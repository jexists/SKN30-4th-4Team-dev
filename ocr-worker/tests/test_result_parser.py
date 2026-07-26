from app.inference.result_parser import parse_result
from app.inference.spotting_parser import parse_spotting_result


class ArrayLike:
    def __init__(self, value):
        self.value = value

    def tolist(self):
        return self.value

    def __bool__(self):
        raise ValueError("배열의 참/거짓 값을 직접 평가할 수 없습니다.")


def test_parses_official_block_result_shape():
    page = parse_result(
        {
            "page_index": 2,
            "width": 1000,
            "height": 1400,
            "parsing_res_list": [
                {
                    "block_bbox": [10, 20, 300, 80],
                    "block_label": "text",
                    "block_content": "임차인 홍길동",
                    "block_id": 4,
                    "block_order": 1,
                }
            ],
        }
    )

    assert page.page_index == 2
    assert page.regions[0].bbox == (10.0, 20.0, 300.0, 80.0)
    assert page.regions[0].text == "임차인 홍길동"


def test_parses_numpy_like_block_bbox():
    page = parse_result(
        {
            "parsing_res_list": [
                {
                    "block_bbox": ArrayLike([10, 20, 300, 80]),
                    "block_content": "전화번호 010-1234-5678",
                }
            ]
        }
    )

    assert page.regions[0].bbox == (10.0, 20.0, 300.0, 80.0)


def test_spotting_result_prefers_fine_grained_polygons():
    page = parse_spotting_result(
        {
            "res": {
                # 실제 단일 이미지 Spotting 결과는 키가 있어도 값이 None일 수 있다.
                "page_index": None,
                "width": 1600,
                "height": 1000,
                "parsing_res_list": [
                    {
                        "block_bbox": [0, 0, 1600, 1000],
                        "block_label": "spotting",
                        "block_content": "전화번호 010-1234-5678",
                    }
                ],
                "spotting_res": {
                    "rec_texts": ArrayLike(["전화번호 010-1234-5678"]),
                    "rec_polys": ArrayLike([[[100, 300], [700, 300], [700, 360], [100, 360]]]),
                },
            }
        },
        page_index=3,
    )

    assert len(page.regions) == 1
    assert page.page_index == 3
    assert page.regions[0].page_index == 3
    assert page.regions[0].bbox == (100.0, 300.0, 700.0, 360.0)
    assert page.regions[0].label == "spotting"
