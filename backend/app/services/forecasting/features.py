"""Calendar and covariate features for forecasting.

All features are *known in advance* at forecast time (calendar, configured festival calendar, store age)
or are lagged by at least the forecast horizon (``lag_season``), so backtests never use information from
after their cutoff.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

# Known festival calendar used for Indian retail (approximate public dates; configurable per company via
# ``company.settings['events']``). Retail demand ramps up in the weeks before these festivals.
INDIA_EVENTS: dict[str, tuple[str, ...]] = {
    "diwali": ("2021-11-04", "2022-10-24", "2023-11-12", "2024-11-01", "2025-10-21", "2026-11-08", "2027-10-29",
               "2028-10-17"),
    "ganesh": ("2021-09-10", "2022-08-31", "2023-09-19", "2024-09-07", "2025-08-27", "2026-09-14", "2027-09-04",
               "2028-08-23"),
}
EVENT_WINDOWS = {"diwali": (20, 2), "ganesh": (7, 3)}


def event_calendar(country: str | None, overrides: dict | None = None) -> dict[str, list[date]]:
    if overrides:
        return {k: [date.fromisoformat(d) for d in v] for k, v in overrides.items()}
    if country == "IN":
        return {k: [date.fromisoformat(d) for d in v] for k, v in INDIA_EVENTS.items()}
    return {}


def _window_weight(index: pd.DatetimeIndex, events: list[date], before: int, after: int) -> np.ndarray:
    ordinals = np.array([d.toordinal() for d in index.date])
    weight = np.zeros(len(index))
    for event in events:
        delta = ordinals - event.toordinal()
        inside = (delta >= -before) & (delta <= after)
        ramp = np.where(delta <= 0, 1 - np.abs(delta) / (before + 1), 1 - delta / (after + 1))
        weight = np.maximum(weight, np.where(inside, np.clip(ramp, 0, 1), 0))
    return weight


def calendar_features(index: pd.DatetimeIndex, freq: str, events: dict[str, list[date]]) -> pd.DataFrame:
    f = pd.DataFrame(index=index)
    t0 = pd.Timestamp("2000-01-01")
    f["trend"] = (index - t0).days / 365.25
    if freq == "D":
        f["dow"] = index.dayofweek
        f["dom"] = index.day
        f["is_weekend"] = (index.dayofweek >= 5).astype(int)
        f["salary_week"] = (index.day <= 7).astype(int)
        doy = index.dayofyear.to_numpy()
        period = 365.25
    elif freq == "W":
        doy = index.dayofyear.to_numpy() + 3  # mid-week
        period = 365.25
    else:
        doy = (index.month.to_numpy() - 0.5) * 30.44
        period = 365.25
    for k in (1, 2, 3):
        f[f"sin{k}"] = np.sin(2 * np.pi * k * doy / period)
        f[f"cos{k}"] = np.cos(2 * np.pi * k * doy / period)
    f["month"] = index.month
    for name, dates in events.items():
        before, after = EVENT_WINDOWS.get(name, (7, 2))
        if freq == "D":
            f[f"evt_{name}"] = _window_weight(index, dates, before, after)
        else:
            days = pd.date_range(index.min() - pd.Timedelta(days=40), index.max() + pd.Timedelta(days=40), freq="D")
            daily = pd.Series(_window_weight(days, dates, before, after), index=days)
            rule = "W-SUN" if freq == "W" else "MS"
            if freq == "W":
                agg = daily.resample("W-MON", label="left", closed="left").mean()
            else:
                agg = daily.resample(rule).mean()
            f[f"evt_{name}"] = agg.reindex(index).fillna(0).to_numpy()
    return f


def season_lag(freq: str) -> int:
    return {"D": 364, "W": 52, "M": 12}[freq]


def add_lag_feature(features: pd.DataFrame, history: pd.Series, freq: str) -> pd.DataFrame:
    """Same-period-last-year value (aligned to weekday for daily data), taken only from ``history``."""
    lag = season_lag(freq)
    out = features.copy()
    offset = {"D": pd.Timedelta(days=lag), "W": pd.Timedelta(weeks=lag), "M": pd.DateOffset(months=lag)}[freq]
    lookup = history.copy()
    keys = out.index - offset
    out["lag_season"] = lookup.reindex(keys).to_numpy()
    return out
