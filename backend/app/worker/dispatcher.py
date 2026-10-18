"""Background job dispatch.

Jobs are durable rows in ``background_jobs``. Dispatch happens only after the enqueuing transaction
commits (so workers always see the row):
- ``AUREX_TASK_BACKEND=celery``: sent to Celery/Redis (production, docker-compose).
- ``inline`` (default for local development): executed on an in-process thread pool;
  ``AUREX_INLINE_JOBS_SYNCHRONOUS=true`` executes immediately in the caller's thread (tests).
"""

from __future__ import annotations

import logging
import threading
import traceback
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import redact_text
from app.db.session import session_scope
from app.models import BackgroundJob

logger = logging.getLogger("aurex.jobs")

JobHandler = Callable[[Session, dict[str, Any]], dict[str, Any] | None]
JOB_HANDLERS: dict[str, JobHandler] = {}
_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()


def job_handler(name: str) -> Callable[[JobHandler], JobHandler]:
    def register(fn: JobHandler) -> JobHandler:
        JOB_HANDLERS[name] = fn
        return fn

    return register


def _pool() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="aurex-job")
        return _executor


def _dispatch(job_id: uuid.UUID, countdown: float) -> None:
    settings = get_settings()
    if settings.task_backend == "celery":
        from app.worker.celery_app import celery_app

        celery_app.send_task("aurex.run_background_job", args=[str(job_id)], countdown=countdown or None)
        return
    if settings.inline_jobs_synchronous:
        run_background_job(job_id)
        return
    if countdown > 0:
        timer = threading.Timer(countdown, lambda: _pool().submit(run_background_job, job_id))
        timer.daemon = True
        timer.start()
    else:
        _pool().submit(run_background_job, job_id)


def enqueue(db: Session, job_type: str, payload: dict[str, Any], *, org_id: uuid.UUID | None = None,
            user_id: uuid.UUID | None = None, countdown: float = 0) -> BackgroundJob:
    if job_type not in JOB_HANDLERS:
        import app.worker.jobs  # noqa: F401  (registers handlers)
    job = BackgroundJob(org_id=org_id, job_type=job_type, payload=payload, created_by=user_id)
    db.add(job)
    db.flush()
    job_id = job.id

    def _after_commit(session: Session) -> None:
        try:
            _dispatch(job_id, countdown)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to dispatch job %s", job_id)

    # once=True: SQLAlchemy removes the listener itself after the first commit (removing it inside the
    # handler would mutate the listener collection while it is being iterated).
    event.listen(db, "after_commit", _after_commit, once=True)
    return job


def run_background_job(job_id: uuid.UUID | str) -> None:
    import app.worker.jobs  # noqa: F401

    job_uuid = uuid.UUID(str(job_id))
    with session_scope() as db:
        job = db.get(BackgroundJob, job_uuid)
        if job is None or job.status not in ("queued", "failed"):
            return
        job.status = "running"
        job.started_at = datetime.now(UTC)
        job.attempts += 1
        handler = JOB_HANDLERS.get(job.job_type)
        payload = dict(job.payload or {})
    try:
        if handler is None:
            raise RuntimeError(f"No handler registered for job type {job.job_type}")
        with session_scope() as db:
            result = handler(db, payload) or {}
        with session_scope() as db:
            job = db.get(BackgroundJob, job_uuid)
            job.status = "succeeded"
            job.result = result
            job.finished_at = datetime.now(UTC)
            job.progress = 1.0
    except Exception as exc:  # noqa: BLE001
        logger.error("Background job %s failed: %s", job_uuid, redact_text(traceback.format_exc()))
        with session_scope() as db:
            job = db.get(BackgroundJob, job_uuid)
            job.status = "failed"
            job.error = redact_text(f"{type(exc).__name__}: {exc}")[:2000]
            job.finished_at = datetime.now(UTC)
