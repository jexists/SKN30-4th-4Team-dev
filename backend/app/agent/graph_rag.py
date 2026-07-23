"""
graph_rag.py
전·월세 분쟁 RAG 챗봇 — 최소 LangGraph (의도분류/intake 없이 매 턴 검색).

구조:
  START → retrieve → [grade_router: 유사도 임계값]
                        ├ generate            (근거 충분 또는 재작성 상한)
                        └ rewrite_query → retrieve   (근거 부족, 최대 1회)
        generate → END

- chitchat/followup 의도분류와 intake 노드를 제거했다. 매 턴 사용자의 질문을 그대로 검색해
  근거 기반으로 답한다. (대화 맥락은 generate 프롬프트의 [대화 맥락] 으로만 반영)
- 멀티턴은 그래프 내부 루프가 아니라 MemorySaver + thread_id 로 상태를 유지하고 매 턴 재호출한다.
  turn 마다 query/retrieval_attempts 는 run_turn 이 초기화한다.
- 검색은 app.services.retrieval.search_similar (KURE-v1 임베딩 + pgvector) 사용.
  ⚠️ 검색 결과는 {**metadata, content, similarity} 이며 metadata 키는 문서마다 다르다
     (법령: law_name/article, 판례: court/case_no …) → 모든 접근은 .get() 으로 방어.
  검색 백엔드 미연결(DB_URL 미설정·데이터 미적재)이면 근거 없이 LLM 답변으로 우회한다.

환경변수: OPENAI_API_KEY, DB_URL (services.retrieval 이 사용)
"""

from __future__ import annotations

from typing import Annotated

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

load_dotenv()

# pgvector 검색은 선택적. 모듈이 없거나 검색이 실패하면 빈 결과로 우회해
# LLM 답변은 계속 동작한다(DB_URL 미설정·데이터 미적재 시 자동으로 근거 없이 진행).
try:
    from app.services.retrieval import search_similar as _search_similar
except Exception:
    _search_similar = None

# ──────────────────────────────────────────────
# LLM
# ──────────────────────────────────────────────
llm = ChatOpenAI(model="gpt-4.1-mini", temperature=0, timeout=30, max_retries=2)
# 쿼리 재작성 등 짧은 보조 호출용 (빠르고 저렴) — 답변 생성은 위 llm 유지
fast_llm = ChatOpenAI(model="gpt-4.1-nano", temperature=0, timeout=20, max_retries=2)

MAX_RETRIEVAL_ATTEMPTS = 1  # 쿼리 재작성 최대 1회

# 결정론 grade 임계값 (KURE-v1: 관련 조항 보통 0.5~0.7)
GRADE_STRONG = 0.45  # top-1 이 이 이상이면 충분 → 바로 생성
GRADE_WEAK = 0.35  # top-1 이 이 미만이면 부족 → (남은 횟수 내) 재작성


def _history_text(state: ChatState, n: int = 12) -> str:
    """최근 대화 n개를 프롬프트용 텍스트로. 법적 고지 꼬리는 제거해 노이즈 감소."""
    lines = []
    for m in (state.get("messages") or [])[-n:]:
        role = "사용자" if isinstance(m, HumanMessage) else "상담봇"
        content = (getattr(m, "content", "") or "").split("\n\n---\n")[0]
        lines.append(f"{role}: {content[:200]}")
    return "\n".join(lines) or "(이전 대화 없음)"


def _cite(h: dict) -> str:
    """source_type 별 출처 표기 (metadata 키가 문서마다 다르므로 .get 으로 분기)."""
    st = h.get("source_type")
    if st in ("statute", "interpretation"):
        return " ".join(x for x in (h.get("law_name"), h.get("article")) if x) or h.get(
            "doc_title", ""
        )
    if st == "precedent":
        return " ".join(x for x in (h.get("court"), h.get("case_no")) if x) or h.get(
            "doc_title", ""
        )
    if st in ("mediation_case", "counsel_case"):
        no = h.get("case_no") or h.get("사례번호")
        return f"{h.get('doc_title', '')} {no}".strip() if no else h.get("doc_title", "")
    return h.get("doc_title", "")  # standard_contract / guide 등


# ──────────────────────────────────────────────
# 공유 State (RAG 챗봇에 필요한 필드만)
# ──────────────────────────────────────────────
class ChatState(TypedDict, total=False):
    # 입력 / 세션
    question: str
    messages: Annotated[list, add_messages]
    # 검색 / 생성
    query: str  # 검색어 (초기엔 질문, rewrite_query 가 갱신)
    retrieved: list
    retrieval_attempts: int
    answer: str
    _last_query: str  # 직전 검색 쿼리 (동일 쿼리 재검색 스킵용)


