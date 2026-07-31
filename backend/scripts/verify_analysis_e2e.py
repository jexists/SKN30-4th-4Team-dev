"""분석 전 구간(공유 저장소 → 큐 → OCR worker → LLM → 저장) 실전 점검.

단위 테스트는 SQLite·가짜 파이프라인으로 도는 반면, 이 스크립트는 **실제 Supabase Storage·
실제 Postgres·실제 OCR worker·실제 LLM** 을 그대로 탄다. 커밋 전에 "정말 되는지" 를 눈으로
확인하려는 용도다.

    uv run python scripts/verify_analysis_e2e.py <계약서.pdf>

만든 작업·산출물·알림·입력 객체는 끝나고 전부 지운다(--keep 으로 남길 수 있다). 실패해도 지운다.

개발 서버(uvicorn)가 떠 있으면 그쪽 워커가 2초마다 큐를 폴링하다 이 작업을 먼저 집어갈 수
있다. 입력이 공유 저장소에 있어 **누가 집든 처리 결과는 같으므로** 그대로 두고 끝나기를
기다린다. 다만 개발 서버는 자기 기동 시점의 설정(OCR_WORKER_URL 등)을 쓰므로, 무엇을
검증했는지 분명히 하려면 [3] 에 찍히는 locked_by 를 확인할 것.
"""

import argparse
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.session import AppSessionLocal  # noqa: E402
from app.models.analysis_job import TERMINAL_STATUSES as _TERMINAL  # noqa: E402
from app.models.analysis_job import JobStatus  # noqa: E402
from app.repositories.analysis_job import AnalysisJobRepository  # noqa: E402
from app.services.analysis_jobs import input_store, runner  # noqa: E402
from app.services.document_processing.client import OcrWorkerClient  # noqa: E402

OK, NG, INFO = "  [OK]", "  [NG]", "  [--]"


def _pick_user(db) -> uuid.UUID:
    """진행 중 작업이 없는 회원. uq_analysis_job_active 에 걸리지 않게 고른다."""
    row = db.execute(
        text("""
        select u.id from app_user u
        where u.is_deleted = false
          and not exists (select 1 from analysis_job j
                          where j.user_id = u.id and j.status in ('QUEUED','RUNNING'))
        order by u.created_at limit 1
    """)
    ).first()
    if row is None:
        raise SystemExit("진행 중 작업이 없는 회원이 없다 — 잠시 후 다시 시도")
    return row[0]


def _wait_until_terminal(job_id: uuid.UUID, *, timeout: float) -> bool:
    """다른 워커가 잡아간 작업이 끝나기를 기다린다. 진행 단계가 바뀌면 찍어 준다."""
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        with AppSessionLocal() as db:
            row = db.execute(
                text("select status, stage, progress, locked_by from analysis_job where id=:j"),
                {"j": job_id},
            ).one()
        now = (row.status, row.stage, row.progress)
        if now != last:
            print(f"       {row.status}/{row.stage} {row.progress}%  by {row.locked_by}")
            last = now
        if row.status in {s.value for s in _TERMINAL}:
            return True
        time.sleep(2)
    return False


