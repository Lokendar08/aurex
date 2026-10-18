"""Forecasting (model versions, runs, points, backtests) and Decision Lab (scenarios, runs)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models.mixins import CompanyScoped


class ForecastModel(UUIDPk, CompanyScoped, Base):
    """A versioned, evaluated model for one target series. Immutable once trained."""

    __tablename__ = "forecast_models"

    target: Mapped[str] = mapped_column(String(40), nullable=False)  # net_sales, units, opex, labor_hours ...
    level: Mapped[str] = mapped_column(String(20), nullable=False)  # company | store | category | product
    level_key: Mapped[str] = mapped_column(String(80), nullable=False)  # 'all' or an id
    frequency: Mapped[str] = mapped_column(String(2), nullable=False)  # D | W | M
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    algorithm: Mapped[str] = mapped_column(String(40), nullable=False)  # selected algorithm
    hyperparameters: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    candidates: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)  # all evaluated models + metrics
    baseline_algorithm: Mapped[str] = mapped_column(String(40), nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)  # selected model backtest metrics
    baseline_metrics: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    skill_vs_baseline: Mapped[float | None] = mapped_column(Float)  # 1 - WAPE_model / WAPE_baseline
    reliability: Mapped[str] = mapped_column(String(20), nullable=False)  # reliable | use_with_caution | unreliable
    training_start: Mapped[date] = mapped_column(Date, nullable=False)
    training_end: Mapped[date] = mapped_column(Date, nullable=False)
    n_observations: Mapped[int] = mapped_column(Integer, nullable=False)
    data_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    random_seed: Mapped[int] = mapped_column(Integer, nullable=False, default=42)
    code_version: Mapped[str] = mapped_column(String(40), nullable=False)
    limitations: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    artifact_path: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("company_id", "target", "level", "level_key", "frequency", "version"),
        CheckConstraint("frequency IN ('D', 'W', 'M')", name="frequency_valid"),
        CheckConstraint("reliability IN ('reliable', 'use_with_caution', 'unreliable')", name="reliability_valid"),
        Index("ix_forecast_models_lookup", "company_id", "target", "level", "level_key", "frequency"),
    )


class ForecastBacktest(Base):
    __tablename__ = "forecast_backtests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("forecast_models.id", ondelete="CASCADE"), nullable=False, index=True
    )
    algorithm: Mapped[str] = mapped_column(String(40), nullable=False)
    fold: Mapped[int] = mapped_column(Integer, nullable=False)
    cutoff: Mapped[date] = mapped_column(Date, nullable=False)
    horizon: Mapped[int] = mapped_column(Integer, nullable=False)
    mae: Mapped[float | None] = mapped_column(Float)
    rmse: Mapped[float | None] = mapped_column(Float)
    wape: Mapped[float | None] = mapped_column(Float)
    mape: Mapped[float | None] = mapped_column(Float)
    bias: Mapped[float | None] = mapped_column(Float)
    coverage_80: Mapped[float | None] = mapped_column(Float)


class ForecastRun(UUIDPk, CompanyScoped, Base):
    __tablename__ = "forecast_runs"

    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("forecast_models.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target: Mapped[str] = mapped_column(String(40), nullable=False)
    level: Mapped[str] = mapped_column(String(20), nullable=False)
    level_key: Mapped[str] = mapped_column(String(80), nullable=False)
    frequency: Mapped[str] = mapped_column(String(2), nullable=False)
    horizon: Mapped[int] = mapped_column(Integer, nullable=False)
    as_of: Mapped[date] = mapped_column(Date, nullable=False)  # last observed period used
    interval_method: Mapped[str] = mapped_column(String(60), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_forecast_runs_lookup", "company_id", "target", "level", "level_key", "frequency"),)


class ForecastPoint(Base):
    __tablename__ = "forecast_points"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("forecast_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    step: Mapped[int] = mapped_column(Integer, nullable=False)
    yhat: Mapped[float] = mapped_column(Float, nullable=False)
    lower_80: Mapped[float | None] = mapped_column(Float)
    upper_80: Mapped[float | None] = mapped_column(Float)
    lower_95: Mapped[float | None] = mapped_column(Float)
    upper_95: Mapped[float | None] = mapped_column(Float)


class Scenario(UUIDPk, Timestamps, CompanyScoped, Base):
    __tablename__ = "scenarios"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="saved", nullable=False)
    horizon_months: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    store_ids: Mapped[list | None] = mapped_column(JSONB)  # None = company-wide
    levers: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    assumptions: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    tags: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("status IN ('draft', 'saved', 'archived')", name="status_valid"),
        CheckConstraint("horizon_months BETWEEN 1 AND 60", name="horizon_valid"),
        Index("ix_scenarios_company_updated", "company_id", "updated_at"),
    )


class ScenarioRun(UUIDPk, Base):
    __tablename__ = "scenario_runs"

    scenario_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scenario_version: Mapped[int] = mapped_column(Integer, nullable=False)
    engine_version: Mapped[str] = mapped_column(String(20), nullable=False)
    inputs_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    computed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
