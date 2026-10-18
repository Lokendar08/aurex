"""Numeric grounding check: every figure in an advisor answer must trace back to a tool output.

Numbers are matched against all numeric values returned by the tools in the same turn, allowing for
display scaling (percent, thousand, lakh, million, crore, billion) and rounding. Figures that cannot
be traced are listed, flagged in the UI and lower the stated confidence - they are never silently
presented as facts.
"""

from __future__ import annotations

import re
from typing import Any

SCALES = (1.0, 100.0, 1e-3, 1e-5, 1e-6, 1e-7, 1e-9)
# A number glued to letters (product names such as "Curd 400g", "Power Bank 10000mAh") is not a figure.
_NUM = re.compile(r"(?<![A-Za-z0-9_.\-/])[-−]?\d[\d,]*(?:\.\d+)?(?![\d\-/A-Za-z])")
_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b")
_CODE = re.compile(r"\b[A-Z]{1,6}-?\d+[A-Z0-9-]*\b")


def collect_numbers(value: Any, out: list[float] | None = None) -> list[float]:
    out = [] if out is None else out
    if isinstance(value, bool):
        return out
    if isinstance(value, int | float):
        out.append(float(value))
    elif isinstance(value, dict):
        for v in value.values():
            collect_numbers(v, out)
    elif isinstance(value, list | tuple):
        for v in value:
            collect_numbers(v, out)
    return out


def _pool(numbers: list[float]) -> list[float]:
    pool = set()
    for n in numbers:
        for s in SCALES:
            pool.add(n * s)
            pool.add(abs(n) * s)
    return sorted(pool)


def supported(x: float, pool: list[float]) -> bool:
    for c in pool:
        tolerance = max(0.051 if abs(x) < 100 else 0.51, abs(c) * 0.006)
        if abs(x - c) <= tolerance:
            return True
    return False


def numbers_in_text(text: str) -> list[float]:
    cleaned = _DATE.sub(" ", text or "")
    cleaned = _CODE.sub(" ", cleaned)
    found = []
    for match in _NUM.finditer(cleaned):
        raw = match.group().replace(",", "").replace("−", "-")
        try:
            value = float(raw)
        except ValueError:
            continue
        is_year = raw.isdigit() and 1990 <= value <= 2100
        small_count = raw.isdigit() and abs(value) <= 12
        if is_year or small_count:
            continue
        found.append(value)
    return found


def verify(answer: dict[str, Any], tool_outputs: list[Any]) -> dict[str, Any]:
    pool = _pool(collect_numbers(tool_outputs))
    unverified_figures = []
    for fig in answer.get("key_figures", []) or []:
        value = fig.get("value")
        if value is None:
            fig["verified"] = None
            continue
        fig["verified"] = supported(float(value), pool)
        if not fig["verified"]:
            unverified_figures.append(fig.get("label"))
    text_numbers = numbers_in_text(answer.get("answer", ""))
    unverified_text = [n for n in text_numbers if not supported(n, pool)]
    ok = not unverified_figures and not unverified_text
    result = {"all_numbers_traced": ok, "checked_numbers": len(text_numbers) + len(answer.get("key_figures") or []),
              "unverified_key_figures": unverified_figures, "unverified_numbers_in_text": unverified_text[:20],
              "method": "Each number is matched to a tool output value (allowing %, thousand, lakh, million, crore and "
                        "billion display scaling and rounding)."}
    if not ok:
        levels = ["high", "medium", "low"]
        current = answer.get("confidence", "medium")
        answer["confidence"] = levels[min(levels.index(current) + 1, 2)] if current in levels else "low"
        answer.setdefault("limitations", []).append(
            f"{len(unverified_figures) + len(unverified_text)} figure(s) in this answer could not be traced to tool "
            "output and should not be relied on.")
    answer["verification"] = result
    return answer
