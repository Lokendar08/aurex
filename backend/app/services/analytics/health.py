"""Business health score: a transparent, heuristic composite (0-100).

Components (default weights; missing components are excluded and the remaining weights renormalized):
  growth          25%  revenue growth vs same period last year: -10% -> 0, +20% -> 100
  profitability   30%  EBITDA margin: 0% -> 0, 12% -> 100 (retail-oriented range)
  liquidity       20%  months of operating outflows covered by cash: 0 -> 0, 3+ months -> 100
  inventory       15%  annualized turnover: 2x -> 0, 12x -> 100, reduced by the out-of-stock rate
  data_quality    10%  cost coverage x freshness (latest sales data older than 3 days reduces the score)

Limitations are returned with every score. The thresholds are generic retail heuristics, not fitted to
outcomes; the score is not a credit rating, valuation or prediction.
"""

from __future__ import annotations

from typing import Any

WEIGHTS = {"growth": 0.25, "profitability": 0.30, "liquidity": 0.20, "inventory": 0.15, "data_quality": 0.10}
LIMITATIONS = [
    "Heuristic thresholds for retail businesses; they are not statistically fitted to business outcomes.",
    "Not a credit rating, valuation or forecast of failure.",
    "Components without data are excluded and the remaining weights are renormalized.",
    "Growth compares with the same calendar period last year; new stores inflate total growth.",
]


def _clip(x: float) -> float:
    return max(0.0, min(1.0, x))


def health_score(*, revenue_growth: float | None, ebitda_margin: float | None, cash_months: float | None,
                 inventory_turnover: float | None, out_of_stock_rate: float | None, cost_coverage: float | None,
                 data_age_days: int | None) -> dict[str, Any]:
    comps: dict[str, dict[str, Any]] = {}
    if revenue_growth is not None:
        comps["growth"] = {"raw": revenue_growth, "raw_label": "revenue growth", "score": 100 * _clip((revenue_growth + 0.10) / 0.30)}
    if ebitda_margin is not None:
        comps["profitability"] = {"raw": ebitda_margin, "raw_label": "EBITDA margin", "score": 100 * _clip(ebitda_margin / 0.12)}
    if cash_months is not None:
        comps["liquidity"] = {"raw": cash_months, "raw_label": "months of cash cover", "score": 100 * _clip(cash_months / 3.0)}
    if inventory_turnover is not None:
        base = _clip((inventory_turnover - 2.0) / 10.0)
        penalty = min((out_of_stock_rate or 0.0) * 5.0, 0.5)
        comps["inventory"] = {"raw": inventory_turnover, "raw_label": "inventory turnover (x/yr)",
                              "score": 100 * base * (1 - penalty), "out_of_stock_rate": out_of_stock_rate}
    if cost_coverage is not None:
        freshness = 1.0 if data_age_days is None or data_age_days <= 3 else max(0.4, 1 - (data_age_days - 3) / 30)
        comps["data_quality"] = {"raw": cost_coverage, "raw_label": "cost coverage", "score": 100 * cost_coverage * freshness,
                                 "data_age_days": data_age_days}
    if not comps:
        return {"score": None, "status": "missing_data", "components": [], "limitations": LIMITATIONS}
    total_weight = sum(WEIGHTS[k] for k in comps)
    score = sum(comps[k]["score"] * WEIGHTS[k] for k in comps) / total_weight
    grade = "strong" if score >= 75 else "stable" if score >= 55 else "watch" if score >= 35 else "at_risk"
    excluded = [k for k in WEIGHTS if k not in comps]
    return {
        "score": round(score, 1), "grade": grade, "status": "ok",
        "components": [{"key": k, "weight": WEIGHTS[k], "effective_weight": round(WEIGHTS[k] / total_weight, 4),
                        **{kk: (round(vv, 4) if isinstance(vv, float) else vv) for kk, vv in v.items()}}
                       for k, v in comps.items()],
        "excluded_components": excluded,
        "limitations": LIMITATIONS + ([f"Excluded for lack of data: {', '.join(excluded)}"] if excluded else []),
    }
