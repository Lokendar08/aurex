"""Bulk, idempotent loading of validated canonical records.

Facts: rows are COPY'd into a temporary staging table and merged with
``INSERT ... ON CONFLICT (integration_id, source_record_id) DO UPDATE ... WHERE content_hash differs``.
The RETURNING ``xmax = 0`` trick separates inserts from updates; rows whose content hash did not
change are counted as *unchanged* (duplicate deliveries / overlapping incremental windows).

Dimensions: matched on their natural key within the company (store code, SKU ...) after applying the
integration's code translation map, and recorded in ``source_records`` (identity map).
"""

from __future__ import annotations

import hashlib
import io
import uuid
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Company, Integration, SourceRecord
from app.pipeline.entities import EntitySpec
from app.pipeline.validation import RowError

REF_TABLES = {
    "store": ("stores", "code"),
    "product": ("products", "sku"),
    "supplier": ("suppliers", "code"),
    "category": ("product_categories", "code"),
    "department": ("departments", "code"),
}


@dataclass
class LoadStats:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    min_date: date | None = None
    max_date: date | None = None

    def merge(self, other: LoadStats) -> None:
        self.inserted += other.inserted
        self.updated += other.updated
        self.unchanged += other.unchanged
        for attr, fn in (("min_date", min), ("max_date", max)):
            mine, theirs = getattr(self, attr), getattr(other, attr)
            if theirs is not None:
                setattr(self, attr, theirs if mine is None else fn(mine, theirs))


@dataclass
class LoadContext:
    db: Session
    company: Company
    integration: Integration
    sync_job_id: uuid.UUID | None
    source_system: str
    is_synthetic: bool = False
    _ref_cache: dict[str, dict[str, uuid.UUID]] = field(default_factory=dict)

    @property
    def org_id(self) -> uuid.UUID:
        return self.company.org_id

    def code_map(self, entity: str) -> dict[str, str]:
        maps = (self.integration.config or {}).get("code_maps", {})
        return {str(k): str(v) for k, v in (maps.get(entity) or {}).items()}

    def refs(self, entity: str) -> dict[str, uuid.UUID]:
        if entity not in self._ref_cache:
            if entity == "purchase_order":
                rows = self.db.execute(text(
                    "SELECT po_number, id FROM purchase_orders WHERE integration_id = :i ORDER BY order_date"),
                    {"i": self.integration.id}).all()
            else:
                table, key = REF_TABLES[entity]
                rows = self.db.execute(text(f"SELECT {key}, id FROM {table} WHERE company_id = :c"),  # noqa: S608
                                       {"c": self.company.id}).all()
            self._ref_cache[entity] = {str(k): v for k, v in rows}
        return self._ref_cache[entity]

    def invalidate(self, entity: str) -> None:
        self._ref_cache.pop(entity, None)


# ---------------------------------------------------------------------------------------------
# Hashing & serialization helpers
# ---------------------------------------------------------------------------------------------


def _stringify(series: pd.Series) -> pd.Series:
    if pd.api.types.is_datetime64_any_dtype(series):
        return series.dt.strftime("%Y-%m-%d").fillna("")
    if pd.api.types.is_float_dtype(series):
        return series.round(3).map(lambda v: "" if pd.isna(v) else f"{v:.3f}")
    return series.astype("string").fillna("")


def row_hashes(frame: pd.DataFrame, columns: list[str]) -> pd.Series:
    if frame.empty:
        return pd.Series([], dtype="string")
    joined = _stringify(frame[columns[0]])
    for col in columns[1:]:
        joined = joined + "\x1f" + _stringify(frame[col])
    return pd.Series([hashlib.sha256(v.encode()).hexdigest() for v in joined.tolist()], index=frame.index)


def _to_csv_frame(frame: pd.DataFrame, int_columns: set[str], date_columns: set[str]) -> pd.DataFrame:
    out = frame.copy()
    for col in out.columns:
        if col in date_columns:
            out[col] = pd.to_datetime(out[col]).dt.strftime("%Y-%m-%d")
        elif col in int_columns:
            out[col] = pd.to_numeric(out[col]).round().astype("Int64")
    return out


def copy_frame(db: Session, table: str, frame: pd.DataFrame, columns: list[str], int_columns: set[str],
               date_columns: set[str], chunk: int = 100_000) -> None:
    raw = db.connection().connection.driver_connection
    with raw.cursor() as cur:
        for start in range(0, len(frame), chunk):
            part = _to_csv_frame(frame.iloc[start:start + chunk][columns], int_columns, date_columns)
            buffer = io.StringIO()
            part.to_csv(buffer, index=False, header=False, na_rep="")
            with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv, NULL '')") as cp:
                cp.write(buffer.getvalue())


# ---------------------------------------------------------------------------------------------
# Reference resolution
# ---------------------------------------------------------------------------------------------


