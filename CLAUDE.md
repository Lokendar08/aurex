# CLAUDE.md — working notes for AUREX

Read this first in every session. Current status per module lives in [CHECKLIST.md](CHECKLIST.md); executed
test results in [docs/TESTING.md](docs/TESTING.md). Update both when you change behaviour.

## Non-negotiable product rules (from the project brief)

1. **Never assume an API or private data access exists.** A connection is `connected` only after an
   authenticated test succeeds (REST, PostgreSQL, SFTP) or a correctly signed webhook event arrives. File
   imports stay `configured`. Vendor profiles (YASH Systems, QubePOS, EcoLite) test as `awaiting_credentials`.
2. **Never fabricate numbers.** Missing data is NULL with a status (`missing_data`, `zero_denominator`,
   `incomplete`, `not_available_at_store_scope`, `not_trained`), never 0. Show definitions, sources and freshness.
3. **Synthetic data is always labelled** (`is_synthetic`, `SYNTHETIC_LABEL`) and never presented as data from
   DMart, MR D.I.Y. or Wellness Forever.
4. **Decision Lab:** costs and accounting identities are deterministic; behavioural effects come only from
   relationships estimated from data or from documented user assumptions; unsupported effects default to zero.
   **Hiring never increases revenue automatically** (required test:
   `backend/tests/test_simulation.py::test_workforce_20_to_30_adds_known_cost_and_no_automatic_revenue`).
5. **AI advisor:** numbers only from validated tools; arithmetic via the `calculate` tool; every number is
   verified against tool inputs/outputs; tools enforce permissions; evidence + confidence on every answer.
6. **Company intelligence:** every figure needs a source URL, fiscal year and basis; share prices only for
   listed securities, as dated snapshots unless a licensed provider is configured; no invented private data.
7. **News:** no invented articles; AI interpretation is labelled and kept separate from reported facts; no
   causal claims without evidence.
8. **Secrets** never reach the frontend or logs: credentials go in `credentials` (Fernet-encrypted), never `config`.
9. **Report only tests that were actually executed**, with the command and the result.

## Commands

Windows dev box (Git Bash paths shown). Backend venv: `backend/.venv` (managed by uv, Python 3.13).

| Task | Command |
|---|---|
| Everything, one click (Windows) | `launch.bat` / `launch.bat stop|status|reset-demo` (logic in `scripts/launch.ps1`; keep it ASCII-only and CRLF for PowerShell 5.1) |
| Dev PostgreSQL 17 (port 5433, `aurex`/`aurex`) | `python scripts/devdb.py init|start|stop|status|create-dbs|reset-test` (repo root) |
| Migrate | `cd backend && .venv/Scripts/python.exe -m alembic upgrade head` |
| Seed demo | `cd backend && .venv/Scripts/python.exe -m app.seed.demo [--small] [--reset] [--train]` |
| API | `cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000` |
| Web | `cd frontend && npx next dev -p 3000` (rewrites `/api/*` to `AUREX_API_URL`, default :8000) |
| Backend tests | `cd backend && PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider` (~1 min; recreates `aurex_test`, seeds the small dataset, trains two models) |
| Lint | `cd backend && .venv/Scripts/python.exe -m ruff check app tests`; repo scripts: `ruff check scripts` from the root |
| Frontend checks | `cd frontend && npx tsc --noEmit && npx eslint src && npx next build` |
| Periodic tasks without Celery | `python -m app.worker.periodic schedule-syncs|purge-retention|refresh-news` |
| Demo sign-in (API) | `POST /api/v1/auth/demo/login {"role": "executive"}` (needs `AUREX_DEMO_MODE=true`) |

## Architecture in one screen

- `frontend/` — Next.js 16 (App Router, `cacheComponents`, `src/proxy.ts` = optimistic redirect only),
  React 19, Tailwind v4 tokens in `globals.css`, shadcn/ui, TanStack Query, Recharts. Read
  `frontend/AGENTS.md` and `frontend/node_modules/next/dist/docs/` before writing Next code (APIs differ from
  older versions). `/app/**` pages are client components using `src/lib/api.ts` (cookies + CSRF + refresh).
