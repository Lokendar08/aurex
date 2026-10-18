# Testing

Only tests and checks that were actually executed are reported here, with the command and the result.
Environment: Windows 11, Python 3.13.14 (uv venv), PostgreSQL 17 (portable dev server, port 5433), Node.js 22.19,
Next.js 16.4.2, Chrome (installed) for Playwright. Date of the final run: 2026-10-18.

## 1. How to run

| Suite | Command | Needs |
|---|---|---|
| Backend unit + integration | `cd backend && uv run pytest -q` (Windows dev box: `PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider`) | PostgreSQL; the session drops/recreates `aurex_test` (override with `AUREX_TEST_DATABASE_URL`), runs all migrations, seeds the compact NovaMart set and trains two models |
| Backend lint | `cd backend && uv run ruff check app tests`; repository scripts: `ruff check scripts` from the root | — |
| Frontend types / lint | `cd frontend && npx tsc --noEmit && npx eslint src` | — |
| Frontend production build | `cd frontend && npx next build` | — (fonts are self-hosted; the build makes no network requests for fonts) |
| End-to-end (headless) | API on :8000 + web server, then `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 PLAYWRIGHT_CHANNEL=chrome npx playwright test e2e/<spec> --workers=1` | Seeded demo database; an installed Chrome (`PLAYWRIGHT_CHANNEL`) or Playwright's own Chromium |

The e2e specs never trigger a browser download (download managers intercept those); generated files are verified
through Playwright's API request context.

## 2. Results of the final run

| Check | Command | Result |
|---|---|---|
| Backend tests | `pytest -q` (backend) | **168 passed**, 0 failed (≈36 s) |
| Backend lint | `ruff check app tests` / `ruff check scripts` | clean |
| Migrations vs models | `alembic upgrade head` then `alembic check` | head = 0003; "No new upgrade operations detected" |
| Frontend types | `npx tsc --noEmit` | 0 errors |
| Frontend lint | `npx eslint src e2e` | 0 problems |
| Production build | `AUREX_API_URL=http://127.0.0.1:8000 npx next build` | success; 37 static pages; no font or network fetches (fonts self-hosted) |
| E2E part B (`e2e/app-smoke-b.spec.ts`) | production standalone server on :3100, API on :8000, installed Chrome | **9 passed** (18.2 s) |
| E2E part A (`e2e/app-smoke.spec.ts`) | same | **4 passed** (9.2 s) |
| GitHub Actions CI — backend | `.github/workflows/ci.yml` on ubuntu-latest, PostgreSQL 17 service (run 39158620456, commit 4ad5b38) | ruff clean; **168 passed** (31.8 s) |
| GitHub Actions CI — frontend | same run | `tsc`, `eslint` and `next build` passed (37 pages) |
| GitHub Actions CI — images | same run | `docker compose config` valid; `aurex-backend` and `aurex-web` images built |

End-to-end tests executed (final run, latest code):

| Spec | Test | What it checks |
|---|---|---|
| B | decision lab: hiring 10 at S04 adds cost but no revenue; saved scenario persists and compares | The "20 → 30 at S04" preset shows net sales ₹0 (no change), operating expenses up, net profit down, the "No revenue effect" note and the sensitivity section; the scenario is saved, survives a reload, and is compared with a second scenario (best risk-adjusted shown) |
| B | advisor: staffing question at S04 answers with traced numbers and evidence | Deterministic answer with verified key figures, "numbers traced", tool call details |
| B | forecasts: model card with WAPE and a reliability verdict | Model card metrics and verdict render from the trained model |
| B | intelligence: DMart with source links, Wellness Forever without a share price | Cited figures with source links; unlisted company shows no price |
| B | news: reported facts kept apart, every AI interpretation labelled | Labels and separation of facts vs interpretation |
| B | benchmarking: comparability notes and the synthetic company labelled | Caveats and the synthetic label |
| B | reports: generate an executive PDF and download it | Report generated; the file is fetched through the API request context (not a browser download), starts with `%PDF` and its SHA-256 matches the server header |
| B | workflows: analyst generates and submits, executive approves | Recommendation lifecycle with separation of duties |
| B | employee: the Decision Lab shows the friendly 403 | Permission-aware routing |
| A | executive: dashboard with KPIs, trend, health score and finance access | KPIs, health score, stores, synthetic banner, no error states |
| A | finance manager: finance workspace and a CSV upload with its validation error log | Upload of invalid rows → "2 received, 0 inserted, 2 rejected" with row-level reasons |
| A | employee: my work only, no Finance in the navigation and a friendly 403 | Navigation and 403 page |
| A | platform admin: platform overview without tenant business data | Metadata-only platform views |

