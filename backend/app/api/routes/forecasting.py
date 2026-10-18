"""Forecasting endpoints: model registry, training jobs, forecasts with history, baseline projection."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession, OrgContext, require
from app.core.errors import NotFoundError, PermissionDeniedError, ValidationAppError
from app.core.permissions import Permission
from app.models import BackgroundJob, ForecastBacktest, ForecastModel, ProductCategory, Store
from app.services.analytics.dashboard import build_scope
from app.services.audit import record_audit
from app.services.forecasting.service import (
    TARGETS,
    active_model,
    baseline_monthly,
    history_frame,
    model_out,
    model_points,
)
from app.worker.dispatcher import enqueue

router = APIRouter(tags=["forecasting"])
P = Permission


def _labels(db: DbSession, company_id: uuid.UUID) -> dict[str, str]:
    labels = {str(s.id): f"{s.code} · {s.name}" for s in db.scalars(select(Store).where(Store.company_id == company_id))}
    labels.update({c.code: c.name for c in db.scalars(select(ProductCategory).where(ProductCategory.company_id == company_id))})
    labels["all"] = "Company"
    return labels


def _visible(ctx: OrgContext, model: ForecastModel) -> bool:
    if ctx.store_scope is None:
        return True
    return model.level == "store" and uuid.UUID(model.level_key) in ctx.store_scope


@router.get("/orgs/{org_id}/forecasts")
def list_forecasts(ctx: Annotated[OrgContext, Depends(require(P.FORECASTS_READ))], db: DbSession,
                   company_id: uuid.UUID | None = None) -> dict:
    company = ctx.default_company(db, company_id)
    rows = db.scalars(select(ForecastModel).where(ForecastModel.company_id == company.id,
                                                  ForecastModel.is_active.is_(True))
                      .order_by(ForecastModel.target, ForecastModel.level, ForecastModel.level_key)).all()
    labels = _labels(db, company.id)
    jobs = db.scalars(select(BackgroundJob).where(BackgroundJob.org_id == ctx.org_id,
                                                  BackgroundJob.job_type == "train_forecasts")
                      .order_by(BackgroundJob.created_at.desc()).limit(5)).all()
    return {"company_id": str(company.id), "is_synthetic": company.is_synthetic,
            "targets": [{"key": t.key, "label": t.label, "unit": t.unit, "frequency": t.freq, "horizon": t.horizon,
                         "evaluation_horizon": t.eval_horizon, "folds": t.folds, "levels": list(t.levels)}
                        for t in TARGETS.values()],
            "models": [model_out(mm, labels) for mm in rows if _visible(ctx, mm)],
            "recent_jobs": [{"id": str(j.id), "status": j.status, "created_at": j.created_at.isoformat(),
                             "finished_at": j.finished_at.isoformat() if j.finished_at else None, "result": j.result,
                             "error": j.error} for j in jobs],
            "methodology": {
                "validation": "Rolling-origin backtests: each fold trains only on data before its cutoff and is scored "
                              "on the following periods (no shuffling, no future information).",
                "metrics": "MAE, RMSE, WAPE (Σ|error| ÷ Σ|actual|), MAPE (zero actuals excluded) and bias.",
                "selection": "Lowest mean WAPE across folds; ties go to the simpler model. Skill = 1 − WAPE ÷ best "
                             "baseline WAPE.",
                "intervals": "Empirical quantiles of the selected model's relative backtest errors by horizon; realised "
                             "coverage on the backtests is reported.",
                "reliability": "reliable: WAPE ≤ 10%, ≥10% better than the best baseline (or the winner is a "
                               "baseline), 80% coverage 70–95% and enough history (180 days / 52 weeks / 18 months); "
                               "use_with_caution: WAPE ≤ 25% and not worse than baseline; otherwise unreliable."}}


class TrainIn(BaseModel):
    company_id: uuid.UUID | None = None
    targets: list[str] | None = Field(default=None, max_length=10)


@router.post("/orgs/{org_id}/forecasts/train", status_code=status.HTTP_202_ACCEPTED)
def train(body: TrainIn, ctx: Annotated[OrgContext, Depends(require(P.FORECASTS_RUN))], db: DbSession,
          request: Request) -> dict:
    if ctx.store_scope is not None:
        raise PermissionDeniedError("Store-scoped members cannot retrain company forecasts")
    company = ctx.default_company(db, body.company_id)
    unknown = [t for t in body.targets or [] if t not in TARGETS]
    if unknown:
        raise ValidationAppError("Unknown targets", details={"targets": unknown})
    running = db.scalar(select(BackgroundJob.id).where(BackgroundJob.org_id == ctx.org_id,
                                                       BackgroundJob.job_type == "train_forecasts",
                                                       BackgroundJob.status.in_(("queued", "running"))))
    if running:
        return {"job_id": str(running), "status": "already_running"}
    job = enqueue(db, "train_forecasts", {"org_id": str(ctx.org_id), "company_id": str(company.id),
                                         "targets": body.targets, "user_id": str(ctx.user.id)},
                  org_id=ctx.org_id, user_id=ctx.user.id)
    record_audit(db, action="forecast.training_requested", org_id=ctx.org_id, actor=ctx.user,
                 entity_type="background_job", entity_id=job.id, request=request, details={"targets": body.targets})
    return {"job_id": str(job.id), "status": "queued"}


@router.get("/orgs/{org_id}/jobs/{job_id}")
def job_status(job_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.ORG_READ))], db: DbSession) -> dict:
    job = db.scalar(select(BackgroundJob).where(BackgroundJob.id == job_id, BackgroundJob.org_id == ctx.org_id))
    if job is None:
        raise NotFoundError("Job not found")
    return {"id": str(job.id), "job_type": job.job_type, "status": job.status, "result": job.result,
            "error": job.error, "created_at": job.created_at.isoformat(),
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None}


@router.get("/orgs/{org_id}/forecasts/models/{model_id}")
def get_model(model_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.FORECASTS_READ))], db: DbSession,
              history_periods: int = Query(default=180, ge=10, le=2000)) -> dict:
    model = ctx.scoped_get(db, ForecastModel, model_id, "Forecast model")
    if not _visible(ctx, model):
        raise PermissionDeniedError("This forecast is outside your store scope")
    scope = build_scope(db, ctx, model.company_id, [uuid.UUID(model.level_key)] if model.level == "store" else None)
    points = model_points(db, model)
    backtests = db.scalars(select(ForecastBacktest).where(ForecastBacktest.model_id == model.id)
                           .order_by(ForecastBacktest.algorithm, ForecastBacktest.fold)).all()
    versions = db.scalars(select(ForecastModel).where(
        ForecastModel.company_id == model.company_id, ForecastModel.target == model.target,
        ForecastModel.level == model.level, ForecastModel.level_key == model.level_key)
        .order_by(ForecastModel.version.desc())).all()
    return {**model_out(model, _labels(db, model.company_id)),
            "history": history_frame(db, scope, model, history_periods),
            "forecast": [{**r, "period_start": r["period_start"].isoformat()} for r in points.to_dict(orient="records")],
            "backtests": [{"algorithm": b.algorithm, "fold": b.fold, "cutoff": b.cutoff.isoformat(), "horizon": b.horizon,
                           "mae": b.mae, "rmse": b.rmse, "wape": b.wape, "mape": b.mape, "bias": b.bias} for b in backtests],
            "versions": [{"id": str(v.id), "version": v.version, "algorithm": v.algorithm, "wape": v.metrics.get("wape"),
                          "reliability": v.reliability, "training_end": v.training_end.isoformat(),
                          "data_fingerprint": v.data_fingerprint[:12], "is_active": v.is_active,
                          "created_at": v.created_at.isoformat()} for v in versions]}


@router.get("/orgs/{org_id}/forecasts/active")
def get_active(ctx: Annotated[OrgContext, Depends(require(P.FORECASTS_READ))], db: DbSession,
               target: str = Query(max_length=40), level: str = Query(default="company", max_length=20),
               key: str = Query(default="all", max_length=80), company_id: uuid.UUID | None = None,
               history_periods: int = Query(default=180, ge=10, le=2000)) -> dict:
    company = ctx.default_company(db, company_id)
    model = active_model(db, company.id, target, level, key)
    if model is None:
        raise NotFoundError("No trained forecast for this series yet", code="not_trained")
    return get_model(model.id, ctx, db, history_periods)


@router.get("/orgs/{org_id}/forecasts/baseline")
def get_baseline(ctx: Annotated[OrgContext, Depends(require(P.FORECASTS_READ, P.FINANCE_READ))], db: DbSession,
                 company_id: uuid.UUID | None = None, store_ids: list[uuid.UUID] | None = Query(default=None),
                 months: int = Query(default=12, ge=1, le=24)) -> dict:
    scope = build_scope(db, ctx, company_id, store_ids)
    return {"currency": scope.currency, "is_synthetic": scope.company.is_synthetic, **baseline_monthly(db, scope, months)}
