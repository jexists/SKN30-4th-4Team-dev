"""POST /api/v1/chat — 계약서를 못 읽은 턴의 처리와 인증.

계약서를 사용하지 못하는 경우는 둘이고 문구가 서로 다르다.
  - `attachment_failed` — **이번 턴에 올린** 파일의 OCR·분석이 실패했다(프론트가 켜 보낸다).
  - `document_unavailable` — **이미 방에 붙어 있던** 계약서의 본문을 못 읽었다(서버가 판단).
둘 중 어느 신호든 끊기면 모델은 계약서를 본 것처럼 답하고, 사용자는 자기 계약서를 근거로 한
답이라고 읽는다. 그래서 여기서는 "run_turn 까지 무엇이 전달되는가" 를 본다.

인증도 같은 자리에서 본다 — 예전에는 만료·무효 토큰이 조용히 익명으로 강등돼, 세션이 끊긴
사용자가 401 대신 계약서 없는 일반 답변을 이유도 모른 채 받았다.

챗봇 엔진(langgraph·langchain-openai)은 지연 로드되므로 여기서는 `_run_turn` 캐시를 직접
갈아끼운다 — OPENAI_API_KEY 도, 무거운 import 도 필요 없다.
"""

import time
import uuid

import jwt
import pytest
from jwt.exceptions import PyJWKClientConnectionError

from app.api.routes import chat as chat_module
from app.core import config, security
from app.models.analysis_job import AnalysisJob, AnalysisResult, JobStatus
from app.models.chat import ChatRoom


@pytest.fixture()
def captured_turn(monkeypatch):
    """run_turn 호출 인자를 붙잡아 두는 가짜 엔진."""
    calls: list[dict] = []

    def fake_run_turn(
        question,
        history=None,
        document_context=None,
        attachment_failed=False,
        document_unavailable=False,
    ):
        calls.append(
            {
                "question": question,
                "history": history,
                "document_context": document_context,
                "attachment_failed": attachment_failed,
                "document_unavailable": document_unavailable,
            }
        )
        return "가짜 답변"

    monkeypatch.setattr(chat_module, "_run_turn", fake_run_turn)
    return calls


def test_attachment_failed_는_run_turn_까지_전달된다(client, captured_turn):
    res = client.post(
        "/api/v1/chat",
        json={"message": "내가 전세 얼마인지 알아?", "attachment_failed": True},
    )

    assert res.status_code == 200
    assert res.json()["data"]["answer"] == "가짜 답변"
    assert captured_turn[0]["attachment_failed"] is True
    # 첨부를 못 읽었으므로 계약서 본문은 없다 — 그래도 질문은 그대로 나간다.
    assert captured_turn[0]["question"] == "내가 전세 얼마인지 알아?"
    assert captured_turn[0]["document_context"] is None


def test_필드를_생략한_예전_클라이언트는_기본값_False_로_동작한다(client, captured_turn):
    res = client.post("/api/v1/chat", json={"message": "전세금 반환 절차 알려줘"})

    assert res.status_code == 200
    assert captured_turn[0]["attachment_failed"] is False


@pytest.mark.parametrize("flag", [True, False])
def test_플래그와_무관하게_답변_봉투는_같다(client, captured_turn, flag):
    res = client.post(
        "/api/v1/chat",
        json={"message": "보증금 못 받았어요", "attachment_failed": flag},
    )

    body = res.json()
    assert body["success"] is True
    assert body["data"]["answer"] == "가짜 답변"
    assert body["data"]["response_time_ms"] >= 0


# ── 인증 ────────────────────────────────────────────────────────
# /chat 의 인증은 '선택' 이지만, 그건 **헤더가 아예 없을 때만** 익명을 허용한다는 뜻이다.
# 토큰이 오긴 왔는데 못 믿을 때 이를 익명으로 강등하면 프론트의 갱신·재요청 흐름(401 을 보고
# 돈다)이 통째로 죽고, 사용자는 계약서 없는 답을 받고도 이유를 알 수 없다.

TEST_SECRET = "test-jwt-secret-0123456789-abcdefghij"  # ≥32B (HMAC 권장 길이)


def _token(sub: str, *, exp_delta: int = 3600, secret: str = TEST_SECRET) -> str:
    return jwt.encode(
        {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + exp_delta},
        secret,
        algorithm="HS256",
    )


