from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str = "ok"
    db: str
    # 임베딩 모델 워밍업 상태: idle·loading·ready·failed. 로그를 안 봐도 확인 가능하게.
    embedder: str = "idle"
