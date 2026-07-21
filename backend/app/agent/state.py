"""에이전트 그래프 상태 (자리표시).

LangGraph 노드들이 주고받는 공유 상태. 질의·검색 결과·생성 답변 등을 담는다.
필드는 에이전트 구현 단계에서 확정한다.
"""

from typing import TypedDict


class AgentState(TypedDict, total=False):
    query: str  # 사용자 질의
    documents: list[dict]  # tools 로 검색한 근거 문서
    answer: str  # 팩트체크 답변
