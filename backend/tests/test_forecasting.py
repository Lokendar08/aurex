"""Forecast evaluation: time-based validation, no leakage, baselines, intervals, versioning."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import select

from app.core.errors import InsufficientDataError
from app.db.session import session_scope
from app.models import Company, ForecastModel, Organization
from app.services.forecasting.engine import evaluate_and_forecast, fingerprint
from app.services.forecasting.features import add_lag_feature
from app.services.forecasting.models import ModelContext


def _series(n: int = 730, noise: float = 0.05, seed: int = 1) -> pd.Series:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-01", periods=n, freq="D")
    weekly = np.array([0.9, 0.85, 0.9, 0.95, 1.05, 1.2, 1.25])[idx.dayofweek]
    yearly = 1 + 0.15 * np.sin(2 * np.pi * idx.dayofyear / 365.25)
    trend = 1 + 0.10 * np.arange(n) / 365
    return pd.Series(1000 * weekly * yearly * trend * rng.lognormal(0, noise, n), index=idx)


def test_advanced_model_beats_naive_baseline_on_seasonal_series() -> None:
    result = evaluate_and_forecast(_series(), freq="D", horizon=60, folds=3, eval_horizon=60)
    names = {c.algorithm for c in result.candidates}
    assert {"naive_last", "seasonal_naive_weekly", "ridge_regression", "gradient_boosting", "holt_winters"} <= names
    naive = next(c for c in result.candidates if c.algorithm == "naive_last")
    assert result.metrics["wape"] < naive.wape
    assert result.skill_vs_baseline is not None and result.skill_vs_baseline > 0
    assert result.reliability in ("reliable", "use_with_caution")


def test_backtest_folds_are_strictly_time_ordered() -> None:
    s = _series()
    result = evaluate_and_forecast(s, freq="D", horizon=30, folds=3, eval_horizon=30)
    cutoffs = sorted({f.cutoff for f in result.folds})
    assert len(cutoffs) == 3
    # every fold evaluates the period immediately after its training window (nothing shuffled)
    assert cutoffs[-1] == (s.index[-30]).date().isoformat()


def test_no_leakage_future_values_do_not_change_backtest_predictions() -> None:
    s = _series()
    tampered = s.copy()
    tampered.iloc[-30:] *= 10  # wildly different "future" for the last fold's evaluation window
    a = evaluate_and_forecast(s, freq="D", horizon=30, folds=2, eval_horizon=30)
    b = evaluate_and_forecast(tampered, freq="D", horizon=30, folds=2, eval_horizon=30)
    fold_a = [f for f in a.fold_predictions][0]
    fold_b = [f for f in b.fold_predictions][0]
    # Fold 1 trains before both evaluation windows: identical predictions despite the tampered tail
    if a.selected == b.selected:
        np.testing.assert_allclose(fold_a["pred"].to_numpy(), fold_b["pred"].to_numpy(), rtol=1e-9)


def test_lag_feature_uses_only_history() -> None:
    s = _series(400)
    features = pd.DataFrame(index=pd.date_range(s.index[-1] + pd.Timedelta(days=1), periods=10, freq="D"))
    lagged = add_lag_feature(features, s, "D")
    expected = s.reindex(features.index - pd.Timedelta(days=364)).to_numpy()
    np.testing.assert_allclose(lagged["lag_season"].to_numpy(), expected)


def test_prediction_intervals_are_ordered_and_coverage_reported() -> None:
    result = evaluate_and_forecast(_series(noise=0.15), freq="D", horizon=45, folds=3, eval_horizon=45)
    f = result.forecast
    assert (f["lower_95"] <= f["lower_80"]).all() and (f["lower_80"] <= f["yhat"]).all()
    assert (f["yhat"] <= f["upper_80"]).all() and (f["upper_80"] <= f["upper_95"]).all()
    assert 0.0 <= result.metrics["coverage_80"] <= 1.0
    assert any("coverage" in note.lower() for note in result.limitations)


def test_short_history_is_disclosed_and_noisy_series_is_not_called_reliable() -> None:
    rng = np.random.default_rng(3)
    idx = pd.date_range("2025-01-01", periods=90, freq="D")
    noisy = pd.Series(rng.lognormal(5, 1.0, 90), index=idx)
    result = evaluate_and_forecast(noisy, freq="D", horizon=14, folds=2, eval_horizon=14)
    assert result.reliability != "reliable"
    assert any("observations" in n for n in result.limitations)


def test_fingerprint_is_deterministic_and_data_sensitive() -> None:
    s = _series(100)
    assert fingerprint(s) == fingerprint(s.copy())
    t = s.copy()
    t.iloc[5] += 1
    assert fingerprint(t) != fingerprint(s)


def test_training_is_reproducible() -> None:
    s = _series(500)
    a = evaluate_and_forecast(s, freq="D", horizon=20, folds=2, eval_horizon=20, ctx=ModelContext(freq="D"))
    b = evaluate_and_forecast(s, freq="D", horizon=20, folds=2, eval_horizon=20, ctx=ModelContext(freq="D"))
    assert a.selected == b.selected
    np.testing.assert_allclose(a.forecast["yhat"].to_numpy(), b.forecast["yhat"].to_numpy())


def test_monthly_series_supported() -> None:
    idx = pd.date_range("2022-01-01", periods=36, freq="MS")
    s = pd.Series(100 + 10 * np.sin(np.arange(36) / 12 * 2 * np.pi) + np.arange(36), index=idx)
    result = evaluate_and_forecast(s, freq="M", horizon=12, folds=2, eval_horizon=6)
    assert len(result.forecast) == 12 and result.forecast.index[0] == pd.Timestamp("2025-01-01")


def test_service_versions_models_and_persists_backtests() -> None:
    from app.services.forecasting.service import train_target

    with session_scope() as db:
        org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
        company = db.scalar(select(Company).where(Company.org_id == org.id))
        before = db.scalar(select(ForecastModel).where(ForecastModel.company_id == company.id,
                                                       ForecastModel.target == "net_sales",
                                                       ForecastModel.level == "company", ForecastModel.is_active.is_(True)))
        model = train_target(db, org_id=org.id, company=company, target="net_sales")
        db.commit()
        assert model.version == before.version + 1 and model.is_active
        assert db.get(ForecastModel, before.id).is_active is False
        assert model.data_fingerprint and model.code_version and model.candidates
        assert any("synthetic" in lim.lower() for lim in model.limitations)


def test_forecast_api_exposes_methodology_and_backtests(demo) -> None:  # type: ignore[no-untyped-def]
    analyst = demo("business_analyst")
    listing = analyst.get("/forecasts").json()
    assert "rolling-origin" in listing["methodology"]["validation"].lower()
    model = next(m for m in listing["models"] if m["target"] == "net_sales" and m["level"] == "company")
    detail = analyst.get(f"/forecasts/models/{model['id']}").json()
    assert detail["backtests"] and detail["forecast"] and detail["history"]
    assert {"mae", "rmse", "wape"} <= set(detail["metrics"])


def test_insufficient_history_raises() -> None:
    from app.services.forecasting.service import train_target

    with session_scope() as db:
        org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
        company = db.scalar(select(Company).where(Company.org_id == org.id))
        with pytest.raises(InsufficientDataError):
            train_target(db, org_id=org.id, company=company, target="operating_expenses")  # only ~6 months
