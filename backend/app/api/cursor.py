"""커서(keyset) 페이지네이션 공용 헬퍼.

커서 = 마지막으로 본 행의 (정렬 시각, id). base64(JSON) 불투명 문자열이라 프론트는 저장·재전달만
하고 해석하지 않는다(api/chatHistory.ts 의 계약).

**id 를 함께 넣는 이유**: 정렬 시각만으로는 같은 시각에 만들어진 행들이 페이지 경계에서
유실되거나 중복된다. 알림은 DB 트리거와 앱이 동시에 만들 수 있어 특히 그렇다.

원래 routes/chat.py 안의 private 함수였는데 알림·분석 목록도 같은 커서를 쓰게 되면서 뽑았다.
"""

import base64
import json
import uuid
from datetime import datetime


def encode_cursor(ts: datetime, id_: uuid.UUID) -> str:
    raw = json.dumps({"t": ts.isoformat(), "i": str(id_)})
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(raw: str | None) -> tuple[datetime, uuid.UUID] | None:
    """커서를 (ts, id) 로. 없거나 손상됐으면 None → 첫 페이지로 취급(fail-soft).

    손상된 커서에 400 을 주지 않는 이유: 사용자가 만질 수 있는 값이 아니라 우리가 준 값이고,
    깨졌다면 첫 페이지를 보여주는 편이 오류 모달보다 낫다.
    """
    if not raw:
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
        return datetime.fromisoformat(data["t"]), uuid.UUID(data["i"])
    except (ValueError, KeyError, TypeError):
        return None
