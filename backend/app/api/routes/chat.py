"""AI 챗봇 엔드포인트 — LangGraph RAG 에이전트(app.agent.graph_rag) 래퍼.

멀티턴은 그래프 내부 루프가 아니라 MemorySaver + thread_id 로 유지한다.
같은 thread_id 로 재호출하면 이전 대화 맥락이 이어진다(현재는 프로세스 메모리에 저장).
"""

import uuid

from fastapi import APIRouter

from app.core.exceptions import AppError
from app.schemas.chat import ChatRequest, ChatResponse
from app.schemas.common import ApiResponse, success_response

router = APIRouter(tags=["chat"])

# graph_rag 는 langgraph·langchain-openai 를 요구하므로 지연 로드한다.
# (미설치·초기화 실패해도 서버 기동과 다른 엔드포인트는 영향받지 않는다.)
_run_turn = None


def _get_run_turn():
    global _run_turn
    if _run_turn is None:
        try:
            from app.agent.graph_rag import run_turn
        except Exception as e:  # 의존성 미설치 / 초기화 실패
            raise AppError(
                "CHAT_UNAVAILABLE",
                "챗봇 엔진을 불러오지 못했습니다. "
                f"의존성(langgraph·langchain-openai) 설치가 필요합니다: {e}",
                503,
            ) from e
        _run_turn = run_turn
    return _run_turn


@router.post("/chat", response_model=ApiResponse[ChatResponse])
def chat(req: ChatRequest) -> ApiResponse[ChatResponse]:
    """한 턴을 처리하고 답변 + thread_id 를 돌려준다.

    동기 함수라 FastAPI 가 스레드풀에서 실행 → OpenAI 블로킹 호출이 이벤트 루프를 막지 않는다.
    """
    thread_id = req.thread_id or uuid.uuid4().hex[:12]
    run_turn = _get_run_turn()
    try:
        answer = run_turn(thread_id, req.message)
    except AppError:
        raise
    except Exception as e:
        raise AppError("CHAT_ERROR", f"답변 생성 중 오류가 발생했습니다: {e}", 500) from e
    return success_response(ChatResponse(answer=answer, thread_id=thread_id))
