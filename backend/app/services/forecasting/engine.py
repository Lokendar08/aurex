"""Model selection with rolling-origin (time-based) backtests and empirical prediction intervals.

For each fold the model is trained ONLY on observations before the cutoff and evaluated on the next
``horizon`` periods. The model with the lowest mean WAPE wins (ties favour the simpler model). Interval
widths come from the selected model's relative backtest errors by horizon bucket (an empirical,
conformal-style approach); their realised coverage on the backtests is reported, never assumed.

Reliability verdict (documented thresholds):
- ``reliable``: WAPE <= 10%, beats the best baseline by >= 10% (or the winner *is* a baseline), 80% interval
  coverage in [0.7, 0.95] and at least ``MIN_HISTORY`` observations (180 daily, 52 weekly, 18 monthly)
- ``use_with_caution``: WAPE <= 25% and not worse than the best baseline
- ``unreliable``: otherwise
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from app.services import metrics as m
from app.services.forecasting.models import BASELINE_NAMES, ModelContext, candidate_models

ENGINE_VERSION = "1.1.0"  # 1.1.0: interior-gap interpolation only, WAPE 0 kept as 0
MIN_HISTORY = {"D": 180, "W": 52, "M": 18}


@dataclass
class FoldResult:
    algorithm: str
    fold: int
    cutoff: str
    horizon: int
    mae: float | None
    rmse: float | None
    wape: float | None
    mape: float | None
    bias: float | None
    coverage_80: float | None = None


@dataclass
class CandidateSummary:
    algorithm: str
    family: str
    description: str
    folds: int
    mae: float | None
    rmse: float | None
    wape: float | None
    mape: float | None
    bias: float | None
    fit_seconds: float
    failed: str | None = None


@dataclass
class ForecastResult:
    freq: str
    horizon: int
    selected: str
    baseline: str
    candidates: list[CandidateSummary]
    folds: list[FoldResult]
    metrics: dict[str, Any]
    baseline_metrics: dict[str, Any]
    skill_vs_baseline: float | None
    reliability: str
    forecast: pd.DataFrame  # index period_start; columns yhat, lower_80, upper_80, lower_95, upper_95
    training_start: str
    training_end: str
    n_observations: int
    data_fingerprint: str
    params: dict[str, Any]
    limitations: list[str] = field(default_factory=list)
    interval_method: str = "empirical backtest error quantiles by horizon"
    engine_version: str = ENGINE_VERSION
    # Out-of-sample predictions of the selected model on each fold (actual, pred) - used for aggregated intervals.
    fold_predictions: list[pd.DataFrame] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        out = asdict(self)
        out.pop("forecast")
        out.pop("fold_predictions", None)
        return out


def fingerprint(series: pd.Series) -> str:
    payload = "|".join(f"{ts.date().isoformat()}:{float(v):.4f}" for ts, v in series.items())
    return hashlib.sha256(payload.encode()).hexdigest()


def future_index(last: pd.Timestamp, freq: str, horizon: int) -> pd.DatetimeIndex:
    if freq == "D":
        return pd.date_range(last + pd.Timedelta(days=1), periods=horizon, freq="D")
    if freq == "W":
        return pd.date_range(last + pd.Timedelta(weeks=1), periods=horizon, freq="7D")
    return pd.date_range(last + pd.offsets.MonthBegin(1), periods=horizon, freq="MS")


def _score(actual: np.ndarray, pred: np.ndarray) -> dict[str, float | None]:
    return {"mae": m.mae(actual, pred).value, "rmse": m.rmse(actual, pred).value, "wape": m.wape(actual, pred).value,
            "mape": m.mape(actual, pred).value, "bias": m.bias(actual, pred).value}


def _buckets(horizon: int) -> list[tuple[int, int]]:
    edges = sorted({0, max(1, horizon // 4), max(2, horizon // 2), horizon})
    return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]


def evaluate_and_forecast(series: pd.Series, *, freq: str, horizon: int, folds: int = 3,
                          eval_horizon: int | None = None, ctx: ModelContext | None = None) -> ForecastResult:
    series = series.sort_index().astype(float)
    ctx = ctx or ModelContext(freq=freq)
    n = len(series)
    eval_h = min(eval_horizon or horizon, max(1, n // 4))
    limitations: list[str] = []
    if n < MIN_HISTORY[freq]:
        limitations.append(f"Only {n} observations; at least {MIN_HISTORY[freq]} are recommended for this frequency.")
    zero_share = float((series <= 0).mean())
    if zero_share > 0.2:
        limitations.append(f"{zero_share:.0%} of periods are zero (intermittent demand); percentage errors are unstable.")

    max_folds = max(1, min(folds, (n - MIN_HISTORY[freq] // 2) // eval_h))
    cutoffs = [n - eval_h * k for k in range(max_folds, 0, -1)]
    cutoffs = [c for c in cutoffs if c >= max(12, MIN_HISTORY[freq] // 2)]
    if not cutoffs:
        cutoffs = [max(1, n - eval_h)]
        limitations.append("History supports a single short backtest only; accuracy estimates are weak.")

    candidates = candidate_models(ctx, n)
    fold_rows: list[FoldResult] = []
    rel_errors: dict[str, list[tuple[int, float]]] = {c.name: [] for c in candidates}
    fold_preds: dict[str, list[pd.DataFrame]] = {c.name: [] for c in candidates}
    summaries: list[CandidateSummary] = []
    for model in candidates:
        scores = []
        started = time.perf_counter()
        failed = None
        for fi, cut in enumerate(cutoffs, 1):
            train, test = series.iloc[:cut], series.iloc[cut:cut + eval_h]
            if len(test) == 0:
                continue
            try:
                fitted = _refit(model, ctx).fit(train)
                pred = fitted.predict(test.index)
            except Exception as exc:  # noqa: BLE001 - a failing candidate is recorded, not fatal
                failed = f"{type(exc).__name__}: {str(exc)[:120]}"
                break
            actual = test.to_numpy()
            fold_preds[model.name].append(pd.DataFrame({"actual": actual, "pred": pred}, index=test.index))
            s = _score(actual, pred)
            scores.append(s)
            fold_rows.append(FoldResult(model.name, fi, test.index[0].date().isoformat(), len(test), **s))
            for step, (a, p) in enumerate(zip(actual, pred, strict=True)):
                if abs(p) > 1e-9:
                    rel_errors[model.name].append((step, (a - p) / p))
        elapsed = time.perf_counter() - started
        if failed or not scores:
            summaries.append(CandidateSummary(model.name, model.family, model.description, 0, None, None, None, None,
                                              None, round(elapsed, 3), failed or "no evaluation window"))
            continue

        def mean_of(key: str, sc: list[dict[str, float | None]] = scores) -> float | None:
            vals = [s[key] for s in sc if s[key] is not None]
            return float(np.mean(vals)) if vals else None

        summaries.append(CandidateSummary(model.name, model.family, model.description, len(scores), mean_of("mae"),
                                          mean_of("rmse"), mean_of("wape"), mean_of("mape"), mean_of("bias"),
                                          round(elapsed, 3)))

    scored = [s for s in summaries if s.wape is not None]
    if not scored:
        raise ValueError("No forecasting model could be evaluated on this series")
    complexity = {"baseline": 0, "statistical": 1, "machine_learning": 2}
    best = min(scored, key=lambda s: (round(s.wape, 4), complexity.get(s.family, 3)))
    baselines = [s for s in scored if s.algorithm in BASELINE_NAMES]
    best_baseline = min(baselines, key=lambda s: s.wape) if baselines else best
    skill = m.safe_ratio(best.wape, best_baseline.wape)
    skill_value = 1 - skill.value if skill.ok else None  # type: ignore[operator]

    # Empirical interval quantiles by horizon bucket for the selected model.
    errors = rel_errors.get(best.algorithm, [])
    bucket_q: list[tuple[tuple[int, int], dict[str, float]]] = []
    for lo, hi in _buckets(eval_h):
        vals = np.array([e for step, e in errors if lo <= step < hi])
        if len(vals) < 8:
            vals = np.array([e for _, e in errors]) if errors else np.array([0.0])
        bucket_q.append(((lo, hi), {q: float(np.quantile(vals, q)) for q in (0.025, 0.1, 0.9, 0.975)}))

    # Coverage of the 80% band on the backtests (honest check of the interval method).
    covered = []
    for step, e in errors:
        q = next((qs for (lo, hi), qs in bucket_q if lo <= step < hi), bucket_q[-1][1])
        covered.append(q[0.1] <= e <= q[0.9])
    coverage = float(np.mean(covered)) if covered else None
    if coverage is not None:
        limitations.append("Interval coverage is measured on the same backtests used to calibrate the intervals; "
                           "expect somewhat lower coverage on genuinely new data.")

    # Final fit on all data.
    final_model = next(c for c in candidates if c.name == best.algorithm)
    fitted = _refit(final_model, ctx).fit(series)
    idx = future_index(series.index[-1], freq, horizon)
    yhat = np.clip(fitted.predict(idx), 0, None)
    lower80, upper80, lower95, upper95 = [], [], [], []
    for step, value in enumerate(yhat):
        q = next((qs for (lo, hi), qs in bucket_q if lo <= step < hi), bucket_q[-1][1])
        widen = 1.0 if step < eval_h else float(np.sqrt((step + 1) / eval_h))  # beyond evaluated horizon
        lower80.append(max(0.0, value * (1 + q[0.1] * widen)))
        upper80.append(value * (1 + q[0.9] * widen))
        lower95.append(max(0.0, value * (1 + q[0.025] * widen)))
        upper95.append(value * (1 + q[0.975] * widen))
    if horizon > eval_h:
        limitations.append(f"Accuracy was measured up to {eval_h} periods ahead; intervals beyond that are widened "
                           "with the square-root-of-horizon rule and are less reliable.")
    forecast = pd.DataFrame({"yhat": yhat, "lower_80": lower80, "upper_80": upper80, "lower_95": lower95,
                             "upper_95": upper95}, index=idx)

    wape_best = 1.0 if best.wape is None else best.wape  # a perfect WAPE of 0 must stay 0
    beats_baseline = skill_value is not None and skill_value >= 0.10
    coverage_ok = coverage is not None and 0.70 <= coverage <= 0.95
    if wape_best <= 0.10 and (beats_baseline or best.algorithm in BASELINE_NAMES) and coverage_ok and n >= MIN_HISTORY[freq]:
        reliability = "reliable"
    elif wape_best <= 0.25 and (skill_value is None or skill_value >= 0):
        reliability = "use_with_caution"
    else:
        reliability = "unreliable"
    if best.algorithm in BASELINE_NAMES:
        limitations.append("A simple baseline performed best; more complex models did not add measurable accuracy.")

    return ForecastResult(
        freq=freq, horizon=horizon, selected=best.algorithm, baseline=best_baseline.algorithm, candidates=summaries,
        folds=fold_rows,
        metrics={"mae": best.mae, "rmse": best.rmse, "wape": best.wape, "mape": best.mape, "bias": best.bias,
                 "coverage_80": coverage, "eval_horizon": eval_h, "folds": len(cutoffs)},
        baseline_metrics={"algorithm": best_baseline.algorithm, "mae": best_baseline.mae, "rmse": best_baseline.rmse,
                          "wape": best_baseline.wape},
        skill_vs_baseline=skill_value, reliability=reliability, forecast=forecast,
        training_start=series.index[0].date().isoformat(), training_end=series.index[-1].date().isoformat(),
        n_observations=n, data_fingerprint=fingerprint(series), params=fitted.params(), limitations=limitations,
        fold_predictions=fold_preds.get(best.algorithm, []),
    )


def _refit(model: Any, ctx: ModelContext) -> Any:
    """Fresh, unfitted copy of a candidate (keeps constructor arguments such as seasonal periods)."""
    from app.services.forecasting import models as mm

    if isinstance(model, mm.SeasonalNaive):
        return mm.SeasonalNaive(ctx, model.period, model.name)
    return type(model)(ctx)
