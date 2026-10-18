# Integration Hub

AUREX connects to a customer's systems only through access that the customer has authorized and that has
been **tested**. No vendor API is assumed. A connection is shown as **connected** only after an
authenticated test succeeds (REST, database, SFTP) or the first correctly signed event arrives (webhook).
File imports are shown as **configured**, never as connected. Synthetic demo feeds are labelled as such.

Research behind the vendor statements in this document: [research/PROVIDER_VERIFICATION.md](research/PROVIDER_VERIFICATION.md)
(machine-readable: `backend/app/data/reference/providers.json`).

## 1. Framework

| Concern | Implementation |
|---|---|
| Connector contract | `BaseConnector.test_connection()` and `fetch(entity, cursor)` yielding batches ([connectors/base.py](../backend/app/connectors/base.py)) |
| Registry and catalogue | [connectors/registry.py](../backend/app/connectors/registry.py): implemented connectors merged with the provider research (verification status, evidence, activation requirements) |
| Status lifecycle | `draft → awaiting_credentials → configured → connected`, plus `error` and `disabled` ([models/integration.py](../backend/app/models/integration.py)) |
| Test before sync | Live providers (`generic_rest`, `postgres_readonly`, `sftp_export`) and vendor profiles are re-tested at the start of every sync; a failed test fails the job and sets the status ([pipeline/runner.py](../backend/app/pipeline/runner.py)) |
| Sync only when live | `POST /integrations/{id}/sync` returns 409 unless the integration is connected |
| Incremental imports | Per-entity cursor stored on the integration; it advances only for entities that completed. REST: `updated since` parameter + cursor field; PostgreSQL: `%(cursor)s` query parameter; SFTP: processed-file ledger |
| Duplicate prevention | Rows upsert on `(integration_id, source_record_id)`; unchanged rows are detected by content hash and not rewritten. Without source ids, deterministic ids are derived from natural keys ([file_import.py](../backend/app/connectors/file_import.py) `NATURAL_KEYS`). An identical file upload is refused with 409 `duplicate_file` (SHA-256) |
| No double counting across systems | System-of-record rules per fact type (store rule > company rule > earliest integration) feed `agg_store_daily` ([pipeline/aggregates.py](../backend/app/pipeline/aggregates.py)); `PUT /integrations-authorities` |
| Validation | Row-level, vectorized: types, required fields, references, units, blank = NULL (never 0); invalid rows are rejected with row, field, code, message and a raw excerpt ([pipeline/validation.py](../backend/app/pipeline/validation.py)) |
| Retries | Transient failures (timeouts, 5xx, 429) retry inside the connector, then the job is re-queued with exponential backoff (30 s · 2^(attempt−1)) up to `max_attempts` |
| Error logs | `GET /sync-jobs/{id}/errors` (paginated); `POST /sync-jobs/{id}/retry` |
| Provenance | Every fact row carries `integration_id`, `sync_job_id`, `source_system`, `source_record_id`, `content_hash`, `ingested_at`, `is_synthetic` |
| Secrets | Credentials go in `credentials` (never `config`; the API rejects secret-looking config keys), are encrypted with Fernet (`AUREX_SECRET_ENCRYPTION_KEY`) and are never returned; the API shows only a `••••last4` fingerprint |
| Network safety | Outbound hosts must resolve to public addresses unless `AUREX_ALLOW_PRIVATE_NETWORK_CONNECTORS=true` (on-premise installs); REST endpoints must be HTTPS in production |
| Scheduling | Connected integrations with `schedule_minutes` are queued by `schedule_due_syncs` — Celery beat every 5 minutes, or `python -m app.worker.periodic schedule-syncs` from cron on inline installs ([periodic.py](../backend/app/worker/periodic.py)) |

Main endpoints (prefix `/api/v1/orgs/{org_id}`): `GET /integrations/catalog`, `GET /integrations/entities`,
`GET /integrations/templates/{entity}.csv`, `GET|POST /integrations`, `GET|PATCH|DELETE /integrations/{id}`,
`POST /integrations/{id}/test`, `POST /integrations/{id}/sync`, `POST /integrations/{id}/uploads`,
`GET /integrations/{id}/jobs`, `GET /sync-jobs`, `GET /sync-jobs/{id}`, `GET /sync-jobs/{id}/errors`,
`POST /sync-jobs/{id}/retry`, `GET|PUT /integrations-authorities`, `POST /integrations/{id}/webhook-secret`.
Public: `GET /api/v1/public/integration-catalog`, `POST /api/v1/webhooks/{integration_id}`.

## 2. Connectors available now

### CSV / Excel import (`csv_upload`, `excel_upload`)
Approved exports uploaded through the UI or API (multipart `file` + `entity_type`, max `AUREX_MAX_UPLOAD_MB`).
Config: `entity_type`, `column_mapping` (canonical field → file column), `date_format` (strftime for non-ISO
dates; ambiguous dates are never guessed), `delimiter`, `sheet_name`. Templates per record type:
`GET /integrations/templates/{entity}.csv`. Status stays `configured`.

