from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk
from app.models.mixins import OrgScoped

INTEGRATION_STATUSES = (
    "draft",                  # created, not yet configured
    "awaiting_credentials",   # vendor/customer authorization or credentials still required
    "configured",             # credentials stored but never successfully tested
    "connected",              # last connection test succeeded (the only state shown as live)
    "error",                  # last test or sync failed
    "disabled",
)

SYNC_STATUSES = ("queued", "running", "succeeded", "partially_succeeded", "failed", "cancelled")


class Integration(UUIDPk, Timestamps, OrgScoped, Base):
    __tablename__ = "integrations"

    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    provider_key: Mapped[str] = mapped_column(String(60), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="draft", nullable=False)
    status_detail: Mapped[str | None] = mapped_column(Text)
    auth_type: Mapped[str] = mapped_column(String(30), default="none", nullable=False)
    # Non-secret configuration (base URL, field mappings, entity selection, schedule...)
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # Fernet-encrypted JSON of credentials. Never serialized to API responses.
    secret_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    secret_fingerprint: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    webhook_secret_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    sync_cursor: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    schedule_minutes: Mapped[int | None] = mapped_column(Integer)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_test_result: Mapped[dict | None] = mapped_column(JSONB)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_successful_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("status IN (" + ", ".join(f"'{s}'" for s in INTEGRATION_STATUSES) + ")", name="status_valid"),
        UniqueConstraint("org_id", "display_name"),
    )


class SyncJob(UUIDPk, OrgScoped, Base):
    __tablename__ = "sync_jobs"

    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trigger: Mapped[str] = mapped_column(String(20), nullable=False)  # manual | schedule | webhook | upload | seed
    entity_types: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="queued", nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    retry_of_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("sync_jobs.id", ondelete="SET NULL"))
    uploaded_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("uploaded_files.id", ondelete="SET NULL")
    )
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    records_received: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    records_inserted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    records_updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    records_unchanged: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    records_rejected: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cursor_start: Mapped[dict | None] = mapped_column(JSONB)
    cursor_end: Mapped[dict | None] = mapped_column(JSONB)
    stats: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("status IN (" + ", ".join(f"'{s}'" for s in SYNC_STATUSES) + ")", name="status_valid"),
        Index("ix_sync_jobs_integration_queued", "integration_id", "queued_at"),
    )


class SyncError(OrgScoped, Base):
    __tablename__ = "sync_errors"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sync_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sync_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entity_type: Mapped[str | None] = mapped_column(String(40))
    source_record_id: Mapped[str | None] = mapped_column(String(255))
    row_number: Mapped[int | None] = mapped_column(Integer)
    field: Mapped[str | None] = mapped_column(String(120))
    error_code: Mapped[str] = mapped_column(String(60), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(10), default="error", nullable=False)  # error | warning
    raw_excerpt: Mapped[dict | None] = mapped_column(JSONB)  # redacted, truncated
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class UploadedFile(UUIDPk, OrgScoped, Base):
    __tablename__ = "uploaded_files"

    integration_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="CASCADE"), index=True
    )
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # The same file content imported twice into the same integration/entity is rejected up-front.
    __table_args__ = (UniqueConstraint("integration_id", "entity_type", "sha256"),)


class SourceRecord(OrgScoped, Base):
    """Identity map for dimension records (stores, products, categories, suppliers, departments).

    Different systems use different identifiers for the same real-world entity (POS store code "S01",
    ERP site "1001"). Each (integration, entity_type, source id) maps to exactly one canonical AUREX id.
    """

    __tablename__ = "source_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_record_id: Mapped[str] = mapped_column(String(255), nullable=False)
    canonical_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    first_seen_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    last_seen_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("integration_id", "entity_type", "source_record_id"),)


class EntityAuthority(UUIDPk, OrgScoped, Base):
    """System-of-record rule: which integration is authoritative for a fact type within a company.

    When two systems both report the same facts (e.g. POS and ERP both send daily sales), analytics
    only count rows from the authoritative integration, preventing double counting. If no rule
    exists and only one integration supplies the fact type, that integration is used.
    """

    __tablename__ = "entity_authorities"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    fact_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # Optional store-level rule (e.g. two POS systems after an acquisition); NULL = company-wide rule.
    store_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("stores.id", ondelete="CASCADE"))
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))

    __table_args__ = (
        Index("uq_entity_authorities_scope", "company_id", "fact_type", "store_id", unique=True,
              postgresql_nulls_not_distinct=True),
    )


class WebhookEvent(OrgScoped, Base):
    __tablename__ = "webhook_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    event_id: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str | None] = mapped_column(String(80))
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="received", nullable=False)
    sync_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("sync_jobs.id", ondelete="SET NULL"))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Idempotency: a provider event id is processed at most once.
    __table_args__ = (UniqueConstraint("integration_id", "event_id"),)