- `backend/app/` — FastAPI. `api/routes/*` → `services/*` → `models/*`. Tenancy and RBAC in `api/deps.py`
  (`OrgContext`, `require(...)`); roles in `core/permissions.py`. Errors: `core/errors.py` (`AppError` family,
  body `{"error": {code, message, details}, "request_id"}`). JSON: `core/jsonsafe.py` (NaN → null).
- Data path: `connectors/*` → `pipeline/validation.py` → `pipeline/loader.py` (COPY into temp table, upsert on
  `(integration_id, source_record_id)` when `content_hash` differs) → `pipeline/aggregates.py`
  (`agg_store_daily` with system-of-record selection) → `services/analytics/*`.
- Jobs: `worker/dispatcher.py` (`enqueue` after commit; inline thread pool or Celery), handlers in
  `worker/jobs.py`, beat schedule in `worker/celery_app.py`.
- Forecasting: `services/forecasting/` (engine = rolling-origin backtests, empirical intervals; service = targets,
  training plan, baseline). Decision Lab: `services/simulation/` (calibration → levers → engine → optimize).
  Advisor: `services/advisor/` (tools, llm, deterministic, verify, service).

## Conventions

- Python: `from __future__ import annotations`, type hints, ruff (`backend/pyproject.toml`, line length 110).
  SQL text is built only from code-defined fragments (`Scope.store_clause`, entity specs); values are always
  bound parameters (`read_frame(db, sql, params)`).
- Every org-scoped query filters by `org_id` (and by store scope via `Scope`/`ctx.resolve_store_ids`).
- New permission-gated endpoint: `Depends(require(P.X))` — and add a test in `tests/test_isolation_rbac.py`.
- Migrations: `alembic revision --autogenerate -m "..."`, then **check** autogenerate did not drop
  `ix_news_articles_title_trgm` (declared in `models/intelligence.py`) or other functional indexes.
- New connector: `ProviderSpec` + `test_connection` (must never report `connected` without an authenticated
  check) + `fetch(entity, cursor)` yielding `Batch`es + registry entry + tests with injected transports (see
  `RestApiConnector.transport`, `SftpExportConnector.session_factory`).
- New Decision Lab lever: `levers.py` model + `APPLY_ORDER` + engine application + evidence in `calibration.py` +
  tests proving the deterministic part and the evidence gating.
- New advisor tool: `tools.py` (`AdvisorTool` with required permissions and a strict schema) + deterministic
  intent if it answers a common question + tests that numbers are traced.
- Frontend: no hard-coded business numbers; use part-A shared components (`src/components/app/*`), formatters
  in `src/lib/app/*`; every page has loading, empty and error states; `useSearchParams` inside `<Suspense>`.

## Environment gotchas

- Windows console code page: run Python with `PYTHONIOENCODING=utf-8` and open files with `encoding="utf-8"`.
- Shell heredocs mangle backslashes and backticks: write patch scripts with the file tool and run them.
- `scripts/devdb.py start` detaches the server (DETACHED_PROCESS); never run `pg_ctl` in the foreground.
- Tests use `aurex_test` (override with `AUREX_TEST_DATABASE_URL`) and drop/recreate it each session.
- Next dev server writes `frontend/.next/dev/lock`; reuse a running server instead of starting a second one.
- Demo data ends 2026-10-17 (`AUREX_DEMO_END_DATE`); the small test dataset ends 2026-04-30.
- Do not use the built-in browser pane for verification (it prompts the user); use headless Playwright.
- **Download nothing.** The dev machine runs a download manager (IDM) that pops up for every browser download: no
  package installs, no Playwright browser installs, no web fetches, and e2e specs use `acceptDownloads: false` and verify
  files through the API request context. Run Playwright on the installed Chrome (`PLAYWRIGHT_CHANNEL=chrome`).
- Fonts are self-hosted (`frontend/src/app/fonts.css`, `frontend/public/fonts`, OFL-licensed); do not reintroduce
  `next/font/google`, which fetches from Google on every build.

## Where to look

| Question | File |
|---|---|
| What is done / missing | `CHECKLIST.md` |
| Metric formulas | `backend/app/services/metrics.py`, `docs/METRICS.md` |
| Provider research | `docs/research/PROVIDER_VERIFICATION.md`, `backend/app/data/reference/providers.json` |
| Company reference data | `docs/research/COMPANY_DATA.md`, `backend/app/data/reference/` |
| Settings | `backend/app/core/config.py`, `.env.example` |
