"""Derived aggregates with system-of-record resolution (no double counting across sources).

For every (store, business_date) exactly ONE integration's sales rows are counted:
  1. a store-level authority rule, else
  2. a company-level authority rule, else
  3. the earliest-created integration that supplied data for that store-day.
``overlapping_sources`` records how many integrations reported that store-day so overlaps are visible
in data-quality views instead of silently inflating revenue.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

_CHOOSE = """
    SELECT c.store_id, c.business_date, c.integration_id, c.n_sources FROM (
        SELECT x.store_id, x.business_date, x.integration_id,
               count(*) OVER (PARTITION BY x.store_id, x.business_date) AS n_sources,
               row_number() OVER (
                   PARTITION BY x.store_id, x.business_date
                   ORDER BY (x.integration_id = ea_s.integration_id) DESC NULLS LAST,
                            (x.integration_id = ea_c.integration_id) DESC NULLS LAST,
                            i.created_at, x.integration_id
               ) AS rnk
        FROM (SELECT DISTINCT store_id, business_date, integration_id FROM {table}
              WHERE company_id = :company AND business_date BETWEEN :start AND :end) x
        JOIN integrations i ON i.id = x.integration_id
        LEFT JOIN entity_authorities ea_s ON ea_s.company_id = :company AND ea_s.fact_type = '{fact}'
             AND ea_s.store_id = x.store_id
        LEFT JOIN entity_authorities ea_c ON ea_c.company_id = :company AND ea_c.fact_type = '{fact}'
             AND ea_c.store_id IS NULL
    ) c WHERE c.rnk = 1
"""


def refresh_store_daily(db: Session, company_id: uuid.UUID, start: date, end: date) -> int:
    params = {"company": company_id, "start": start, "end": end}
    db.execute(text("DELETE FROM agg_store_daily WHERE company_id = :company AND business_date BETWEEN :start AND :end"),
               params)
    sql = f"""
        WITH chosen_sales AS MATERIALIZED ({_CHOOSE.format(table='sales_records', fact='sales')}),
             chosen_traffic AS MATERIALIZED ({_CHOOSE.format(table='store_traffic', fact='traffic')}),
             sales AS MATERIALIZED (
                SELECT s.org_id, s.company_id, s.store_id, s.business_date, ch.integration_id, ch.n_sources,
                       sum(s.gross_amount) AS gross, sum(s.discount_amount) AS discount,
                       sum(s.refund_amount) AS refund, sum(s.net_amount) AS net,
                       sum(s.cost_amount) AS cost,
                       sum(CASE WHEN s.cost_amount IS NOT NULL THEN s.net_amount ELSE 0 END) AS covered,
                       sum(s.quantity) AS qty, count(*) AS lines
                FROM sales_records s
                JOIN chosen_sales ch ON ch.store_id = s.store_id AND ch.business_date = s.business_date
                     AND ch.integration_id = s.integration_id
                WHERE s.company_id = :company AND s.business_date BETWEEN :start AND :end
                GROUP BY s.org_id, s.company_id, s.store_id, s.business_date, ch.integration_id, ch.n_sources
             ),
             traffic AS MATERIALIZED (
                SELECT t.store_id, t.business_date, ch.integration_id, sum(t.transaction_count) AS txn
                FROM store_traffic t
                JOIN chosen_traffic ch ON ch.store_id = t.store_id AND ch.business_date = t.business_date
                     AND ch.integration_id = t.integration_id
                WHERE t.company_id = :company AND t.business_date BETWEEN :start AND :end
                GROUP BY t.store_id, t.business_date, ch.integration_id
             )
        INSERT INTO agg_store_daily (org_id, company_id, store_id, business_date, sales_integration_id,
                                     traffic_integration_id, gross_amount, discount_amount, refund_amount, net_amount,
                                     cost_amount, cost_covered_net_amount, quantity, line_count, transaction_count,
                                     overlapping_sources, refreshed_at)
        SELECT s.org_id, s.company_id, s.store_id, s.business_date, s.integration_id, t.integration_id, s.gross,
               s.discount, s.refund, s.net, s.cost, s.covered, s.qty, s.lines, t.txn, s.n_sources, now()
        FROM sales s LEFT JOIN traffic t ON t.store_id = s.store_id AND t.business_date = s.business_date
    """
    result = db.execute(text(sql), params)
    return result.rowcount or 0


def refresh_all_store_daily(db: Session, company_id: uuid.UUID) -> int:
    bounds = db.execute(text("SELECT min(business_date), max(business_date) FROM sales_records WHERE company_id = :c"),
                        {"c": company_id}).one()
    if bounds[0] is None:
        db.execute(text("DELETE FROM agg_store_daily WHERE company_id = :c"), {"c": company_id})
        return 0
    return refresh_store_daily(db, company_id, bounds[0], bounds[1])
