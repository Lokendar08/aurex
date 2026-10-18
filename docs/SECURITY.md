# Security

This document describes the controls implemented in AUREX and the ones that are **not** implemented yet.
Every control below is enforced on the backend; the web app only mirrors permissions for usability.

## 1. Authentication and sessions

| Control | Implementation |
|---|---|
| Password hashing | Argon2id (time cost 3, memory 64 MiB by default; `AUREX_ARGON2_*`) — [core/security.py](../backend/app/core/security.py) |
| Password policy | ≥ `AUREX_PASSWORD_MIN_LENGTH` (10) characters, ≤ 256, at least one letter and one digit, not a common password, must not contain the e-mail name |
| Brute force | Account lockout after `AUREX_MAX_FAILED_LOGINS` (5) failures for `AUREX_LOCKOUT_MINUTES` (15); auth endpoints rate-limited per client IP and per e-mail (10/min) |
| User enumeration | Unknown e-mails still run a dummy Argon2 verification, so timing and responses do not reveal whether an account exists |
| Access token | HS256 JWT, 15 minutes (`AUREX_ACCESS_TOKEN_TTL_MINUTES`), bound to a server-side session id that is checked on every request (revocation is immediate) |
| Refresh token | Opaque random token stored only as an HMAC-SHA256 hash, 14 days, **rotated on every use**; re-use of a rotated token revokes the whole session family and is audited ([services/auth.py](../backend/app/services/auth.py)) |
| Cookies | `aurex_access` HttpOnly, SameSite=Lax, path `/api`; `aurex_refresh` HttpOnly, SameSite=Strict, path `/api/v1/auth`; `aurex_csrf` readable by JS; `aurex_session` HttpOnly hint used only by the Next.js redirect. `Secure` is mandatory in production (`AUREX_COOKIE_SECURE=true`, enforced at start-up) |
| CSRF | Double-submit: unsafe requests authenticated by cookie must send `X-CSRF-Token` equal to the `aurex_csrf` cookie; Bearer-token API clients are not subject to CSRF |
| Password change | Requires the current password; revokes every other session |
| Demo accounts | One-click demo sign-in exists only when `AUREX_DEMO_MODE=true`; demo users cannot sign in with a password or change it |

Not implemented: multi-factor authentication, SSO (SAML/OIDC) and e-mail delivery (invitation links are shown
once to the inviter; there is no e-mail password-reset flow). These are tracked in [CHECKLIST.md](../CHECKLIST.md).

## 2. Authorization and tenant isolation

- Every organization-scoped route resolves an `OrgContext` from the `{org_id}` in the path
  ([api/deps.py](../backend/app/api/deps.py)). Users without a membership receive **404**, so the organization's
  existence is not disclosed. All queries filter by `org_id`. Store-scoped members are further limited to
  their stores (`resolve_store_ids`), and company-level rows such as head-office costs are hidden from them.
- Permissions are checked with `require(...)` on each route; the role → permission mapping lives in
  [core/permissions.py](../backend/app/core/permissions.py). Separation of duties: the author of a
  recommendation cannot approve it.
- Platform administrators manage tenants and operations but have **no** access to tenant business data
  (no membership; platform endpoints return metadata only).
- Members without `finance:read` see changes (deltas) but not absolute P&L levels, margins, cost structure, capex or
  marketing spend — in Decision Lab results and evidence, saved scenarios, recommendations (monthly baseline/scenario
  levels and cost assumptions) and the advisor's simulation tool. Optimizer constraints on absolute scenario totals are
  refused for them, and GMROI (gross profit) is removed from inventory analytics. A delta can still imply the level of
  the very cost being changed, which is why workforce scenarios require `workforce:read` to run and to be seen (saved workforce scenarios and recommendations made from them are hidden without it)
  ([services/simulation/access.py](../backend/app/services/simulation/access.py)).
- The AI advisor's tools re-check permissions and store scope on every call.
- Saved scenarios and recommendations follow the store scope: store-scoped members see only scenarios (and
  recommendations from scenarios) whose stores lie entirely inside their scope; others answer 404.
- Isolation and RBAC are covered by [test_isolation_rbac.py](../backend/tests/test_isolation_rbac.py) and
  [test_review_fixes.py](../backend/tests/test_review_fixes.py).

### Role → permission matrix (generated from code)

Plat = platform admin, Owner = organization owner, Exec = executive, Fin = finance manager, Ops = operations
manager, Inv = inventory manager, HR = HR manager, Analyst = business analyst, Emp = employee, Audit = auditor.

