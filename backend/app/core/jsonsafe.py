"""JSON response that never emits NaN/Infinity and understands numpy/pandas scalars.

Analytics code distinguishes "unknown" (None) from numbers; a stray NaN must become ``null`` rather
than crash serialization (Starlette uses ``allow_nan=False``) or reach clients as invalid JSON.
"""

from __future__ import annotations

import datetime as dt
import decimal
import json
import math
import uuid
from typing import Any

import numpy as np
from fastapi.responses import JSONResponse


def sanitize(value: Any) -> Any:
    if value is None or isinstance(value, bool | str | int) and not isinstance(value, np.integer):
        return value
    if isinstance(value, float | np.floating):
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, dict):
        return {str(k): sanitize(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [sanitize(v) for v in value]
    if isinstance(value, np.ndarray):
        return [sanitize(v) for v in value.tolist()]
    if isinstance(value, dt.datetime | dt.date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return sanitize(float(value))
    if hasattr(value, "isoformat"):
        return value.isoformat()
    try:
        import pandas as pd

        if value is pd.NaT or (not isinstance(value, list | dict) and pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass
    return value


class SafeJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(sanitize(content), ensure_ascii=False, allow_nan=False, separators=(",", ":"),
                          default=str).encode("utf-8")
