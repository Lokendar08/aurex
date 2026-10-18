# AUREX project checklist

Legend: `[x]` done and verified by executed tests or runs · `[~]` done with stated limitations · `[ ]` not done.
Evidence for "verified" is in [docs/TESTING.md](docs/TESTING.md). Last updated: 2026-10-19.

## Implementation order (module 17)

1. Foundations: settings, security primitives, database schema + migrations, tenancy/RBAC, auth — done
2. Data path: connector framework, validation, loader, aggregates, NovaMart generator + demo seed — done
3. Analytics: metrics library, P&L, operations, dashboard, health score — done
4. Forecasting → Decision Lab → AI advisor (each depends on the previous) — done
5. Intelligence, news, benchmarking, reports, workflow — done
6. Public website and authentication UI — done
7. Authenticated app UI (part A: shell, dashboards, workspaces, integrations, data quality, settings, platform;
   part B: forecasts, Decision Lab, advisor, intelligence, news, benchmarking, reports, workflows) — see 1.x below
8. Deployment, documentation, final verification — see section 18

## 1. Public website
- [x] Home, Product, Integrations, Security, About, Sign in, Sign up (navy/white/blue design system)
- [x] Demo entry ("Explore the live demo") with every role; hidden when demo mode is off

## 2. Authentication, organizations and RBAC
- [x] Registration (creates organization + owner), login, logout, refresh rotation with reuse detection, password change
- [x] Organizations, companies, stores, departments, fiscal periods, invitations (single-use, expiring)
- [x] 10 roles; permissions enforced on every backend route; store-scoped memberships; last-owner guard
- [x] Tenant isolation (404 for non-members), platform admins without tenant data access
- [ ] MFA, SSO (SAML/OIDC), e-mail delivery (invites and password reset by e-mail)

## 3. Integration Hub
- [x] Provider verification research for YASH Systems/DMart (unverified), QubePOS/MR D.I.Y. (verified), "EcoLite"/Wellness Forever (partially verified) + 19 common systems
- [x] Connector framework: status lifecycle, test-before-sync, sync history, incremental cursors, retries with backoff, error logs, provenance, duplicate prevention
- [x] Connectors: CSV/Excel import, SFTP export folder (host-key pinned), documented REST API, signed webhook, read-only PostgreSQL, synthetic demo feeds, vendor profiles
- [x] Exact activation requirements documented per connection ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md))
- [~] Planned vendor-specific connectors (Shopify, Square, Zoho, QuickBooks, …) are listed with docs; connect through the generic REST connector
- [ ] OAuth authorization-code flows (interactive "Connect with …" buttons) for SaaS vendors

## 4. Normalization pipeline
- [x] Canonical model for sales, traffic, inventory snapshots/movements, purchase orders, expenses, budgets, cash, workforce, marketing, customers + dimensions
- [x] Vectorized validation; blank = NULL (never 0); ambiguous dates never guessed
- [x] Idempotent upserts (source record id + content hash); derived ids from natural keys; duplicate files refused
- [x] System-of-record rules; no double counting across overlapping feeds

## 5. Executive dashboard
- [x] KPIs with definitions, comparisons, statuses for missing data; filters (company, stores, period); freshness and sources
- [x] UI: dashboard with KPI grid, trends, stores, category mix, expenses, inventory, cash, health score, sources (headless smoke test in TESTING.md)

## 5b. Authenticated app shell and workspaces (part A)
- [x] Session/org context, permission-aware navigation, URL filter bar (company/store/period), synthetic-data banner, friendly 403 page
- [x] Workspaces: Finance, Operations, Inventory, Workforce, Analytics (revenue bridge), My Work, Audit
- [x] Integration Hub UI (catalogue with research evidence, config-driven connection form, test/sync/upload, job error logs, system-of-record rules), Data Quality, Settings (members, invitations, roles matrix, companies/stores/departments, periods), Platform admin

## 6. Financial and operational analytics
- [x] P&L (cost coverage rule), budget vs actual, expense anomalies (seasonality-aware), inventory turnover/DIO/GMROI, stockout/overstock risk, suppliers, workforce productivity, store/category performance, revenue bridge
- [x] Formulas unit-tested ([test_metrics.py](backend/tests/test_metrics.py))

## 7. Forecasting
- [x] Baselines (last value, seasonal naive weekly/yearly) vs Holt-Winters, ridge with Fourier/event features, gradient boosting
- [x] Rolling-origin backtests, no leakage, MAE/RMSE/WAPE/MAPE/bias/coverage, empirical intervals, reliability verdicts, versioning, limitations
- [x] Default plan: company targets, every store, every category (22 models on the demo data)
- [x] Forecasts UI: history/forecast with 80%/95% bands, model card (metrics, skill vs baseline, reliability), candidates, backtests, versions, baseline P&L

