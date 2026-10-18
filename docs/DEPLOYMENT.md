# Deployment

> Status: on GitHub Actions the compose file validates and both Docker images build (see [TESTING.md](TESTING.md)).
> The stack itself — Caddy, Celery worker/beat, backups — has **not been started** (Docker was not installed on the
> development machine). Migrations, the API, inline workers, the seed and the periodic CLI were executed locally.

## 1. Topology (docker-compose)

```mermaid
flowchart LR
  user((Browser)) -->|80/443| edge[Caddy edge\nTLS, X-Forwarded-For overwrite]
  edge --> web[web: Next.js standalone :3000]
  web -->|/api/* rewrite| api[api: FastAPI/uvicorn :8000]
  api --> pg[(PostgreSQL 17)]
  api --> redis[(Redis 7)]
  worker[worker: Celery] --> pg
  worker --> redis
  beat[beat: Celery beat] --> redis
  backup[backup: pg_dump loop] --> pg
  migrate[migrate: alembic upgrade head] --> pg
```

| Service | Image | Role |
|---|---|---|
| `postgres` | `postgres:17-alpine` | Primary database (volume `pgdata`); not published |
| `redis` | `redis:7-alpine` (AOF on) | Celery broker and shared rate-limit counters; not published |
| `migrate` | backend image | One-shot `alembic upgrade head`; the API waits for it to succeed |
| `api` | backend image | `uvicorn app.main:app --workers 2`; health check `/api/v1/health` |
| `worker` | backend image | Celery worker (sync jobs, forecast training, reports, rules, news) |
| `beat` | backend image | Celery beat: due syncs every 5 min, retention purge daily, news hourly (if enabled) |
| `web` | frontend image | Next.js standalone server; `/api/*` is rewritten to `http://api:8000` at build time |
| `edge` | `caddy:2-alpine` | Only published service; automatic HTTPS when `AUREX_SITE_ADDRESS` is a hostname |
| `backup` | `postgres:17-alpine` | Daily `pg_dump -Fc` + file-storage tarball, SHA-256 checksums, retention |
| `seed` | backend image | Optional (`demo` profile): synthetic NovaMart demo + forecast training |

## 2. First deployment

1. Install Docker Engine with the Compose v2 plugin on the host. Point DNS at it if you use a hostname.
2. Configure secrets:
   ```bash
   cp .env.example .env
   python -c "import secrets; print(secrets.token_urlsafe(48))"                                # AUREX_JWT_SECRET
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # AUREX_SECRET_ENCRYPTION_KEY
   ```
   Set `POSTGRES_PASSWORD`, `AUREX_JWT_SECRET`, `AUREX_SECRET_ENCRYPTION_KEY`, `AUREX_SITE_ADDRESS`
   (hostname for HTTPS), keep `AUREX_COOKIE_SECURE=true` and `AUREX_DEMO_MODE=false`.
3. Start: `docker compose up -d --build`. Check `docker compose ps` (all healthy, `migrate` exited 0).
4. Verify: `curl https://<host>/api/v1/health/ready` → `{"status": "ready", ...}` with the migration revision.
5. Create the first organization by signing up in the web app (the registering user becomes the owner),
   then invite members from **Settings → Members**. Create a platform administrator by setting
   `users.is_platform_admin = true` for a dedicated account (platform admins see tenant metadata only).

The API refuses to start in production with development secrets, insecure cookies or demo mode
(`Settings.validate_for_production`).

### Public demo (synthetic data only)

For a showcase that must never hold real customer data:
`AUREX_DEMO_MODE=true`, `AUREX_ALLOW_DEMO_IN_PRODUCTION=true`, then `docker compose run --rm seed`
(full NovaMart dataset + 22 forecast models; measured local timings are in [TESTING.md](TESTING.md)). The seed
finishes with `VACUUM (ANALYZE)` of the loaded tables, so the first dashboard requests do not compete with autovacuum.
Demo sign-in buttons then appear on the sign-in page.

## 3. TLS and proxies

- `AUREX_SITE_ADDRESS=aurex.example.com` makes Caddy obtain and renew certificates (ports 80 and 443 must be
  reachable). `:80` serves plain HTTP for a local trial only (cookies are `Secure`; browsers accept them on
  `localhost`).
- The edge overwrites `X-Forwarded-For` with the client address and the API trusts exactly one hop
  (`AUREX_TRUSTED_PROXY_HOPS=1`). If you put another load balancer in front of Caddy, make it overwrite (not
  append) the header or raise the hop count to match — otherwise rate limits use the wrong address.
- Uploads: Caddy allows 30 MB bodies; the API enforces `AUREX_MAX_UPLOAD_MB` (25).

## 4. Scaling

- **API**: raise `--workers` in `backend/Dockerfile` or run more `api` replicas. Sessions are validated
  against the database and rate-limit counters live in Redis, so replicas need no sticky sessions.
