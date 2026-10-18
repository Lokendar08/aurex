"""Report generation and download."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession, OrgContext, require
from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.core.permissions import Permission
from app.models import Report
from app.services.audit import record_audit
from app.services.reports.service import REPORT_TYPES, validate_request
from app.worker.dispatcher import enqueue

router = APIRouter(tags=["reports"])
P = Permission
MEDIA = {"pdf": "application/pdf", "csv": "text/csv",
         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


def report_out(r: Report) -> dict[str, Any]:
    return {"id": str(r.id), "report_type": r.report_type, "format": r.format, "title": r.title, "status": r.status,
            "parameters": r.parameters, "file_size": r.file_size, "sha256": r.sha256, "error": r.error,
            "created_by": str(r.created_by) if r.created_by else None, "created_at": r.created_at.isoformat(),
            "completed_at": r.completed_at.isoformat() if r.completed_at else None}


class ReportIn(BaseModel):
    report_type: str = Field(max_length=40)
    format: str = Field(default="pdf", max_length=10)
    title: str | None = Field(default=None, max_length=300)
    parameters: dict[str, Any] = Field(default_factory=dict)


@router.get("/orgs/{org_id}/reports")
def list_reports(ctx: Annotated[OrgContext, Depends(require(P.REPORTS_READ))], db: DbSession) -> dict:
    rows = db.scalars(select(Report).where(Report.org_id == ctx.org_id).order_by(Report.created_at.desc()).limit(100)).all()
    visible = [r for r in rows if _can_download(ctx, r)]
    return {"types": [{"key": k, "title": v["title"], "permission": v["permission"].value,
                       "allowed": ctx.has(P.REPORTS_GENERATE) and ctx.has(v["permission"])} for k, v in REPORT_TYPES.items()],
            "formats": ["pdf", "csv", "xlsx"], "reports": [report_out(r) for r in visible]}


@router.post("/orgs/{org_id}/reports", status_code=status.HTTP_202_ACCEPTED)
def create_report(body: ReportIn, ctx: Annotated[OrgContext, Depends(require(P.REPORTS_GENERATE))], db: DbSession,
                  request: Request) -> dict:
    spec = validate_request(ctx, body.report_type, body.format)
    company = ctx.default_company(db, uuid.UUID(body.parameters["company_id"]) if body.parameters.get("company_id") else None)
    report = Report(org_id=ctx.org_id, company_id=company.id, report_type=body.report_type, format=body.format,
                    title=body.title or f"{spec['title']} - {company.name}", parameters=body.parameters,
                    created_by=ctx.user.id)
    db.add(report)
    db.flush()
    enqueue(db, "generate_report", {"report_id": str(report.id)}, org_id=ctx.org_id, user_id=ctx.user.id)
    record_audit(db, action="report.requested", org_id=ctx.org_id, actor=ctx.user, entity_type="report",
                 entity_id=report.id, request=request, details={"type": body.report_type, "format": body.format})
    return report_out(report)


def _can_download(ctx: OrgContext, r: Report) -> bool:
    if r.created_by == ctx.user.id:
        return True
    spec = REPORT_TYPES.get(r.report_type)
    # Reports are built with their requester's scope; other members need company-wide access to that data.
    return bool(spec) and ctx.has(spec["permission"]) and ctx.store_scope is None


@router.get("/orgs/{org_id}/reports/{report_id}")
def get_report(report_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.REPORTS_READ))], db: DbSession) -> dict:
    report = ctx.scoped_get(db, Report, report_id, "Report")
    if not _can_download(ctx, report):
        raise NotFoundError("Report not found")
    return report_out(report)


@router.get("/orgs/{org_id}/reports/{report_id}/download")
def download(report_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.REPORTS_READ))], db: DbSession,
             request: Request) -> FileResponse:
    report = ctx.scoped_get(db, Report, report_id, "Report")
    if not _can_download(ctx, report):
        raise PermissionDeniedError("You do not have access to this report")
    if report.status != "completed" or not report.file_path or not Path(report.file_path).exists():
        raise ConflictError("The report is not ready", details={"status": report.status})
    record_audit(db, action="report.downloaded", org_id=ctx.org_id, actor=ctx.user, entity_type="report",
                 entity_id=report.id, request=request)
    safe = "".join(ch if ch.isalnum() or ch in "-_ " else "_" for ch in report.title)[:80].strip() or "report"
    return FileResponse(report.file_path, media_type=MEDIA[report.format], filename=f"{safe}.{report.format}",
                        headers={"X-Content-SHA256": report.sha256 or ""})


@router.delete("/orgs/{org_id}/reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(report_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.REPORTS_GENERATE))], db: DbSession,
                  request: Request) -> Response:
    report = ctx.scoped_get(db, Report, report_id, "Report")
    if report.created_by != ctx.user.id and not ctx.has(P.ORG_MANAGE):
        raise PermissionDeniedError("Only the requester or an owner can delete this report")
    if report.file_path:
        Path(report.file_path).unlink(missing_ok=True)
    record_audit(db, action="report.deleted", org_id=ctx.org_id, actor=ctx.user, entity_type="report",
                 entity_id=report.id, request=request)
    db.delete(report)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
