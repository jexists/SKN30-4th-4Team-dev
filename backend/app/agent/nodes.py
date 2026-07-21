"""에이전트 그래프 노드 (자리표시).

각 노드는 AgentState 를 받아 갱신해 돌려준다. 예: 검색(retrieve) →
답변 생성(generate). tools/ 의 툴과 model.get_llm 을 사용한다.
"""

from app.agent.state import AgentState


def retrieve(state: AgentState) -> AgentState:
    # TODO(agent): tools.retrieval_tool.retrieve 로 근거 문서 수집
    raise NotImplementedError("에이전트 구현 단계에서 작성")


def generate(state: AgentState) -> AgentState:
    # TODO(agent): model.get_llm + prompts 로 팩트체크 답변 생성
    raise NotImplementedError("에이전트 구현 단계에서 작성")
