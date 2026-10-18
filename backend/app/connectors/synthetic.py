"""Built-in synthetic demo feeds for the fictional NovaMart company.

These feeds are generated locally (no external system). They are labelled as synthetic everywhere and
flow through exactly the same validation, normalization and loading pipeline as customer data.

Each demo integration serves one "feed" (pos, erp, accounting, hris, marketing). The feed can be viewed
"as of" a date, so the seed can demonstrate an initial load followed by an incremental sync with a
lookback window (overlapping records are detected as unchanged; late status changes as updates).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from app.connectors.base import BaseConnector, Batch, ConnectorConfigurationError, ProviderSpec, TestResult
from app.core.config import get_settings
from app.pipeline.entities import ENTITIES
from app.seed.novamart_generator import NovaMartConfig, cached_generate

FEEDS: dict[str, tuple[str, ...]] = {
    "pos": ("sales", "traffic", "customer_metric"),
    "erp": ("store", "category", "supplier", "product", "department", "purchase_order", "purchase_order_line",
            "inventory_movement", "inventory_snapshot", "budget"),
    "accounting": ("expense", "cash_flow", "cash_balance"),
    "hris": ("workforce",),
    "marketing": ("marketing_spend",),
}
BATCH_ROWS = 150_000


def demo_config(config: dict[str, Any]) -> NovaMartConfig:
    settings = get_settings()
    base = NovaMartConfig(seed=int(config.get("seed", settings.demo_seed)),
                          end=date.fromisoformat(config.get("end", settings.demo_end_date)))
    if config.get("small"):
        from app.seed.novamart_generator import small_config

        base = small_config(seed=base.seed)
    return base


class SyntheticDemoConnector(BaseConnector):
    spec = ProviderSpec(
        key="novamart_synthetic",
        name="NovaMart synthetic demo feed",
        categories=("pos", "erp", "accounting", "workforce", "marketing"),
        methods=("synthetic",),
        summary="Built-in generator for the fictional NovaMart retailer. Synthetic data only - not an external system.",
        availability="available",
        supported_entities=tuple(e for feed in FEEDS.values() for e in feed),
        is_demo=True,
    )

    def _feed(self) -> str:
        feed = self.config.get("feed")
        if feed not in FEEDS:
            raise ConnectorConfigurationError("Demo integration has no valid 'feed' configured")
        return feed

    def entities_for_sync(self) -> list[str]:
        return list(FEEDS[self._feed()])

    def test_connection(self) -> TestResult:
        feed = self._feed()
        data = cached_generate(demo_config(self.config))
        rows = sum(len(data.frames[e]) for e in FEEDS[feed])
        return TestResult(True, "connected",
                          f"Built-in synthetic '{feed}' feed is available ({rows:,} records). Not an external system.",
                          checks=[{"name": "generator", "ok": True, "records": rows}])

    def _as_of(self) -> date:
        cfg = demo_config(self.config)
        as_of = self.config.get("as_of")
        return min(date.fromisoformat(as_of), cfg.end) if as_of else cfg.end

    def fetch(self, entity: str, cursor: dict[str, Any] | None) -> Iterator[Batch]:
        if entity not in FEEDS[self._feed()]:
            return
        data = cached_generate(demo_config(self.config))
        frame = data.frames[entity]
        spec = ENTITIES[entity]
        as_of = self._as_of()
        as_of_ts = pd.Timestamp(as_of)
        lookback = int(self.config.get("lookback_days", 3))
        since = None
        if cursor and cursor.get("through"):
            since = pd.Timestamp(date.fromisoformat(cursor["through"]) - timedelta(days=lookback))

        if entity in ("purchase_order", "purchase_order_line"):
            frame = self._purchase_view(data, entity, as_of_ts, since)
        elif frame.empty or (spec.date_field and spec.date_field not in frame.columns):
            frame = frame.iloc[0:0]
        elif spec.date_field:
            dates = frame[spec.date_field]
            mask = dates <= as_of_ts
            if since is not None:
                mask &= dates > since
            frame = frame.loc[mask]
        for start in range(0, len(frame), BATCH_ROWS):
            yield Batch(entity=entity, frame=frame.iloc[start:start + BATCH_ROWS].copy(),
                        cursor_after={"through": as_of.isoformat()})
        if frame.empty:
            yield Batch(entity=entity, frame=frame.copy(), cursor_after={"through": as_of.isoformat()})

    @staticmethod
    def _purchase_view(data: Any, entity: str, as_of: pd.Timestamp, since: pd.Timestamp | None) -> pd.DataFrame:
        """POs as the ERP would report them on ``as_of``: not-yet-received orders are still open."""
        po = data.frames["purchase_order"]
        po = po.loc[po["order_date"] <= as_of].copy()
        late = po["received_date"].notna() & (po["received_date"] > as_of)
        po.loc[late, "status"] = "open"
        po.loc[late, "received_date"] = pd.NaT
        if since is not None:
            changed = (po["order_date"] > since) | (po["received_date"].notna() & (po["received_date"] > since))
            po = po.loc[changed]
        if entity == "purchase_order":
            return po
        lines = data.frames["purchase_order_line"]
        lines = lines.loc[lines["po_number"].isin(po["po_number"])].copy()
        open_numbers = set(po.loc[po["status"] == "open", "po_number"])
        lines.loc[lines["po_number"].isin(open_numbers), "quantity_received"] = np.nan
        return lines
