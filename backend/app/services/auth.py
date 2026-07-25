"""인증된 사용자 클레임을 애플리케이션 사용자 정보로 변환한다."""

from app.schemas.auth import MeResponse


def get_current_user_summary(user: dict) -> MeResponse:
    """Supabase JWT에서 회원가입 시 저장한 닉네임을 포함한 사용자 정보를 만든다.

    회원가입 화면은 nickname을 ``user_metadata``에 저장한다. 닉네임을 입력하지 않은
    기존 사용자에게는 DB provisioning 트리거와 같은 규칙으로 이메일 앞부분을 사용한다.
    """
    email = user.get("email")
    metadata = user.get("user_metadata")
    raw_nickname = metadata.get("nickname") if isinstance(metadata, dict) else None
    nickname = raw_nickname.strip() if isinstance(raw_nickname, str) else None

    if not nickname and isinstance(email, str):
        nickname = email.partition("@")[0].strip() or None

    return MeResponse(
        id=str(user.get("sub", "")),
        email=email,
        role=user.get("role"),
        nickname=nickname,
    )
