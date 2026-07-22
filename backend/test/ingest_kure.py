"""KURE-v1 임베딩 색인 도구 (CLI 배치).

data/02_processed/api_text/*.jsonl 의 법령·판례·해석 문서를 읽어
  1) 청킹(recursive char split) →
  2) KURE-v1(nlpai-lab/KURE-v1, 1024차원) 임베딩 →
  3) Supabase Postgres(pgvector) 벡터 스토어에 적재
한다. FastAPI 백엔드가 사용하는 것과 같은 DB(DATABASE_URL)에 저장한다.

── 실행 (backend/ 에서) ──────────────────────────────────────────────
    uv sync --group ingest                       # 의존성(sentence-transformers·torch) 설치
    # .env 의 DATABASE_URL 을 Postgres 연결 문자열로 설정해야 함 (sqlite 불가)
    #   예) DATABASE_URL=postgresql+psycopg://USER:PW@HOST:5432/postgres

    uv run --group ingest python -m test.ingest_kure --dry-run     # 청킹 통계만 확인
    uv run --group ingest python -m test.ingest_kure --limit 20    # 파일당 20건 소량 시험
    uv run --group ingest python -m test.ingest_kure --recreate    # 테이블 새로 만들고 전체 적재

── 참고 ──────────────────────────────────────────────────────────────
* KURE-v1 최초 실행 시 모델(~2GB)을 HuggingFace 에서 내려받는다.
* 임베딩은 코사인 검색을 위해 정규화(normalize)해서 저장한다.
* 데이터 metadata 는 문서 유형마다 키가 다르므로(법령 law_name/article, 판례 court/case_no …)
  전체를 jsonb 로 보존하고 검색·필터에 쓰는 몇 개만 별도 컬럼으로 평탄화한다.
* 재실행은 기본적으로 append 이다. 깨끗이 다시 적재하려면 --recreate 를 쓴다.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterator
from pathlib import Path

# Windows 콘솔(cp949)에서도 한글·이모지 출력이 깨지지 않도록 UTF-8 로 강제.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass

# ──────────────────────────────────────────────
# 설정 상수
# ──────────────────────────────────────────────
MODEL_NAME = "nlpai-lab/KURE-v1"
EMBED_DIM = 1024  # KURE-v1 출력 차원 (테이블 vector(N) 과 일치해야 함)
DEFAULT_TABLE = "legal_chunks"
DEFAULT_DATA_DIR = "data/02_processed/api_text"

# 청킹 기본값 (문자 기준). 법령은 대개 한 조항이라 그대로, 판례는 길어서 분할된다.
DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 150
MIN_CHUNK_CHARS = 30  # 이보다 짧은 조각은 버린다

# metadata 에서 뽑아 인덱스 컬럼으로 평탄화할 키
FLAT_KEYS = ("source_type", "doc_title", "authority", "issue", "source_id")


# ══════════════════════════════════════════════
# 1) 데이터 로드
# ══════════════════════════════════════════════
def iter_records(path: Path, limit: int | None = None) -> Iterator[dict]:
    """JSONL 한 줄 = {page_content, metadata} 를 순회. 깨진 줄은 건너뛴다."""
    n = 0
    with path.open(encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                print(f"  ⚠️  {path.name}:{line_no} JSON 파싱 실패 → 건너뜀", file=sys.stderr)
                continue
            content = (obj.get("page_content") or "").strip()
            if not content:
                continue
            yield {"content": content, "metadata": obj.get("metadata") or {}}
            n += 1
            if limit is not None and n >= limit:
                return


# ══════════════════════════════════════════════
# 2) 청킹 (recursive character split + overlap)
# ══════════════════════════════════════════════
_SEPARATORS = ["\n\n", "\n", ". ", "。", " ", ""]


def _split_recursive(text: str, size: int, seps: list[str]) -> list[str]:
    """구분자 우선순위대로 재귀 분할. 마지막 ""(빈 구분자)는 강제 문자 분할."""
    sep = seps[0]
    if sep == "":
        return [text[i : i + size] for i in range(0, len(text), size)]

    parts = text.split(sep)
    chunks: list[str] = []
    cur = ""
    for part in parts:
        piece = part if not cur else sep + part
        if len(cur) + len(piece) <= size:
            cur += piece
        else:
            if cur:
                chunks.append(cur)
                cur = ""
            if len(part) > size:  # 한 조각이 통째로 너무 길면 하위 구분자로
                chunks.extend(_split_recursive(part, size, seps[1:]))
            else:
                cur = part
    if cur:
        chunks.append(cur)
    return chunks


def _apply_overlap(chunks: list[str], overlap: int) -> list[str]:
    """앞 청크의 꼬리 overlap 문자를 다음 청크 앞에 덧붙여 맥락을 잇는다."""
    if overlap <= 0 or len(chunks) <= 1:
        return chunks
    out = [chunks[0]]
    for i in range(1, len(chunks)):
        tail = chunks[i - 1][-overlap:]
        out.append(f"{tail} {chunks[i]}".strip())
    return out


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    """텍스트를 검색 단위 청크 리스트로. 짧으면 통째로 반환."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    base = _split_recursive(text, size, _SEPARATORS)
    base = [c.strip() for c in base if len(c.strip()) >= MIN_CHUNK_CHARS]
    return _apply_overlap(base, overlap)