### SFTP export folder (`sftp_export`)
Polls a folder that the vendor or the retailer's IT fills with scheduled exports — the recommended first
connection for POS/ERP systems without a public API ([sftp_export.py](../backend/app/connectors/sftp_export.py)).

| Field | Notes |
|---|---|
| `host`, `port` (22), `username`, `remote_dir` | Host must resolve to a public address unless private-network connectors are enabled |
| `host_key_fingerprint` | **Required.** `SHA256:…` exactly as printed by `ssh-keygen -lf <host key>.pub`, obtained out of band. Any other key is refused (no trust-on-first-use) |
| `files` | Ordered rules `[{"pattern": "sales_*.csv", "entity": "sales", "column_mapping": {...}, "delimiter": ",", "sheet_name": "..."}]`; first match wins; `.csv`, `.txt`, `.xlsx`, `.xlsm` |
| `date_format` | strftime format for non-ISO dates |
| credentials | `private_key` (+ `private_key_passphrase`) preferred, or `password` |

Read-only (list + download). Each processed file's name, size and modification time are recorded in the
cursor; unchanged files are skipped, re-exported files are re-read and upserted. Files above the upload
limit fail the job with an explicit message. Tested against a real in-process SSH/SFTP server
([test_sftp_connector.py](../backend/tests/test_sftp_connector.py)).

### Documented REST API (`generic_rest`)
For any system with documented REST/JSON endpoints ([rest_api.py](../backend/app/connectors/rest_api.py)).
Config: `base_url` (https), `auth_type` (`api_key_header` | `bearer` | `basic` | `oauth2_client_credentials`),
`api_key_header`, `token_url`, `scope`, `test_endpoint` (an authenticated GET that must return JSON), and
`entities`:

```json
{"sales": {"path": "/v1/sales", "records_path": "data.items",
           "pagination": {"type": "page|offset|cursor|none", "size": 500, "page_param": "page",
                          "next_cursor_path": "meta.next"},
           "params": {"status": "posted"},
           "incremental": {"param": "updated_since", "cursor_field": "updated_at"},
           "field_mapping": {"source_record_id": "id", "store_code": "store.code", "business_date": "date",
                             "net_amount": "totals.net"}}}
```
Credentials: `api_key`, `token`, `username`/`password`, `client_id`/`client_secret` (OAuth2 client credentials).
401/403 → `error` (or `awaiting_credentials` when missing); 408/425/429/5xx retried.

### Signed webhook (`webhook_push`)
The source pushes `{"entity": "<record type>", "records": [...]}` to `POST /api/v1/webhooks/{integration_id}` with:
- `X-Aurex-Timestamp`: Unix seconds (±300 s tolerance — replay protection)
- `X-Aurex-Signature`: `sha256=` + hex HMAC-SHA256 of `"{timestamp}.{raw body}"` with the integration's signing secret
- `X-Aurex-Event-Id`: unique per event; a repeated id is acknowledged as `duplicate` and not processed again

The signing secret is generated by `POST /integrations/{id}/webhook-secret` and shown once. Bodies are
limited to 10 MB. The integration becomes `connected` after the first verified event.

### Authorized PostgreSQL database (`postgres_readonly`)
Config: `host`, `port`, `database`, `username`, `sslmode` (default `require`), `entities`
(`{"sales": {"query": "SELECT ... WHERE updated_at > %(cursor)s", "cursor_field": "updated_at",
"initial_cursor": "2024-01-01", "field_mapping": {...}}}`); credential `password`. Sessions run with
`default_transaction_read_only=on` and a 60 s statement timeout; the test fails unless the session is
read-only; only single `SELECT`/`WITH` statements are accepted. Use a read replica and a role with `SELECT`
on the needed views only.

### Synthetic demo feeds (`novamart_synthetic`)
Internal to the NovaMart demo organization; not listed in the public catalogue; every row has
`is_synthetic = true`. See [NOVAMART.md](NOVAMART.md).

## 3. The three systems named in the brief

None of them publishes a public API, and AUREX does not pretend otherwise. Their vendor profiles
(`yash_systems`, `qube_pos`, `ecolite`) always test as `awaiting_credentials` with the reason and carry the research
verdict in the catalogue. They accept approved export files (CSV/Excel), which are imported with the file connector;
successful or failed uploads never change the connection status, which stays `awaiting_credentials` until a real,
tested connection exists.

