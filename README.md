# AUREX

AUREX is a business intelligence, enterprise integration, forecasting and decision-simulation platform for
multi-store retailers. It connects to a company's own systems through authorized, tested connections,
normalizes the data into one model, and answers four questions with evidence: *what happened, why, what is
likely next, and what happens if we change something*.

It ships with **NovaMart**, a fictional, reproducible 36-month synthetic retailer, so the whole product works
in demo mode without any credentials. NovaMart is not DMart, MR D.I.Y. or Wellness Forever, and every screen,
report and answer based on it is labelled synthetic.

## What is in the box

| Area | Highlights |
|---|---|
| Public website | Home, Product, Integrations, Security, About, Sign in / Sign up (`frontend/src/app/(marketing)`, `(auth)`) |
| Identity & access | Organizations, companies, stores, departments, invitations; 10 roles with backend-enforced permissions, store-scoped memberships, strict tenant isolation, audit trail |
| Integration Hub | Reusable connector framework: CSV/Excel import, SFTP export folders (host-key pinned), documented REST APIs, signed webhooks, read-only PostgreSQL; status that is only "connected" after an authenticated test; sync history, incremental cursors, retries, row-level error logs, provenance on every row. Verified research on the vendors named in the brief — no API is assumed ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)) |
| Normalization | One canonical model; idempotent upserts by source record id + content hash; missing data stored as NULL, never 0; system-of-record rules prevent double counting across overlapping feeds |
| Dashboards & analytics | Executive dashboard with filters, metric definitions, freshness and sources; P&L, budget vs actual, expenses and anomalies, inventory (turnover, DIO, GMROI, stockout/overstock risk), suppliers, workforce productivity, store and category performance, revenue bridge (store, category, price/volume/mix), business health score |
| Forecasting | Seasonal-naive baselines vs Holt-Winters, ridge with Fourier/event features and gradient boosting; rolling-origin backtests (no leakage), MAE/RMSE/WAPE/MAPE/bias, empirical prediction intervals, versioned models with data fingerprints, explicit reliability verdicts ([docs/FORECASTING.md](docs/FORECASTING.md)) |
| Decision Lab | Workforce, price, marketing, supplier cost, inventory policy, new store, opex, retention and product-mix levers on one engine; baseline comparison, ROI, payback, NPV, Monte Carlo P10/P50/P90, sensitivity tornado, downside, goal optimizer. **Hiring never increases revenue automatically** ([docs/DECISION_LAB.md](docs/DECISION_LAB.md)) |
| AI advisor | Answers only through validated, permission-checked tools; arithmetic through a calculator tool; every number traced to a tool output; evidence, assumptions, limitations and confidence on every answer; deterministic mode without an API key ([docs/ADVISOR.md](docs/ADVISOR.md)) |
| Company intelligence | DMart (Avenue Supermarts), MR D.I.Y., Wellness Forever and peers from cited public filings; share prices only for listed securities, as dated sourced snapshots; data gaps stated |
| Market news | Search, exact and near-duplicate detection, reported facts separated from clearly labelled AI interpretation; no invented articles |
| Benchmarking | Unit-free comparisons with comparability caveats (currency, fiscal year, consolidation basis) and an explained health score |
| Workflow | Reports (PDF/CSV/Excel with checksums), rule-based and scenario-based recommendations, approvals with separation of duties, tasks, notifications, predicted-vs-actual outcome tracking |
| Operations | Docker images, docker-compose (PostgreSQL, Redis, API, Celery worker/beat, web, Caddy edge, backups), CI workflow, retention purge, health/readiness endpoints |

## One-click launch on Windows

On a Windows 10/11 (64-bit) PC with nothing else installed: get the project (clone it, or **Code → Download ZIP** and
extract it), then double-click **`launch.bat`**.

