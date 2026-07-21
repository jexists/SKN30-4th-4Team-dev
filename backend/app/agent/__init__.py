"""전·월세 분쟁 팩트체크 에이전트 (자리표시, LangGraph).

LangGraph 그래프가 tools/ 의 툴을 호출해 근거를 모으고 답변을 생성한다.
- state   : 노드 간 공유 상태(AgentState)
- prompts : 프롬프트 템플릿
- model   : LLM 모델 팩토리
- nodes   : 그래프 노드(검색·생성 등)
- graph   : 노드를 엮어 컴파일한 그래프(build_graph)
실제 로직은 RAG/에이전트 구현 단계에서 채운다.
"""
