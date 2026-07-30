"""업로드 원본을 워커가 읽을 수 있도록 잠시 디스크에 둔다.

⚠️ **영속 저장소가 아니다.** 프로세스가 죽으면 여기 있던 파일은 의미를 잃고, 기동 시 통째로
지운다. 그래서 남아 있던 QUEUED/RUNNING 작업은 재큐잉하지 않고 FAILED 로 닫는다
(repositories/analysis_job.py 의 fail_active 참고).

파일명은 `000`, `001` … 업로드 순서 그대로다. 원본 이름은 analysis_job.file_names 가 들고 있다
— 사용자가 올린 파일명에 든 이상한 문자가 디스크 경로로 새지 않게 분리했다.
"""

import logging
import shutil
import tempfile
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

SPOOL_ROOT = Path(tempfile.gettempdir()) / "skn30-analysis"


def spool_dir(job_id: uuid.UUID) -> Path:
    return SPOOL_ROOT / str(job_id)


def create(job_id: uuid.UUID) -> Path:
    path = spool_dir(job_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def store(spool: Path, index: int, content: bytes) -> None:
    (spool / f"{index:03d}").write_bytes(content)


def discard(job_id: uuid.UUID) -> None:
    """작업이 끝나면 부른다. 실패해도 조용히 넘어간다 — 청소는 본 작업이 아니다."""
    shutil.rmtree(spool_dir(job_id), ignore_errors=True)


def purge_all() -> None:
    """기동 시 남은 스풀을 전부 지운다. 어차피 그 작업들은 FAILED 로 닫힌다."""
    if not SPOOL_ROOT.exists():
        return
    try:
        shutil.rmtree(SPOOL_ROOT, ignore_errors=True)
    except OSError:
        logger.warning("분석 스풀 정리 실패 — 다음 기동에 다시 시도한다", exc_info=True)
