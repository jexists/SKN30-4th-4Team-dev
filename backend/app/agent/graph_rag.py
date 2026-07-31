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
  검색 백엔드 미연결(RAG_DB_URL 미설정·데이터 미적재)이면 근거 없이 LLM 답변으로 우회한다.

환경변수: OPENAI_API_KEY, RAG_DB_URL (services.retrieval 이 사용)
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
# LLM 답변은 계속 동작한다(RAG_DB_URL 미설정·데이터 미적재 시 자동으로 근거 없이 진행).
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

# 첨부 계약서 본문의 프롬프트 반영 상한. 여러 장짜리 계약서는 수만 자가 나오는데 전부 넣으면
# 컨텍스트를 계약서가 다 먹어 법령 근거가 밀린다. 앞부분(당사자·보증금·기간·특약)에 핵심이
# 몰려 있어 앞에서 자른다.
MAX_DOCUMENT_CHARS = 8000

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
    # 이 방에 첨부된 계약서 본문(개인정보 치환 완료). 없으면 빈 문자열.
    document_context: str
    # 이번 턴에 올린 첨부를 읽지 못했는지. 계약서 없이 답하되 그 사실을 먼저 밝히게 한다.
    attachment_failed: bool
    # 이 방에 계약서가 **붙어는 있는데** 본문을 가져오지 못했는지(분석 결과 없음·본문 없음).
    # attachment_failed 와 층이 다르다 — 저쪽은 "이번에 올린 파일", 이쪽은 "이미 붙어 있던
    # 계약서" 다. 같은 플래그로 뭉개면 고지 문구가 사실과 어긋난다.
    document_unavailable: bool
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

    # 첨부 계약서는 법령 근거와 층이 다르다 — 근거가 아니라 '사용자의 실제 계약 내용'이다.
    # 첨부가 없을 때 빈 블록을 넣으면 모델이 "계약서를 확인할 수 없다"는 군더더기를 붙이므로
    # 블록과 규칙을 통째로 넣지 않는다.
    document = (state.get("document_context") or "").strip()
    doc_block = f"[첨부 계약서]\n{document[:MAX_DOCUMENT_CHARS]}\n\n" if document else ""

    attachment_failed = bool(state.get("attachment_failed"))
    # 본문이 실제로 들어왔으면 '못 가져왔다'는 고지는 사실이 아니다 — 플래그보다 본문을 믿는다.
    document_unavailable = bool(state.get("document_unavailable")) and not document

    # "첫 문장" 을 요구하는 규칙은 프롬프트 전체에서 **하나뿐이어야 한다.** 예전에는 고정 규칙
    # 2번(첫 문장에서 질문에 직접 답하라)과 첨부 실패 규칙(첫 문장에서 못 읽었다고 밝혀라)이
    # 동시에 첫 문장을 요구해, 모델이 둘 중 하나를 임의로 버렸다 — 고지가 밀리면 사용자는
    # 봇이 자기 계약서를 보고 답한 줄로 읽는다. 그래서 순서 규칙 자체를 조건부로 조립한다.
    # 첨부 실패와 계약서 조회 실패가 겹칠 수도 있으므로(예전 계약서가 붙은 방에서 새 파일까지
    # 실패) 그 경우도 한 줄로 합쳐 둔다 — 두 줄이 되면 다시 첫 문장이 갈라진다.
    answer_rule = (
        "그다음 문장부터는 질문의 핵심 용어를 그대로 사용해 법령·판례에 근거한 결론부터 제시하라."
    )
    if attachment_failed and document_unavailable:
        opening_rule = (
            "첫 문장에서 이번에 올린 첨부 파일도, 이 대화에 연결된 계약서 내용도 읽지 못해 "
            f"일반적인 기준으로 답변한다는 사실을 밝혀라. {answer_rule}"
        )
    elif attachment_failed:
        opening_rule = (
            "첫 문장에서 이번에 올린 첨부 파일을 읽지 못했다는 사실을 밝혀라. 그다음 문장부터는 "
            "질문의 핵심 용어를 그대로 사용해 법령·판례에 근거한 결론부터 제시하라."
        )
    elif document_unavailable:
        opening_rule = (
            "첫 문장에서 현재 첨부된 계약서 내용을 불러오지 못해 일반적인 기준으로 답변한다는 "
            f"사실을 밝혀라. {answer_rule}"
        )
    else:
        opening_rule = (
            "첫 문장에서 질문에 직접 답하라. 질문의 핵심 용어를 그대로 사용해 결론부터 제시하라."
        )

    # 고정 규칙 1~6 뒤에 상황별 규칙을 이어 붙인다. 번호는 여기서 매긴다 — 조건마다 하드코딩하면
    # 첨부만 실패한 턴에서 "6) 다음 8)" 처럼 번호가 뛴다.
    extra_rules: list[str] = []
    if document:
        extra_rules.append(
            "[첨부 계약서]는 사용자가 실제로 올린 계약서다. 계약서에 관한 질문이면 그 내용을 "
            "먼저 확인하고, 법령·판례와 대조해 문제 소지를 짚어라. 계약서에 없는 조항·금액·날짜를 "
            "지어내지 말고, 확인되지 않으면 '첨부된 계약서에서는 확인되지 않는다'고 밝혀라."
        )
    # 첨부를 읽지 못한 턴. 질문까지 버리는 대신 계약서 없이 답하되, 사용자가 올린 파일을 봤다고
    # 오해하지 않도록 모델이 그 사실을 먼저 밝히게 한다(순서는 위 opening_rule 이 정한다 —
    # 여기서 다시 "첫 문장" 을 요구하면 규칙이 둘로 갈라진다).
    if attachment_failed:
        extra_rules.append(
            "이번 질문에 올린 파일은 처리에 실패해 읽지 못했다. 그 사실을 밝힌 뒤에는 법령·판례에 "
            "근거한 일반적인 기준으로 최대한 구체적으로 답하라. 사과나 재시도 안내는 넣지 마라"
            "(화면이 이미 알린다). 읽지 못한 파일의 금액·날짜·조항을 아는 것처럼 말하거나 "
            "지어내지 마라."
        )
        # 방에 예전 계약서가 붙어 있으면 doc_block 은 그 계약서다. 어느 쪽을 못 읽었는지 못 박는다.
        if document:
            extra_rules.append(
                "위 [첨부 계약서]는 이번에 올린 파일이 아니라 **이 대화에 이미 붙어 있던** "
                "계약서다. 그 내용을 근거로 쓸 때는 이번에 올린 파일과 혼동하지 마라."
            )
    # 이 대화에 계약서가 붙어는 있는데 본문을 가져오지 못한 턴. 질문을 막지 않고 일반 답변을
    # 내되, 계약서를 읽은 것처럼 말하면 사용자가 자기 계약서를 근거로 한 답으로 오해한다.
    if document_unavailable:
        extra_rules.append(
            "이 대화에 연결된 계약서의 내용을 이번 턴에는 불러오지 못했다. 계약서를 실제로 읽은 "
            "것처럼 말하거나 그 금액·날짜·조항을 지어내지 말고, 법령·판례에 근거한 일반적인 "
            "기준으로 최대한 구체적으로 답하라. 사과나 재시도 안내는 넣지 마라(화면이 이미 알린다)."
        )
    doc_rule = "".join(f"{i}) {rule}\n" for i, rule in enumerate(extra_rules, start=7))

    prompt = (
        "너는 세입자를 돕는 법률 상담봇이다. 아래 근거만 사용해 답하라.\n"
        "규칙:\n"
        "1) 딱딱한 보고서체(~한다/~이다)가 아니라 상담원이 말하듯 정중한 해요체로 답하라.\n"
        f"2) {opening_rule}\n"
        "3) 결론의 법적 근거는 [법령·판례]에서 인용하고 출처(법령명·조항 또는 법원·사건번호)를 "
        "자연스럽게 문장 안에 녹여라.\n"
        "4) 근거가 부분적이면 그 범위 안에서 최대한 구체적으로 답하고, "
        "마지막에 한 문장으로 한계를 밝혀라. 답변 전체를 '알 수 없다'로 끝내지 마라.\n"
        "5) [사례]는 '이런 경우 이렇게 판단된 적 있다'는 참고로만. "
        "근거에 없는 내용은 절대 단정하지 마라. 근거 밖 사실을 추가하지 마라.\n"
        "6) 이전 대화가 있으면 이어지는 대화처럼 답하라. 앞에서 이미 설명한 내용은 반복하지 말고 "
        "새로 묻는 부분에 집중하라. 면책 문구·인사말은 넣지 마라.\n"
        f"{doc_rule}\n"
        f"[대화 맥락]\n{_history_text(state)}\n\n"
        f"{doc_block}"
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
def run_turn(
    question: str,
    history: list[dict] | None = None,
    document_context: str | None = None,
    attachment_failed: bool = False,
    document_unavailable: bool = False,
) -> str:
    """한 턴 실행.

    document_context 는 방에 첨부된 계약서 본문(개인정보 치환 완료)이다.
    attachment_failed 는 이번 턴에 올린 파일을 읽지 못했다는 뜻으로, 계약서 없이 답하되
    모델이 그 사실을 먼저 밝히게 한다(첨부가 실패했다고 질문까지 버리지 않기 위한 것).
    document_unavailable 은 방에 계약서가 붙어 있는데 그 본문을 가져오지 못했다는 뜻이다.
    둘 다 "계약서 없이 답하되 그 사실을 알린다" 지만 **무엇을 못 읽었는지가 다르므로**
    문구가 달라야 한다 — 한 플래그로 합치면 고지가 사실과 어긋난다.
    """
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
            "document_context": document_context or "",
            "attachment_failed": attachment_failed,
            "document_unavailable": document_unavailable,
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
