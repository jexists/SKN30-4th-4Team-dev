"""에이전트 그래프 조립 (자리표시).

nodes 를 LangGraph StateGraph 로 엮어 컴파일한다. API(api/routes)는
이 그래프를 실행해 전·월세 분쟁 답변을 얻는다.
실제 조립은 에이전트 구현 단계에서 채운다(LangGraph 의존성도 그때 추가).
"""


def build_graph():
    # TODO(agent): StateGraph(AgentState)에 nodes 등록·엣지 연결 후 compile
    raise NotImplementedError("에이전트 구현 단계에서 작성")
