from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """모든 ORM 모델(= ERD 테이블)의 기반 클래스."""

    pass
