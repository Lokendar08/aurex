"""Vectorized validation of canonical records.

Rules
- Blank / absent optional values become NULL ("not reported"), never zero.
- A present value that cannot be parsed is an error (not silently NULL).
- A row with any error is rejected and logged with row number, field, code and a redacted excerpt.
- Duplicate ``source_record_id`` values inside one batch keep the last occurrence (warning).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.core.logging import redact_value
from app.pipeline.entities import EntitySpec, FieldSpec

TRUE_VALUES = {"true", "t", "yes", "y", "1"}
FALSE_VALUES = {"false", "f", "no", "n", "0"}
MAX_STORED_ERRORS_PER_BATCH = 500


@dataclass
class RowError:
    row_number: int | None
    source_record_id: str | None
    field: str | None
    code: str
    message: str
    severity: str = "error"
    raw: dict | None = None


@dataclass
class ValidationResult:
    valid: pd.DataFrame
    errors: list[RowError] = field(default_factory=list)
    received: int = 0
    rejected: int = 0
    warnings: int = 0
    error_counts: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


class _Collector:
    def __init__(self, raw: pd.DataFrame, spec: EntitySpec) -> None:
        self.raw = raw
        self.spec = spec
        self.reject = np.zeros(len(raw), dtype=bool)
        self.errors: list[RowError] = []
        self.counts: dict[str, int] = {}
        self.warnings = 0

    def add(self, mask: np.ndarray | pd.Series, code: str, field_name: str | None, message: str,
            severity: str = "error") -> None:
        mask_arr = np.asarray(mask, dtype=bool)
        n = int(mask_arr.sum())
        if n == 0:
            return
        self.counts[code] = self.counts.get(code, 0) + n
        if severity == "error":
            self.reject |= mask_arr
        else:
            self.warnings += n
        room = MAX_STORED_ERRORS_PER_BATCH - len(self.errors)
        if room <= 0:
            return
        for idx in np.flatnonzero(mask_arr)[:room]:
            row = self.raw.iloc[int(idx)]
            raw_excerpt = {str(k): (None if pd.isna(v) else str(v)[:120]) for k, v in list(row.items())[:20]
                           if not str(k).startswith("_")}
            src = row.get("source_record_id")
            self.errors.append(RowError(
                row_number=int(row["_row"]) if "_row" in row and not pd.isna(row["_row"]) else int(idx) + 1,
                source_record_id=None if src is None or pd.isna(src) else str(src)[:255],
                field=field_name, code=code, message=message, severity=severity,
                raw=redact_value(raw_excerpt),  # type: ignore[arg-type]
            ))


def _blank(series: pd.Series) -> pd.Series:
    if series.dtype == object or pd.api.types.is_string_dtype(series):
        stripped = series.astype("string").str.strip()
        return series.isna() | (stripped == "") | stripped.str.lower().isin(["nan", "null", "none", "n/a"])
    return series.isna()


def _coerce(series: pd.Series, spec: FieldSpec, collector: _Collector, date_format: str | None) -> pd.Series:
    blank = _blank(series).to_numpy()
    if spec.kind == "str":
        out = series.astype("string").str.strip()
        out = out.mask(blank)
        if spec.max_len:
            too_long = (out.str.len() > spec.max_len).fillna(False).to_numpy()
            collector.add(too_long, "too_long", spec.name, f"{spec.name} exceeds {spec.max_len} characters")
        if spec.choices:
            lowered = out.str.lower()
            bad = (~lowered.isin(spec.choices) & ~pd.Series(blank, index=out.index)).to_numpy()
            collector.add(bad, "invalid_choice", spec.name,
                          f"{spec.name} must be one of: {', '.join(spec.choices)}")
            out = lowered
        return out
    if spec.kind in ("date", "datetime"):
        if pd.api.types.is_datetime64_any_dtype(series):
            parsed = series
        elif date_format:
            parsed = pd.to_datetime(series.astype("string").str.strip(), format=date_format, errors="coerce")
        else:
            parsed = pd.to_datetime(series.astype("string").str.strip(), format="ISO8601", errors="coerce")
        invalid = parsed.isna().to_numpy() & ~blank
        collector.add(invalid, "invalid_date", spec.name,
                      f"{spec.name} is not a valid date (expected ISO 8601 such as 2026-01-31"
                      + (f" or format {date_format}" if date_format else "") + ")")
        return parsed.dt.normalize() if spec.kind == "date" else parsed
    if spec.kind in ("decimal", "int"):
        if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            numeric = series.astype("float64")
        else:
            cleaned = series.astype("string").str.strip().str.replace(",", "", regex=False)
            numeric = pd.to_numeric(cleaned, errors="coerce").astype("float64")
        invalid = numeric.isna().to_numpy() & ~blank
        collector.add(invalid, "invalid_number", spec.name, f"{spec.name} is not a valid number")
        finite = np.isfinite(numeric.to_numpy(dtype="float64", na_value=np.nan)) | numeric.isna().to_numpy()
        collector.add(~finite, "invalid_number", spec.name, f"{spec.name} is not finite")
        if spec.kind == "int":
            vals = numeric.to_numpy(dtype="float64", na_value=np.nan)
            frac = ~np.isnan(vals) & (np.abs(vals - np.round(vals)) > 1e-9)
            collector.add(frac, "invalid_integer", spec.name, f"{spec.name} must be a whole number")
        if spec.nonneg:
            negative = (numeric < 0).fillna(False).to_numpy()
            collector.add(negative, "negative_value", spec.name, f"{spec.name} must not be negative")
        return numeric
    if spec.kind == "bool":
        if pd.api.types.is_bool_dtype(series):
            return series.astype("boolean")
        lowered = series.astype("string").str.strip().str.lower()
        out = pd.Series(pd.NA, index=series.index, dtype="boolean")
        out[lowered.isin(TRUE_VALUES).fillna(False).to_numpy()] = True
        out[lowered.isin(FALSE_VALUES).fillna(False).to_numpy()] = False
        invalid = out.isna().to_numpy() & ~blank
        collector.add(invalid, "invalid_boolean", spec.name, f"{spec.name} must be true/false")
        return out
    raise ValueError(f"Unsupported field kind {spec.kind}")


def validate_batch(spec: EntitySpec, frame: pd.DataFrame, *, base_currency: str, today: date | None = None,
                   date_format: str | None = None) -> ValidationResult:
    today = today or date.today()
    raw = frame.reset_index(drop=True).copy()
    raw.columns = [str(c).strip().lower() for c in raw.columns]
    if "_row" not in raw.columns:
        raw["_row"] = np.arange(1, len(raw) + 1)
    result = ValidationResult(valid=pd.DataFrame(), received=len(raw))
    if raw.empty:
        result.valid = pd.DataFrame(columns=spec.field_names())
        return result

    collector = _Collector(raw, spec)
    out = pd.DataFrame(index=raw.index)
    for fspec in spec.fields:
        if fspec.name in raw.columns:
            col = _coerce(raw[fspec.name], fspec, collector, date_format)
        else:
            col = pd.Series(pd.NA, index=raw.index, dtype="object")
            if fspec.kind in ("decimal", "int"):
                col = pd.Series(np.nan, index=raw.index, dtype="float64")
            elif fspec.kind in ("date", "datetime"):
                col = pd.Series(pd.NaT, index=raw.index, dtype="datetime64[ns]")
        if fspec.default is not None:
            col = col.where(~col.isna(), fspec.default) if fspec.kind != "bool" else col.fillna(fspec.default)
        if fspec.required:
            missing = col.isna().to_numpy()
            if fspec.name in raw.columns:  # present-but-invalid values were already reported by _coerce
                missing = missing & (raw[fspec.name].astype("string").str.strip().fillna("") == "").to_numpy()
            collector.add(missing, "missing_required", fspec.name, f"{fspec.name} is required")
        out[fspec.name] = col

    # --- Cross-field rules --------------------------------------------------------------------
    if spec.date_field and spec.date_field in out:
        dates = out[spec.date_field]
        future = (dates > pd.Timestamp(today + timedelta(days=1))).fillna(False).to_numpy()
        collector.add(future, "future_date", spec.date_field, f"{spec.date_field} is in the future")
        ancient = (dates < pd.Timestamp(2000, 1, 1)).fillna(False).to_numpy()
        collector.add(ancient, "date_out_of_range", spec.date_field, f"{spec.date_field} is before 2000-01-01")

    if spec.has_currency:
        cur = out["currency"].astype("string").str.upper()
        assumed = cur.isna().to_numpy()
        if assumed.any():
            result.notes.append(f"{int(assumed.sum())} rows had no currency; assumed company base currency {base_currency}")
        cur = cur.fillna(base_currency)
        bad_fmt = ~cur.str.fullmatch(r"[A-Z]{3}").fillna(False).to_numpy()
        collector.add(bad_fmt, "invalid_currency", "currency", "currency must be an ISO 4217 code")
        mismatch = (cur != base_currency).fillna(False).to_numpy() & ~bad_fmt
        collector.add(mismatch, "currency_mismatch", "currency",
                      f"currency differs from the company base currency {base_currency}; "
                      "convert before import (multi-currency facts are not mixed into one P&L)")
        out["currency"] = cur

    if spec.key == "sales":
        gross = out["gross_amount"]
        disc = out["discount_amount"].fillna(0)
        refund = out["refund_amount"].fillna(0)
        expected_net = gross - disc - refund
        net_missing = out["net_amount"].isna()
        mismatch = (~net_missing & ((out["net_amount"] - expected_net).abs() >= 0.05)).fillna(False).to_numpy()
        collector.add(mismatch, "net_mismatch", "net_amount",
                      "net_amount must equal gross_amount - discount_amount - refund_amount")
        out["net_amount"] = out["net_amount"].where(~net_missing, expected_net.round(2))
        negative_net = (out["net_amount"] < -0.005).fillna(False).to_numpy() & ~mismatch
        collector.add(negative_net, "negative_net", "net_amount",
                      "discounts and refunds exceed gross sales; record refunds against the original sale date")
        needs_sku = out["grain"].isin(["transaction_line", "daily_summary"]).fillna(False).to_numpy()
        collector.add(needs_sku & out["sku"].isna().to_numpy(), "missing_required", "sku",
                      "sku is required for transaction_line and daily_summary grains")
        needs_qty = needs_sku & out["quantity"].isna().to_numpy()
        collector.add(needs_qty, "missing_required", "quantity", "quantity is required for product-level sales")
    if spec.key == "store":
        both = out["opened_on"].notna() & out["closed_on"].notna()
        bad_range = (both & (out["closed_on"] < out["opened_on"])).to_numpy()
        collector.add(bad_range, "invalid_range", "closed_on", "closed_on is before opened_on")
    if spec.key == "purchase_order":
        has = out["received_date"].notna()
        bad = (has & (out["received_date"] < out["order_date"])).fillna(False).to_numpy()
        collector.add(bad, "invalid_range", "received_date", "received_date is before order_date")

    # --- Source record ids & in-batch duplicates ----------------------------------------------
    if spec.kind == "fact":
        collector.add(out["source_record_id"].isna().to_numpy(), "missing_required", "source_record_id",
                      "source_record_id is required (connectors derive it from natural keys when absent)")
    key_col = "source_record_id" if spec.kind == "fact" else spec.natural_key
    if key_col:
        # Duplicates are judged among rows that passed validation, so an invalid later copy never
        # causes a valid earlier one to be dropped.
        keys = out[key_col].astype("string").where(~pd.Series(collector.reject, index=out.index))
        dup_mask = (keys.duplicated(keep="last") & keys.notna()).to_numpy() & ~collector.reject
        collector.add(dup_mask, "duplicate_in_batch", key_col,
                      f"duplicate {key_col} in this batch; the last occurrence was kept", severity="warning")
        drop_dups = dup_mask
    else:
        drop_dups = np.zeros(len(out), dtype=bool)

    keep = ~collector.reject & ~drop_dups
    valid = out.loc[keep].copy()
    valid["_row"] = raw.loc[keep, "_row"].to_numpy()
    result.valid = valid.reset_index(drop=True)
    result.errors = collector.errors
    result.rejected = int(collector.reject.sum())
    result.warnings = collector.warnings
    result.error_counts = collector.counts
    return result