def _context_header(meta: dict) -> str:
    """임베딩 품질용 맥락 헤더 (문서 제목·조항 등). 저장 content 에는 넣지 않는다."""
    bits = [meta.get("doc_title"), meta.get("law_name"), meta.get("article")]
    return " ".join(b for b in bits if b)


def build_chunks(record: dict, size: int, overlap: int) -> list[dict]:
    """레코드 1건 → 청크 dict 리스트.
    반환: {content(원문 청크), embed_text(맥락 헤더+청크), metadata, chunk_index, n_chunks}
    """
    meta = record["metadata"]
    pieces = chunk_text(record["content"], size, overlap)
    header = _context_header(meta)
    out = []
    for i, piece in enumerate(pieces):
        embed_text = f"{header}\n{piece}" if header else piece
        out.append(
            {
                "content": piece,
                "embed_text": embed_text,
                "metadata": meta,
                "chunk_index": i,
                "n_chunks": len(pieces),
            }
        )
    return out


# ══════════════════════════════════════════════
# 3) 임베딩 (KURE-v1)
# ══════════════════════════════════════════════
def load_model(device: str | None):
    """SentenceTransformer 로 KURE-v1 로드 (최초 1회 다운로드)."""
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        sys.exit(
            "❌ sentence-transformers 가 필요합니다.\n"
            "   uv sync --group ingest  후 다시 실행하세요."
        )
    print(f"🧠 임베딩 모델 로드: {MODEL_NAME} (device={device or 'auto'})")
    model = SentenceTransformer(MODEL_NAME, device=device)
    dim = model.get_sentence_embedding_dimension()
    if dim != EMBED_DIM:
        sys.exit(
            f"❌ 모델 출력 차원({dim})이 테이블 vector({EMBED_DIM})과 다릅니다. "
            f"EMBED_DIM 상수를 {dim} 로 맞추세요."
        )
    return model


