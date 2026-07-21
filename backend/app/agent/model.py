"""LLM 모델 팩토리 (자리표시).

에이전트가 쓰는 LLM 인스턴스를 생성한다. 구체 모델·프로바이더는
추후 결정(루트 CLAUDE.md). 키는 core/config(.env)에서 읽는다.
"""


def get_llm():
    raise NotImplementedError("에이전트 구현 단계에서 작성")
