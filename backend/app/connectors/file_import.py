"""CSV / Excel imports (including approved exports from POS/ERP vendors without APIs).

Configuration (``Integration.config``)
- ``entity_type``: default canonical entity for uploads (can be overridden per upload)
- ``column_mapping``: ``{canonical_field: source_column}``; unmapped canonical names are matched by header
- ``date_format``: strftime format for non-ISO dates, e.g. ``%d/%m/%Y`` (ambiguous dates are never guessed)
- ``delimiter``, ``sheet_name``, ``code_maps``

Source record ids: if the file has none, a deterministic id is derived from the entity's natural key so
re-uploading the same or an overlapping export updates rows instead of duplicating them.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pandas as pd

from app.connectors.base import (
    BaseConnector,
    Batch,
    ConfigField,
    ConnectorConfigurationError,
    ProviderSpec,
    TestResult,
)
from app.pipeline.entities import DIMENSION_ORDER, ENTITIES, FACT_ORDER

# Natural keys used to derive deterministic source ids. ``repeats`` = identical keys are legitimate
# separate records (an occurrence index is appended), otherwise duplicates are true duplicates.
NATURAL_KEYS: dict[str, tuple[tuple[str, ...], bool]] = {
    "sales": (("store_code", "sku", "business_date", "grain", "channel", "transaction_ref"), False),
    "traffic": (("store_code", "business_date"), False),
    "inventory_snapshot": (("store_code", "sku", "snapshot_date"), False),
    "inventory_movement": (("store_code", "sku", "movement_date", "movement_type", "reference"), True),
    "purchase_order": (("po_number",), False),
    "purchase_order_line": (("po_number", "sku"), False),
    "expense": (("store_code", "department_code", "expense_date", "category", "subcategory", "vendor", "gl_account",
                 "description"), True),
    "cash_flow": (("period_start", "category", "activity"), False),
    "cash_balance": (("as_of_date",), False),
    "budget": (("version_name", "store_code", "period_start", "metric"), False),
    "workforce": (("store_code", "department_code", "period_start", "period_type"), False),
    "marketing_spend": (("store_code", "period_start", "period_type", "channel", "campaign"), False),
    "customer_metric": (("store_code", "period_start"), False),
}

CHUNK_ROWS = 50_000


def derive_source_ids(frame: pd.DataFrame, entity: str) -> pd.Series:
    keys, repeats = NATURAL_KEYS.get(entity, ((), False))
    if not keys:
        return pd.Series([None] * len(frame), index=frame.index, dtype="object")
    parts = [frame[k].astype("string").fillna("").str.strip() if k in frame else pd.Series("", index=frame.index)
             for k in keys]
    joined = parts[0]
    for part in parts[1:]:
        joined = joined + "|" + part
    if repeats:
        occurrence = joined.groupby(joined).cumcount().astype("string")
        joined = joined + "#" + occurrence
    return joined.map(lambda v: f"{entity}:" + hashlib.sha1(v.encode(), usedforsecurity=False).hexdigest()[:32])


def apply_mapping(frame: pd.DataFrame, mapping: dict[str, str] | None, entity: str) -> pd.DataFrame:
    spec = ENTITIES[entity]
    frame = frame.copy()
    frame.columns = [str(c).strip() for c in frame.columns]
    lower_lookup = {c.lower(): c for c in frame.columns}
    out = pd.DataFrame(index=frame.index)
    mapping = mapping or {}
    for canonical in spec.field_names():
        source_col = mapping.get(canonical)
        if source_col and source_col in frame.columns:
            out[canonical] = frame[source_col]
        elif source_col and source_col.lower() in lower_lookup:
            out[canonical] = frame[lower_lookup[source_col.lower()]]
        elif canonical in lower_lookup:
            out[canonical] = frame[lower_lookup[canonical]]
    if "_row" in frame.columns:
        out["_row"] = frame["_row"]
    if spec.kind == "fact":
        if "source_record_id" not in out or out["source_record_id"].isna().all():
            out["source_record_id"] = derive_source_ids(out, entity)
        else:
            blank = out["source_record_id"].astype("string").str.strip().fillna("") == ""
            if blank.any():
                derived = derive_source_ids(out, entity)
                out.loc[blank, "source_record_id"] = derived[blank]
    return out


def read_table(path: Path, *, delimiter: str | None = None, sheet_name: str | None = None) -> Iterator[pd.DataFrame]:
    """Read a CSV or Excel file as text columns in chunks, tagging each row with its 1-based file row number."""
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        frame = pd.read_excel(path, dtype=str, sheet_name=sheet_name or 0, engine="openpyxl")
        frame["_row"] = range(2, len(frame) + 2)
        for start in range(0, len(frame), CHUNK_ROWS):
            yield frame.iloc[start:start + CHUNK_ROWS]
        return
    row_offset = 2
    for chunk in pd.read_csv(path, dtype=str, keep_default_na=False, sep=delimiter or ",", chunksize=CHUNK_ROWS,
                             encoding="utf-8-sig"):
        chunk = chunk.copy()
        chunk["_row"] = range(row_offset, row_offset + len(chunk))
        row_offset += len(chunk)
        yield chunk


class FileImportConnector(BaseConnector):
    spec = ProviderSpec(
        key="csv_upload",
        name="CSV / Excel import",
        categories=("pos", "erp", "inventory", "accounting", "workforce", "crm"),
        methods=("csv", "excel", "approved_export"),
        summary="Upload approved CSV or Excel exports. Columns are mapped to the AUREX data model, validated row "
                "by row and loaded idempotently.",
        availability="available",
        supported_entities=tuple(DIMENSION_ORDER + FACT_ORDER),
        config_fields=(
            ConfigField("entity_type", "Default record type", "select", False,
                        options=tuple(DIMENSION_ORDER + FACT_ORDER)),
            ConfigField("column_mapping", "Column mapping (canonical field → file column)", "json"),
            ConfigField("date_format", "Date format for non-ISO dates (e.g. %d/%m/%Y)"),
            ConfigField("delimiter", "CSV delimiter"),
            ConfigField("sheet_name", "Excel sheet name"),
        ),
    )

    def test_connection(self) -> TestResult:
        return TestResult(ok=True, status="configured",
                          message="File-based import: there is no live endpoint to test. Each upload is validated "
                                  "row by row and reported in the sync history.",
                          checks=[{"name": "configuration", "ok": True}])

    def entities_for_sync(self) -> list[str]:
        entity = (self.uploaded_file.entity_type if self.uploaded_file else None) or self.config.get("entity_type")
        return [entity] if entity else []

    def _read(self, path: Path) -> Iterator[pd.DataFrame]:
        return read_table(path, delimiter=self.config.get("delimiter"), sheet_name=self.config.get("sheet_name"))

    def fetch(self, entity: str, cursor: dict[str, Any] | None) -> Iterator[Batch]:
        if self.uploaded_file is None:
            raise ConnectorConfigurationError("File imports run only for an uploaded file")
        path = Path(self.uploaded_file.storage_path)
        if not path.exists():
            raise ConnectorConfigurationError("Uploaded file is no longer available in storage")
        mapping = (self.config.get("column_mapping") or {}).get(entity) if isinstance(
            (self.config.get("column_mapping") or {}).get(entity), dict) else self.config.get("column_mapping")
        for chunk in self._read(path):
            yield Batch(entity=entity, frame=apply_mapping(chunk, mapping, entity), cursor_after=None)


class ExcelImportConnector(FileImportConnector):
    spec = ProviderSpec(
        key="excel_upload",
        name="Excel workbook import",
        categories=FileImportConnector.spec.categories,
        methods=("excel", "approved_export"),
        summary="Upload .xlsx workbooks exported from accounting, ERP or workforce systems.",
        availability="available",
        supported_entities=FileImportConnector.spec.supported_entities,
        config_fields=FileImportConnector.spec.config_fields,
    )
