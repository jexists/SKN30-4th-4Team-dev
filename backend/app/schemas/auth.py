from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MeResponse(BaseModel):
    """현재 로그인한 사용자 요약 — Supabase JWT 클레임에서 뽑아낸다."""

    id: str  # Supabase user id (JWT sub)
    email: str | None = None
    role: str | None = None
    nickname: str | None = None
    # 로그인 수단. Supabase 가 app_metadata.provider 에 넣어주는 값 그대로("email"/"kakao").
    login_provider: str | None = None
    # 프로필 사진 공개 URL(Supabase Storage). profile.profile_image 를 그대로 내보낸다.
    profile_image: str | None = None
    # 위험 보고서 생성 완료 알림 수신 여부. profile.notify_report_complete 를 그대로 내보낸다.
    notify_report_complete: bool = True


class UpdateNicknameIn(BaseModel):
    """닉네임 변경 요청. 카카오 가입 시 닉네임 상한(20자)과 동일하게 맞춘다."""

    model_config = ConfigDict(str_strip_whitespace=True)

    nickname: str = Field(min_length=1, max_length=20)


class UpdateNotificationPrefIn(BaseModel):
    """위험 보고서 생성 완료 알림 수신 여부 변경 요청."""

    notify_report_complete: bool


class WithdrawalResponse(BaseModel):
    """회원 탈퇴 결과. Soft Delete 라 계정 행은 남고 표시만 바뀐다."""

    id: str
    deleted_at: datetime
