# 카카오 회원가입·로그인

## 책임 분리

- Kakao OAuth, access token, refresh token, logout: Supabase Auth
- JWT 검증, 서비스 회원 판별, 프로필·약관·로그인 이력: FastAPI
- 서비스 회원 판별 기준: 활성 `public.app_user`와 현재 버전 필수약관(`terms`, `privacy`)
  동의 행 존재

카카오 OAuth가 처음 성공하면 Supabase의 `auth.users`에는 인증 식별자가 만들어진다. 이
시점에는 서비스 약관에 동의하지 않았으므로 `app_user`는 만들지 않는다. 신규 사용자가
가입 화면에서 필수약관에 동의한 뒤 `/api/v1/auth/signup`이 앱 회원 데이터를 하나의
트랜잭션으로 생성한다.

## 전체 흐름

1. 프론트가 `supabase.auth.signInWithOAuth({ provider: "kakao" })`를 PKCE 방식으로 호출한다.
2. Kakao → Supabase callback → `/auth/callback`으로 돌아온다.
3. 프론트가 authorization code를 Supabase 세션으로 교환한다.
4. `POST /api/v1/auth/kakao/login`으로 서비스 회원 여부를 확인한다.
5. 기존 회원은 원래 화면으로 이동하고 로그인 이력을 저장한다.
6. 신규 사용자는 회원가입 안내 모달에서 가입 여부를 선택한다. 확인하면
   `/signup?mode=kakao`로 이동하고, 취소하면 임시 인증 계정을 삭제하고 로그아웃한다.
7. 가입 화면에서 닉네임과 약관 동의를 입력한다.
8. `POST /api/v1/auth/signup`이 가입을 완료한다.
9. 가입 완료 전 다른 화면으로 이동하면 `DELETE /api/v1/auth/kakao/pending`이 임시
   `auth.users` 계정을 삭제하고 Supabase 세션을 종료한다.

Refresh Token은 Supabase JS가 관리한다. 기존 `refreshSession()` 재시도와
`supabase.auth.signOut()`을 사용하므로 별도 refresh/logout API나 DB 컬럼은 없다.

## API

모든 요청은 `Authorization: Bearer <Supabase access token>`을 사용하고 기존
`ApiResponse` 봉투로 응답한다.

### 회원 상태 조회

```http
GET /api/v1/auth/registration
```

```json
{
  "success": true,
  "code": 200,
  "message": "",
  "data": { "status": "signup_required" },
  "error": null
}
```

### 카카오 로그인 완료 통지

```http
POST /api/v1/auth/kakao/login
Content-Type: application/json

{}
```

```json
{
  "success": true,
  "code": 200,
  "message": "",
  "data": {
    "status": "authenticated",
    "user": {
      "id": "0d8e7dbb-8a75-41ab-b507-6f15409ca0c4",
      "email": null,
      "nickname": "홈쉴드",
      "profile_image": "https://example.com/profile.png"
    }
  },
  "error": null
}
```

### 카카오 회원가입 완료

```http
POST /api/v1/auth/signup
Content-Type: application/json

{
  "nickname": "홈쉴드",
  "agree_terms": true,
  "agree_privacy": true,
  "agree_marketing": false
}
```

성공 시 HTTP 201과 `status: "authenticated"`를 반환한다. 필수동의 누락은 422,
이미 가입된 회원은 409, 유효한 JWT지만 앱 회원이 아닌 사용자의 회원 전용 API 접근은
403이다.

### 미완료 카카오 가입 취소

```http
DELETE /api/v1/auth/kakao/pending
```

가입 화면 이탈 시 호출한다. 필수약관 동의까지 완료된 회원은 409로 보호하며 삭제하지
않는다. 미완료 인증 계정은 `auth.users`에서 삭제한 뒤 프론트가 로컬 세션을 종료한다.

## 외부 설정

1. Kakao Developers에서 앱을 만들고 카카오 로그인을 활성화한다.
2. REST API 키와 활성화된 Client Secret을 Supabase Authentication Providers의 Kakao에
   입력한다.
3. Kakao Redirect URI에 다음 값을 등록한다.

   ```text
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

4. Kakao 동의 항목에서 `profile_nickname`, `profile_image`를 설정한다.
5. 이 서비스는 이메일이 없는 카카오 계정도 허용하므로 Supabase Kakao provider에서
   **Allow users without an email**을 활성화한다.
6. Supabase Redirect Allow List에 아래 주소와 실제 운영 주소를 추가한다.

   ```text
   http://localhost:5173/auth/callback
   https://<production-origin>/auth/callback
   ```

7. Supabase SQL Editor에서 `backend/sql/schema.sql` 적용 후
   `backend/sql/auth_provisioning.sql`을 다시 적용한다.

키와 Client Secret은 저장소의 `.env`에 추가하지 않고 Kakao/Supabase Dashboard에서만
관리한다.

## 운영 확인

- 신규 카카오 계정: OAuth 후 가입 화면 표시, 동의 후 4개 앱 테이블 생성
- 기존 카카오 계정: 가입 화면 없이 로그인, `login_history` 추가
- 가입 중 앱 내부 화면 이탈: 미완료 `auth.users` 삭제 후 비회원 세션으로 전환
- 만료 access token: Supabase refresh 후 API 한 번 재시도
- 로그아웃: Supabase 세션 제거 후 보호 화면 접근 차단
