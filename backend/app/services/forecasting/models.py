"""Candidate forecasting models behind one interface: ``fit(history)`` then ``predict(future_index)``.

Baselines: last value, seasonal naive (weekly / yearly). Advanced: Holt-Winters exponential smoothing,
gradient boosting and ridge regression on known-in-advance calendar/festival/trend features plus the
same-period-last-year lag. Regression models are fitted on log1p(y) (multiplicative effects, positive
forecasts); preprocessing is fitted on the training window only.
"""

from __future__ import annotations

import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from app.services.forecasting.features import add_lag_feature, calendar_features, season_lag

RANDOM_SEED = 42


@dataclass
class ModelContext:
    freq: str
    events: dict[str, list[date]] = field(default_factory=dict)
    # Known-in-advance covariates (e.g. store age) computed for ANY index, past or future.
    covariate_fn: Callable[[pd.DatetimeIndex], pd.DataFrame] | None = None


class ForecastModelBase:
    name = "base"
    family = "baseline"
    description = ""

    def __init__(self, ctx: ModelContext) -> None:
        self.ctx = ctx
        self.history: pd.Series | None = None

    def fit(self, history: pd.Series) -> ForecastModelBase:
        self.history = history.astype(float)
        return self

    def predict(self, index: pd.DatetimeIndex) -> np.ndarray:
        raise NotImplementedError

    def params(self) -> dict[str, Any]:
        return {}


class LastValue(ForecastModelBase):
    name = "naive_last"
    description = "Repeats the last observed value"

    def predict(self, index: pd.DatetimeIndex) -> np.ndarray:
        assert self.history is not None
        return np.full(len(index), float(self.history.iloc[-1]))


class SeasonalNaive(ForecastModelBase):
    family = "baseline"

    def __init__(self, ctx: ModelContext, period: int, name: str) -> None:
        super().__init__(ctx)
        self.period = period
        self.name = name
        self.description = f"Repeats the value from {period} periods earlier"

    def predict(self, index: pd.DatetimeIndex) -> np.ndarray:
        assert self.history is not None
        values = self.history.to_numpy()
        if len(values) < self.period:
            return np.full(len(index), float(values[-self.period:].mean()))
        last_cycle = values[-self.period:]
        return np.array([last_cycle[i % self.period] for i in range(len(index))], dtype=float)


class SeasonalNaiveYearly(ForecastModelBase):
    """Same period last year; beyond one year ahead the last observed year repeats."""

    name = "seasonal_naive_yearly"
    description = "Same period last year (weekday-aligned for daily data)"

    def predict(self, index: pd.DatetimeIndex) -> np.ndarray:
        assert self.history is not None
        lag = season_lag(self.ctx.freq)
        hist = self.history
        out = []
        for ts in index:
            k = 1
            while True:
                offset = {"D": pd.Timedelta(days=lag * k), "W": pd.Timedelta(weeks=lag * k),
                          "M": pd.DateOffset(months=lag * k)}[self.ctx.freq]
                key = ts - offset
                if key in hist.index:
                    out.append(float(hist.loc[key]))
                    break
                if key < hist.index[0]:
                    out.append(float(hist.iloc[-lag:].mean()) if len(hist) >= 1 else 0.0)
                    break
                k += 1
        return np.array(out)


class HoltWinters(ForecastModelBase):
    name = "holt_winters"
    family = "statistical"
    description = "Exponential smoothing with damped trend and additive seasonality on log scale"

    def __init__(self, ctx: ModelContext) -> None:
        super().__init__(ctx)
        self.period = {"D": 7, "W": 52, "M": 12}[ctx.freq]
        self._fit = None

    def fit(self, history: pd.Series) -> HoltWinters:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        super().fit(history)
        y = np.log1p(np.clip(history.to_numpy(dtype=float), 0, None))
        seasonal = "add" if len(y) >= 2 * self.period + 2 else None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self._fit = ExponentialSmoothing(y, trend="add", damped_trend=True, seasonal=seasonal,
                                             seasonal_periods=self.period if seasonal else None,
                                             initialization_method="estimated").fit(optimized=True)
        return self

    def predict(self, index: pd.DatetimeIndex) -> np.ndarray:
        assert self._fit is not None
        return np.expm1(self._fit.forecast(len(index)))

    def params(self) -> dict[str, Any]:
        if self._fit is None:
            return {}
        return {k: (float(v) if isinstance(v, (int, float, np.floating)) else None)
                for k, v in self._fit.params.items() if k in ("smoothing_level", "smoothing_trend",
                                                              "smoothing_seasonal", "damping_trend")}


