"""Connector registry and the public integration catalogue.

The catalogue merges implemented connectors with the verified provider research in
``app/data/reference/providers.json`` (verification status, evidence, activation requirements).
Providers without an implemented connector are listed as ``planned`` with their official docs; they can
be connected today through the generic REST connector using the vendor's documented API.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.connectors.base import BaseConnector, ProviderSpec
from app.connectors.file_import import ExcelImportConnector, FileImportConnector
from app.connectors.push_and_db import PostgresReadOnlyConnector, WebhookConnector, make_vendor_profile
from app.connectors.rest_api import RestApiConnector
from app.connectors.sftp_export import SftpExportConnector
from app.connectors.synthetic import SyntheticDemoConnector
from app.core.crypto import decrypt_secrets
from app.core.errors import ValidationAppError
from app.models import Integration, UploadedFile

REFERENCE_DIR = Path(__file__).resolve().parents[1] / "data" / "reference"

# Vendor profiles for the systems named in the project brief. Their association with each retailer and
# their integration capabilities come from ``providers.json`` (see docs/research/PROVIDER_VERIFICATION.md).
# None of them has a verified public API, so they activate through retailer-authorized exports first.
_VENDOR_PROFILES = [
    make_vendor_profile("yash_systems", "YASH Systems (reported DMart POS)", ("pos", "erp"),
                        "Brief: system associated with DMart. Research: association UNVERIFIED; the closest match is "
                        "Yash Systems India Pvt Ltd (Nagpur) with no public API.", research_key="yash_systems_india"),
    make_vendor_profile("qube_pos", "QubePOS / QubeRM (MR D.I.Y.)", ("pos", "crm", "erp"),
                        "Brief: system associated with MR D.I.Y. Research: VERIFIED via MR D.I.Y. annual report "
                        "(Qube Apps Solutions Sdn Bhd is a 30% associate); no public API.", research_key="qube_apps_qubepos"),
    make_vendor_profile("ecolite", "EcoLite / EcoGreen (reported Wellness Forever)", ("pos", "erp"),
                        "Brief: tentative 'EcoLite'. Research: PARTIALLY VERIFIED - likely C-Square EcoGreen (incl. "
                        "'EcoGreen Lite'); not confirmed by either company; no public API.", research_key="csquare_ecogreen"),
]

CONNECTORS: dict[str, type[BaseConnector]] = {
    cls.spec.key: cls
    for cls in (SyntheticDemoConnector, FileImportConnector, ExcelImportConnector, RestApiConnector,
                SftpExportConnector, WebhookConnector, PostgresReadOnlyConnector, *_VENDOR_PROFILES)
}


def get_spec(provider_key: str) -> ProviderSpec:
    cls = CONNECTORS.get(provider_key)
    if cls is None:
        raise ValidationAppError("Unknown or not yet implemented provider", details={"provider_key": provider_key})
    return cls.spec


def build_connector(db: Session, integration: Integration, uploaded_file: UploadedFile | None = None) -> BaseConnector:
    cls = CONNECTORS.get(integration.provider_key)
    if cls is None:
        raise ValidationAppError("Unknown provider", details={"provider_key": integration.provider_key})
    if uploaded_file is not None and cls.spec.availability == "requires_vendor_authorization":
        # A vendor without a verified API: its approved exports are parsed by the file connector, while the
        # connection itself keeps reporting that it is not live.
        cls = ExcelImportConnector if uploaded_file.filename.lower().endswith((".xlsx", ".xlsm")) else FileImportConnector
    return cls(integration, decrypt_secrets(integration.secret_ciphertext), db, uploaded_file)


@lru_cache
def provider_research() -> dict[str, dict[str, Any]]:
    path = REFERENCE_DIR / "providers.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {p["key"]: p for p in data.get("providers", []) if isinstance(p, dict) and p.get("key")}


def _verification(research: dict[str, Any] | None) -> str | None:
    if not research:
        return None
    assoc = research.get("reported_association") or {}
    caps = research.get("integration_capabilities") or {}
    return assoc.get("verification_status") or caps.get("verification_status")


def catalog_entries(include_internal: bool = False) -> list[dict[str, Any]]:
    research = provider_research()
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for key, cls in CONNECTORS.items():
        spec = cls.spec
        if spec.is_demo and not include_internal:
            continue
        info = research.get(spec.research_key or key)
        caps = (info or {}).get("integration_capabilities") or {}
        public_api = caps.get("public_api") or {}
        entries.append({
            "key": key,
            "name": spec.name,
            "categories": list(spec.categories),
            "methods": list(spec.methods),
            "availability": spec.availability,
            "verification_status": _verification(info),
            "summary": (info or {}).get("description") or spec.summary,
            "docs_url": public_api.get("docs_url") or spec.docs_url,
            "implemented": True,
            "activation_requirements": list((info or {}).get("activation_requirements") or spec.activation_requirements),
            "research": info,
        })
        seen.add(key)
        if spec.research_key:
            seen.add(spec.research_key)
    for key, info in research.items():
        if key in seen:
            continue
        caps = info.get("integration_capabilities") or {}
        public_api = caps.get("public_api") or {}
        methods = []
        if public_api.get("available"):
            methods.append("api")
        if "oauth2" in (caps.get("auth_methods") or []):
            methods.append("oauth")
        if (caps.get("webhooks") or {}).get("available"):
            methods.append("webhook")
        if caps.get("export_formats"):
            methods.append("approved_export")
        entries.append({
            "key": key,
            "name": info.get("name", key),
            "categories": info.get("categories") or [],
            "methods": methods,
            "availability": "planned",
            "verification_status": _verification(info),
            "summary": info.get("description") or "",
            "docs_url": public_api.get("docs_url"),
            "implemented": False,
            "activation_requirements": info.get("activation_requirements") or [
                "Connect through the generic REST connector using the vendor's documented API and credentials "
                "authorized by your organization."],
            "research": info,
        })
    return entries