Measured timings (development machine, full 36-month NovaMart dataset):

| Operation | Time |
|---|---|
| Full demo seed (≈915,000 records, 5 synthetic feeds, example CSV) | 117–177 s across five runs |
| `VACUUM (ANALYZE)` of the loaded tables (end of seed) | 8–56 s |
| Training the 22 forecast models | 31–42 s |
| First executive-dashboard request after a fresh seed (cold process) | 1.4–2.8 s (18.4 s before the seed's VACUUM step was added) |
| Executive dashboard, warm | 0.6–1.6 s depending on period |
| Decision Lab simulation with 200 Monte Carlo runs | ≈2.3 s |
| Backend test suite | ≈37–92 s (longer when a seed ran concurrently) |

## 3. What the backend suite covers (168 tests)

| File | Tests | What it proves |
|---|---|---|
| `test_metrics.py` | 14 | Formulas (growth, margins, turnover, DIO, GMROI, basket, SPLH, CAGR, budget variance, MAE/RMSE/WAPE/MAPE/bias/coverage); zero denominators and missing data return statuses, never 0 |
| `test_auth.py` | 15 | Registration, login, lockout, enumeration resistance, refresh rotation and reuse detection, CSRF, password policy and change, invitations, demo sign-in rules |
| `test_isolation_rbac.py` | 22 | Tenant isolation (404 for non-members), every role's permissions on the API, store-scoped data, platform admins without tenant data |
| `test_pipeline.py` | 17 | CSV/Excel import, NULL for missing values, row-level rejections with reasons, duplicate files and overlapping exports, deterministic source ids, REST connector connected only after an authenticated test, webhook signatures/replay/idempotency, system of record (no double counting), budget versions never added, single error per invalid value |
| `test_sftp_connector.py` | 4 | SFTP against a real in-process SSH server: host-key pinning (mismatch refused, never "connected"), wrong password, incremental files, re-exports upserted without duplicates, private keys pasted without line breaks |
| `test_forecasting.py` | 12 | Rolling-origin backtests without leakage, baselines vs models, interval coverage, reliability verdicts, versioning and data fingerprints, insufficient-history handling |
| `test_simulation.py` | 14 | **Required: 20 → 30 employees adds deterministic staffing cost and no revenue**; documented-assumption gating; price elasticity formula; supplier cost; opex; new store capex/depreciation/payback; inventory policy; apply order; Monte Carlo reproducibility; optimizer bounds/constraints |
| `test_persistence_workflows.py` | 10 | Saved scenarios survive a new session, versioning, comparison by downside, recommendation approval with separation of duties, tasks, predicted-vs-actual measurement, reports in PDF/XLSX/CSV with checksums, audit trail |
| `test_advisor_intel_news.py` | 26 | Advisor example questions with every number traced, the 20 → 30 question, permission-aware tools, fabricated-number detection, company profiles with sources and no price for unlisted companies, benchmarking caveats, news dedupe, AI interpretation requires a key, log redaction, retention, market-data refresh platform-only |
| `test_api_and_errors.py` | 14 | Error shape, validation, 500s without internals, rate limiting with Retry-After, security headers, readiness, dashboard contract and an independent SQL cross-check, honest public catalogue, upload size limit, spoofed X-Forwarded-For ignored, integration config visibility |
| `test_review_fixes.py` | 20 | Regression tests for review findings: vendor-profile uploads (success and failure keep the connection not live), payback after delayed investment and without capex, store-scoped scenario and recommendation access and counts, workforce scenarios hidden without workforce access, finance redaction (Decision Lab, evidence, optimizer, recommendations), workforce scenarios need workforce access, opex assumptions without absolute bases, fiscal periods for new organizations, GMROI visibility, period validation, self-deactivation, baseline months beyond/partly inside the forecast horizon, store-scoped recommendation counts, platform-wide rows cannot duplicate |

## 4. Additional scripted checks (executed on the full 36-month dataset)

- **Endpoint sweep**: 9 roles × 49 read endpoints → no 5xx, no response slower than 3 s; 403s only where the role
  lacks the permission.
- **Advisor (deterministic mode)**: the six example questions plus "What happens if we increase employees from 20 to 30
  at store S04?" all answered with every number traced to tool outputs. The S04 answer: headcount 20 → 30, staffing
  cost +₹3.87 lakh per month (₹46.39 lakh over 12 months), revenue effect ₹0.
- **Forecast training**: 22 models (company, every store, every category) trained without failures; see the timing
  and accuracy in section 2.

## 5. Not executed in this environment

- The docker-compose **stack was not started** (no Docker on the development machine). On GitHub Actions the compose file
  validates and both images build; running the stack end to end (`docker compose up`, seed, browse) has not been done.
- The advisor's LLM mode against the live Anthropic API (no API key configured); deterministic mode is fully tested.
- Live vendor connections (none is authorized; see INTEGRATIONS.md), live market-data providers and live news fetching
  (disabled by default). Connectors are tested with injected transports and a local SFTP server.
- Real-browser downloads in e2e (deliberately avoided; files are verified through the API).

## 6. Defects found by testing and review, and fixed

Backend: duplicate detection counting rejected rows; outbound DNS check in connector tests; seed example dated outside
the compact dataset; org auditors not seeing sign-ins; tax assumption in the workforce test; advisor router missing
"from 20 to 30"; optimizer silently skipping combinations; spoofable X-Forwarded-For; unreachable market-data refresh;
future implementation dates; product analytics double counting an overlapping sales feed; log redaction breaking the
uvicorn access log; "last 7 days" empty for some periods; non-secret config fields masked; uploaders unable to see
upload settings; budget versions added together; duplicate date errors; vendor-profile uploads always failing;
aggregates not rebuilt after a partially failed sync; payback in month 1 for delayed investments; store-scoped access to
company-wide scenarios; data-quality store list leaking codes; absolute financials visible without finance access;
unknown gross margin treated as 0; opex start month ignored for variable costs; WAPE 0 treated as 1; inconsistent
Monte Carlo ROI; store contribution estimated below the cost-coverage threshold; GMROI never computed; calibration
ignoring company events and systems of record; advisor recording the configured instead of the answering model;
overstock currency; 429 without headers; no fiscal periods for new organizations; refresh cookie path; self-deactivation
returning 404; partial interpolation of long gaps; partial last baseline month; store-scoped recommendation counts.
Second review: workforce scenarios now need workforce access; cost assumptions redacted on recommendations and in the advisor's simulation tool; opex assumptions without absolute bases; recommendations from multi-store scenarios visible to their store-scoped authors; payback evaluated whenever cash dips; aggregate rebuild after failures in its own session; vendor profiles stay `awaiting_credentials` after uploads; weekly interpolation of interior gaps only; a 50% cost-coverage floor for the baseline margin; budget COGS consistent with estimated gross profit; store-level marketing scenarios using allocated, not company, spend; cookie paths from the API prefix; platform-wide reference rows unique (migration 0003); dead code removed.
Verification: an e2e test that depended on scenarios left by earlier runs; a first dashboard request of 18 s right after a bulk seed (autovacuum contention), fixed by ending the seed with `VACUUM (ANALYZE)`.
Frontend: download helper revoking the object URL too early and saving empty files when a download manager intercepts.
CI (first run on GitHub Actions): `uv run pytest` could not import `app` (the backend is not an installed package; fixed
with `pythonpath = ["."]` in the pytest config), and `tsc` on a fresh checkout lacked Next.js's generated `LayoutProps`
type (the root layout now types its props explicitly). The image job passed on the first run.