- **Workers**: `--concurrency` on the `worker` command, or more replicas. Run exactly **one** `beat`.
- **Database**: for a managed PostgreSQL 17, remove the `postgres` service and set `AUREX_DATABASE_URL`
  (`postgresql+psycopg://user:pass@host:5432/db?sslmode=require`). The migration runs
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`, so the migration role needs permission to create that extension
  (or create it beforehand). Tune `AUREX_DATABASE_POOL_SIZE` × replicas below the server's connection limit.
- **Storage**: uploaded files and generated reports are written to `AUREX_STORAGE_DIR` (`storage` volume),
  which must be shared by `api` and `worker`. For several hosts, mount shared storage (NFS/EFS) there.
- Data volume reference (local dev database with the full 36-month NovaMart set): 848 MB including indexes,
  613,840 sales rows, 155,680 inventory snapshots.

## 5. Upgrades and rollback

1. Back up (section 6) and note the current image tag (`AUREX_VERSION`).
2. `git pull` (or deploy the new release), then `AUREX_VERSION=<new> docker compose up -d --build`.
   `migrate` applies new Alembic revisions before the API and workers restart.
3. Check `/api/v1/health/ready` and the platform overview.
4. Rollback: restore the pre-upgrade database dump, then start the previous image tag. Alembic downgrades
   exist for each revision, but restoring the backup is the supported path.

## 6. Backups and restore

- The `backup` service writes `/backups/aurex-db-<UTC timestamp>.dump` (+ `.sha256`) and
  `/backups/aurex-files-<timestamp>.tar.gz` every `BACKUP_INTERVAL_SECONDS` (86400) and deletes files older than
  `BACKUP_RETENTION_DAYS` (14) — [deploy/backup/backup.sh](../deploy/backup/backup.sh).
- **Copy `/backups` off the host** (object storage in another region); a backup on the same disk does not
  survive the loss of that disk.
- Restore — [deploy/backup/restore.sh](../deploy/backup/restore.sh):
  ```bash
  docker compose stop api worker beat web
  docker compose run --rm --entrypoint /bin/sh backup /backup/restore.sh /backups/aurex-db-<timestamp>.dump
  docker compose up -d
  ```
- Test a restore regularly into a scratch environment; an untested backup is not a backup.

## 7. Monitoring

| Signal | Where |
|---|---|
| Liveness | `GET /api/v1/health` |
| Readiness (database + migration revision, storage writable, task backend, advisor mode) | `GET /api/v1/health/ready` |
| Logs | JSON (`AUREX_LOG_JSON=true`) with request ids; secrets redacted; ship stdout to your log platform |
| Operations | `GET /api/v1/platform/overview` (integrations by status, sync and background jobs in the last 24 h, database size), `GET /api/v1/platform/jobs` |
| Data freshness | Data Quality page per organization; integrations in `error` show `status_detail` |

## 8. Installation without Docker

- Python 3.13 with [uv](https://docs.astral.sh/uv/) (`cd backend && uv sync --frozen --no-dev`), Node.js 22
  (`cd frontend && npm ci && AUREX_API_URL=http://127.0.0.1:8000 npm run build`), PostgreSQL 17, optional Redis.
- Run `alembic upgrade head`, then `uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2` and
  `node .next/standalone/server.js` (copy `.next/static` and `public` next to it) behind a TLS reverse proxy that
  overwrites `X-Forwarded-For` (`AUREX_TRUSTED_PROXY_HOPS=1`).
- Without Celery (`AUREX_TASK_BACKEND=inline`), jobs run on an in-process thread pool and periodic tasks
  must come from cron — see [backend/app/worker/periodic.py](../backend/app/worker/periodic.py):
  `python -m app.worker.periodic schedule-syncs|purge-retention|refresh-news`.

## 9. Production checklist

- [ ] Unique `AUREX_JWT_SECRET` (≥ 32 chars) and `AUREX_SECRET_ENCRYPTION_KEY`; `.env` readable only by the operator
- [ ] `AUREX_ENV=production`, `AUREX_COOKIE_SECURE=true`, `AUREX_DEMO_MODE=false`
- [ ] HTTPS hostname in `AUREX_SITE_ADDRESS`; `AUREX_TRUSTED_PROXY_HOPS` matches the proxy chain
- [ ] `AUREX_ALLOW_PRIVATE_NETWORK_CONNECTORS=false` unless this is an on-premise install
- [ ] Backups copied off-host and a restore tested
- [ ] Log shipping and alerting on `/api/v1/health/ready` and on integrations in `error`
- [ ] Retention periods reviewed against your legal requirements
- [ ] Optional services configured deliberately: `AUREX_ANTHROPIC_API_KEY` (data is sent to the model
      provider for AI answers), market-data licence, news fetching
- [ ] Data-sharing agreements in place for every external connection ([INTEGRATIONS.md](INTEGRATIONS.md))
