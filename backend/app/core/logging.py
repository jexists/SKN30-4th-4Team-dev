import logging


def setup_logging(level: int = logging.INFO) -> None:
    """앱 전역 로깅 설정. main 에서 한 번 호출."""
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    )