def resolve_references(ctx: LoadContext, spec: EntitySpec, frame: pd.DataFrame) -> tuple[pd.DataFrame, list[RowError], int]:
    """Translate codes to canonical ids. Rows with unknown required/provided references are rejected."""
    if frame.empty or not spec.refs:
        return frame, [], 0
    reject = np.zeros(len(frame), dtype=bool)
    errors: list[RowError] = []
    out = frame.copy()
    for ref_field, (entity, target_col) in spec.refs.items():
        if ref_field not in out:
            continue
        codes = out[ref_field].astype("string")
        translation = ctx.code_map(entity)
        if translation:
            codes = codes.map(lambda c, t=translation: t.get(c, c) if not pd.isna(c) else c).astype("string")
        lookup = ctx.refs(entity)
        ids = codes.map(lambda c, lk=lookup: lk.get(str(c)) if not pd.isna(c) else None)
        provided = codes.notna().to_numpy()
        unknown = provided & ids.isna().to_numpy()
        missing_required = (ref_field in spec.required_refs) & ~provided
        bad = unknown | missing_required
        for idx in np.flatnonzero(unknown)[:200]:
            errors.append(RowError(
                row_number=int(out.iloc[int(idx)].get("_row", idx + 1)),
                source_record_id=str(out.iloc[int(idx)].get("source_record_id") or "") or None,
                field=ref_field, code=f"unknown_{entity}",
                message=f"{ref_field} '{codes.iloc[int(idx)]}' does not match any {entity} in this company "
                        f"(import {entity} records first or add a code mapping)"))
        reject |= bad
        out[target_col] = ids
    return out.loc[~reject].reset_index(drop=True), errors, int(reject.sum())


# ---------------------------------------------------------------------------------------------
# Facts
# ---------------------------------------------------------------------------------------------


def _model_columns(spec: EntitySpec) -> list[str]:
    return [f.name for f in spec.fields if f.name not in spec.refs]


def load_facts(ctx: LoadContext, spec: EntitySpec, frame: pd.DataFrame) -> LoadStats:
    stats = LoadStats()
    if frame.empty:
        return stats
    table = spec.model.__tablename__
    value_cols = [c for c in _model_columns(spec) if c != "source_record_id"]
    ref_cols = [target for _, (_, target) in spec.refs.items() if target in frame.columns]
    hash_cols = value_cols + ref_cols
    data = frame.copy()
    for col in ref_cols:
        data[col] = data[col].map(lambda v: str(v) if v is not None and not pd.isna(v) else None)
    data["content_hash"] = row_hashes(data, hash_cols)
    data["org_id"] = str(ctx.org_id)
    data["company_id"] = str(ctx.company.id)
    data["integration_id"] = str(ctx.integration.id)
    data["sync_job_id"] = str(ctx.sync_job_id) if ctx.sync_job_id else None
    data["source_system"] = ctx.source_system
    data["is_synthetic"] = ctx.is_synthetic
    columns = ["org_id", "company_id", "integration_id", "sync_job_id", "source_system", "source_record_id",
               "content_hash", "is_synthetic", *ref_cols, *value_cols]
    if table == "purchase_orders":
        data["id"] = [str(uuid.uuid4()) for _ in range(len(data))]
        columns = ["id", *columns]

    int_cols = {f.name for f in spec.fields if f.kind == "int"}
    date_cols = {f.name for f in spec.fields if f.kind == "date"}
    stage = f"stage_{table}_{uuid.uuid4().hex[:8]}"
    db = ctx.db
    db.execute(text(f"CREATE TEMP TABLE {stage} ON COMMIT DROP AS SELECT {', '.join(columns)} FROM {table} WITH NO DATA"))
    copy_frame(db, stage, data, columns, int_cols, date_cols)

    update_cols = [c for c in columns if c not in ("id", "org_id", "company_id", "integration_id", "source_record_id")]
    set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols) + ", ingested_at = now()"
    date_expr = spec.date_field or "NULL::date"
    row = db.execute(text(f"""
        WITH up AS (
            INSERT INTO {table} ({', '.join(columns)})
            SELECT {', '.join(columns)} FROM {stage}
            ON CONFLICT (integration_id, source_record_id) DO UPDATE SET {set_clause}
            WHERE {table}.content_hash IS DISTINCT FROM EXCLUDED.content_hash
            RETURNING (xmax = 0) AS inserted, {date_expr} AS d
        )
        SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted), min(d), max(d) FROM up
    """)).one()  # noqa: S608 - identifiers come from static entity specs
    db.execute(text(f"DROP TABLE IF EXISTS {stage}"))
    stats.inserted, stats.updated = int(row[0]), int(row[1])
    if stats.inserted + stats.updated >= 20_000:
        # Bulk loads change table statistics substantially; refresh them so aggregate refreshes and
        # analytics queries get good plans immediately (autovacuum would only catch up later).
        db.execute(text(f"ANALYZE {table}"))
    stats.unchanged = len(data) - stats.inserted - stats.updated
    stats.min_date, stats.max_date = row[2], row[3]
    if table == "purchase_orders":
        ctx.invalidate("purchase_order")
    return stats


