"""Generic connector for documented REST/JSON APIs (API key, bearer token, basic or OAuth2 client credentials).

The connection is only reported as ``connected`` after an authenticated request to the configured test
endpoint succeeds. Field mappings use dotted paths into each JSON record.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import httpx
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

RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


def dig(record: Any, path: str) -> Any:
    current = record
    for part in path.split("."):
        if current is None:
            return None
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


class RestApiConnector(BaseConnector):
    spec = ProviderSpec(
        key="generic_rest",
        name="Documented REST API",
        categories=("pos", "erp", "inventory", "accounting", "workforce", "crm"),
        methods=("api", "oauth"),
        summary="Connect any system with documented REST/JSON endpoints using credentials the customer has "
                "authorized. Supports page, offset and cursor pagination and incremental 'updated since' syncs.",
        availability="available",
        auth_type="configurable",
        supported_entities=tuple(DIMENSION_ORDER + FACT_ORDER),
        config_fields=(
            ConfigField("base_url", "Base URL (https)", "url", True),
            ConfigField("auth_type", "Authentication", "select", True,
                        options=("api_key_header", "bearer", "basic", "oauth2_client_credentials")),
            ConfigField("api_key_header", "API key header name (e.g. X-API-Key)"),
            ConfigField("token_url", "OAuth2 token URL", "url"),
            ConfigField("scope", "OAuth2 scope"),
            ConfigField("test_endpoint", "Test endpoint path (e.g. /health or /me)", required=True),
            ConfigField("entities", "Entity endpoints & field mappings", "json", True),
            ConfigField("api_key", "API key", "password", secret=True),
            ConfigField("token", "Bearer token", "password", secret=True),
            ConfigField("username", "Username", secret=True),
            ConfigField("password", "Password", "password", secret=True),
            ConfigField("client_id", "OAuth2 client id", secret=True),
            ConfigField("client_secret", "OAuth2 client secret", "password", secret=True),
        ),
    )

    transport: httpx.BaseTransport | None = None  # injectable for tests

    def _client(self) -> httpx.Client:
        base_url = str(self.config.get("base_url") or "")
        if self.transport is None:  # an injected transport exists only in tests (no real network)
            validate_outbound_host(base_url)
        timeout = float(self.config.get("timeout_seconds", 30))
        return httpx.Client(base_url=base_url, timeout=timeout, transport=self.transport,
                            headers={"Accept": "application/json", "User-Agent": "AUREX-Connector/1.0"})

    def _auth_headers(self, client: httpx.Client) -> dict[str, str]:
        auth_type = self.config.get("auth_type")
        if auth_type == "api_key_header":
            if not self.secrets.get("api_key"):
                raise ConnectorConfigurationError("API key not provided")
            return {self.config.get("api_key_header") or "X-API-Key": self.secrets["api_key"]}
        if auth_type == "bearer":
            if not self.secrets.get("token"):
                raise ConnectorConfigurationError("Bearer token not provided")
            return {"Authorization": f"Bearer {self.secrets['token']}"}
        if auth_type == "basic":
            if not (self.secrets.get("username") and self.secrets.get("password")):
                raise ConnectorConfigurationError("Username and password are required")
            import base64

            raw = f"{self.secrets['username']}:{self.secrets['password']}".encode()
            return {"Authorization": "Basic " + base64.b64encode(raw).decode()}
        if auth_type == "oauth2_client_credentials":
            token_url = self.config.get("token_url")
            if not (token_url and self.secrets.get("client_id") and self.secrets.get("client_secret")):
                raise ConnectorConfigurationError("OAuth2 token URL, client id and client secret are required")
            if self.transport is None:
                validate_outbound_host(token_url)
            response = self._request(client, "POST", token_url, data={
                "grant_type": "client_credentials", "client_id": self.secrets["client_id"],
                "client_secret": self.secrets["client_secret"], **({"scope": self.config["scope"]}
                                                                  if self.config.get("scope") else {})})
            token = response.json().get("access_token")
            if not token:
                raise ConnectorError("OAuth2 token endpoint did not return an access_token")
            return {"Authorization": f"Bearer {token}"}
        raise ConnectorConfigurationError("Unsupported or missing auth_type")

    def _request(self, client: httpx.Client, method: str, url: str, **kwargs: Any) -> httpx.Response:
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                response = client.request(method, url, **kwargs)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_exc = exc
                continue
            if response.status_code in RETRYABLE_STATUS:
                last_exc = TransientConnectorError(f"HTTP {response.status_code} from {url}")
                if attempt < 2:
                    continue
                raise last_exc
            if response.status_code in (401, 403):
                raise ConnectorConfigurationError(f"Authentication failed (HTTP {response.status_code})")
            if response.status_code >= 400:
                raise ConnectorError(f"HTTP {response.status_code} from {url}")
            return response
        raise TransientConnectorError(f"Request to {url} failed after retries: {type(last_exc).__name__}")

    def test_connection(self) -> TestResult:
        missing = [label for label in ("base_url", "auth_type", "test_endpoint") if not self.config.get(label)]
        if missing:
            return TestResult(False, "awaiting_credentials", f"Missing configuration: {', '.join(missing)}")
        try:
            with self._client() as client:
                headers = self._auth_headers(client)
                started = datetime.now(UTC)
                response = self._request(client, "GET", self.config["test_endpoint"], headers=headers)
                elapsed_ms = round((datetime.now(UTC) - started).total_seconds() * 1000)
                try:
                    response.json()
                    json_ok = True
                except ValueError:
                    json_ok = False
        except ConnectorConfigurationError as exc:
            status = "awaiting_credentials" if "not provided" in str(exc) or "required" in str(exc) else "error"
            return TestResult(False, status, str(exc))
        except ConnectorError as exc:
            return TestResult(False, "error", str(exc))
        if not json_ok:
            return TestResult(False, "error", "Test endpoint responded but did not return JSON")
        return TestResult(True, "connected", f"Authenticated request succeeded (HTTP {response.status_code})",
                          checks=[{"name": "authenticated_request", "ok": True, "latency_ms": elapsed_ms}])

    def fetch(self, entity: str, cursor: dict[str, Any] | None) -> Iterator[Batch]:
        endpoints = self.config.get("entities") or {}
        endpoint = endpoints.get(entity)
        if not endpoint:
            raise ConnectorConfigurationError(f"No endpoint configured for {entity}")
        pagination = endpoint.get("pagination") or {"type": "none"}
        params = dict(endpoint.get("params") or {})
        incremental = endpoint.get("incremental") or {}
        if incremental.get("param") and cursor and cursor.get("value"):
            params[incremental["param"]] = cursor["value"]
        records_path = endpoint.get("records_path")
        mapping = endpoint.get("field_mapping") or {}
        max_pages = int(self.config.get("max_pages", 1000))
        newest = cursor.get("value") if cursor else None
        with self._client() as client:
            headers = self._auth_headers(client)
            page, next_cursor = 1, None
            for _ in range(max_pages):
                page_params = dict(params)
                if pagination.get("type") == "page":
                    page_params[pagination.get("page_param", "page")] = page
                    page_params[pagination.get("size_param", "per_page")] = pagination.get("size", 500)
                elif pagination.get("type") == "offset":
                    size = int(pagination.get("size", 500))
                    page_params[pagination.get("offset_param", "offset")] = (page - 1) * size
                    page_params[pagination.get("limit_param", "limit")] = size
                elif pagination.get("type") == "cursor" and next_cursor:
                    page_params[pagination.get("cursor_param", "cursor")] = next_cursor
                payload = self._request(client, "GET", endpoint["path"], params=page_params, headers=headers).json()
                records = dig(payload, records_path) if records_path else payload
                if not isinstance(records, list):
                    raise ConnectorError(f"Expected a list of records at '{records_path or '$'}'")
                if not records:
                    break
                flat = pd.DataFrame([{canon: dig(rec, src) for canon, src in mapping.items()} for rec in records]
                                    if mapping else records)
                if incremental.get("cursor_field"):
                    values = [dig(r, incremental["cursor_field"]) for r in records]
                    values = [v for v in values if v is not None]
                    if values:
                        newest = max([newest, *values]) if newest else max(values)
                yield Batch(entity=entity, frame=apply_mapping(flat, None, entity),
                            cursor_after={"value": newest} if newest else cursor)
                if pagination.get("type") in (None, "none"):
                    break
                if pagination.get("type") == "cursor":
                    next_cursor = dig(payload, pagination.get("next_cursor_path", "next_cursor"))
                    if not next_cursor:
                        break
                elif len(records) < int(pagination.get("size", 500)):
                    break
                page += 1
