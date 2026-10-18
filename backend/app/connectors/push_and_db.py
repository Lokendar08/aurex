"""Signed webhook (push) connections and authorized read-only PostgreSQL connections."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pandas as pd

from app.connectors.base import (
    BaseConnector,
    Batch,
    ConfigField,
    ConnectorConfigurationError,
    ConnectorError,
    ProviderSpec,
    TestResult,
    TransientConnectorError,
    validate_outbound_host,
)
from app.connectors.file_import import apply_mapping
from app.pipeline.entities import DIMENSION_ORDER, FACT_ORDER


class WebhookConnector(BaseConnector):
    spec = ProviderSpec(
        key="webhook_push",
        name="Signed webhook (push)",
        categories=("pos", "erp", "inventory", "accounting", "workforce", "crm"),
        methods=("webhook",),
        summary="Source systems push records to a per-connection HTTPS endpoint. Each request is signed with "
                "HMAC-SHA256 over the timestamp and body, replay-protected, and processed at most once per event id.",
        availability="available",
        auth_type="hmac_signature",
        supported_entities=tuple(DIMENSION_ORDER + FACT_ORDER),
    )

    def test_connection(self) -> TestResult:
        if self.integration.webhook_secret_ciphertext is None:
            return TestResult(False, "awaiting_credentials", "Webhook signing secret has not been generated")
        received = (self.integration.last_test_result or {}).get("last_verified_event_at")
        if received:
            return TestResult(True, "connected", f"Last verified signed event received at {received}")
        return TestResult(False, "configured",
                          "Endpoint and signing secret are ready. The connection is shown as connected only after "
                          "the first correctly signed event is received.")

    def fetch(self, entity: str, cursor: dict[str, Any] | None) -> Iterator[Batch]:
        # Push-only: records arrive through the webhook endpoint, not through scheduled pulls.
        return iter(())


class PostgresReadOnlyConnector(BaseConnector):
    spec = ProviderSpec(
        key="postgres_readonly",
        name="Authorized database (PostgreSQL, read-only)",
        categories=("erp", "pos", "inventory", "accounting"),
        methods=("database",),
        summary="Read from a customer-approved PostgreSQL replica using a read-only role. Every session is forced "
                "into a read-only transaction with a statement timeout; only single SELECT statements are accepted.",
        availability="available",
        auth_type="database_credentials",
        supported_entities=tuple(DIMENSION_ORDER + FACT_ORDER),
        config_fields=(
            ConfigField("host", "Host", required=True),
            ConfigField("port", "Port", "integer"),
            ConfigField("database", "Database", required=True),
            ConfigField("username", "Read-only username", required=True),
            ConfigField("sslmode", "SSL mode", "select", options=("require", "verify-full", "prefer", "disable")),
            ConfigField("entities", "Per-entity SELECT queries and field mappings", "json", True),
            ConfigField("password", "Password", "password", True, secret=True),
        ),
    )

    def _connect(self):  # type: ignore[no-untyped-def]
        import psycopg

        missing = self.missing_settings()
        if missing:
            raise ConnectorConfigurationError("Missing: " + ", ".join(missing))
        validate_outbound_host(str(self.config["host"]), require_https=False)
        try:
            return psycopg.connect(
                host=self.config["host"], port=int(self.config.get("port") or 5432), dbname=self.config["database"],
                user=self.config["username"], password=self.secrets.get("password"),
                sslmode=self.config.get("sslmode") or "require", connect_timeout=10,
                options="-c default_transaction_read_only=on -c statement_timeout=60000",
            )
        except psycopg.OperationalError as exc:
            message = str(exc).split("\n")[0]
            if "password authentication failed" in message:
                raise ConnectorConfigurationError("Database authentication failed") from exc
            raise TransientConnectorError(f"Database connection failed: {message}") from exc

    def test_connection(self) -> TestResult:
        try:
            with self._connect() as conn:
                read_only = conn.execute("SHOW default_transaction_read_only").fetchone()[0]
                conn.execute("SELECT 1")
        except ConnectorConfigurationError as exc:
            status = "awaiting_credentials" if str(exc).startswith("Missing") else "error"
            return TestResult(False, status, str(exc))
        except ConnectorError as exc:
            return TestResult(False, "error", str(exc))
        if read_only != "on":
            return TestResult(False, "error", "Session is not read-only; refusing to use this connection")
        return TestResult(True, "connected", "Connected with a read-only session",
                          checks=[{"name": "read_only_session", "ok": True}])

    @staticmethod
    def _validate_query(query: str) -> str:
        normalized = query.strip().rstrip(";").strip()
        lowered = normalized.lower()
        if not (lowered.startswith("select") or lowered.startswith("with")):
            raise ConnectorConfigurationError("Only SELECT queries are allowed")
        if ";" in normalized:
            raise ConnectorConfigurationError("Only a single statement is allowed")
        return normalized

    def fetch(self, entity: str, cursor: dict[str, Any] | None) -> Iterator[Batch]:
        definition = (self.config.get("entities") or {}).get(entity)
        if not definition or not definition.get("query"):
            raise ConnectorConfigurationError(f"No query configured for {entity}")
        query = self._validate_query(definition["query"])
        cursor_field = definition.get("cursor_field")
        params = {"cursor": (cursor or {}).get("value") or definition.get("initial_cursor", "1900-01-01")}
        newest = (cursor or {}).get("value")
        with self._connect() as conn, conn.cursor(name=f"aurex_{entity}") as cur:
            cur.execute(query, params)
            columns = [d.name for d in cur.description] if cur.description else []
            while True:
                rows = cur.fetchmany(10_000)
                if not rows:
                    break
                frame = pd.DataFrame(rows, columns=columns)
                mapping = definition.get("field_mapping") or {}
                mapped = frame.rename(columns={v: k for k, v in mapping.items()}) if mapping else frame
                if cursor_field and cursor_field in frame:
                    candidate = str(frame[cursor_field].max())
                    newest = max(newest, candidate) if newest else candidate
                yield Batch(entity=entity, frame=apply_mapping(mapped, None, entity),
                            cursor_after={"value": newest} if newest else cursor)


class VendorProfileConnector(BaseConnector):
    """Vendor-specific profile for systems whose integration capabilities must be verified per customer.

    No vendor API is assumed. Until the vendor provides documented API access authorized by the
    retailer, data can only arrive through approved exports (CSV/Excel uploads) or a generic REST /
    database connection configured from documentation the customer supplies.
    """

    def test_connection(self) -> TestResult:
        return TestResult(
            False, "awaiting_credentials",
            f"No verified API is available for {self.spec.name}. Activation requires the retailer's authorization "
            "and vendor-provided API documentation/credentials, or use approved exports via file import.",
            checks=[{"name": "documented_api", "ok": False}],
        )

    def fetch(self, entity: str, cursor: dict[str, Any] | None) -> Iterator[Batch]:
        raise ConnectorConfigurationError(
            f"{self.spec.name} has no verified API connection. Upload approved exports instead.")


def make_vendor_profile(key: str, name: str, categories: tuple[str, ...], summary: str,
                        research_key: str | None = None) -> type[VendorProfileConnector]:
    spec = ProviderSpec(key=key, name=name, categories=categories, methods=("approved_export",), summary=summary,
                        availability="requires_vendor_authorization", research_key=research_key or key,
                        supported_entities=tuple(DIMENSION_ORDER + FACT_ORDER))
    return type(f"{key.title().replace('_', '')}Connector", (VendorProfileConnector,), {"spec": spec})
