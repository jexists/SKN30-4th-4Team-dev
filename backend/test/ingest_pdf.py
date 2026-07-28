"""PDF 페이지 JSONL 전처리 + KURE-v1 임베딩 색인 도구 (CLI 배치).

data/02_processed/pdf/*.jsonl (PDF 에서 추출한 '페이지 단위' 문서) 를 읽어
  0) 전처리(cleaning) — PDF 추출 특유의 잡음 제거 →
  1) 청킹(recursive char split) →
  2) KURE-v1(nlpai-lab/KURE-v1, 1024차원) 임베딩 →
  3) Supabase Postgres(pgvector) 의 legal_chunks 에 적재
한다. 임베딩·DB 적재 로직은 test.ingest_kure 와 완전히 동일한 것을 재사용하므로,
같은 테이블(legal_chunks)·같은 스키마에 섞여 저장되고 RAG 검색이 그대로 읽는다.

api_text 색인(test.ingest_kure)과 다른 점은 두 가지뿐이다:
  * 입력이 '페이지 텍스트' 라서 헤더/푸터·깨진 줄바꿈·제어문자 등 잡음이 많다 → 전처리 추가.
  * 임베딩 맥락 헤더에 문서 제목뿐 아니라 '페이지 번호'까지 넣어 검색 품질을 높인다.
metadata(source_type·doc_title·authority·issue·source_id …)는 이미
ingest_kure 의 FLAT_KEYS 와 동일하므로 스키마·평탄화 코드를 그대로 쓴다.

── 실행 (backend/ 에서) ──────────────────────────────────────────────
    uv sync --group ingest                        # 의존성(sentence-transformers·torch)
    # 접속 DB 는 .env 의 DB_URL 을 그대로 쓴다(별도 RAG_DB_URL 불필요, Postgres 여야 함).
    #   우선순위: --database-url > 환경변수/.env 의 DB_URL > (하위호환) RAG_DB_URL·APP_DB_URL

    uv run --group ingest python -m test.ingest_pdf --dry-run    # 전처리·청킹 통계만
    uv run --group ingest python -m test.ingest_pdf --limit 20   # 파일당 20건 소량 시험
    uv run --group ingest python -m test.ingest_pdf --recreate   # 테이블 새로 만들고 전체 적재
    uv run --group ingest python -m test.ingest_pdf              # 기존 테이블에 append

── 참고 ──────────────────────────────────────────────────────────────
* 재실행은 기본 append 다. ingest_kure 와 같은 테이블을 쓰므로, 처음부터 깨끗이
  다시 적재하려면 --recreate 로 테이블을 재생성한 뒤 두 색인을 모두 다시 돌린다.
* 전처리는 원문을 손상하지 않는 범위(공백/제어문자 정리, NFC 정규화)만 한다.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata

# 임베딩·DB·청킹 로직은 ingest_kure 와 100% 공유한다(중복 금지).
# DB 접속(resolve_database_url) 도 ingest_kure 것을 그대로 쓴다 → .env 의 DB_URL 을 읽는다.
# (import 시점에 ingest_kure 가 stdout 을 UTF-8 로 재설정해 주므로 콘솔 한글도 안전하다.)
from test.ingest_kure import (
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_TABLE,
    chunk_text,
    collect_files,
    connect,
    embed_texts,
    ensure_schema,
    insert_rows,
    iter_records,
    load_model,
    resolve_data_dir,
    resolve_database_url,
)

# ──────────────────────────────────────────────
# 설정 상수
# ──────────────────────────────────────────────
DEFAULT_DATA_DIR = "data/02_processed/pdf"
# 전처리 후 이보다 짧은 '페이지' 는 목차 파편·페이지 번호일 확률이 높아 통째로 버린다.
DEFAULT_MIN_PAGE_CHARS = 15

# 제어문자·zero-width·BOM 제거 (탭 0x09·줄바꿈 0x0a 는 보존). PDF 추출물에 자주 섞인다.
_CTRL_CHARS = (
    "".join(chr(c) for c in range(0x00, 0x09))       # 0x00-0x08 (탭 0x09 제외)
    + chr(0x0b) + chr(0x0c)                           # 수직탭·폼피드 (LF 0x0a 제외)
    + "".join(chr(c) for c in range(0x0e, 0x20))       # 0x0e-0x1f
    + chr(0x7f)                                       # DEL
    + "".join(chr(c) for c in range(0x200b, 0x2010))   # zero-width·LRM·RLM
    + chr(0x2028) + chr(0x2029)                       # line/paragraph separator
    + chr(0xfeff)                                     # BOM
)
_CTRL_RE = re.compile("[" + re.escape(_CTRL_CHARS) + "]")
# 줄 끝에서 단어를 자른 하이픈("계약-\n서" → "계약서"). 한글엔 드물지만 표기 혼용 대비.
_HYPHEN_WRAP_RE = re.compile(r"(?<=\w)-\n(?=\w)")


# ══════════════════════════════════════════════
# 0) 전처리 (PDF 페이지 텍스트 cleaning)
# ══════════════════════════════════════════════
def clean_pdf_text(text: str) -> str:
    """PDF 페이지에서 뽑은 텍스트를 임베딩·검색에 적합하게 정리한다.

    - 유니코드 NFC 정규화(분해된 한글 자모 → 완성형)
    - 줄바꿈 통일(CRLF/CR → LF)
    - 제어문자·zero-width·BOM 제거
    - 줄 끝 하이픈 줄바꿈 이어붙이기
    - 과도한 빈 줄(3+ → 1개)·연속 공백(2+ → 1개)·줄 끝 공백 정리
    표(| … |)·마크다운 헤더(#) 같은 구조는 검색 맥락에 도움되므로 보존한다.
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CTRL_RE.sub("", text)
    text = _HYPHEN_WRAP_RE.sub("", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ══════════════════════════════════════════════
# 청킹 + 임베딩용 맥락 헤더 (페이지 인지)
# ══════════════════════════════════════════════
def _context_header(meta: dict) -> str:
    """임베딩 품질용 맥락 헤더 (문서 제목·연도·페이지). 저장 content 에는 넣지 않는다."""
    title = meta.get("doc_title") or ""
    year = meta.get("doc_year")
    page = meta.get("book_page") or meta.get("pdf_page") or meta.get("page_index")
    bits = [title]
    if year:
        bits.append(f"({year})")
    if page:
        bits.append(f"p.{page}")
    return " ".join(b for b in bits if b).strip()


def build_chunks(record: dict, size: int, overlap: int, min_page_chars: int) -> list[dict]:
    """레코드(=PDF 한 페이지) 1건 → 전처리 후 청크 dict 리스트.

    반환: {content(정리된 청크), embed_text(맥락 헤더+청크), metadata, chunk_index, n_chunks}
    전처리 결과가 너무 짧으면(min_page_chars 미만) 빈 리스트를 반환해 통째로 버린다.
    """
    cleaned = clean_pdf_text(record["content"])
    if len(cleaned) < min_page_chars:
        return []
    meta = record["metadata"]
    pieces = chunk_text(cleaned, size, overlap)
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
# 메인
# ══════════════════════════════════════════════
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="PDF 페이지 JSONL 전처리 + KURE-v1 임베딩 색인 (→ pgvector legal_chunks)"
    )
    p.add_argument("--data-dir", default=DEFAULT_DATA_DIR, help="JSONL 폴더 (repo 루트 기준)")
    p.add_argument("--files", default="", help="쉼표로 구분한 파일명(미지정 시 *.jsonl 전체)")
    p.add_argument("--table", default=DEFAULT_TABLE, help="적재 테이블명")
    p.add_argument("--database-url", default=None, help="DB 연결 문자열(미지정 시 .env)")
    p.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE)
    p.add_argument("--chunk-overlap", type=int, default=DEFAULT_CHUNK_OVERLAP)
    p.add_argument("--min-page-chars", type=int, default=DEFAULT_MIN_PAGE_CHARS,
                   help="전처리 후 이보다 짧은 페이지는 버림")
    p.add_argument("--batch-size", type=int, default=64, help="임베딩·insert 배치 크기")
    p.add_argument("--limit", type=int, default=None, help="파일당 최대 레코드 수(시험용)")
    p.add_argument("--device", default=None, help="cpu | cuda (기본 auto)")
    p.add_argument("--recreate", action="store_true", help="테이블을 drop 후 재생성")
    p.add_argument("--dry-run", action="store_true", help="전처리·청킹 통계만 출력(임베딩·적재 X)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    data_dir = resolve_data_dir(args.data_dir)
    files = collect_files(data_dir, args.files)

    print("=" * 60)
    print("📄 PDF 페이지 전처리 + KURE-v1 색인 도구")
    print(f"   데이터 폴더 : {data_dir}")
    print(f"   대상 파일   : {', '.join(p.name for p in files)}")
    print(f"   청크        : size={args.chunk_size}, overlap={args.chunk_overlap}")
    print(f"   최소 페이지 : {args.min_page_chars}자 미만 버림")
    print("=" * 60)

    # ── 0·1) 로드 + 전처리 + 청킹 ──
    all_chunks: list[dict] = []
    for path in files:
        n_rec, n_dropped, n_chunk = 0, 0, 0
        for rec in iter_records(path, args.limit):
            n_rec += 1
            chunks = build_chunks(rec, args.chunk_size, args.chunk_overlap, args.min_page_chars)
            if not chunks:
                n_dropped += 1
                continue
            all_chunks.extend(chunks)
            n_chunk += len(chunks)
        print(f"  • {path.name:<32} 페이지 {n_rec:>5} (버림 {n_dropped:>3}) → 청크 {n_chunk:>6}")

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

    # ── 2) 임베딩 ──
    model = load_model(args.device)

    # ── 3) 적재 ──
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