def embed_texts(model, texts: list[str], batch_size: int) -> list[list[float]]:
    """코사인 검색을 위해 정규화한 임베딩 반환."""
    vecs = model.encode(
        texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    return vecs.tolist()


# ══════════════════════════════════════════════
# 4) 벡터 스토어 (Supabase Postgres + pgvector)
# ══════════════════════════════════════════════
def to_libpq_dsn(url: str) -> str:
    """SQLAlchemy URL(postgresql+psycopg://…) → psycopg.connect 용 DSN 으로 정규화."""
    for prefix in ("postgresql+psycopg2://", "postgresql+psycopg://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix) :]
    return url


def resolve_database_url(cli_url: str | None) -> str:
    """우선순위: --database-url > INGEST_DATABASE_URL > app 설정(DATABASE_URL)."""
    url = cli_url or os.getenv("INGEST_DATABASE_URL")
    if not url:
        try:
            from app.core.config import settings  # backend/ 를 pythonpath 로 실행 시 가능

            url = settings.DATABASE_URL
        except Exception:
            url = os.getenv("DATABASE_URL", "")
    if not url:
        sys.exit("❌ DATABASE_URL 이 없습니다. .env 또는 --database-url 로 지정하세요.")
    if url.startswith("sqlite"):
        sys.exit(
            "❌ pgvector 는 Postgres 가 필요합니다.\n"
            "   DATABASE_URL 을 Supabase/Postgres 연결 문자열로 설정하세요.\n"
            "   예) postgresql+psycopg://USER:PW@HOST:5432/postgres"
        )
    return to_libpq_dsn(url)


def connect(dsn: str):
    try:
        import psycopg
    except ImportError:
        sys.exit("❌ psycopg 가 필요합니다. (백엔드 기본 의존성) uv sync 를 실행하세요.")
    return psycopg.connect(dsn)


def ensure_schema(conn, table: str, recreate: bool) -> None:
    """pgvector 확장 + 테이블 + 인덱스 준비."""
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        if recreate:
            cur.execute(f"DROP TABLE IF EXISTS {table};")
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {table} (
                id           bigserial PRIMARY KEY,
                content      text        NOT NULL,
                embedding    vector({EMBED_DIM}) NOT NULL,
                source_type  text,
                doc_title    text,
                authority    text,
                issue        text,
                source_id    text,
                chunk_index  int         NOT NULL DEFAULT 0,
                n_chunks     int         NOT NULL DEFAULT 1,
                metadata     jsonb       NOT NULL DEFAULT '{{}}'::jsonb,
                created_at   timestamptz NOT NULL DEFAULT now()
            );
            """
        )
        # HNSW 코사인 인덱스 (pgvector >= 0.5). Supabase 지원.
        cur.execute(
            f"CREATE INDEX IF NOT EXISTS {table}_embedding_idx "
            f"ON {table} USING hnsw (embedding vector_cosine_ops);"
        )
        cur.execute(f"CREATE INDEX IF NOT EXISTS {table}_source_type_idx ON {table} (source_type);")
        cur.execute(f"CREATE INDEX IF NOT EXISTS {table}_issue_idx ON {table} (issue);")
    conn.commit()


def _vec_literal(vec: list[float]) -> str:
    """pgvector 리터럴 '[0.1,0.2,…]' (별도 패키지 없이 ::vector 캐스팅용)."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


def insert_rows(conn, table: str, chunks: list[dict], vectors: list[list[float]]) -> None:
    """청크+임베딩을 배치 insert."""
    sql = f"""
        INSERT INTO {table}
            (content, embedding, source_type, doc_title, authority, issue,
             source_id, chunk_index, n_chunks, metadata)
        VALUES
            (%(content)s, %(embedding)s::vector, %(source_type)s, %(doc_title)s,
             %(authority)s, %(issue)s, %(source_id)s, %(chunk_index)s, %(n_chunks)s,
             %(metadata)s::jsonb)
    """
    rows = []
    for ch, vec in zip(chunks, vectors, strict=True):
        meta = ch["metadata"]
        rows.append(
            {
                "content": ch["content"],
                "embedding": _vec_literal(vec),
                "source_type": meta.get("source_type"),
                "doc_title": meta.get("doc_title"),
                "authority": meta.get("authority"),
                "issue": meta.get("issue"),
                "source_id": meta.get("source_id"),
                "chunk_index": ch["chunk_index"],
                "n_chunks": ch["n_chunks"],
                "metadata": json.dumps(meta, ensure_ascii=False),
            }
        )
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    conn.commit()


# ══════════════════════════════════════════════
# 메인
# ══════════════════════════════════════════════
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="KURE-v1 임베딩 색인 도구 (JSONL → pgvector)")
    p.add_argument("--data-dir", default=DEFAULT_DATA_DIR, help="JSONL 폴더 (repo 루트 기준)")
    p.add_argument("--files", default="", help="쉼표로 구분한 파일명(미지정 시 *.jsonl 전체)")
    p.add_argument("--table", default=DEFAULT_TABLE, help="적재 테이블명")
    p.add_argument("--database-url", default=None, help="DB 연결 문자열(미지정 시 .env)")
    p.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE)
    p.add_argument("--chunk-overlap", type=int, default=DEFAULT_CHUNK_OVERLAP)
    p.add_argument("--batch-size", type=int, default=64, help="임베딩·insert 배치 크기")
    p.add_argument("--limit", type=int, default=None, help="파일당 최대 레코드 수(시험용)")
    p.add_argument("--device", default=None, help="cpu | cuda (기본 auto)")
    p.add_argument("--recreate", action="store_true", help="테이블을 drop 후 재생성")
    p.add_argument("--dry-run", action="store_true", help="청킹 통계만 출력(임베딩·적재 X)")
    return p.parse_args()


