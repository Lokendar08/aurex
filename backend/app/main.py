"""AUREX API application factory."""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import __version__
from app.core.config import get_settings
from app.core.errors import RateLimitedError, error_payload, install_error_handlers
from app.core.jsonsafe import SafeJSONResponse
from app.core.logging import configure_logging
from app.core.ratelimit import rate_limiter
from app.db.session import get_engine
from app.services.audit import client_ip

logger = logging.getLogger("aurex.http")


def _router_modules() -> list[APIRouter]:
    from app.api.routes import (
        advisor,
        analytics,
        auth,
        dashboard,
        decision_lab,
        forecasting,
        integrations,
        intelligence,
        organizations,
        platform,
        public,
        reports,
        workflows,
    )

    return [auth.router, organizations.router, integrations.router, dashboard.router, analytics.router,
            forecasting.router, decision_lab.router, advisor.router, intelligence.router, reports.router,
            workflows.router, platform.router, public.router]


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    problems = settings.validate_for_production()
    if problems:
        raise RuntimeError("Unsafe production configuration:\n- " + "\n- ".join(problems))

    app = FastAPI(
        title="AUREX API",
        version=__version__,
        description="AI-powered business intelligence, integration, forecasting and decision simulation platform.",
        default_response_class=SafeJSONResponse,
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        redoc_url=None,
    )
    install_error_handlers(app)

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = request_id[:64]
        started = time.perf_counter()
        try:
            rate_limiter.check("ip", client_ip(request) or "unknown", settings.rate_limit_api_per_minute * 2)
        except RateLimitedError as exc:
            from fastapi.responses import JSONResponse

            limited = JSONResponse(status_code=429,
                                   content=error_payload(exc.code, exc.message, exc.details, request.state.request_id),
                                   headers={"Retry-After": str(exc.details.get("retry_after", 60)),
                                            "X-Request-ID": request.state.request_id,
                                            "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                                            "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"})
            return limited
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith(settings.api_prefix) and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        if settings.is_production:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        logger.info("%s %s -> %s (%sms)", request.method, request.url.path, response.status_code, duration_ms,
                    extra={"request_id": request.state.request_id, "path": request.url.path,
                           "status": response.status_code, "duration_ms": duration_ms})
        return response

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-CSRF-Token", "Authorization", "X-Request-ID"],
        )

    health = APIRouter(tags=["health"])

    @health.get("/health")
    def liveness() -> dict:
        return {"status": "ok", "version": __version__}

    @health.get("/health/ready")
    def readiness() -> dict:
        checks: dict[str, dict] = {}
        try:
            with get_engine().connect() as conn:
                revision = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
            checks["database"] = {"ok": True, "migration": revision}
        except Exception as exc:  # noqa: BLE001
            checks["database"] = {"ok": False, "error": type(exc).__name__}
        try:
            settings.storage_dir.mkdir(parents=True, exist_ok=True)
            probe = settings.storage_dir / ".probe"
            probe.write_text("ok")
            probe.unlink()
            checks["storage"] = {"ok": True}
        except OSError as exc:
            checks["storage"] = {"ok": False, "error": type(exc).__name__}
        checks["task_backend"] = {"ok": True, "mode": settings.task_backend}
        checks["ai_advisor"] = {"ok": True, "mode": "llm" if settings.anthropic_api_key else "deterministic"}
        ready = all(c["ok"] for c in checks.values())
        return {"status": "ready" if ready else "degraded", "checks": checks}

    app.include_router(health, prefix=settings.api_prefix)
    for router in _router_modules():
        app.include_router(router, prefix=settings.api_prefix)
    return app


app = create_app()