def _auth(sub: str, **kwargs) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(sub, **kwargs)}"}


@pytest.fixture()
def auth_secret(monkeypatch):
    """검증 시크릿을 테스트 값으로 설정(security.py 가 참조하는 공유 settings)."""
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_SECRET", TEST_SECRET)
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_AUD", "authenticated")
    monkeypatch.setattr(config.settings, "JWT_LEEWAY_SECONDS", 60)
    return TEST_SECRET


@pytest.fixture()
def make_room(db_sessionmaker):
    """방을 만들어 room_id 를 돌려준다. attached=True 면 계약서 분석까지 붙인다.

    payload=None 이면 AnalysisResult 자체를 만들지 않는다(= 결과가 지워진 방).
    """

    def _make(user_id: uuid.UUID, *, attached: bool = False, payload: dict | None = None) -> str:
        room_id = uuid.uuid4()
        job_id = uuid.uuid4() if attached else None
        with db_sessionmaker() as db:
            if attached:
                db.add(
                    AnalysisJob(
                        id=job_id,
                        user_id=user_id,
                        file_names=["계약서.pdf"],
                        status=JobStatus.SUCCEEDED.value,
                    )
                )
                if payload is not None:
                    db.add(AnalysisResult(job_id=job_id, user_id=user_id, payload=payload))
            db.add(ChatRoom(id=room_id, user_id=user_id, title="테스트 방", analysis_job_id=job_id))
            db.commit()
        return str(room_id)

    return _make


def test_헤더가_없고_room_id_도_없으면_익명_일반_채팅이_된다(client, captured_turn):
    res = client.post("/api/v1/chat", json={"message": "전세금 반환 절차 알려줘"})

    assert res.status_code == 200
    assert captured_turn[0]["document_context"] is None
    assert captured_turn[0]["document_unavailable"] is False


def test_헤더가_없는데_room_id_가_있으면_401(client, captured_turn):
    """방은 누군가의 소유물이다 — 익명으로 남의 방 id 를 넣어 볼 수 있으면 안 된다."""
    res = client.post(
        "/api/v1/chat", json={"message": "내 계약서 봐줘", "room_id": str(uuid.uuid4())}
    )

    assert res.status_code == 401
    assert res.json()["error"]["title"] == "로그인 필요"
    assert captured_turn == []


def test_만료된_토큰은_익명으로_강등되지_않고_401(client, auth_secret, captured_turn):
    res = client.post(
        "/api/v1/chat",
        json={"message": "전세금 반환 절차 알려줘"},
        headers=_auth(str(uuid.uuid4()), exp_delta=-3600),
    )

    assert res.status_code == 401
    assert res.json()["error"]["message"] == "세션이 만료되었습니다. 다시 로그인해 주세요."
    # 이게 원래 버그였다 — 만료 토큰이 None 으로 뭉개져 익명 일반 답변이 그대로 나갔다.
    assert captured_turn == []


def test_무효한_토큰은_401(client, auth_secret, captured_turn):
    res = client.post(
        "/api/v1/chat",
        json={"message": "전세금 반환 절차 알려줘"},
        headers=_auth(str(uuid.uuid4()), secret="a-different-secret"),
    )

    assert res.status_code == 401
    assert captured_turn == []


class _FailingJwksClient:
    """JWKS 조회가 실패하는 대역(네트워크 단절·Supabase 장애)."""

    def get_signing_key_from_jwt(self, _token: str):
        raise PyJWKClientConnectionError("JWKS 응답 없음")