# ---------------------------------------------------------------------------------------------
# Dimensions
# ---------------------------------------------------------------------------------------------


def load_dimensions(ctx: LoadContext, spec: EntitySpec, frame: pd.DataFrame) -> LoadStats:
    stats = LoadStats()
    if frame.empty:
        return stats
    assert spec.natural_key
    db = ctx.db
    table = spec.model.__tablename__
    key = spec.natural_key
    data = frame.copy()
    translation = ctx.code_map(spec.key)
    if translation:
        data[key] = data[key].map(lambda c: translation.get(str(c), str(c)))
    data["source_record_id"] = data["source_record_id"].fillna(data[key]).astype("string")
    ref_targets = [target for f, (_, target) in spec.refs.items() if target in data.columns and f != "parent_code"]
    value_cols = [c for c in _model_columns(spec) if c not in ("source_record_id", "parent_code")]
    hash_cols = value_cols + ref_targets + (["parent_code"] if "parent_code" in data else [])
    data["content_hash"] = row_hashes(data, hash_cols)

    existing = {
        r.source_record_id: r for r in db.scalars(select(SourceRecord).where(
            SourceRecord.integration_id == ctx.integration.id, SourceRecord.entity_type == spec.key,
            SourceRecord.source_record_id.in_(data["source_record_id"].tolist())))
    }
    changed_mask = [
        (sid not in existing) or (existing[sid].content_hash != h)
        for sid, h in zip(data["source_record_id"], data["content_hash"], strict=True)
    ]
    changed = data.loc[changed_mask].copy()
    stats.unchanged = len(data) - len(changed)

    if not changed.empty:
        for col in ref_targets:
            changed[col] = changed[col].map(lambda v: str(v) if v is not None and not pd.isna(v) else None)
        changed["id"] = [str(uuid.uuid4()) for _ in range(len(changed))]
        changed["org_id"] = str(ctx.org_id)
        changed["company_id"] = str(ctx.company.id)
        columns = ["id", "org_id", "company_id", *ref_targets, *value_cols]
        if spec.key == "product" and "currency" in columns:
            changed["currency"] = changed["currency"].fillna(ctx.company.base_currency)
        int_cols = {f.name for f in spec.fields if f.kind == "int"}
        date_cols = {f.name for f in spec.fields if f.kind == "date"}
        stage = f"stage_{table}_{uuid.uuid4().hex[:8]}"
        db.execute(text(f"CREATE TEMP TABLE {stage} ON COMMIT DROP AS SELECT {', '.join(columns)} FROM {table} WITH NO DATA"))
        copy_frame(db, stage, changed, columns, int_cols, date_cols)
        updatable = [c for c in columns if c not in ("id", "org_id", "company_id", key)]
        set_clause = ", ".join(f"{c} = COALESCE(EXCLUDED.{c}, {table}.{c})" for c in updatable)
        set_clause = (set_clause + ", " if set_clause else "") + "updated_at = now()"
        rows = db.execute(text(f"""
            INSERT INTO {table} ({', '.join(columns)}) SELECT {', '.join(columns)} FROM {stage}
            ON CONFLICT (company_id, {key}) DO UPDATE SET {set_clause}
            RETURNING id, {key}, (xmax = 0) AS inserted
        """)).all()  # noqa: S608
        db.execute(text(f"DROP TABLE IF EXISTS {stage}"))
        id_by_key = {str(r[1]): r[0] for r in rows}
        stats.inserted = sum(1 for r in rows if r[2])
        stats.updated = len(rows) - stats.inserted

        # Self-reference (category hierarchy) resolved after all codes exist.
        if spec.key == "category" and "parent_code" in changed:
            ctx.invalidate("category")
            lookup = ctx.refs("category")
            for code, parent in zip(changed["code"], changed["parent_code"], strict=True):
                if parent is not None and not pd.isna(parent) and str(parent) in lookup:
                    db.execute(text("UPDATE product_categories SET parent_id = :p WHERE company_id = :c AND code = :k"),
                               {"p": lookup[str(parent)], "c": ctx.company.id, "k": code})

        for sid, code, h in zip(changed["source_record_id"], changed[key], changed["content_hash"], strict=True):
            canonical = id_by_key.get(str(code))
            if canonical is None:
                continue
            if sid in existing:
                existing[sid].canonical_id = canonical
                existing[sid].content_hash = h
                existing[sid].last_seen_job_id = ctx.sync_job_id
            else:
                db.add(SourceRecord(org_id=ctx.org_id, integration_id=ctx.integration.id, entity_type=spec.key,
                                    source_record_id=str(sid), canonical_id=canonical, content_hash=h,
                                    first_seen_job_id=ctx.sync_job_id, last_seen_job_id=ctx.sync_job_id))
        db.flush()
    ctx.invalidate(spec.key)
    return stats
