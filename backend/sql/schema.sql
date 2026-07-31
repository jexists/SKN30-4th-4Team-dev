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
    is_deleted  boolean NOT NULL DEFAULT false,
    deleted_at  timestamptz
);

-- 회원 탈퇴(Soft Delete) 플래그. 기존 DB 에도 붙이고, 이미 deleted_at 이 찍힌 행은 백필한다.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
UPDATE app_user SET is_deleted = true WHERE deleted_at IS NOT NULL AND NOT is_deleted;

-- TODO: 탈퇴 후 3일이 지난 회원의 chat/contract/notification 등 데이터와 계정을
--       완전 삭제(Hard Delete)하는 배치가 훑을 인덱스. 배치는 미구현 — docs/회원탈퇴.md 참고.
--       같은 배치에서 notification 도 함께 정리한다: 사용자가 지운 알림(deleted_at IS NOT NULL)은
--       soft delete 라 행이 남으므로, deleted_at < now() - interval '30 days' 인 것을 purge 한다.
CREATE INDEX IF NOT EXISTS idx_app_user_withdrawn ON app_user (deleted_at) WHERE is_deleted;

-- 2. profile — 프로필 (1:1)
CREATE TABLE IF NOT EXISTS profile (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  uuid NOT NULL UNIQUE REFERENCES app_user (id) ON DELETE CASCADE,
    nickname                 text,
    nickname_updated_at      timestamptz,
    profile_image            text,
    -- 위험 보고서 생성 완료 알림(마이페이지 "알림 설정" 토글) 수신 여부. 기본은 켜짐이다.
    notify_report_complete   boolean NOT NULL DEFAULT true,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profile ADD COLUMN IF NOT EXISTS notify_report_complete boolean NOT NULL DEFAULT true;

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
-- 방에 첨부된 계약서 분석. 붙어 있으면 그 방의 모든 질문에 계약서 맥락이 함께 들어간다.
-- ON DELETE SET NULL: 분석을 지워도 대화 기록은 남아야 한다(첨부만 풀린다).
-- FK 는 analysis_job 정의(14번) 이후에 붙여야 하므로 그 아래에서 추가한다.
ALTER TABLE chat_room ADD COLUMN IF NOT EXISTS analysis_job_id  uuid;

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
-- 이 메시지와 함께 보낸 첨부파일. [{"name": "계약서.pdf", "kind": "pdf"}] 형태로,
-- **파일명과 종류만** 담는다 — 원본 바이트는 워커가 분석을 끝내며 지우므로 서버에 없다.
-- 첨부 자체(어떤 계약서를 참고하는가)는 chat_room.analysis_job_id 가 들고, 이 컬럼은
-- "어느 메시지에 무엇을 붙여 보냈는가" 라는 대화 기록만 담당한다.
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS attachments jsonb;

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
--
-- 읽음/삭제를 불리언이 아니라 nullable timestamp 로 표현한다. `read_at IS NOT NULL` 이
-- 곧 "읽음" 이라 불리언을 완전히 대체하면서 시각까지 남는다. is_deleted 같은 짝 컬럼을
-- 따로 두면 같은 사실을 두 곳이 표현해 불일치가 생기므로 만들지 않는다.
CREATE TABLE IF NOT EXISTS notification (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    type        text NOT NULL DEFAULT 'GENERAL'
        CHECK (type IN ('GENERAL', 'WELCOME',
                        'ANALYSIS_STARTED', 'ANALYSIS_COMPLETED', 'ANALYSIS_FAILED')),
    title       text NOT NULL,
    content     text NOT NULL,
    -- 클릭 시 이동할 대상. 완성된 URL 을 넣지 않는 이유는 라우트가 바뀌면 DB 에 남은 과거
    -- 알림이 통째로 깨지기 때문이다 — 프론트가 resource_type 을 보고 경로를 만든다.
    resource_type text CHECK (resource_type IN ('ANALYSIS_JOB')),
    resource_id   uuid,
    read_at     timestamptz,   -- NULL = 안읽음
    deleted_at  timestamptz,   -- NULL = 살아있음
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- 기존 DB 따라잡기.
ALTER TABLE notification ADD COLUMN IF NOT EXISTS type          text NOT NULL DEFAULT 'GENERAL';
ALTER TABLE notification ADD COLUMN IF NOT EXISTS resource_type text;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS resource_id   uuid;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS read_at       timestamptz;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;

ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_type_check;
ALTER TABLE notification ADD  CONSTRAINT notification_type_check
    CHECK (type IN ('GENERAL', 'WELCOME',
                    'ANALYSIS_STARTED', 'ANALYSIS_COMPLETED', 'ANALYSIS_FAILED'));
ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_resource_type_check;
ALTER TABLE notification ADD  CONSTRAINT notification_resource_type_check
    CHECK (resource_type IN ('ANALYSIS_JOB'));

-- is_read → read_at 이관. 정확히 언제 읽었는지는 남아 있지 않으므로 created_at 으로 채운다
-- (이미 읽은 알림에 한해 "읽은 시각" 은 복원 불가하고, 안읽음/읽음 구분만 보존된다).
-- 새로 만든 DB 에는 is_read 가 없으므로 컬럼이 있을 때만 돈다.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notification' AND column_name = 'is_read'
    ) THEN
        UPDATE notification SET read_at = created_at WHERE is_read AND read_at IS NULL;
        ALTER TABLE notification DROP COLUMN is_read;
    END IF;
END $$;

-- 중복 방지 키. 같은 사건에 대한 알림을 두 번 만들지 않는다
-- (가입 축하 = 'welcome', 분석 완료 = 'analysis:{job_id}:SUCCEEDED' 처럼 발신 측이 정한다).
-- 예전에는 가입 축하만을 위한 전용 인덱스(uq_notification_welcome)를 두었는데,
-- 그 특수 케이스를 이 범용 규칙 하나로 흡수한다.
ALTER TABLE notification ADD COLUMN IF NOT EXISTS dedupe_key text;
UPDATE notification SET dedupe_key = 'welcome'
    WHERE dedupe_key IS NULL AND (type = 'WELCOME' OR title = '회원가입을 축하합니다.');
UPDATE notification SET type = 'WELCOME'
    WHERE type <> 'WELCOME' AND dedupe_key = 'welcome';

-- 전체 탭: 최신순 커서 페이지네이션. created_at 만으로는 DB 트리거와 앱이 같은 시각에 만든
-- 행이 페이지 경계에서 유실·중복되므로 id 를 타이브레이커로 함께 넣는다.
-- deleted_at 조건을 인덱스 안에 넣어야 지운 행을 훑지 않는다.
CREATE INDEX IF NOT EXISTS idx_notification_user_created
    ON notification (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
-- "읽지 않음" 탭 + 헤더 Badge 개수 전용. 안읽음만 담아 인덱스가 작게 유지된다.
-- (user_id, read_at, created_at DESC) 같은 통짜 인덱스보다, 두 질의가 각각 자기 부분
-- 인덱스만 훑는 편이 작고 빠르다.
CREATE INDEX IF NOT EXISTS idx_notification_user_unread
    ON notification (user_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL AND read_at IS NULL;
DROP INDEX IF EXISTS idx_notification_user;   -- (user_id, is_read) — 위 둘로 대체

-- 같은 사건에 대한 알림은 회원당 1건. 가입 축하는 이메일(트리거)과 카카오(가입 완료 API)가
-- 서로 다른 경로로 만들기 때문에 애플리케이션 검사만으로는 동시 실행을 막지 못한다
-- — 최후 방어선을 DB 에 둔다. 분석 완료/실패 알림의 중복도 같은 인덱스가 막는다.
-- deleted_at 조건을 일부러 넣지 않는다: 넣으면 사용자가 알림을 지운 뒤 중복 생성이 가능해진다.
DROP INDEX IF EXISTS uq_notification_welcome;   -- 가입 축하 전용 특수 케이스였다
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_dedupe
    ON notification (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 14. analysis_job — AI 분석 작업 (비동기 작업 큐)
--
-- 서류 여러 장을 한 번에 올려 종합 분석 1건을 만드는 실제 흐름에 맞춘 테이블이다.
-- (contract/contract_analysis 는 "파일 1개 = 1행, 분석과 1:1" 이라 이 흐름과 맞지 않는다.)
--
-- 이 테이블 자체가 작업 큐다. Redis 를 두지 않고, 워커가 QUEUED 행을
-- FOR UPDATE SKIP LOCKED 로 하나씩 선점한다(locked_by/lease_expires_at). uvicorn worker 를
-- 여러 개로 늘려도 같은 작업이 두 번 실행되지 않는다.
--
-- 업로드 원본은 공유 저장소에 보관한다. 기동 시 QUEUED 와 lease 가 살아 있는 RUNNING 은
-- 그대로 두고, lease 만료 작업은 남은 시도 횟수에 따라 재큐잉하거나 FAILED 로 정리한다.
CREATE TABLE IF NOT EXISTS analysis_job (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    -- 같은 요청의 재전송(더블클릭·네트워크 재시도)을 같은 작업으로 흡수한다.
    idempotency_key   text,
    status            text NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    -- 진행 화면에 무엇을 하고 있는지 보여주기 위한 단계. status 와 달리 참고용이다.
    stage             text
        CHECK (stage IN ('UPLOADING', 'OCR', 'ANALYZING', 'RAG', 'LLM', 'SAVING', 'COMPLETED')),
    progress          smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    attempt_count     smallint NOT NULL DEFAULT 0,
    file_names        jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- error_message 는 그대로 사용자에게 보인다. 내부 예외 문자열·API 키·경로·계약서
    -- 개인정보를 넣지 않는다(원인은 error_code 와 로그에 남긴다).
    error_code        text,
    error_message     text,
    locked_by         text,          -- 선점한 워커 식별자 (호스트:pid:스레드)
    lease_expires_at  timestamptz,   -- 이 시각이 지나면 죽은 작업으로 본다
    heartbeat_at      timestamptz,
    queued_at         timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    finished_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 사용자가 목록에서 지운 분석. 행은 남기고 deleted_at 만 찍는다(chat_room·notification 과 같은 규칙).
-- result 가 아니라 job 에 두는 이유: 목록은 analysis_job 기준이고, 실패한 분석에는
-- analysis_result 행이 아예 없다. 두 곳이 같은 사실을 표현하면 불일치만 생긴다.
ALTER TABLE analysis_job ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 이 작업의 결과를 알림으로 알릴지. 채팅 첨부(false)는 대화 안에서 진행·결과를 그대로
-- 보여주므로 벨 배지·토스트까지 뜨면 같은 사실이 두 번 전달된다. 완료·실패 알림은 워커가
-- 만들기 때문에 "알리지 말 것" 이 요청이 아니라 행에 남아 있어야 한다.
-- 기본값 true — 분석 화면(/analyze)에서 올린 기존 행은 그대로 알림을 받는다.
ALTER TABLE analysis_job ADD COLUMN IF NOT EXISTS notify boolean NOT NULL DEFAULT true;

-- 목록 조회가 지운 행을 훑지 않도록 살아 있는 행만 담는다. 아래 alive 인덱스가 대체하므로
-- 예전 전체 인덱스는 지운다(같은 컬럼을 두 번 갱신할 이유가 없다).
CREATE INDEX IF NOT EXISTS idx_analysis_job_user_alive
    ON analysis_job (user_id, created_at DESC) WHERE deleted_at IS NULL;
DROP INDEX IF EXISTS idx_analysis_job_user;
-- 워커가 다음 작업을 고를 때 훑는 인덱스 — 대기 중인 행만 담는다.
-- ⚠️ 큐 관련 인덱스에는 deleted_at 조건을 넣지 않는다. 지워진 작업이라도 진행 중이면
--    워커가 정상적으로 끝맺어야 하고, uq_analysis_job_active 도 마찬가지다.
CREATE INDEX IF NOT EXISTS idx_analysis_job_queue
    ON analysis_job (queued_at) WHERE status = 'QUEUED';
-- lease 가 만료된 좀비 작업을 회수할 때 훑는 인덱스.
CREATE INDEX IF NOT EXISTS idx_analysis_job_lease
    ON analysis_job (lease_expires_at) WHERE status = 'RUNNING';
-- 회원당 진행 중 작업은 1건 — 같은 분석을 두 번 돌리지 않게 막는 최후 방어선이다.
-- 애플리케이션도 먼저 검사하지만(409), 동시에 들어온 두 요청은 DB 만이 막을 수 있다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_job_active
    ON analysis_job (user_id) WHERE status IN ('QUEUED', 'RUNNING');
-- 같은 idempotency key 의 재전송은 새 작업을 만들지 않고 기존 작업을 돌려준다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_job_idempotency
    ON analysis_job (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 15. analysis_result — 분석 산출물 (analysis_job 과 1:1)
--
-- 작업(진행 상태)과 산출물을 분리한다. 사용자가 실패한 분석을 다시 돌리면 작업은 새로 생기지만
-- 과거 산출물은 그대로 남고, 목록 화면은 payload(수십 KB)를 읽지 않고 summary·risk_level 만
-- 조인해 쓸 수 있다.
CREATE TABLE IF NOT EXISTS analysis_result (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      uuid NOT NULL UNIQUE REFERENCES analysis_job (id) ON DELETE CASCADE,
    -- 조회 때마다 job 을 조인하지 않고 소유권을 검사하려고 함께 둔다.
    user_id     uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    title       text,
    summary     text,
    risk_level  text CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    -- AnalysisResultOut 전문. 마스킹 PDF 는 용량 때문에 넣지 않는다.
    payload     jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analysis_result_user
    ON analysis_result (user_id, created_at DESC);


-- 16. chat_room.analysis_job_id FK — 채팅방에 첨부된 계약서 분석
--
-- 컬럼 자체는 chat_room(5번) 에서 추가했지만 FK 는 analysis_job 이 만들어진 뒤라야 걸 수 있어
-- 여기에 둔다. ON DELETE SET NULL 이라 분석을 지워도 대화는 남고 첨부만 풀린다.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_room_analysis_job'
    ) THEN
        ALTER TABLE chat_room
            ADD CONSTRAINT fk_chat_room_analysis_job
            FOREIGN KEY (analysis_job_id) REFERENCES analysis_job (id) ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_chat_room_analysis_job
    ON chat_room (analysis_job_id) WHERE analysis_job_id IS NOT NULL;

-- 목록에서 제목을 고칠 수 있게 되면서 "언제 고쳤는지" 가 필요해졌다.
-- 기존 행은 생성 시각으로 백필한 뒤 NOT NULL 로 조인다.
ALTER TABLE analysis_result ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE analysis_result SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE analysis_result ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE analysis_result ALTER COLUMN updated_at SET NOT NULL;