| Permission | Plat | Owner | Exec | Fin | Ops | Inv | HR | Analyst | Emp | Audit |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `org:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `org:manage` |  | ✓ |  |  |  |  |  |  |  |  |
| `members:read` |  | ✓ | ✓ | ✓ |  |  | ✓ | ✓ |  | ✓ |
| `members:manage` |  | ✓ |  |  |  |  |  |  |  |  |
| `integrations:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |  | ✓ |
| `integrations:manage` |  | ✓ |  |  |  |  |  |  |  |  |
| `data:import` |  | ✓ |  | ✓ |  | ✓ | ✓ | ✓ |  |  |
| `data_quality:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `dashboard:read` |  | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |  | ✓ |
| `sales:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `finance:read` |  | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |  | ✓ |
| `inventory:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |  | ✓ |
| `suppliers:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |  | ✓ |
| `workforce:read` |  | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |  | ✓ |
| `forecasts:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `forecasts:run` |  | ✓ |  | ✓ |  | ✓ |  | ✓ |  |  |
| `scenarios:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `scenarios:write` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `advisor:use` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `intelligence:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `intelligence:manage` |  | ✓ |  |  |  |  |  | ✓ |  |  |
| `reports:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `reports:generate` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `recommendations:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `recommendations:write` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| `recommendations:approve` |  | ✓ | ✓ | ✓ |  |  |  |  |  |  |
| `tasks:read` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ |
| `tasks:manage` |  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  |
| `audit:read` |  | ✓ |  |  |  |  |  |  |  | ✓ |
| `platform:admin` | ✓ |  |  |  |  |  |  |  |  |  |

Employees can still see and update the status of tasks assigned to them through `/workflows/my-work`.

## 3. Secrets and data protection

- Configuration secrets are `SecretStr` and never logged. Production start-up refuses development defaults
  for the JWT secret, the encryption key and the database password, insecure cookies, and demo mode unless
  `AUREX_ALLOW_DEMO_IN_PRODUCTION=true` (`Settings.validate_for_production` in [core/config.py](../backend/app/core/config.py)).
- Integration credentials and webhook signing secrets are encrypted with Fernet (`AUREX_SECRET_ENCRYPTION_KEY`)
  ([core/crypto.py](../backend/app/core/crypto.py)); the API never returns them (only `••••last4`), and refuses
  credentials sent inside `config`.
- Logs pass through a redaction filter (Bearer tokens, JWTs, API keys, Fernet ciphertexts, password/secret/token
  key-values, database URL passwords) — [core/logging.py](../backend/app/core/logging.py). Audit details are
  redacted before storage.
- API responses carry `Cache-Control: no-store`; JSON serialization converts NaN/∞ to null
  ([core/jsonsafe.py](../backend/app/core/jsonsafe.py)); unhandled errors return a generic message with a
  request id and never internals.
- Synthetic demo data is flagged (`is_synthetic`) and labelled in the UI, reports and advisor answers.

## 4. Network and input safety

| Area | Control |
|---|---|
| Rate limiting | Per user (600/min API, 20/min advisor), per client IP (2× the API limit), auth endpoints (10/min); Redis-backed when configured (shared across workers), in-memory otherwise; 429 with `Retry-After` ([core/ratelimit.py](../backend/app/core/ratelimit.py)) |
| Client IP | `X-Forwarded-For` is honoured only for `AUREX_TRUSTED_PROXY_HOPS` trusted proxies (default 0); the compose edge overwrites the header, so clients cannot spoof their address to evade limits ([services/audit.py](../backend/app/services/audit.py)) |
| Outbound connections (SSRF) | Connector hosts must resolve to public addresses unless `AUREX_ALLOW_PRIVATE_NETWORK_CONNECTORS=true`; REST endpoints must be HTTPS in production |
| SFTP | Host key pinned by SHA256 fingerprint (no trust-on-first-use); read-only |
| Customer databases | PostgreSQL sessions forced read-only with a statement timeout; single SELECT statements only |
| Webhooks | HMAC-SHA256 over timestamp + body, ±300 s replay window, idempotent by event id, 10 MB body limit |
| Uploads | Size limit (`AUREX_MAX_UPLOAD_MB`), SHA-256 duplicate detection, parsed as text (no macros or formulas executed), stored outside the web root |
| SQL | Values are always bound parameters; SQL text is assembled only from code-defined fragments |
| Headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` (API and web); HSTS at the Caddy edge |

## 5. Audit trail

Append-only `audit_events` record sign-ins (one platform-level event plus one per organization), failed
sign-ins, refresh-token re-use, membership and role changes, invitations, integration changes, tests and
uploads, webhook signature failures, scenario changes, advisor questions (length only, not content), report
generation, recommendation decisions and platform-admin actions, with actor, IP, user agent, request id and
outcome. Organization auditors read them at `GET /orgs/{org_id}/audit-events`; platform admins at
`GET /platform/audit-events`.

## 6. Retention and backups

- Retention (days, 0 disables): audit 730, sync errors 180, notifications 180, generated reports 365
  (`AUREX_RETENTION_*`); purged daily by Celery beat or `python -m app.worker.periodic purge-retention`
  ([services/retention.py](../backend/app/services/retention.py)).
- Backups: the `backup` compose service writes daily `pg_dump` custom-format dumps with SHA-256 checksums and
  a tarball of file storage, keeping `BACKUP_RETENTION_DAYS` (14). Restore with
  [deploy/backup/restore.sh](../deploy/backup/restore.sh). Copy backups off the host.

## 7. AI-specific controls

- The advisor answers only from validated tools; arithmetic goes through the `calculate` tool; every number in
  an answer is checked against tool inputs and outputs, and unverified numbers are flagged
  ([services/advisor/verify.py](../backend/app/services/advisor/verify.py)).
- Tool outputs are treated as data; the system prompt forbids following instructions found in data.
- Without `AUREX_ANTHROPIC_API_KEY` no data leaves the installation for AI processing (deterministic mode).

## 8. Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainers; do not open public issues containing exploit
details or customer data.
