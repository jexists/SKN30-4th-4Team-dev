"""카카오 OAuth 이후 앱 회원가입 API 스키마."""

from typing import Literal

from pydantic import BaseModel, Field

RegistrationStatus = Literal["authenticated", "signup_required"]


class RegistrationResponse(BaseModel):
    status: RegistrationStatus


class AuthUserInfo(BaseModel):
    id: str
    email: str | None = None
    nickname: str | None = None
    profile_image: str | None = None


class KakaoAuthResponse(BaseModel):
    status: RegistrationStatus
    user: AuthUserInfo


class KakaoSignUpRequest(BaseModel):
    nickname: str | None = Field(default=None, max_length=20)
    agree_terms: Literal[True]
    agree_privacy: Literal[True]
    agree_marketing: bool = False
