"""Reusable column groups.

``OrgScoped`` / ``CompanyScoped`` put the tenant key on every confidential table; all repository
queries filter on ``org_id`` (see ``app.api.deps.OrgContext``).

``Provenance`` is carried by every normalized fact row: which integration produced it, the source
system's own identifier, the sync job, and a content hash used for idempotent upserts. The unique
constraint ``(integration_id, source_record_id)`` on each fact table is what makes re-imports and
overlapping incremental syncs safe (no duplicate rows).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


class OrgScoped:
    @declared_attr
    def org_id(cls) -> Mapped[uuid.UUID]:  # noqa: N805
        return mapped_column(
            UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
        )


class CompanyScoped(OrgScoped):
    @declared_attr
    def company_id(cls) -> Mapped[uuid.UUID]:  # noqa: N805
        return mapped_column(
            UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
        )


class Provenance:
    @declared_attr
    def integration_id(cls) -> Mapped[uuid.UUID]:  # noqa: N805
        return mapped_column(
            UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="RESTRICT"), nullable=False
        )

    @declared_attr
    def sync_job_id(cls) -> Mapped[uuid.UUID | None]:  # noqa: N805
        return mapped_column(UUID(as_uuid=True), ForeignKey("sync_jobs.id", ondelete="SET NULL"), nullable=True)

    source_system: Mapped[str] = mapped_column(String(64), nullable=False)
    source_record_id: Mapped[str] = mapped_column(String(255), nullable=False)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
