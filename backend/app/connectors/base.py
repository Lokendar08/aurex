"""Connector framework.

A connector knows how to (a) test that an authorized connection really works and (b) fetch records
for supported entities, mapped onto the canonical fields in ``app.pipeline.entities``. Connectors never
write to the database themselves; the sync runner validates and loads what they return.

Status semantics (``Integration.status``):
- ``awaiting_credentials``: authorization/credentials still missing. Never shown as live.
- ``configured``: credentials or upload settings stored, but no successful live test (or a file-based
  connection that has no live endpoint).
- ``connected``: the most recent connection test succeeded against the real endpoint.
- ``error``: the most recent test or sync failed.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, ClassVar, Literal
from urllib.parse import urlparse

import pandas as pd
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Integration, UploadedFile

Availability = Literal["available", "requires_vendor_authorization", "file_import_only", "planned"]


class ConnectorError(Exception):
    retryable = False


class TransientConnectorError(ConnectorError):
    """Network timeouts, HTTP 429/5xx: the sync job is retried with backoff."""

    retryable = True


class ConnectorConfigurationError(ConnectorError):
    """Missing/invalid configuration or credentials: not retried until the configuration changes."""


@dataclass
class TestResult:
    ok: bool
    status: str
    message: str
    checks: list[dict[str, Any]] = field(default_factory=list)
    tested_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "status": self.status, "message": self.message, "checks": self.checks,
                "tested_at": self.tested_at.isoformat()}


@dataclass
class Batch:
    entity: str
    frame: pd.DataFrame
    cursor_after: dict[str, Any] | None = None
    note: str | None = None


@dataclass(frozen=True)
class ConfigField:
    name: str
    label: str
    kind: str = "string"  # string | url | integer | select | json | boolean | password
    required: bool = False
    secret: bool = False
    help: str = ""
    options: tuple[str, ...] = ()


@dataclass(frozen=True)
class ProviderSpec:
    key: str
    name: str
    categories: tuple[str, ...]
    methods: tuple[str, ...]
    summary: str
    availability: Availability
    auth_type: str = "none"
    supported_entities: tuple[str, ...] = ()
    config_fields: tuple[ConfigField, ...] = ()
    docs_url: str | None = None
    research_key: str | None = None
    activation_requirements: tuple[str, ...] = ()
    is_demo: bool = False

    def secret_field_names(self) -> list[str]:
        return [f.name for f in self.config_fields if f.secret]


class BaseConnector:
    spec: ClassVar[ProviderSpec]

    def __init__(self, integration: Integration, secrets: dict[str, Any], db: Session,
                 uploaded_file: UploadedFile | None = None) -> None:
        self.integration = integration
        self.secrets = secrets
        self.db = db
        self.uploaded_file = uploaded_file
        self.config: dict[str, Any] = dict(integration.config or {})

    # -- contract ---------------------------------------------------------------------------
    def test_connection(self) -> TestResult:
        raise NotImplementedError

    def fetch(self, entity: str, cursor: dict[str, Any] | None) -> Iterator[Batch]:
        raise NotImplementedError

    def entities_for_sync(self) -> list[str]:
        configured = self.config.get("entities")
        if isinstance(configured, dict):
            return [e for e in configured if e in self.spec.supported_entities]
        if isinstance(configured, list):
            return [e for e in configured if e in self.spec.supported_entities]
        return list(self.spec.supported_entities)

    @property
    def date_format(self) -> str | None:
        return self.config.get("date_format")

    def missing_settings(self) -> list[str]:
        missing = []
        for f in self.spec.config_fields:
            if not f.required:
                continue
            source = self.secrets if f.secret else self.config
            if source.get(f.name) in (None, "", {}):
                missing.append(f.label)
        return missing


# ---------------------------------------------------------------------------------------------
# Outbound network safety (SSRF protection)
# ---------------------------------------------------------------------------------------------


def validate_outbound_host(url_or_host: str, *, require_https: bool = True) -> str:
    """Reject URLs that point at loopback/private/link-local networks unless explicitly allowed.

    Customer systems inside private networks can be enabled by the platform operator with
    ``AUREX_ALLOW_PRIVATE_NETWORK_CONNECTORS=true`` (on-premise deployments).
    """
    settings = get_settings()
    parsed = urlparse(url_or_host if "://" in url_or_host else f"tcp://{url_or_host}")
    host = parsed.hostname
    if not host:
        raise ConnectorConfigurationError("A valid host is required")
    if require_https and parsed.scheme not in ("https",) and not (
        settings.env != "production" and parsed.scheme == "http"
    ):
        raise ConnectorConfigurationError("Only https:// endpoints are allowed")
    allow_private = getattr(settings, "allow_private_network_connectors", False) or settings.env == "test"
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise TransientConnectorError(f"Could not resolve host {host}") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved
                or address.is_multicast) and not allow_private:
            raise ConnectorConfigurationError(
                f"{host} resolves to a non-public address ({address}); private-network connectors are disabled")
    return host