# ══════════════════════════════════════════════
# 검색 → 관련성 라우팅 → (재작성 루프) → 생성
# ══════════════════════════════════════════════
def _query(state: ChatState) -> str:
    return state.get("query") or state.get("question", "")


def retrieve(state: ChatState) -> dict:
    """pgvector 검색. 재작성 쿼리가 직전과 같으면 재검색을 생략한다.
    재작성으로 다시 온 경우 기존 결과와 병합해 recall 을 높인다."""
    q = _query(state)
    if state.get("_last_query") == q and state.get("retrieved"):
        return {}  # 동일 쿼리 → 기존 결과 재사용
    if _search_similar is None:  # 검색 백엔드 미연결 → 근거 없이 진행
        return {"retrieved": [], "_last_query": q}
    try:
        hits = _search_similar(query=q, k=12, min_score=0.15)
    except Exception:  # 검색 실패도 대화가 끊기지 않게 우회
        return {"retrieved": state.get("retrieved") or [], "_last_query": q}
    # 재검색(재작성)이면 기존 결과와 병합 (교체 X): 시도마다 근거가 누적돼 recall 상승
    prev = state.get("retrieved") or []
    if prev and state.get("retrieval_attempts", 0) > 0:
        seen, merged = set(), []
        for h in sorted(prev + hits, key=lambda x: -x.get("similarity", 0)):
            key = h.get("content", "")[:120]
            if key not in seen:
                seen.add(key)
                merged.append(h)
        hits = merged[:12]
    return {"retrieved": hits, "_last_query": q}


def _top_score(state: ChatState) -> float:
    hits = state.get("retrieved") or []
    return hits[0].get("similarity", 0.0) if hits else 0.0


def grade_router(state: ChatState) -> str:
    """관련성 평가 — 노드가 아니라 retrieve 뒤 조건부 엣지의 순수 라우터.
    top-1 >= GRADE_STRONG 이면 충분, < GRADE_WEAK(또는 결과 없음)이면 부족 → 재작성."""
    if _search_similar is None:  # 검색 백엔드 미연결 → 재작성 무의미, 바로 생성
        return "generate"
    top = _top_score(state)
    if top >= GRADE_STRONG:
        return "generate"
    if top < GRADE_WEAK and state.get("retrieval_attempts", 0) < MAX_RETRIEVAL_ATTEMPTS:
        return "rewrite"
    return "generate"  # 중간 구간 또는 상한 초과 → 있는 근거로 진행(부족 고지)


def rewrite_query(state: ChatState) -> dict:
    """부족한 부분을 반영해 쿼리 재작성 후 재검색 루프 (최대 1회)."""
    new_q = fast_llm.invoke(
        f"원 질문: {_query(state)}\n"
        f"부족한 점: 관련 조항 부족(top score {_top_score(state):.2f})\n"
        "임대차 법령 검색에 잘 걸리도록, 원 질문과 다른 표현으로 재작성해라. "
        "관련 법령명(주택임대차보호법 등)과 법률 용어(대항력·우선변제권·수선의무·계약갱신요구권·"
        "임차권등기명령 등) 중 해당하는 것을 포함한 한 문장만 출력."
    ).content.strip()
    return {"query": new_q, "retrieval_attempts": state.get("retrieval_attempts", 0) + 1}


