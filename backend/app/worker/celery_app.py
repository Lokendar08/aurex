"""Celery application (used when AUREX_TASK_BACKEND=celery; see docker-compose.yml).

Run a worker:  celery -A app.worker.celery_app worker --loglevel=INFO   (Windows dev: add --pool=solo)
Run beat:      celery -A app.worker.celery_app beat --loglevel=INFO
"""

from __future__ import annotations

from celery import Celery

from app.core.config import get_settings

settings = get_settings()
celery_app = Celery("aurex", broker=settings.redis_url or "redis://localhost:6379/0")
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_default_queue="aurex",
    timezone="UTC",
    beat_schedule={
        "schedule-due-syncs": {"task": "aurex.schedule_due_syncs", "schedule": 300.0},
        "purge-retention": {"task": "aurex.purge_retention", "schedule": 86400.0},
        "refresh-news": {"task": "aurex.refresh_news", "schedule": 3600.0},
    },
)


@celery_app.task(name="aurex.run_background_job")
def run_background_job_task(job_id: str) -> None:
    from app.worker.dispatcher import run_background_job

    run_background_job(job_id)


@celery_app.task(name="aurex.schedule_due_syncs")
def schedule_due_syncs_task() -> int:
    from app.worker.jobs import schedule_due_syncs

    return schedule_due_syncs()


@celery_app.task(name="aurex.purge_retention")
def purge_retention_task() -> dict:
    from app.db.session import session_scope
    from app.services.retention import purge_expired

    with session_scope() as db:
        return purge_expired(db)


@celery_app.task(name="aurex.refresh_news")
def refresh_news_task() -> dict:
    from app.db.session import session_scope
    from app.services.news import refresh_all_sources

    if not settings.news_fetch_enabled:
        return {"skipped": "news fetching disabled"}
    with session_scope() as db:
        return refresh_all_sources(db)