## 8. Decision Lab
- [x] Levers: workforce, price, marketing, supplier cost, inventory policy, new store, opex, retention, product mix
- [x] Central engine, baseline comparison, ROI, payback, NPV, Monte Carlo P10/P50/P90, sensitivity, downside, goal optimizer, scenario versioning and comparison
- [x] **Required test 20 → 30 employees: no automatic revenue, deterministic staffing cost** (passes)
- [x] Decision Lab UI: lever builder with presets (incl. 20 → 30 at S04), outcome band P10–P90, cash/payback, sensitivity, per-lever evidence vs assumptions, saved scenarios with versions, compare, goal optimizer, recommendation from scenario

## 9. AI advisor
- [x] Tool-based answers with permissions, calculator tool, numeric verification, evidence/assumptions/limitations/confidence
- [x] LLM mode (Anthropic SDK, strict tools, structured output) and deterministic mode without a key
- [~] LLM mode not exercised against the live API in this environment (no key); deterministic mode fully tested
- [x] Advisor UI: conversations, safe markdown, verified key figures, traced-number check, tool calls, confidence, mode banner

## 10. Company intelligence
- [x] DMart/Avenue Supermarts, MR D.I.Y., Wellness Forever and peers from cited filings; data gaps; derived metrics
- [x] Share prices only for listed securities (dated snapshots); optional licensed market-data refresh (platform admin)
- [x] UI: company list and detail with cited figures, dated snapshots for listed companies only, data gaps

## 11. Market news
- [x] Search, exact + near-duplicate detection, official/verified flags, labelled AI interpretation (requires a key)
- [~] RSS/official-source fetching implemented but disabled by default (`AUREX_NEWS_FETCH_ENABLED`); seeded articles are real, cited items
- [x] UI: search/filters, official/verified badges, duplicates, reported facts vs labelled AI interpretation

## 12. Benchmarking
- [x] Unit-free comparisons, comparability notes (currency, fiscal year, basis), health-score explanation
- [x] UI: comparison table, unit-free charts, comparability notes, health-score breakdown

## 13. Reports, recommendations, approvals, tasks, notifications, audit
- [x] Reports: executive, financial, inventory, forecast, scenario comparison, benchmarking × PDF/CSV/Excel, SHA-256 checksums, permission re-check
- [x] Recommendations (rules + from scenarios), approvals with separation of duties, tasks, notifications, predicted-vs-actual measurement
- [x] Audit trail (org and platform level)
- [x] UI: reports generator/list with checksums, workflows (recommendation pipeline, approvals, tasks, notifications, outcome tracking), audit page

## 14. Database and security
- [x] Migrations 0001–0003 (incl. NULLS NOT DISTINCT uniqueness for platform-wide rows), constraints, indexes; Fernet-encrypted secrets; log redaction; rate limiting (Redis or memory); trusted-proxy client IP; security headers; CSRF; retention purge; backups (compose service + restore script)
- [x] Production start-up refuses unsafe configuration

## 15. NovaMart synthetic dataset
- [x] Fictional, reproducible 36 months (2023-10-01 → 2026-10-17), 8 stores, 10 categories, labelled synthetic everywhere; demo works without credentials

## 16. Tests
- [x] Backend suite executed and green: 168 passed; ruff clean; `alembic check` shows no model/schema drift
- [x] Frontend `tsc` and `eslint` clean; production build succeeds without network fetches; headless e2e 13/13 passed (9 part B + 4 part A) against the production build with the installed Chrome
- [ ] Docker images and compose stack built/run (Docker not available in the development environment)
- [ ] CI workflow executed on a CI runner

## 18. Deployment and documentation
- [x] Dockerfiles, docker-compose (PostgreSQL, Redis, migrate, API, worker, beat, web, Caddy edge, backup, demo seed), `.env.example`, CI workflow
- [x] README, CLAUDE.md, this checklist, docs (architecture, data model, metrics, integrations, forecasting, Decision Lab, advisor, NovaMart, security, deployment, testing)

## Known limitations and next steps
- MFA/SSO and e-mail delivery are not implemented.
- OAuth "connect" flows for SaaS vendors are not implemented; use the generic REST connector with customer-issued credentials.
- No live vendor connection has been activated: every external connection needs the authorizations listed in docs/INTEGRATIONS.md.
- Market data and news fetching need licensed keys / explicit enablement.
