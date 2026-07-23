"""AI 챗봇 엔드포인트 — LangGraph RAG 에이전트(app.agent.graph_rag) 래퍼.

멀티턴 맥락은 요청의 history 로 주입한다(대화 기록의 원본은 DB = chat_room/chat_message,
프론트가 최근 N개를 함께 보낸다). 저장·조회는 프론트가 Supabase 로 직접 한다.
"""

import time

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
    """한 턴을 처리하고 답변 + 응답시간(ms)을 돌려준다.

    동기 함수라 FastAPI 가 스레드풀에서 실행 → OpenAI 블로킹 호출이 이벤트 루프를 막지 않는다.
    """
    run_turn = _get_run_turn()
    history = [t.model_dump() for t in req.history]
    started = time.perf_counter()
    try:
        answer = run_turn(req.message, history)
    except AppError:
        raise
    except Exception as e:
        raise AppError("CHAT_ERROR", f"답변 생성 중 오류가 발생했습니다: {e}", 500) from e
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return success_response(ChatResponse(answer=answer, response_time_ms=elapsed_ms))
