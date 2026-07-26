from app.document.page import PageImage


def preprocess_page(page: PageImage) -> PageImage:
    """명시적 좌표 변환 전처리 확장 지점.

    현재는 좌표 안정성을 위해 원본 렌더 이미지를 그대로 반환한다. 기울기나
    원근 보정을 추가할 때는 반드시 변환 행렬도 함께 반환하도록 변경해야 한다.
    """
    return page