| Brief claim | Research verdict | Connection that can be activated today |
|---|---|---|
| YASH Systems Private Limited → DMart | **Unverified.** Closest entity: Yash Systems India Pvt Ltd (Nagpur); only user-generated sources link it to DMart; DMart filings confirm SAP ERP but name no POS vendor | Approved exports via `sftp_export` or upload |
| QubePOS / QubeRM → MR D.I.Y. | **Verified.** Qube Apps Solutions Sdn Bhd is a 30% associate of MR D.I.Y. Group (Annual Report 2025); QubeERP portal on mrdiy.com | Approved exports via `sftp_export` or upload; `generic_rest` once Qube supplies an API specification |
| "EcoLite" → Wellness Forever | **Partially verified, name not found.** Likely C-Square EcoGreen (the Wellness Forever app uses C-Square's `com.c2info.` namespace); not confirmed by either company | Approved exports via `sftp_export` or upload |

### Exact activation requirements

**DMart (Avenue Supermarts) — YASH Systems (unverified)**
1. DMart IT confirms the actual system of record for store sales and inventory (and the vendor's identity:
   the source of the name "YASH Systems Private Limited" — contract, invoice or email — must be produced).
2. Written authorization and data-sharing agreement signed by DMart; infosec review and NDA.
3. Extract specification (files, columns, date format, frequency) from the vendor, routed through DMart.
4. An SFTP account (key-based) with read access to the export folder, the server's SHA256 host key
   fingerprint, and AUREX egress IPs allow-listed.
5. In AUREX: create an `sftp_export` connection with the file rules, run **Test** (must report host key
   verified and authenticated), then sync. Set system-of-record rules if another feed covers the same stores.

**MR D.I.Y. — QubePOS / QubeRM / QubeERP (verified)**
1. Written authorization and data-sharing agreement from MR D.I.Y. (Qube is an MR D.I.Y. associate: commercial
   terms may be a related-party matter for the retailer).
2. Scope per country instance and module (QubeRM POS, FPOS, QubeERP — Malaysia and Indonesia may differ).
3. From Qube, routed through MR D.I.Y. IT: either an integration/API specification (base URL, auth scheme,
   endpoints, pagination, incremental field, rate limits) or a scheduled export to SFTP.
4. Credentials issued by Qube (API keys/OAuth client, or SFTP key) and AUREX IPs allow-listed; data-protection
   review under applicable law (e.g. Malaysia PDPA).
5. In AUREX: `generic_rest` with the documented endpoints and field mappings (connected only after the
   authenticated test call succeeds), or `sftp_export` for files.

**Wellness Forever — EcoLite / EcoGreen (partially verified)**
1. Wellness Forever IT confirms which system and edition it runs (EcoGreen multi-store vs EcoGreen Lite).
2. Authorization and data-sharing agreement; restrict to aggregated sales and inventory — pharmacy data can
   contain prescription data, which AUREX must not receive without explicit written approval.
3. API or scheduled export provided by C-Square, routed through Wellness Forever; legal review given
   C-Square's Reliance Retail ownership.
4. DPDP Act 2023 compliance, credentials (SFTP key or API), IP allow-listing.
5. In AUREX: `sftp_export` (or `generic_rest` if an API is documented), then test and sync.

## 4. Other systems (official documentation found)

Shopify, Square, Lightspeed Retail, Odoo, SAP Business One, Dynamics 365 Business Central, Oracle NetSuite,
TallyPrime, Zoho Inventory/Books, QuickBooks Online, Xero, Gofrugal, Ginesys, LS Central, BambooHR, Deputy,
HubSpot, Salesforce are listed in the catalogue as `planned` with their documentation links and rate-limit
notes. They connect today through `generic_rest` (or `postgres_readonly` / `sftp_export`). Generic
requirements for each: the customer's admin consent (OAuth app or API key with read scopes only), the
documented endpoints for each record type, the incremental ("updated since") field, and the vendor's rate
limits configured as page size/schedule. TallyPrime needs an on-premise agent (local HTTP server), so it
requires `AUREX_ALLOW_PRIVATE_NETWORK_CONNECTORS=true` on a self-hosted install.

## 5. Optional external services

| Service | Activation | Behaviour without it |
|---|---|---|
| AI advisor (Anthropic) | `AUREX_ANTHROPIC_API_KEY` (model `AUREX_ADVISOR_MODEL`, default `claude-opus-5-5`) | Deterministic mode: questions are routed to validated analyses; free-form questions are not answered |
| News interpretation (Anthropic) | Same key | Articles show reported facts only; "interpret" returns 409 `llm_not_configured` |
| News fetching | `AUREX_NEWS_FETCH_ENABLED=true` (+ Celery beat hourly, or `POST /news/refresh`) | Only stored, sourced articles; no articles are invented |
| Market data (listed securities) | `AUREX_MARKET_DATA_PROVIDER=alphavantage|twelvedata` + `AUREX_MARKET_DATA_API_KEY` (licensed key); a platform admin calls `POST /api/v1/platform/market-data/refresh` with an explicit symbol map (`{"NSE:DMART": "<provider symbol>"}` — tickers are never guessed) | Only dated, sourced snapshots labelled "snapshot, not live"; unlisted companies never show a price |

## 6. Checklist for a new connection

1. Written authorization from the data owner (and the vendor where required).
2. Credentials with the least privilege (read-only scopes, read replica, folder-scoped SFTP account).
3. Create the integration with config + credentials; confirm the status is `awaiting_credentials`/`configured`.
4. **Test** — only a successful authenticated test makes it `connected`.
5. First sync; review the sync job (received / inserted / updated / unchanged / rejected) and the error log.
6. Set system-of-record rules if another feed covers the same stores and fact types.
7. Enable the schedule.