def _cleanup(user_id: uuid.UUID, job_id: uuid.UUID, file_count: int) -> None:
    """analysis_result 는 FK CASCADE 로 함께 지워진다. 알림은 resource_id 로 찾는다."""
    with AppSessionLocal() as db:
        db.execute(text("delete from notification where resource_id = :j"), {"j": job_id})
        db.execute(text("delete from analysis_job where id = :j"), {"j": job_id})
        db.commit()
    input_store.discard(user_id, job_id, file_count)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("contract", type=Path, help="계약서 파일 (pdf/png/jpg)")
    parser.add_argument("--keep", action="store_true", help="만든 행·객체를 지우지 않는다")
    parser.add_argument("--timeout", type=float, default=900.0, help="완료 대기 상한(초)")
    args = parser.parse_args()

    if not args.contract.exists():
        raise SystemExit(f"파일이 없다: {args.contract}")

    print("\n[0] 사전 점검")
    if AppSessionLocal is None:
        print(f"{NG} APP_DB_URL 미설정 — SQLite 폴백이면 큐가 돌지 않는다")
        return 1
    print(f"{OK} DB 연결 설정됨")

    # 여기서 막히는 게 가장 흔하다. service_role 키나 버킷 이름이 비면 업로드가 시작조차 못 한다.
    if input_store._configuration() is None:
        print(f"{NG} 분석 입력 저장소 설정이 비었다 — backend/.env 를 확인할 것")
        have_url = bool(settings.SUPABASE_URL)
        have_key = bool(settings.SUPABASE_SERVICE_ROLE_KEY)
        print(f"       SUPABASE_URL             : {'설정됨' if have_url else '비어 있음'}")
        print(f"       SUPABASE_SERVICE_ROLE_KEY: {'설정됨' if have_key else '비어 있음'}")
        print(f"       ANALYSIS_INPUT_BUCKET    : {settings.ANALYSIS_INPUT_BUCKET or '비어 있음'}")
        return 1
    print(f"{OK} 입력 저장소 설정됨 (bucket={settings.ANALYSIS_INPUT_BUCKET})")

    try:
        health = OcrWorkerClient().health()
        print(f"{OK} OCR worker 응답: model_loaded={health.model_loaded}")
    except Exception as exc:  # noqa: BLE001 - 원인을 그대로 보여주는 게 목적이다
        print(f"{NG} OCR worker 확인 실패: {type(exc).__name__}: {exc}")
        return 1

    with AppSessionLocal() as db:
        user_id = _pick_user(db)
    print(f"{INFO} 테스트 회원: {user_id}")

    content = args.contract.read_bytes()
    payloads = [(args.contract.name, content)]
    job_id = uuid.uuid4()

    print("\n[1] 입력 업로드 (라우터와 같은 순서: 저장소 먼저, 행은 나중)")
    input_store.store_all(user_id, job_id, payloads)
    print(f"{OK} 업로드됨 {len(content):,}바이트 → {user_id}/{job_id}/000")

    exit_code = 1
    try:
        print("\n[2] 다른 호스트도 읽을 수 있어야 한다 (공유 저장소의 핵심)")
        loaded = input_store.load(user_id, job_id, 0)
        if loaded != content:
            print(f"{NG} 내려받은 내용이 올린 것과 다르다 ({len(loaded):,}바이트)")
            return 1
        print(f"{OK} 같은 키로 되읽기 성공 — 워커가 어느 호스트든 처리 가능")

        with AppSessionLocal() as db:
            AnalysisJobRepository(db).create(
                user_id, job_id=job_id, file_names=[args.contract.name]
            )
            db.commit()
        print(f"{OK} 작업 접수 job={job_id}")

        print("\n[3] 워커가 처리 (OCR + LLM — 몇 분 걸린다)")
        started = time.perf_counter()
        if runner.AnalysisWorker().run_once("verify-e2e"):
            print(f"{OK} 이 스크립트가 직접 처리했다 ({time.perf_counter() - started:.1f}s)")
        else:
            print(f"{INFO} 다른 워커(uvicorn 등)가 먼저 잡았다 — 끝날 때까지 기다린다")
            if not _wait_until_terminal(job_id, timeout=args.timeout):
                print(f"{NG} {args.timeout}s 안에 끝나지 않았다 — 워커가 도는지 확인")
                return 1
            print(f"{OK} 처리 완료 ({time.perf_counter() - started:.1f}s)")

        print("\n[4] 결과 확인")
        with AppSessionLocal() as db:
            row = db.execute(
                text("""
                select j.status, j.stage, j.progress, j.attempt_count,
                       j.error_code, j.error_message, j.locked_by,
                       r.title, r.risk_level, r.summary,
                       jsonb_array_length(coalesce(r.payload->'documents','[]'::jsonb)) docs,
                       length(coalesce(r.payload->>'sanitized_text','')) text_len,
                       jsonb_array_length(
                           coalesce(r.payload->'analysis'->'risks','[]'::jsonb)) risks
                from analysis_job j
                left join analysis_result r on r.job_id = j.id
                where j.id = :j
            """),
                {"j": job_id},
            ).one()

        print(
            f"{INFO} status={row.status} stage={row.stage} progress={row.progress} "
            f"attempt={row.attempt_count} locked_by={row.locked_by!r}"
        )
        if row.status != JobStatus.SUCCEEDED.value:
            print(f"{NG} 실패: {row.error_code} / {row.error_message}")
            return 1
        print(f"{OK} SUCCEEDED")

        checks = [
            (row.title is not None, f"제목 저장됨: {row.title!r}"),
            (row.risk_level is not None, f"위험도 저장됨: {row.risk_level}"),
            (row.summary is not None, f"요약 저장됨: {(row.summary or '')[:40]!r}…"),
            (row.docs == 1, f"문서 {row.docs}건"),
            (row.text_len > 0, f"인식 텍스트 {row.text_len}자"),
            (row.risks is not None, f"위험 항목 {row.risks}건"),
        ]
        ok = True
        for passed, label in checks:
            print(f"{OK if passed else NG} {label}")
            ok &= bool(passed)
        exit_code = 0 if ok else 1

        print("\n[5] 입력 정리 확인 (워커가 끝나고 스스로 지워야 한다)")
        try:
            input_store.load(user_id, job_id, 0)
            print(f"{NG} 입력이 저장소에 남아 있다")
            exit_code = 1
        except Exception:
            print(f"{OK} 입력이 지워졌다")
    finally:
        if args.keep:
            print(f"\n{INFO} --keep — job={job_id} 를 남긴다")
        else:
            _cleanup(user_id, job_id, len(payloads))
            print(f"\n{INFO} 정리 완료 (job·result·알림·입력 객체 삭제)")

    print("\n결과:", "통과 — 커밋해도 된다" if exit_code == 0 else "실패 — 위 [NG] 확인")
    print(f"     (OCR provider 는 worker 쪽 설정, LLM 은 {settings.CONTRACT_ANALYSIS_MODEL})")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