class _RegressionModel(ForecastModelBase):
    family = "machine_learning"

    def _design(self, index: pd.DatetimeIndex, history: pd.Series) -> pd.DataFrame:
        features = calendar_features(index, self.ctx.freq, self.ctx.events)
        features = add_lag_feature(features, np.log1p(history.clip(lower=0)), self.ctx.freq)
        if self.ctx.covariate_fn is not None:
            features = features.join(self.ctx.covariate_fn(index))
        return features

    def fit(self, history: pd.Series) -> _RegressionModel:
        super().fit(history)
        X = self._design(history.index, history)
        y = np.log1p(history.clip(lower=0).to_numpy(dtype=float))
        self._columns = list(X.columns)
        self._fit_model(X, y)
        return self

    def predict(self, index: pd.DatetimeIndex) -> np.ndarray:
        assert self.history is not None
        X = self._design(index, self.history)[self._columns]
        return np.expm1(self._predict_model(X)).clip(min=0)

    def _fit_model(self, X: pd.DataFrame, y: np.ndarray) -> None:
        raise NotImplementedError

    def _predict_model(self, X: pd.DataFrame) -> np.ndarray:
        raise NotImplementedError


class GradientBoosting(_RegressionModel):
    name = "gradient_boosting"
    description = "Histogram gradient boosting on calendar, festival, trend and last-year features (log scale)"

    def _fit_model(self, X: pd.DataFrame, y: np.ndarray) -> None:
        from sklearn.ensemble import HistGradientBoostingRegressor

        categorical = [c in ("dow", "month") for c in X.columns]
        self._model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=15,
                                                    min_samples_leaf=max(5, len(y) // 60), l2_regularization=1.0,
                                                    categorical_features=categorical, random_state=RANDOM_SEED)
        self._model.fit(X, y)

    def _predict_model(self, X: pd.DataFrame) -> np.ndarray:
        return self._model.predict(X)

    def params(self) -> dict[str, Any]:
        return {"max_iter": 300, "learning_rate": 0.05, "max_leaf_nodes": 15, "random_state": RANDOM_SEED}


class RidgeFourier(_RegressionModel):
    name = "ridge_regression"
    description = "Ridge regression on trend, Fourier seasonality, weekday/month dummies, festivals and last-year lag"

    def _prep(self, X: pd.DataFrame, fit: bool) -> np.ndarray:
        X = X.copy()
        dummies = []
        for col, levels in (("dow", range(7)), ("month", range(1, 13))):
            if col in X:
                for level in levels:
                    dummies.append((f"{col}_{level}", (X[col] == level).astype(float)))
                X = X.drop(columns=[col])
        for name, values in dummies:
            X[name] = values
        if "lag_season" in X:
            X["lag_missing"] = X["lag_season"].isna().astype(float)
            if fit:
                self._lag_fill = float(X["lag_season"].mean()) if X["lag_season"].notna().any() else 0.0
            X["lag_season"] = X["lag_season"].fillna(self._lag_fill)
        X = X.fillna(0.0)
        if fit:
            self._mean = X.mean()
            self._std = X.std().replace(0, 1.0)
            self._cols = list(X.columns)
        X = X.reindex(columns=self._cols, fill_value=0.0)
        return ((X - self._mean) / self._std).to_numpy(dtype=float)

    def _fit_model(self, X: pd.DataFrame, y: np.ndarray) -> None:
        from sklearn.linear_model import Ridge

        self._model = Ridge(alpha=3.0)
        self._model.fit(self._prep(X, fit=True), y)

    def _predict_model(self, X: pd.DataFrame) -> np.ndarray:
        return self._model.predict(self._prep(X, fit=False))

    def params(self) -> dict[str, Any]:
        return {"alpha": 3.0}


class MovingAverage(ForecastModelBase):
    name = "moving_average"
    description = "Mean of the last 3 periods"

    def predict(self, index: pd.DatetimeIndex) -> np.ndarray:
        assert self.history is not None
        return np.full(len(index), float(self.history.iloc[-3:].mean()))


def candidate_models(ctx: ModelContext, n_obs: int) -> list[ForecastModelBase]:
    freq = ctx.freq
    models: list[ForecastModelBase] = [LastValue(ctx)]
    if freq == "D":
        models.append(SeasonalNaive(ctx, 7, "seasonal_naive_weekly"))
    if freq == "M":
        models.append(MovingAverage(ctx))
    if n_obs > season_lag(freq):
        models.append(SeasonalNaiveYearly(ctx))
    models.append(HoltWinters(ctx))
    min_regression = {"D": 120, "W": 60, "M": 18}[freq]
    if n_obs >= min_regression:
        models += [RidgeFourier(ctx), GradientBoosting(ctx)]
    return models


BASELINE_NAMES = {"naive_last", "seasonal_naive_weekly", "seasonal_naive_yearly", "moving_average"}
