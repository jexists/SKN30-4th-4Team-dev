"""ORM 모델 = ERD (DB 테이블/관계).

정의한 모델은 이 파일에서 import 해 Base.metadata 에 등록되도록 합니다.
주의: DB 테이블은 여기(models/), API 입출력은 schemas/ 로 항상 분리합니다.
"""

from app.models.analysis_job import AnalysisJob, AnalysisResult  # noqa: F401
from app.models.auth import AppUser, LoginHistory, Profile, UserAgreement  # noqa: F401
from app.models.chat import ChatMessage, ChatRoom  # noqa: F401
from app.models.notification import Notification  # noqa: F401
