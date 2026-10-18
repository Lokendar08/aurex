"""Periodic maintenance tasks for installations without Celery beat (AUREX_TASK_BACKEND=inline).

With Celery, beat runs these on the schedule in ``celery_app.py``. Without it, call this module from cron
or a systemd timer, e.g.:

    */5 * * * *  cd /opt/aurex/backend && .venv/bin/python -m app.worker.periodic schedule-syncs
    17 3 * * *   cd /opt/aurex/backend && .venv/bin/python -m app.worker.periodic purge-retention
    7 * * * *    cd /opt/aurex/backend && .venv/bin/python -m app.worker.periodic refresh-news
"""

from __future__ import annotations

import argparse
import json
import logging

from app.core.config import get_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("task", choices=("schedule-syncs", "purge-retention", "refresh-news"))
    args = parser.parse_args(argv)
    logging.basicConfig(level=get_settings().log_level)

    if args.task == "schedule-syncs":
        from app.worker.jobs import schedule_due_syncs

        result: object = {"queued": schedule_due_syncs()}
    elif args.task == "purge-retention":
        from app.db.session import session_scope
        from app.services.retention import purge_expired

        with session_scope() as db:
            result = purge_expired(db)
    else:
        if not get_settings().news_fetch_enabled:
            result = {"skipped": "news fetching disabled (AUREX_NEWS_FETCH_ENABLED=false)"}
        else:
            from app.db.session import session_scope
            from app.services.news import refresh_all_sources

            with session_scope() as db:
                result = refresh_all_sources(db)
    print(json.dumps(result, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
