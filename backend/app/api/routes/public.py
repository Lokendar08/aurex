"""Unauthenticated public endpoints (no tenant data)."""

from __future__ import annotations

from fastapi import APIRouter

from app import __version__
from app.core.config import get_settings

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/status")
def status() -> dict:
    settings = get_settings()
    return {"name": "AUREX", "version": __version__, "demo_mode": settings.demo_mode,
            "advisor_mode": "llm" if settings.anthropic_api_key else "deterministic"}
