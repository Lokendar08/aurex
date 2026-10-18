"""unique constraints treat a NULL org_id (platform-wide reference rows) as equal

Platform-wide companies, news sources and articles have org_id NULL. A plain UNIQUE (org_id, ...) considers NULLs
distinct, so duplicate platform-wide rows were possible. NULLS NOT DISTINCT (PostgreSQL 15+) closes that gap.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-19 00:30:00
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINTS = (
    ("market_entities", "uq_market_entities_org_id_key", ["org_id", "key"]),
    ("news_sources", "uq_news_sources_org_id_url", ["org_id", "url"]),
    ("news_articles", "uq_news_articles_org_id_url_hash", ["org_id", "url_hash"]),
)


def upgrade() -> None:
    for table, name, columns in CONSTRAINTS:
        op.drop_constraint(name, table, type_="unique")
        op.create_unique_constraint(name, table, columns, postgresql_nulls_not_distinct=True)


def downgrade() -> None:
    for table, name, columns in CONSTRAINTS:
        op.drop_constraint(name, table, type_="unique")
        op.create_unique_constraint(name, table, columns)