def test_인증_서버_장애는_401_이_아니라_503(client, monkeypatch, captured_turn):
    """멀쩡한 세션을 만료로 취급해 로그아웃시키면 안 된다."""
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode(
        {"sub": str(uuid.uuid4()), "aud": "authenticated", "exp": int(time.time()) + 3600},
        private_key,
        algorithm="ES256",
    )
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_AUD", "authenticated")
    monkeypatch.setattr(security, "_get_jwks_client", lambda: _FailingJwksClient())

    res = client.post(
        "/api/v1/chat",
        json={"message": "전세금 반환 절차 알려줘"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert res.status_code == 503
    assert res.json()["error"]["title"] == "인증 서버 오류"
    assert captured_turn == []


def test_남의_방은_404(client, auth_secret, captured_turn, register_member, make_room):
    """존재 여부를 알려주지 않는다 — 없는 방·잘못된 UUID 와 같은 문구다."""
    owner = register_member()
    intruder = register_member()
    room_id = make_room(owner)

    res = client.post(
        "/api/v1/chat",
        json={"message": "이 계약서 봐줘", "room_id": room_id},
        headers=_auth(str(intruder)),
    )

    assert res.status_code == 404
    assert res.json()["error"]["message"] == "이미 삭제되었거나 존재하지 않는 대화입니다."
    assert captured_turn == []


# ── 계약서 context 의 세 가지 상태 ──────────────────────────────────
# A. 계약서가 원래 없는 방      → 일반 답변, 고지 없음
# B. 계약서가 정상             → 그 본문을 근거로
# C. 계약서는 붙었는데 못 읽음  → 일반 답변 + "못 불러왔다" 고지
# 예전에는 B 가 아닌 모든 경우가 A 로 뭉개져, C 에서 모델이 아무 말 없이 일반 답변을 냈다.


def test_계약서가_없는_방은_일반_답변이고_고지도_없다(
    client, auth_secret, captured_turn, register_member, make_room
):
    user_id = register_member()
    room_id = make_room(user_id)

    res = client.post(
        "/api/v1/chat",
        json={"message": "계약갱신요구권이 뭐예요?", "room_id": room_id},
        headers=_auth(str(user_id)),
    )

    assert res.status_code == 200
    assert captured_turn[0]["document_context"] is None
    assert captured_turn[0]["document_unavailable"] is False


def test_정상_계약서는_본문이_run_turn_까지_전달된다(
    client, auth_secret, captured_turn, register_member, make_room
):
    user_id = register_member()
    room_id = make_room(user_id, attached=True, payload={"sanitized_text": "  임대차계약서 본문  "})

    res = client.post(
        "/api/v1/chat",
        json={"message": "보증금이 얼마죠?", "room_id": room_id},
        headers=_auth(str(user_id)),
    )

    assert res.status_code == 200
    assert captured_turn[0]["document_context"] == "임대차계약서 본문"
    assert captured_turn[0]["document_unavailable"] is False


def test_분석_결과가_없으면_일반_답변을_하되_못_불러왔다고_알린다(
    client, auth_secret, captured_turn, register_member, make_room
):
    user_id = register_member()
    room_id = make_room(user_id, attached=True)  # AnalysisResult 없음

    res = client.post(
        "/api/v1/chat",
        json={"message": "보증금이 얼마죠?", "room_id": room_id},
        headers=_auth(str(user_id)),
    )

    # 요청을 실패시키지 않는다 — 계약서를 못 찾았다고 대화를 끊는 것보다 일반 답변이 낫다.
    assert res.status_code == 200
    assert res.json()["data"]["answer"] == "가짜 답변"
    assert captured_turn[0]["document_context"] is None
    assert captured_turn[0]["document_unavailable"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {},  # payload 는 있는데 sanitized_text 가 없다
        {"sanitized_text": None},
        {"sanitized_text": 123},  # 타입 오류
        {"sanitized_text": "   "},  # 공백뿐인 빈 본문
    ],
    ids=["없음", "None", "타입오류", "빈문자열"],
)
def test_본문이_비어_있으면_못_불러왔다고_알린다(
    client, auth_secret, captured_turn, register_member, make_room, payload
):
    user_id = register_member()
    room_id = make_room(user_id, attached=True, payload=payload)

    res = client.post(
        "/api/v1/chat",
        json={"message": "보증금이 얼마죠?", "room_id": room_id},
        headers=_auth(str(user_id)),
    )

    assert res.status_code == 200
    assert captured_turn[0]["document_context"] is None
    assert captured_turn[0]["document_unavailable"] is True


def test_계약서_조회_실패_응답에는_내부_사유가_새지_않는다(
    client, auth_secret, captured_turn, register_member, make_room
):
    """왜 못 읽었는지(결과 없음·payload 이상)는 로그의 몫이다 — 봉투는 평소와 같아야 한다."""
    user_id = register_member()
    room_id = make_room(user_id, attached=True)

    body = client.post(
        "/api/v1/chat",
        json={"message": "보증금이 얼마죠?", "room_id": room_id},
        headers=_auth(str(user_id)),
    ).json()

    assert body["success"] is True
    assert body["error"] is None
    assert set(body["data"]) == {"answer", "response_time_ms"}


# ── 프롬프트 규칙 ────────────────────────────────────────────────
# graph_rag 는 import 시점에 ChatOpenAI 를 만들고 그래프를 컴파일한다(OPENAI_API_KEY 필요).
# 키가 없는 환경에서는 이 파일의 나머지 테스트를 막지 않도록 통째로 건너뛴다.
graph_rag = pytest.importorskip(
    "app.agent.graph_rag",
    reason="langgraph/langchain-openai 미설치 또는 OPENAI_API_KEY 미설정",
)


def _prompt(monkeypatch, state: dict) -> str:
    """generate() 가 LLM 에 넘기는 프롬프트 문자열을 가로챈다."""
    seen: list[str] = []

    class FakeLlm:
        def invoke(self, prompt):
            seen.append(prompt)
            return type("Msg", (), {"content": "답변"})()

    monkeypatch.setattr(graph_rag, "llm", FakeLlm())
    graph_rag.generate(state)
    return seen[0]


def test_첨부를_못_읽었으면_그_사실을_밝히라는_규칙이_들어간다(monkeypatch):
    prompt = _prompt(monkeypatch, {"question": "전세 얼마야?", "attachment_failed": True})

    assert "읽지 못했다" in prompt
    # 계약서 블록 자체는 없다 — 없는 계약서를 근거로 주면 그대로 지어낸다.
    assert "[첨부 계약서]" not in prompt


def test_평소_턴에는_첨부_관련_규칙이_붙지_않는다(monkeypatch):
    prompt = _prompt(monkeypatch, {"question": "전세 얼마야?"})

    assert "읽지 못했다" not in prompt
    assert "[첨부 계약서]" not in prompt
    # 고정 규칙 6개까지만 있고 7) 이 붙지 않아야 한다(빈 규칙 번호가 새면 모델이 헷갈린다).
    assert "7)" not in prompt


# ── 첫 문장 규칙 충돌 ────────────────────────────────────────────────
# 예전에는 고정 규칙 2번(첫 문장에서 질문에 직접 답하라)과 첨부 실패 규칙(첫 문장에서 못 읽었다고
# 밝혀라)이 **둘 다** 첫 문장을 요구했다. 모델은 둘 중 하나를 임의로 버렸고, 고지가 밀리면
# 사용자는 봇이 자기 계약서를 보고 답한 줄로 읽는다. 문구가 들어 있는지가 아니라 "첫 문장을
# 요구하는 지시가 하나뿐인지" 를 본다.


def _first_sentence_directives(prompt: str) -> list[str]:
    """'첫 문장' 을 요구하는 규칙 줄들. 프롬프트 전체에서 하나여야 한다."""
    return [line for line in prompt.splitlines() if "첫 문장" in line]


def test_평소_턴은_첫_문장에서_질문에_직접_답하라고만_지시한다(monkeypatch):
    prompt = _prompt(monkeypatch, {"question": "전세금 언제 돌려받나요?"})

    directives = _first_sentence_directives(prompt)
    assert len(directives) == 1
    assert "질문에 직접 답하라" in directives[0]


def test_첨부_실패_턴은_첫_문장을_고지에만_내준다(monkeypatch):
    prompt = _prompt(
        monkeypatch, {"question": "전세금 언제 돌려받나요?", "attachment_failed": True}
    )

    directives = _first_sentence_directives(prompt)
    # 두 규칙이 동시에 첫 문장을 가져가면 안 된다.
    assert len(directives) == 1
    directive = directives[0]
    assert "읽지 못했다" in directive
    # 첫 문장을 고지에 내주는 대신, 그다음 문장부터 질문에 답하라는 지시가 이어져야 한다.
    # (고지만 남고 답이 사라지면 사용자는 아무것도 얻지 못한다.)
    assert "그다음 문장부터" in directive
    assert "법령·판례에 근거한 결론" in directive


def test_기존_계약서가_붙어_있어도_첫_문장_지시는_하나다(monkeypatch):
    """이번 첨부만 실패한 경우에도 순서 규칙이 갈라지면 안 된다."""
    prompt = _prompt(
        monkeypatch,
        {"question": "q", "document_context": "임대차계약서 본문", "attachment_failed": True},
    )

    assert len(_first_sentence_directives(prompt)) == 1
    # 기존 계약서와 이번에 실패한 파일을 구분하는 규칙은 그대로 남아 있어야 한다.
    assert "이미 붙어 있던" in prompt


def test_규칙_번호는_상황에_따라_이어진다(monkeypatch):
    """계약서가 붙어 있으면 7), 그 상태로 새 첨부가 실패하면 8)·9) 까지 이어진다."""
    only_doc = _prompt(monkeypatch, {"question": "q", "document_context": "임대차계약서 본문"})
    assert "7)" in only_doc and "8)" not in only_doc

    both = _prompt(
        monkeypatch,
        {"question": "q", "document_context": "임대차계약서 본문", "attachment_failed": True},
    )
    assert "8)" in both
    # 방에 이미 붙어 있던 계약서와 이번에 실패한 파일을 구분해 주지 않으면 모델이 뒤섞는다.
    assert "9)" in both and "이미 붙어 있던" in both

    # 첨부만 실패한 턴은 계약서 규칙이 없으므로 7) 하나로 끝난다.
    fail_only = _prompt(monkeypatch, {"question": "q", "attachment_failed": True})
    assert "7)" in fail_only and "8)" not in fail_only


# ── 이미 붙어 있던 계약서를 못 읽은 턴 ────────────────────────────────
# 새로 올린 파일이 깨진 것(attachment_failed)과 달리, 이쪽은 사용자가 아무것도 올리지 않았는데도
# 계약서를 못 쓰는 경우다. 문구를 attachment_failed 로 돌려쓰면 "이번에 올린 파일" 이라는 거짓말이
# 되므로 상태를 따로 둔다.


def test_계약서를_못_불러온_턴은_첫_문장에서_일반_답변임을_밝힌다(monkeypatch):
    prompt = _prompt(monkeypatch, {"question": "보증금이 얼마죠?", "document_unavailable": True})

    directives = _first_sentence_directives(prompt)
    assert len(directives) == 1  # 첫 문장을 요구하는 지시는 언제나 하나뿐이다.
    directive = directives[0]
    assert "계약서 내용을 불러오지 못" in directive
    assert "일반적인 기준으로 답변한다" in directive
    # 고지만 남고 답이 사라지면 사용자는 아무것도 얻지 못한다.
    assert "그다음 문장부터" in directive
    # 없는 계약서를 근거로 주면 그대로 지어낸다.
    assert "[첨부 계약서]" not in prompt
    # 이번 턴에 올린 파일은 없다 — 그쪽 문구가 섞이면 사실과 어긋난다.
    assert "이번에 올린 첨부 파일을 읽지 못했다" not in prompt


def test_계약서를_못_불러온_턴에는_지어내지_말라는_규칙이_붙는다(monkeypatch):
    prompt = _prompt(monkeypatch, {"question": "q", "document_unavailable": True})

    assert "7)" in prompt and "8)" not in prompt
    assert "연결된 계약서의 내용을 이번 턴에는 불러오지 못했다" in prompt
    assert "실제로 읽은 " in prompt


def test_계약서_본문이_있으면_조회_실패_고지가_붙지_않는다(monkeypatch):
    """플래그가 잘못 켜져 와도 본문이 실제로 있으면 고지는 거짓말이다 — 본문을 믿는다."""
    prompt = _prompt(
        monkeypatch,
        {"question": "q", "document_context": "임대차계약서 본문", "document_unavailable": True},
    )

    directives = _first_sentence_directives(prompt)
    assert len(directives) == 1
    assert "질문에 직접 답하라" in directives[0]
    assert "불러오지 못" not in prompt
    assert "[첨부 계약서]" in prompt


def test_새_첨부와_기존_계약서가_모두_실패해도_첫_문장_지시는_하나다(monkeypatch):
    prompt = _prompt(
        monkeypatch,
        {"question": "q", "attachment_failed": True, "document_unavailable": True},
    )

    directives = _first_sentence_directives(prompt)
    assert len(directives) == 1
    directive = directives[0]
    # 무엇을 못 읽었는지 둘 다 밝혀야 한다 — 한쪽만 말하면 나머지는 읽은 것처럼 읽힌다.
    assert "이번에 올린 첨부 파일" in directive
    assert "연결된 계약서" in directive
    assert "그다음 문장부터" in directive