def resolve_data_dir(data_dir: str) -> Path:
    """어디서 실행하든 데이터 폴더를 찾는다.
    절대경로/직접 상대경로를 먼저 보고, 없으면 cwd·이 파일의 상위 경로들을 훑는다
    (backend/ · repo 루트 · Colab 처럼 얕은 경로 모두 안전)."""
    cand = Path(data_dir)
    if cand.exists():
        return cand
    here = Path(__file__).resolve()
    for base in [Path.cwd(), *here.parents]:
        if (base / data_dir).exists():
            return base / data_dir
    sys.exit(f"❌ 데이터 폴더를 찾을 수 없습니다: {data_dir}")


def collect_files(data_dir: Path, files_arg: str) -> list[Path]:
    if files_arg.strip():
        names = [f.strip() for f in files_arg.split(",") if f.strip()]
        paths = [data_dir / n for n in names]
        missing = [str(p) for p in paths if not p.exists()]
        if missing:
            sys.exit(f"❌ 파일 없음: {', '.join(missing)}")
        return paths
    paths = sorted(data_dir.glob("*.jsonl"))
    if not paths:
        sys.exit(f"❌ {data_dir} 에 *.jsonl 이 없습니다.")
    return paths


def main() -> None:
    args = parse_args()
    data_dir = resolve_data_dir(args.data_dir)
    files = collect_files(data_dir, args.files)

    print("=" * 60)
    print("📚 KURE-v1 색인 도구")
    print(f"   데이터 폴더 : {data_dir}")
    print(f"   대상 파일   : {', '.join(p.name for p in files)}")
    print(f"   청크        : size={args.chunk_size}, overlap={args.chunk_overlap}")
    print("=" * 60)

    # ── 1·2) 로드 + 청킹 ──
    all_chunks: list[dict] = []
    per_file: dict[str, tuple[int, int]] = {}
    for path in files:
        n_rec, n_chunk = 0, 0
        for rec in iter_records(path, args.limit):
            chunks = build_chunks(rec, args.chunk_size, args.chunk_overlap)
            all_chunks.extend(chunks)
            n_rec += 1
            n_chunk += len(chunks)
        per_file[path.name] = (n_rec, n_chunk)
        print(f"  • {path.name:<28} 레코드 {n_rec:>5} → 청크 {n_chunk:>6}")

    total = len(all_chunks)
    print("-" * 60)
    print(f"  합계: 청크 {total:,}개")

    if args.dry_run:
        lengths = [len(c["content"]) for c in all_chunks]
        if lengths:
            avg = sum(lengths) / len(lengths)
            print(f"  청크 길이(문자): 최소 {min(lengths)} / 평균 {avg:.0f} / 최대 {max(lengths)}")
        print("\n✅ dry-run 완료 (임베딩·적재는 하지 않음).")
        return

    if total == 0:
        sys.exit("❌ 적재할 청크가 없습니다.")

    # ── 3) 임베딩 ──
    model = load_model(args.device)

    # ── 4) 적재 준비 ──
    dsn = resolve_database_url(args.database_url)
    conn = connect(dsn)
    try:
        ensure_schema(conn, args.table, args.recreate)
        print(f"🗄️  테이블 준비 완료: {args.table}")

        done = 0
        for start in range(0, total, args.batch_size):
            batch = all_chunks[start : start + args.batch_size]
            vectors = embed_texts(model, [c["embed_text"] for c in batch], args.batch_size)
            insert_rows(conn, args.table, batch, vectors)
            done += len(batch)
            print(f"  적재 {done:,}/{total:,}")
        print(f"\n✅ 완료: {done:,}개 청크를 {args.table} 에 적재했습니다.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
