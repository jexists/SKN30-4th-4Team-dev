-- ─────────────────────────────────────────────────────────────
-- 전·월세 분쟁 팩트체커 — 초기 스키마 (docs/ERD.md 최종본, 13개 테이블)
--
-- 멱등: 전부 IF NOT EXISTS → 재실행 안전, 기존 객체(legal_chunks 등) 미변경.
-- 인증: app_user.id 는 Supabase auth.users(id) 를 참조하는 앱 확장 테이블.
-- ⚠️ 지금은 부트스트랩 DDL. 정식 반영은 Alembic 마이그레이션으로 옮기는 것을 권장.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. app_user — 앱 사용자 (auth.users 확장)
CREATE TABLE IF NOT EXISTS app_user (
    id          uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    username    text UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

-- 2. profile — 프로필 (1:1)
CREATE TABLE IF NOT EXISTS profile (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid NOT NULL UNIQUE REFERENCES app_user (id) ON DELETE CASCADE,
    nickname             text,
    nickname_updated_at  timestamptz,
    profile_image        text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 3. user_agreement — 약관·동의 이력
CREATE TABLE IF NOT EXISTS user_agreement (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    agreement_type  text NOT NULL CHECK (agreement_type IN ('terms', 'privacy', 'marketing')),
    version         text NOT NULL,
    is_agreed       boolean NOT NULL,
    agreed_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, agreement_type, version)
);

-- 4. login_history — 로그인 이력
CREATE TABLE IF NOT EXISTS login_history (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    client_ip  inet,
    device     text,
    login_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history (user_id, login_at DESC);

-- 5. chat_room — 채팅방
CREATE TABLE IF NOT EXISTS chat_room (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    title             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_chat_at      timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    title_updated_at  timestamptz,
    deleted_at        timestamptz
);
ALTER TABLE chat_room ADD COLUMN IF NOT EXISTS last_chat_at     timestamptz;
ALTER TABLE chat_room ADD COLUMN IF NOT EXISTS title_updated_at timestamptz;

-- 기존 행 백필: 지금까지 updated_at 이 곧 '마지막 대화 시각' 이었으므로 그대로 옮긴다.
-- 대화가 한 번도 없던 방은 updated_at 이 생성 시각이라 자연히 '등록일' 이 들어간다.
UPDATE chat_room SET last_chat_at = COALESCE(updated_at, created_at) WHERE last_chat_at IS NULL;

ALTER TABLE chat_room ALTER COLUMN last_chat_at SET DEFAULT now();
ALTER TABLE chat_room ALTER COLUMN last_chat_at SET NOT NULL;

-- 정렬 키가 바뀌었으므로 인덱스도 교체.
CREATE INDEX IF NOT EXISTS idx_chat_room_user_last_chat
    ON chat_room (user_id, last_chat_at DESC);
DROP INDEX IF EXISTS idx_chat_room_user;

-- 6. chat_message — 대화 메시지
CREATE TABLE IF NOT EXISTS chat_message (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_room_id   uuid NOT NULL REFERENCES chat_room (id) ON DELETE CASCADE,
    role           text NOT NULL CHECK (role IN ('USER', 'ASSISTANT', 'SYSTEM')),
    content        text NOT NULL,
    response_time  integer,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_message_room ON chat_message (chat_room_id, created_at);

-- 12. document — 지식베이스 원문 메타
CREATE TABLE IF NOT EXISTS document (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title       text NOT NULL,
    doc_type    text NOT NULL CHECK (doc_type IN ('LAW', 'PRECEDENT', 'GUIDE', 'FAQ')),
    source      text,
    source_ref  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 13. document_chunk — 청크 + 벡터 임베딩 (KURE-v1 = 1024차원)
CREATE TABLE IF NOT EXISTS document_chunk (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id      uuid NOT NULL REFERENCES document (id) ON DELETE CASCADE,
    chunk_index      integer NOT NULL,
    content          text NOT NULL,
    token_count      integer,
    embedding        vector(1024),
    embedding_model  text,
    metadata         jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_chunk_embedding
    ON document_chunk USING hnsw (embedding vector_cosine_ops);

-- 7. message_source — 답변 근거(인용)
CREATE TABLE IF NOT EXISTS message_source (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_message_id    uuid NOT NULL REFERENCES chat_message (id) ON DELETE CASCADE,
    document_chunk_id  uuid REFERENCES document_chunk (id) ON DELETE SET NULL,
    score              double precision,
    rank               smallint,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_source_message ON message_source (chat_message_id);

-- 8. feedback — 답변 피드백 (답변당 최대 1건)
CREATE TABLE IF NOT EXISTS feedback (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_message_id  uuid NOT NULL UNIQUE REFERENCES chat_message (id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    rating           smallint NOT NULL CHECK (rating IN (-1, 1)),
    comment          text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- 9. contract — 계약서
CREATE TABLE IF NOT EXISTS contract (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    title            text NOT NULL,
    file_name        text NOT NULL,
    storage_path     text NOT NULL,
    mime_type        text NOT NULL,
    file_size        bigint NOT NULL,
    ocr_text         text,
    analysis_status  text NOT NULL
        CHECK (analysis_status IN ('UPLOADING', 'OCR', 'ANALYZING', 'COMPLETED', 'FAILED')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_contract_user ON contract (user_id, created_at DESC);

-- 10. contract_analysis — AI 분석 결과 (1:1)
CREATE TABLE IF NOT EXISTS contract_analysis (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id      uuid NOT NULL UNIQUE REFERENCES contract (id) ON DELETE CASCADE,
    summary          text,
    analysis_result  jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 11. notification — 알림
CREATE TABLE IF NOT EXISTS notification (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    title       text NOT NULL,
    content     text NOT NULL,
    is_read     boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_user ON notification (user_id, is_read);
