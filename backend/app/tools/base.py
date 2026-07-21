"""에이전트가 호출하는 툴의 공통 인터페이스 (자리표시).

각 툴은 이름(name)·설명(description)·실행(run)을 갖는다. 에이전트
(orchestrator)가 LLM 의 판단에 따라 적절한 툴을 골라 호출한다.
"""

from typing import Any, Protocol


class Tool(Protocol):
    name: str
    description: str

    def run(self, **kwargs: Any) -> Any: ...