The first run downloads portable copies of uv, Python 3.13, Node.js 22 and PostgreSQL 17 into `.tools\` inside the
project (no admin rights needed), installs the packages (roughly half a gigabyte of downloads in total), creates a local
database on port 5433, loads the synthetic NovaMart demo with its forecast models, builds the web app, starts everything
and opens http://127.0.0.1:3000 (or the next free port). Expect 10–20 minutes once, depending on the connection; later runs start in seconds. The only system-wide
install is the Microsoft Visual C++ runtime, and only if Windows lacks it (PostgreSQL needs it; Windows asks for
permission once).

| Command | Effect |
|---|---|
| `launch.bat` | Set up whatever is missing, start AUREX, open the browser |
| `launch.bat stop` | Stop the web app, the API and the database |
| `launch.bat status` | Show what is running |
| `launch.bat reset-demo` | Reload the NovaMart demo data from scratch |
| `launch.bat start -Dev` | Run the web app in development mode (hot reload) |

Other switches: `-NoBrowser`, `-Rebuild` (force a web build), `-PortableTools` (ignore uv/Node.js installed on the PC),
`-DryRun` (print what would be downloaded or started), `-NoPause`. Logs are in `.tools\logs`. Ports in use by other
programs are skipped automatically (API from 8000, web app from 3000, checked on IPv4 and IPv6). After starting the
API the launcher computes the demo dashboard once, so the first page you open is fast.

## Quick start (local development)

Prerequisites: Python 3.13 with [uv](https://docs.astral.sh/uv/), Node.js 22, and PostgreSQL 17.

1. **Database** (port 5433, user/password `aurex`/`aurex`, databases `aurex` and `aurex_test`):
   ```bash
   cd .devtools/pg && npm install && cd ../..        # portable PostgreSQL 17 (Windows package pinned;
                                                      # on macOS/Linux install @embedded-postgres/<platform>
                                                      # or put a PostgreSQL 17 pg_ctl on PATH)
   python scripts/devdb.py init
   python scripts/devdb.py start
   python scripts/devdb.py create-dbs
   ```
   Any PostgreSQL 17 works instead: set `AUREX_DATABASE_URL=postgresql+psycopg://user:pass@host:port/aurex`.
2. **Backend**:
   ```bash
   cd backend
   uv sync
   uv run alembic upgrade head
   uv run python -m app.seed.demo --train             # synthetic NovaMart + 22 forecast models
   uv run uvicorn app.main:app --reload --port 8000   # OpenAPI docs: http://127.0.0.1:8000/api/v1/docs
   ```
3. **Frontend**:
   ```bash
   cd frontend
   npm ci
   npm run dev                                        # http://localhost:3000 (proxies /api to :8000)
   ```
4. Open http://localhost:3000/sign-in and use **Explore the live demo** to sign in as any of the ten roles.

Optional: `AUREX_ANTHROPIC_API_KEY` enables free-form AI answers; without it the advisor runs in
deterministic mode. See [.env.example](.env.example) for every setting.

## Tests

```bash
cd backend && uv run pytest -q          # creates/migrates/seeds the aurex_test database itself
cd backend && uv run ruff check app tests
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```
Executed results, with dates and counts, are recorded in [docs/TESTING.md](docs/TESTING.md).

## Production

`docker compose up -d --build` after configuring `.env` — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for
TLS, scaling, backups, upgrades and the production checklist, and [docs/SECURITY.md](docs/SECURITY.md) for the
security model.

## Repository layout

```
backend/            FastAPI app (app/), Alembic migrations, tests, Dockerfile
  app/api/          routes + dependencies (tenancy, permissions)
  app/connectors/   connector framework and connectors
  app/pipeline/     validation, loading, aggregates, sync runner
  app/services/     analytics, forecasting, simulation, advisor, intelligence, news, reports, workflow
  app/seed/         NovaMart generator, demo seed, reference data loader
  app/worker/       job dispatcher, job handlers, Celery app, periodic CLI
frontend/           Next.js 16 app: marketing site, auth, authenticated app (/app/*)
deploy/             Caddyfile, backup and restore scripts
docs/               architecture and reference documentation, research
scripts/            local development helpers (portable PostgreSQL)
CLAUDE.md           working notes for contributors and coding agents
CHECKLIST.md        module-by-module status
```

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [Metrics](docs/METRICS.md) ·
[Integrations](docs/INTEGRATIONS.md) · [Forecasting](docs/FORECASTING.md) · [Decision Lab](docs/DECISION_LAB.md) ·
[AI advisor](docs/ADVISOR.md) · [NovaMart dataset](docs/NOVAMART.md) · [Security](docs/SECURITY.md) ·
[Deployment](docs/DEPLOYMENT.md) · [Testing](docs/TESTING.md) · Research:
[providers](docs/research/PROVIDER_VERIFICATION.md), [company data](docs/research/COMPANY_DATA.md)