def generate(state: ChatState) -> dict:
    """근거 기반 답변 생성. 결론은 binding, 사례는 persuasive 로 층 분리.
    답변을 messages 에도 적재(멀티턴 히스토리 유지)."""
    retrieved = state.get("retrieved") or []
    binding = [h for h in retrieved if h.get("authority") == "binding"]
    persuasive = [h for h in retrieved if h.get("authority") == "persuasive"]
    ref = [h for h in retrieved if h.get("authority") == "reference"]

    def fmt(hs):
        # source_type 별 출처 표기(_cite): 법령→법령명·조항, 판례→법원·사건번호, 사례→문서명
        return "\n".join(f"- {_cite(h)}: {h.get('content', '')[:200]}" for h in hs) or "(없음)"

    prompt = (
        "너는 세입자를 돕는 법률 상담봇이다. 아래 근거만 사용해 답하라.\n"
        "규칙:\n"
        "1) 딱딱한 보고서체(~한다/~이다)가 아니라 상담원이 말하듯 정중한 해요체로 답하라.\n"
        "2) 첫 문장에서 질문에 직접 답하라. 질문의 핵심 용어를 그대로 사용해 결론부터 제시하라.\n"
        "3) 결론의 법적 근거는 [법령·판례]에서 인용하고 출처(법령명·조항 또는 법원·사건번호)를 "
        "자연스럽게 문장 안에 녹여라.\n"
        "4) 근거가 부분적이면 그 범위 안에서 최대한 구체적으로 답하고, "
        "마지막에 한 문장으로 한계를 밝혀라. 답변 전체를 '알 수 없다'로 끝내지 마라.\n"
        "5) [사례]는 '이런 경우 이렇게 판단된 적 있다'는 참고로만. "
        "근거에 없는 내용은 절대 단정하지 마라. 근거 밖 사실을 추가하지 마라.\n"
        "6) 이전 대화가 있으면 이어지는 대화처럼 답하라. 앞에서 이미 설명한 내용은 반복하지 말고 "
        "새로 묻는 부분에 집중하라. 면책 문구·인사말은 넣지 마라.\n\n"
        f"[대화 맥락]\n{_history_text(state)}\n\n"
        f"[법령·판례]\n{fmt(binding)}\n\n[사례]\n{fmt(persuasive)}\n\n[실무 참고]\n{fmt(ref)}\n\n"
        f"질문: {state.get('question', '')}"
    )

    answer = llm.invoke(prompt).content.strip()
    return {"answer": answer, "messages": [AIMessage(content=answer)]}


# ══════════════════════════════════════════════
# 그래프 조립 (검색 → 생성 최소 그래프)
# ══════════════════════════════════════════════
def build_app():
    g = StateGraph(ChatState)

    g.add_node("retrieve", retrieve)
    g.add_node("rewrite_query", rewrite_query)
    g.add_node("generate", generate)

    g.add_edge(START, "retrieve")

    # 검색 → 결정론 관련성 라우터 (→ 쿼리 재작성 루프, 최대 1회)
    g.add_conditional_edges(
        "retrieve", grade_router, {"generate": "generate", "rewrite": "rewrite_query"}
    )
    g.add_edge("rewrite_query", "retrieve")

    g.add_edge("generate", END)

    return g.compile(checkpointer=MemorySaver())


app = build_app()


# ──────────────────────────────────────────────
# 한 턴 실행 헬퍼
# ──────────────────────────────────────────────
# 대화 맥락은 호출자가 넘긴 history 로 주입한다(DB 가 기록의 원본).
# MemorySaver 는 그래프 컴파일 요건이라 남겨두되, 매 호출 새 thread_id 로 격리한다.
def run_turn(question: str, history: list[dict] | None = None) -> str:
    import uuid

    msgs = []
    for h in history or []:
        content = (h.get("content") or "").strip()
        if not content:
            continue
        msgs.append(
            AIMessage(content=content)
            if h.get("role") == "assistant"
            else HumanMessage(content=content)
        )
    msgs.append(HumanMessage(content=question))  # 이번 턴 질문

    out = app.invoke(
        {
            "question": question,
            "query": question,  # 이번 턴 검색어 (재작성 전 초기값)
            "retrieval_attempts": 0,  # 턴마다 재작성 예산 초기화
            "messages": msgs,
        },
        config={"configurable": {"thread_id": uuid.uuid4().hex}},
    )
    return out["answer"]


if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("🏠 전·월세 분쟁 RAG 챗봇 실행")
    print("=" * 50)
    print("※ 종료하려면 '종료' 또는 'exit'를 입력하세요.\n")

    history: list[dict] = []
    while True:
        question = input("\n👤 질문 입력: ").strip()
        if question.lower() in ["종료", "exit", "quit"]:
            print("\n👋 챗봇을 종료합니다. 안전한 거래 되세요!")
            break
        if not question:
            print("⚠️ 질문을 입력해 주세요.")
            continue
        print("\n🔍 관련 법령 및 판례 검색 중...")
        try:
            answer = run_turn(question, history)
            print(f"\n🤖 [답변]:\n{answer}")
            print("\n" + "─" * 50)
            history.append({"role": "user", "content": question})
            history.append({"role": "assistant", "content": answer})
        except Exception as e:
            print(f"\n❌ 에러가 발생했습니다: {e}")
