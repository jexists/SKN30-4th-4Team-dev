from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str = "ok"
    db: str
