"""레거시 로컬 분석 스풀 유틸리티.

분석 런타임은 여러 프로세스·호스트가 공유하는 ``input_store``를 사용한다. 이 모듈은 기존
호출부와 실제 TEMP 삭제를 막는 회귀 테스트를 위해 남아 있으며, 새 런타임 코드에서 사용하면
안 된다.

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
