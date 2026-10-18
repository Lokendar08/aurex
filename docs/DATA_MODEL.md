# AUREX data model

AUREX stores everything in one PostgreSQL schema: 58 tables declared in
[backend/app/models](../backend/app/models) and created by Alembic revision
[0001](../backend/migrations/versions/20261018_0001_initial_schema.py). This document lists every table by model
file, then explains the cross-cutting rules: tenancy columns, provenance and the idempotent upsert key,
"missing is not zero", system-of-record selection, canonical entities and migrations.

## 1. Conventions

| Convention | Rule | Source |
|---|---|---|
| Constraint names | Deterministic: `ix_<column_label>`, `uq_<table>_<columns>`, `ck_<table>_<name>`, `fk_<table>_<column>_<referred>`, `pk_<table>` | [db/base.py:11-21](../backend/app/db/base.py#L11-L21) |
| Primary keys | `UUIDPk` (UUID4) for entities; `BigInteger` identity for high-volume rows (fact lines, errors, audit, messages, notifications) | [db/base.py:24-25](../backend/app/db/base.py#L24-L25) |
| Timestamps | `Timestamps` adds `created_at` / `updated_at` (server `now()`, `onupdate`) | [db/base.py:28-34](../backend/app/db/base.py#L28-L34) |
| Money / quantities | `NUMERIC(18,2)` in the row's `currency`; quantities `NUMERIC(14,3)` | [facts.py:38-39](../backend/app/models/facts.py#L38-L39) |
| Tenancy | `OrgScoped` adds `org_id` (FK `organizations`, `ON DELETE CASCADE`, indexed); `CompanyScoped` adds `company_id` (FK `companies`, cascade) | [mixins.py:22-35](../backend/app/models/mixins.py#L22-L35) |
| Provenance | `Provenance` on every normalized fact row (section 3) | [mixins.py:38-54](../backend/app/models/mixins.py#L38-L54) |

All tenant reads go through `OrgContext`, which filters on `org_id` and applies the membership's store scope
([ARCHITECTURE.md](ARCHITECTURE.md#3-backend-layering-and-tenancy)). Tables that carry `org_id` without the mixin:
`agg_store_daily` (explicit `org_id`, `company_id`), `scenario_runs` (`org_id` only), `background_jobs` and
`audit_events` (`org_id` NULL for platform-level rows), and `market_entities`, `news_sources`, `news_articles` (`org_id`
NULL for platform-wide reference data, set for an organization's own entries). Child tables reached only through a
parent have no tenant column: `forecast_backtests`, `forecast_points`, `listed_securities`, `financial_observations`,
`market_observations`. `users`, `auth_sessions` and `fx_rates` are global.

## 2. Tables by model file

### identity.py — accounts, tenants, sessions, audit

| Table | Purpose | Key columns and constraints |
|---|---|---|
| `users` | Login identities | `email` unique, CHECK lowercase; `password_hash` (argon2); `is_active`, `is_platform_admin`, `is_demo`; `failed_login_count`, `locked_until` ([identity.py:28-47](../backend/app/models/identity.py#L28-L47)) |
| `organizations` | Tenants | `slug` unique; `base_currency` (default INR); `timezone`; `is_demo`; `status` in (active, suspended); `settings` JSONB ([identity.py:50-67](../backend/app/models/identity.py#L50-L67)) |
| `memberships` | User x organization with a role | unique (`org_id`, `user_id`); `role` CHECK against membership roles; `store_scope` UUID[] (NULL = all stores); `status` in (active, suspended) ([identity.py:70-92](../backend/app/models/identity.py#L70-L92)) |
| `invitations` | Pending invitations | `token_hash` unique (HMAC of the token); `role`, `store_scope`, `expires_at`, `accepted_at`, `revoked_at` ([identity.py:95-110](../backend/app/models/identity.py#L95-L110)) |
| `auth_sessions` | Refresh-token sessions | `family_id` (rotation family), `refresh_token_hash` unique, `expires_at`, `rotated_at`, `revoked_at`, `revoke_reason` ([identity.py:113-129](../backend/app/models/identity.py#L113-L129)) |
| `audit_events` | Audit trail | `org_id` NULL for platform events; `action`, `entity_type/id`, `outcome`, `ip_address`, `request_id`, redacted `details` JSONB ([identity.py:132-159](../backend/app/models/identity.py#L132-L159)) |

The audit table is documented as append-only; the application never updates rows, but the retention job deletes
rows older than `AUREX_RETENTION_AUDIT_DAYS` (730) ([retention.py:20-26](../backend/app/services/retention.py#L20-L26)).

### business.py — company structure

| Table | Purpose | Key columns and constraints |
|---|---|---|
| `companies` | Legal/operating business inside an organization | unique (`org_id`, `name`); `base_currency`; `fiscal_year_start_month` CHECK 1-12; `is_synthetic`; `settings` JSONB (e.g. `events` for the forecasting calendar) ([business.py:24-42](../backend/app/models/business.py#L24-L42)) |
| `stores` | Physical stores | unique (`company_id`, `code`); `opened_on`, `closed_on`, `selling_area_sqft` CHECK > 0, `status` in (planned, active, closed) ([business.py:45-62](../backend/app/models/business.py#L45-L62)) |
| `departments` | Store or head-office departments | unique (`company_id`, `code`); optional `store_id` ([business.py:65-73](../backend/app/models/business.py#L65-L73)) |
| `financial_periods` | Monthly fiscal calendar | unique (`company_id`, `period_start`); `fiscal_year/quarter/month`, `label`, `status` in (open, closed) ([business.py:76-93](../backend/app/models/business.py#L76-L93)). Rows for fiscal years current year - 3 to + 2 are created with every company: at registration ([auth.py:311-314](../backend/app/services/auth.py#L311-L314)), `POST /orgs` ([organizations.py:113](../backend/app/api/routes/organizations.py#L113)) and `POST /orgs/{org_id}/companies` ([organizations.py:377](../backend/app/api/routes/organizations.py#L377)); the demo seed creates its own range |

### integration.py — connections and ingestion bookkeeping

| Table | Purpose | Key columns and constraints |
|---|---|---|
| `integrations` | One configured connection | `provider_key`; `status` in (draft, awaiting_credentials, configured, connected, error, disabled); `config` JSONB (non-secret); `secret_ciphertext` (Fernet) and masked `secret_fingerprint`; `webhook_secret_ciphertext`; `sync_cursor` JSONB; `schedule_minutes`; unique (`org_id`, `display_name`) ([integration.py:25-66](../backend/app/models/integration.py#L25-L66)) |
| `sync_jobs` | One sync attempt | `trigger` (manual, schedule, webhook, upload, seed); `status` in (queued, running, succeeded, partially_succeeded, failed, cancelled); `attempt`/`max_attempts` (3), `retry_of_id`; record counters; `cursor_start/end`; `stats` JSONB ([integration.py:69-101](../backend/app/models/integration.py#L69-L101)) |
| `sync_errors` | Rejected rows and warnings | `row_number`, `field`, `error_code`, `severity` (error, warning), `raw_excerpt` (redacted, 20 columns x 120 chars) ([integration.py:104-119](../backend/app/models/integration.py#L104-L119), [validation.py:71-81](../backend/app/pipeline/validation.py#L71-L81)) |
| `uploaded_files` | Stored uploads | `sha256`; unique (`integration_id`, `entity_type`, `sha256`) so the same file is not imported twice ([integration.py:122-138](../backend/app/models/integration.py#L122-L138)) |
| `source_records` | Identity map for dimensions | unique (`integration_id`, `entity_type`, `source_record_id`) to `canonical_id` ([integration.py:141-163](../backend/app/models/integration.py#L141-L163)) |
| `entity_authorities` | System-of-record rules | (`company_id`, `fact_type`, `store_id`) unique with `NULLS NOT DISTINCT`; `store_id` NULL = company-wide rule ([integration.py:166-190](../backend/app/models/integration.py#L166-L190)) |
| `webhook_events` | Webhook idempotency | unique (`integration_id`, `event_id`); `payload_sha256`; `status` ([integration.py:193-209](../backend/app/models/integration.py#L193-L209)) |

### facts.py — the common data model

Dimensions (no provenance columns; matched on natural keys, see section 6):

| Table | Purpose | Key columns and constraints |
|---|---|---|
| `product_categories` | Category tree | unique (`company_id`, `code`); `parent_id` self-reference ([facts.py:54-63](../backend/app/models/facts.py#L54-L63)) |
| `suppliers` | Suppliers | unique (`company_id`, `code`); `payment_terms_days`, `contracted_lead_time_days` ([facts.py:66-76](../backend/app/models/facts.py#L66-L76)) |
| `products` | SKUs | unique (`company_id`, `sku`); `category_id`, `primary_supplier_id`, `list_price`, `unit_cost`, `currency` ([facts.py:79-98](../backend/app/models/facts.py#L79-L98)) |

Facts (all `CompanyScoped` + `Provenance`, all unique on (`integration_id`, `source_record_id`)):

| Table | Grain / purpose | Measures (nullable unless noted) | Constraints |
|---|---|---|---|
| `sales_records` | Transaction line, daily summary or store-day total | `quantity`, `gross_amount` (NOT NULL), `discount_amount`, `refund_amount`, `refund_quantity`, `net_amount` (NOT NULL), `cost_amount`, `tax_amount` | grain enum, non-negative amounts and quantities, net identity ([facts.py:106-142](../backend/app/models/facts.py#L106-L142)) |
| `store_traffic` | Store-day counts not additive across products | `transaction_count`, `footfall` | — ([facts.py:145-159](../backend/app/models/facts.py#L145-L159)) |
| `inventory_snapshots` | Store x product x date | `on_hand_qty` (NOT NULL), `on_order_qty`, `unit_cost`, `inventory_value`, `reorder_point`, `safety_stock` | — ([facts.py:167-188](../backend/app/models/facts.py#L167-L188)) |
| `inventory_movements` | Signed stock movements | `quantity` (NOT NULL, + into stock), `unit_cost`, `value` | `movement_type` in receipt, sale, customer_return, adjustment, transfer_in, transfer_out, shrinkage, write_off ([facts.py:191-215](../backend/app/models/facts.py#L191-L215)) |
| `purchase_orders` | PO headers (UUID id) | `total_amount`; `order_date`, `expected_date`, `received_date` | status enum; `received_date >= order_date` ([facts.py:218-238](../backend/app/models/facts.py#L218-L238)) |
| `purchase_order_lines` | PO lines | `quantity_ordered`, `unit_cost`, `line_amount` (NOT NULL), `quantity_received` | — ([facts.py:241-256](../backend/app/models/facts.py#L241-L256)) |
| `expenses` | Ledger expenses (COGS is never an expense row) | `amount` (NOT NULL); `store_id` NULL = head office | category in rent, utilities, payroll, marketing, maintenance, logistics, technology, insurance, professional_fees, store_supplies, other, depreciation, finance_costs, income_tax ([facts.py:263-295](../backend/app/models/facts.py#L263-L295)) |
| `cash_flow_entries` | Monthly cash flows, signed | `amount` (NOT NULL, + inflow) | activity in operating/investing/financing; category enum ([facts.py:298-317](../backend/app/models/facts.py#L298-L317)) |
| `cash_balances` | Bank balance by date | `balance` (NOT NULL) | — ([facts.py:320-328](../backend/app/models/facts.py#L320-L328)) |
| `budgets` | Budget lines | `amount` (NOT NULL); `metric` = `net_sales`, `cogs`, `gross_profit` or `opex:<category>`; `version_name` (alternative plans, never summed; section 5) | — ([facts.py:331-347](../backend/app/models/facts.py#L331-L347)) |
| `workforce_aggregates` | Store/department x week or month (no individual records) | `headcount`, `fte`, `hours_worked`, `overtime_hours`, `labor_cost`, `hires`, `separations` | `period_type` in week/month ([facts.py:355-378](../backend/app/models/facts.py#L355-L378)) |
| `marketing_spend` | Channel/campaign x week or month | `spend` (NOT NULL), `impressions`, `clicks` | `spend >= 0` ([facts.py:381-399](../backend/app/models/facts.py#L381-L399)) |
| `customer_metrics` | Store x month aggregates | `active_customers`, `new_customers`, `returning_customers`, `loyalty_members` | — ([facts.py:402-416](../backend/app/models/facts.py#L402-L416)) |

Reference and derived:

| Table | Purpose | Notes |
|---|---|---|
| `fx_rates` | Exchange rates with source | Unique (`base_currency`, `quote_currency`, `rate_date`, `source`) ([facts.py:424-436](../backend/app/models/facts.py#L424-L436)). Reserved, not populated (see below): facts in a currency other than the company base currency are rejected at validation instead of converted ([validation.py:197-200](../backend/app/pipeline/validation.py#L197-L200)). |
| `agg_store_daily` | Store-day totals from the system of record | PK (`store_id`, `business_date`) (section 5, [facts.py:439-471](../backend/app/models/facts.py#L439-L471)) |
| `data_quality_notes` | Known data limitations | Declared ([facts.py:474-482](../backend/app/models/facts.py#L474-L482)); reserved, not populated (see below). |

### analytics.py — forecasting and Decision Lab

| Table | Purpose | Key columns and constraints |
|---|---|---|
| `forecast_models` | One evaluated, versioned model per series | unique (`company_id`, `target`, `level`, `level_key`, `frequency`, `version`); `algorithm`, `candidates`, `metrics`, `baseline_metrics`, `skill_vs_baseline`, `reliability` CHECK, `data_fingerprint`, `random_seed`, `code_version`, `limitations`, `is_active` ([analytics.py:30-65](../backend/app/models/analytics.py#L30-L65)) |
| `forecast_backtests` | Per-fold, per-candidate scores | `fold`, `cutoff`, `horizon`, `mae`, `rmse`, `wape`, `mape`, `bias`, `coverage_80` ([analytics.py:68-84](../backend/app/models/analytics.py#L68-L84)) |
| `forecast_runs` | A generated forecast | `as_of` (last observed period), `horizon`, `interval_method` ([analytics.py:87-102](../backend/app/models/analytics.py#L87-L102)) |
| `forecast_points` | Forecast values | `period_start`, `step`, `yhat`, `lower_80/upper_80`, `lower_95/upper_95` ([analytics.py:105-118](../backend/app/models/analytics.py#L105-L118)) |
| `scenarios` | Saved Decision Lab scenarios | `levers` JSONB, `assumptions` JSONB (runs, seed, discount rate), `store_ids` (NULL = company), `version`, `status` in (draft, saved, archived), `horizon_months` CHECK 1-60 ([analytics.py:121-140](../backend/app/models/analytics.py#L121-L140)) |
| `scenario_runs` | Computed results | `scenario_version`, `engine_version`, `inputs_hash`, `result` JSONB ([analytics.py:143-157](../backend/app/models/analytics.py#L143-L157)) |

### Reserved schema (declared, not populated)

These tables and columns exist in the schema but no current code writes them, and no code reads them. Readers must
treat them as empty, not as zero.

| Table / column | Declared at | Status |
|---|---|---|
| `fx_rates` | [facts.py:424-436](../backend/app/models/facts.py#L424-L436) | No rows; currencies are never converted |
| `data_quality_notes` | [facts.py:474-482](../backend/app/models/facts.py#L474-L482) | No rows |
| `forecast_models.artifact_path` | [analytics.py:56](../backend/app/models/analytics.py#L56) | Always NULL; fitted models are not persisted ([FORECASTING.md](FORECASTING.md#7-versioning-and-storage)). A path helper `storage.model_artifact_path` exists but is not called ([storage.py:34-37](../backend/app/services/storage.py#L34-L37)) |
| `forecast_backtests.coverage_80` | [analytics.py:84](../backend/app/models/analytics.py#L84) | Always NULL (the per-fold `coverage_80` field of the engine's fold record is never set, [engine.py:43](../backend/app/services/forecasting/engine.py#L43)); coverage is stored once per model in `forecast_models.metrics.coverage_80` |
| `source_updated_at` (every fact table) | [mixins.py:51](../backend/app/models/mixins.py#L51) | Always NULL; the loaders do not map a source modification time |

### workflow.py — recommendations, tasks, reports, jobs, advisor

| Table | Purpose | Key columns and constraints |
|---|---|---|
| `recommendations` | Proposed actions | `source` (rule_engine, scenario, advisor, manual); `dedupe_key`; `evidence`, `assumptions`, `predicted_impact` JSONB; `status` in proposed, pending_approval, approved, rejected, in_progress, implemented, measured, dismissed; `confidence`, `priority` CHECKs ([workflow.py:27-63](../backend/app/models/workflow.py#L27-L63)) |
| `approvals` | Approval requests | `status` in pending, approved, rejected, cancelled ([workflow.py:66-81](../backend/app/models/workflow.py#L66-L81)) |
| `tasks` | Assigned work | `assignee_id`, `due_date`, `status` in open, in_progress, done, cancelled ([workflow.py:84-105](../backend/app/models/workflow.py#L84-L105)) |
| `recommendation_outcomes` | Predicted vs actual after implementation | `baseline_value`, `predicted_value`, `actual_value`, `variance`, `method` ([workflow.py:108-126](../backend/app/models/workflow.py#L108-L126)) |
| `notifications` | Per-user notifications | `read_at`; index (`user_id`, `created_at`) ([workflow.py:129-143](../backend/app/models/workflow.py#L129-L143)) |
| `reports` | Generated report files | `format` in pdf/csv/xlsx; `status` in queued/running/completed/failed; `sha256`, `file_path` ([workflow.py:146-168](../backend/app/models/workflow.py#L146-L168)) |
| `background_jobs` | Durable job records | `job_type`, `status` in queued/running/succeeded/failed, `payload`, `result`, `attempts` ([workflow.py:171-194](../backend/app/models/workflow.py#L171-L194)) |
| `advisor_conversations` | Per-user advisor threads | `user_id`, `company_id`, `title` ([workflow.py:197-204](../backend/app/models/workflow.py#L197-L204)) |
| `advisor_messages` | Questions and structured answers | `role`, `content`, `answer` JSONB, `tool_calls` JSONB, `mode` (llm, deterministic) ([workflow.py:207-219](../backend/app/models/workflow.py#L207-L219)) |
| `recommendation_rule_runs` | Rule-engine executions | `created_count`, `skipped_duplicates`, `details` ([workflow.py:222-231](../backend/app/models/workflow.py#L222-L231)) |

### intelligence.py — public reference data

| Table | Purpose | Key columns and constraints |
|---|---|---|
| `market_entities` | Public companies (platform-wide when `org_id` NULL) | unique (`org_id`, `key`) NULLS NOT DISTINCT; `aliases`, `reporting_currency`, `data_gaps`, `market_share_estimates` ([intelligence.py:33-55](../backend/app/models/intelligence.py#L33-L55)) |
| `listed_securities` | Exchange listings | unique (`exchange`, `ticker`); `verification_status` ([intelligence.py:58-72](../backend/app/models/intelligence.py#L58-L72)) |
| `financial_observations` | Reported figures with source | unique (`entity_id`, `fiscal_year`, `basis`, `metric`); `value` as reported, `value_base_units`, `source_url`, `verification_status` ([intelligence.py:75-100](../backend/app/models/intelligence.py#L75-L100)) |
| `market_observations` | Price / market-cap snapshots | unique (`security_id`, `as_of`, `source`); `is_snapshot` ([intelligence.py:103-123](../backend/app/models/intelligence.py#L103-L123)) |
| `news_sources` | Feeds | unique (`org_id`, `url`) NULLS NOT DISTINCT; `source_type`, `verified_working` ([intelligence.py:126-142](../backend/app/models/intelligence.py#L126-L142)) |
| `news_articles` | Articles | unique (`org_id`, `url_hash`) NULLS NOT DISTINCT; `facts_summary` vs labelled `ai_interpretation`; `duplicate_of_id`; GIN index on `entity_keys`, trigram index on `title` ([intelligence.py:145-179](../backend/app/models/intelligence.py#L145-L179)) |

PostgreSQL treats NULLs as distinct in ordinary unique constraints. The (`org_id`, ...) uniques on `market_entities`,
`news_sources` and `news_articles` are therefore declared `NULLS NOT DISTINCT` (`postgresql_nulls_not_distinct=True`,
[intelligence.py:55](../backend/app/models/intelligence.py#L55), [intelligence.py:142](../backend/app/models/intelligence.py#L142),
[intelligence.py:175](../backend/app/models/intelligence.py#L175); migration `0003`), so platform-wide rows (`org_id` NULL)
cannot be duplicated either, as `entity_authorities` already declared
([0001:638](../backend/migrations/versions/20261018_0001_initial_schema.py#L638)). The (`integration_id`, `entity_type`,
`sha256`) unique of `uploaded_files` is an ordinary one, so it does not catch duplicates among rows with a NULL
`integration_id`.

## 3. Provenance and the upsert key

Every fact table includes the `Provenance` columns ([mixins.py:38-54](../backend/app/models/mixins.py#L38-L54)):

| Column | Meaning | Written by |
|---|---|---|
| `integration_id` | Integration that produced the row; FK with `ON DELETE RESTRICT` | `load_facts` ([loader.py:195](../backend/app/pipeline/loader.py#L195)) |
| `sync_job_id` | Sync job that last wrote the row (`SET NULL` on job deletion) | [loader.py:196](../backend/app/pipeline/loader.py#L196) |
| `source_system` | Integration `provider_key` (`webhook_push` for webhook loads) | [runner.py:167-168](../backend/app/pipeline/runner.py#L167-L168) |
| `source_record_id` | The source's identifier, max 255 characters | connector or derived (section 6) |
| `source_updated_at` | Source modification time | Reserved: declared, not populated by current loaders (section 2) |
| `content_hash` | SHA-256 over the value columns and resolved reference ids (floats rounded to 3 decimals, dates `YYYY-MM-DD`, joined with `\x1f`) | [loader.py:96-110](../backend/app/pipeline/loader.py#L96-L110), [loader.py:186-192](../backend/app/pipeline/loader.py#L186-L192) |
| `ingested_at` | First load time, refreshed when the row changes | [loader.py:213](../backend/app/pipeline/loader.py#L213) |
| `is_synthetic` | `True` when the integration is a demo feed | [runner.py:167-168](../backend/app/pipeline/runner.py#L167-L168) |

**Upsert key.** Each fact table has `UNIQUE (integration_id, source_record_id)`, e.g.
[facts.py:132](../backend/app/models/facts.py#L132). The loader inserts with
`ON CONFLICT (integration_id, source_record_id) DO UPDATE SET ... WHERE <table>.content_hash IS DISTINCT FROM
EXCLUDED.content_hash` ([loader.py:215-224](../backend/app/pipeline/loader.py#L215-L224)). Consequences:

- Re-importing the same records, or an incremental window that overlaps the previous one, creates no duplicates;
  unchanged rows are counted as `unchanged` and are not rewritten.
- A changed row (e.g. a purchase order that has since been received) is updated in place; `sync_job_id` and
  `ingested_at` move to the latest job.
- The key is per integration: the same real-world sale reported by two integrations is stored twice. Double
  counting is prevented at read time by system-of-record selection (section 5), not at write time.
- Rows are never deleted by a sync. A record that disappears from the source stays in AUREX.
- An integration that has supplied any fact rows cannot be deleted through the API ("disable it instead") and the
  database FK would refuse it as well ([integrations.py:312-325](../backend/app/api/routes/integrations.py#L312-L325)).

## 4. Missing is not zero

The rule is stated at [facts.py:5-6](../backend/app/models/facts.py#L5-L6): NULL means "not supplied by the source", zero
means the source reported zero.

- **Columns.** Measures are nullable unless the row is meaningless without them (e.g. `gross_amount`, `net_amount`,
  `on_hand_qty`, `amount`) ([facts.py:120-128](../backend/app/models/facts.py#L120-L128)).
- **Validation.** Blank strings and the literals `nan`, `null`, `none`, `n/a` become NULL
  ([validation.py:84-88](../backend/app/pipeline/validation.py#L84-L88)); a present value that does not parse is an error,
  never silently NULL ([validation.py:3-8](../backend/app/pipeline/validation.py#L3-L8)).
- **Check constraints on `sales_records`** ([facts.py:131-142](../backend/app/models/facts.py#L131-L142)):

| Constraint | Expression |
|---|---|
| `ck_sales_records_grain_valid` | `grain IN ('transaction_line', 'daily_summary', 'store_daily_total')` |
| `ck_sales_records_amounts_nonneg` | `gross_amount >= 0 AND coalesce(discount_amount, 0) >= 0 AND coalesce(refund_amount, 0) >= 0` |
| `ck_sales_records_net_identity` | `abs(net_amount - (gross_amount - coalesce(discount_amount, 0) - coalesce(refund_amount, 0))) < 0.05` |
| `ck_sales_records_qty_nonneg` | `coalesce(quantity, 0) >= 0 AND coalesce(refund_quantity, 0) >= 0` |

  Other CHECKs: `stores.selling_area_sqft > 0`, `purchase_orders.received_date >= order_date`, `marketing_spend.spend >= 0`
  and the enumerations listed in section 2. The net identity treats an unreported discount or refund as zero, which is
  also how validation fills a missing `net_amount` ([validation.py:203-212](../backend/app/pipeline/validation.py#L203-L212)).
- **Propagation.** `agg_store_daily.cost_amount` is `SUM(cost_amount)` (NULL lines ignored, NULL if all are NULL) and
  `cost_covered_net_amount` is the net sales of lines whose cost is known ([aggregates.py:48-53](../backend/app/pipeline/aggregates.py#L48-L53));
  margins are computed on that covered base and the P&L refuses to report gross profit below 90% cost coverage
  ([METRICS.md](METRICS.md#2-pl-construction)).

Places where the code does substitute a value (documented defaults):

| Situation | Behaviour | Source |
|---|---|---|
| Missing `currency` | Company base currency assumed; a note is added to the job | [validation.py:189-194](../backend/app/pipeline/validation.py#L189-L194) |
| Field defaults | `grain=daily_summary`, `channel=in_store`, store `status=active`, PO `status=open`, workforce `period_type=month`, marketing `period_type=week`, product `unit_of_measure=unit`, `is_active=true` | [entities.py:84-204](../backend/app/pipeline/entities.py#L84-L204) |
| Dimension re-import with a blank column | Existing value kept (`COALESCE(EXCLUDED.col, table.col)`), so an import can never erase a known value, but also cannot clear one | [loader.py:287-289](../backend/app/pipeline/loader.py#L287-L289) |
| Weekly units series for forecasting | Weeks without any sales rows count as zero units (`asfreq("7D", fill_value=0.0)`) | [series.py](../backend/app/services/forecasting/series.py) `units_weekly` |
| Inventory demand | A product with no sales rows in the last 28 days has zero average daily demand | [operations.py](../backend/app/services/analytics/operations.py) `inventory_positions` |
| Decision Lab baseline margin below 90% cost coverage | From 50% coverage (`MIN_COVERAGE_FOR_BASELINE_MARGIN`) the trailing gross margin is estimated from the sales that have a recorded cost and the baseline carries a note; below 50%, or with no cost data, the baseline is refused (422), never computed at a margin of 0 | [service.py:229](../backend/app/services/forecasting/service.py#L229), [service.py:243-248](../backend/app/services/forecasting/service.py#L243-L248), [service.py:329-331](../backend/app/services/forecasting/service.py#L329-L331) |

## 5. System of record and `agg_store_daily`

When two integrations report the same facts (POS and ERP both sending daily sales), only one is counted.

**Rules.** `entity_authorities` holds rules keyed by (`company_id`, `fact_type`, `store_id`); `store_id` NULL means a
company-wide rule ([integration.py:166-190](../backend/app/models/integration.py#L166-L190)). Fact types come from
`AUTHORITY_FACT_TYPES` ([entities.py:212-216](../backend/app/pipeline/entities.py#L212-L216)): `sales`, `traffic`,
`inventory` (snapshots and movements), `purchasing` (orders and lines), `expenses`, `cash` (flows and balances), `budgets`,
`workforce`, `marketing`, `customers`. Rules are managed with `GET`/`PUT /orgs/{org_id}/integrations-authorities`; setting a
`sales` or `traffic` rule rebuilds the company's `agg_store_daily` immediately
([integrations.py:493-534](../backend/app/api/routes/integrations.py#L493-L534)).

**Sales and traffic: per store-day.** For every (store, business_date) the integrations that supplied rows are ranked
([aggregates.py:19-37](../backend/app/pipeline/aggregates.py#L19-L37)):

1. the integration named by a **store-level** rule for that store;
2. the integration named by the **company-level** rule;
3. the **earliest-created** integration (`integrations.created_at`, then `integration_id`).

A rule is a preference among the integrations that actually reported that store-day: if the authoritative
integration has no rows for a store-day, the next criterion picks another integration's rows. Sales and traffic are
chosen independently (`sales_integration_id`, `traffic_integration_id`).

**`agg_store_daily`** ([facts.py:439-471](../backend/app/models/facts.py#L439-L471), built by
[aggregates.py:40-77](../backend/app/pipeline/aggregates.py#L40-L77)):

| Column | Definition |
|---|---|
| `store_id`, `business_date` | Primary key: exactly one row per store-day |
| `sales_integration_id` | The single integration whose sales rows were summed |
| `gross_amount`, `discount_amount`, `refund_amount`, `net_amount`, `quantity` | Sums over that integration's rows |
| `cost_amount` | Sum of known costs (NULL if none known) |
| `cost_covered_net_amount` | Net sales of lines with a known cost |
| `line_count` | Number of summed rows |
| `transaction_count`, `traffic_integration_id` | From the chosen traffic integration (LEFT JOIN; NULL when no traffic) |
| `overlapping_sources` | Number of integrations that reported sales for that store-day |

The table is rebuilt by `DELETE` + `INSERT` for a date range after every load that inserted or updated sales or
traffic ([runner.py:103-110](../backend/app/pipeline/runner.py#L103-L110)), including after a failed sync for the sales and
traffic entities that were committed before the failure ([runner.py:120-130](../backend/app/pipeline/runner.py#L120-L130)),
and for all dates when a sales/traffic rule changes ([aggregates.py:80-86](../backend/app/pipeline/aggregates.py#L80-L86)).
Only store-days that have sales appear; a store-day with traffic but no sales has no row.

**Readers.** The P&L, dashboard, data bounds and daily forecasting series read `agg_store_daily`
([pnl.py:70-82](../backend/app/services/analytics/pnl.py#L70-L82), [base.py:131-134](../backend/app/services/analytics/base.py#L131-L134)).
Product-level queries read `sales_records` and add `sales_authority_join`, which keeps only rows whose
(`store_id`, `business_date`, `integration_id`) matches the chosen `sales_integration_id`; the join is skipped only
when no store-day has more than one source (`max(overlapping_sources) <= 1`)
([base.py:102-128](../backend/app/services/analytics/base.py#L102-L128)). It is used by product and category sales and
the revenue bridge (`product_sales`, [operations.py:52-66](../backend/app/services/analytics/operations.py#L52-L66)), the
28-day demand of inventory positions ([operations.py:181-187](../backend/app/services/analytics/operations.py#L181-L187)), and
in the Decision Lab by the price elasticities ([calibration.py:131-139](../backend/app/services/simulation/calibration.py#L131-L139))
and the inventory demand profile ([calibration.py:464-468](../backend/app/services/simulation/calibration.py#L464-L468)).
The weekly units series and the Decision Lab category profile always join `agg_store_daily` on `sales_integration_id`
instead ([series.py:85-93](../backend/app/services/forecasting/series.py#L85-L93),
[calibration.py:104-111](../backend/app/services/simulation/calibration.py#L104-L111)).

**Other fact types: one integration per company.** `chosen_source` returns the company-level rule if one exists,
otherwise the earliest-created integration that has rows in the table; store-level rules are not consulted for these
facts ([base.py:79-99](../backend/app/services/analytics/base.py#L79-L99)). `inventory_movements` and `cash_balances` use
the `inventory` and `cash` rules ([base.py:33](../backend/app/services/analytics/base.py#L33)).

**Visibility.** `freshness()` lists every integration that supplied each fact type with its latest date
([base.py:137](../backend/app/services/analytics/base.py#L137)); the data-quality endpoint reports
`store_days_with_multiple_sources`; the P&L adds a note when overlaps were excluded
([pnl.py:157-158](../backend/app/services/analytics/pnl.py#L157-L158)).

Every analytics, forecasting and Decision Lab read of a non-sales fact table filters on its `chosen_source`, including
the purchase-order lead times used for inventory positions
([operations.py:188-196](../backend/app/services/analytics/operations.py#L188-L196)), the past-opening capex
(`cash`, [calibration.py:403-406](../backend/app/services/simulation/calibration.py#L403-L406)) and the store cost profile
(`expenses`, [calibration.py:434-437](../backend/app/services/simulation/calibration.py#L434-L437)). When a fact type has no
rows, `chosen_source` is `None` and the input is reported as unavailable: most callers return early, and the lead-time,
capex and store-cost queries match no rows because `integration_id = NULL` is never true (lead times then fall back to
the contracted lead time). `freshness()` deliberately lists all integrations.

**Budget versions.** Budget lines of different `version_name`s are alternative plans for the same months, so they are
never summed: budget vs actual uses the requested version, or for each month the most recently imported version
(`max(ingested_at)`, ties broken by name) and returns `versions_used`
([operations.py:496-562](../backend/app/services/analytics/operations.py#L496-L562), [METRICS.md](METRICS.md#6-other-operational-measures)).

## 6. Canonical entities and natural keys

Connectors map source fields onto canonical entity specs ([entities.py:37-68](../backend/app/pipeline/entities.py#L37-L68)).
Dimensions load before facts (`LOAD_ORDER`, [entities.py:206-209](../backend/app/pipeline/entities.py#L206-L209)).

**Dimensions** are matched on a natural key within the company and upserted on (`company_id`, key)
([loader.py:243-323](../backend/app/pipeline/loader.py#L243-L323)); each (integration, entity, source id) is recorded in
`source_records`. Two integrations that send the same store code therefore resolve to the same canonical store.

| Entity | Table | Natural key | References |
|---|---|---|---|
| `store` | `stores` | `code` | — |
| `category` | `product_categories` | `code` | `parent_code` (resolved after load) |
| `supplier` | `suppliers` | `code` | — |
| `product` | `products` | `sku` | `category_code`, `supplier_code` |
| `department` | `departments` | `code` | `store_code` |

**Facts** require a `source_record_id` ([validation.py:231-233](../backend/app/pipeline/validation.py#L231-L233)). File-based
connectors derive one when the file has none: `"<entity>:" + sha1(joined natural key)[:32]`, with an occurrence index
appended for entities where identical keys are legitimate repeats ([file_import.py:32-66](../backend/app/connectors/file_import.py#L32-L66)):

| Entity | Natural key for derived ids | Repeats allowed | Required references | Date field |
|---|---|---|---|---|
| `sales` | store_code, sku, business_date, grain, channel, transaction_ref | no | store_code (sku required for line/daily grains) | business_date |
| `traffic` | store_code, business_date | no | store_code | business_date |
| `inventory_snapshot` | store_code, sku, snapshot_date | no | store_code, sku | snapshot_date |
| `inventory_movement` | store_code, sku, movement_date, movement_type, reference | yes | store_code, sku | movement_date |
| `purchase_order` | po_number | no | supplier_code | order_date |
| `purchase_order_line` | po_number, sku | no | po_number, sku | — |
| `expense` | store_code, department_code, expense_date, category, subcategory, vendor, gl_account, description | yes | — | expense_date |
| `cash_flow` | period_start, category, activity | no | — | period_start |
| `cash_balance` | as_of_date | no | — | as_of_date |
| `budget` | version_name, store_code, period_start, metric | no | — | period_start |
| `workforce` | store_code, department_code, period_start, period_type | no | — | period_start |
| `marketing_spend` | store_code, period_start, period_type, channel, campaign | no | — | period_start |
| `customer_metric` | store_code, period_start | no | — | period_start |

Sources: [file_import.py:34-49](../backend/app/connectors/file_import.py#L34-L49), [entities.py:113-204](../backend/app/pipeline/entities.py#L113-L204).

- **Code maps.** `integration.config.code_maps[<entity>]` translates source codes to canonical codes before lookup,
  e.g. an ERP site `1001` to store `S01` ([loader.py:70-72](../backend/app/pipeline/loader.py#L70-L72),
  [loader.py:151-153](../backend/app/pipeline/loader.py#L151-L153)).
- **Unknown references.** A provided code that matches nothing rejects the row with `unknown_<entity>`, even for an
  optional reference such as `sku` ([loader.py:155-168](../backend/app/pipeline/loader.py#L155-L168)).
- **Purchase-order lines** resolve `po_number` only against purchase orders loaded by the same integration; if that
  integration has several orders with one number, the latest `order_date` wins ([loader.py:76-79](../backend/app/pipeline/loader.py#L76-L79)).
- **Validation codes** (stored on `sync_errors.error_code`): `missing_required`, `too_long`, `invalid_choice`,
  `invalid_date`, `invalid_number`, `invalid_integer`, `negative_value`, `invalid_boolean`, `future_date` (more than one
  day ahead), `date_out_of_range` (before 2000-01-01), `invalid_currency`, `currency_mismatch`, `net_mismatch`,
  `negative_net`, `invalid_range`, `duplicate_in_batch` (warning; last occurrence kept), `unknown_<entity>`
  ([validation.py:91-254](../backend/app/pipeline/validation.py#L91-L254)).
- The catalogue of entities and fields is served at `GET /orgs/{org_id}/integrations/entities`, and an empty CSV
  template per entity at `GET /orgs/{org_id}/integrations/templates/{entity}.csv`
  ([integrations.py:131-143](../backend/app/api/routes/integrations.py#L131-L143)).

## 7. Migrations

| Revision | File | Content |
|---|---|---|
| `0001` | [20261018_0001_initial_schema.py](../backend/migrations/versions/20261018_0001_initial_schema.py) | Autogenerated schema for all 58 tables, plus `CREATE EXTENSION pg_trgm` and the trigram index on `news_articles.title` |
| `0002` | [20261018_0002_widen_reference_data_columns.py](../backend/migrations/versions/20261018_0002_widen_reference_data_columns.py) | Widens `financial_observations.fiscal_year` and `basis` to 40 characters and `listed_securities.exchange` to 80 |
| `0003` | [20261019_0003_unique_nulls_not_distinct.py](../backend/migrations/versions/20261019_0003_unique_nulls_not_distinct.py) | Recreates the (`org_id`, ...) unique constraints of `market_entities`, `news_sources` and `news_articles` as `NULLS NOT DISTINCT` (PostgreSQL 15 or later) ([0003:21-31](../backend/migrations/versions/20261019_0003_unique_nulls_not_distinct.py#L21-L31)); an existing database with duplicate platform-wide rows must be cleaned before the upgrade succeeds |

- [migrations/env.py](../backend/migrations/env.py) imports `app.models` so `Base.metadata` is complete, uses the
  application database URL unless `sqlalchemy.url` is passed, and compares column types.
- docker-compose runs `alembic upgrade head` in the `migrate` service before the API starts; the test suite
  recreates `aurex_test` and runs all migrations ([conftest.py:46-59](../backend/tests/conftest.py#L46-L59)).
- `scripts/patch_initial_migration.py` is a one-off helper that injected the `pg_trgm` statements into `0001` while it
  was still being iterated.
- The demo reset deletes fact rows explicitly before the organization, because fact rows reference integrations with
  `ON DELETE RESTRICT` ([demo.py:72-82](../backend/app/seed/demo.py#L72-L82)).
