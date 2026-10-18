"""Organizations, members, invitations, companies, stores, departments, fiscal periods and audit trail."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, OrgContext, OrgCtx, require
from app.core.config import get_settings
from app.core.errors import ConflictError, PermissionDeniedError, ValidationAppError
from app.core.permissions import (
    MEMBERSHIP_ROLES,
    ROLE_INFO,
    ROLE_PERMISSIONS,
    Permission,
    Role,
    assignable_roles,
)
from app.core.security import generate_token, hash_token
from app.models import (
    AuditEvent,
    Company,
    Department,
    FinancialPeriod,
    Invitation,
    Membership,
    Organization,
    Store,
    User,
)
from app.schemas.common import Code, CountryCode, CurrencyCode, ShortText
from app.services import auth as auth_service
from app.services.audit import record_audit
from app.services.periods import ensure_financial_periods

router = APIRouter(tags=["organizations"])
P = Permission


# ---------------------------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------------------------


def org_out(org: Organization) -> dict:
    return {"id": str(org.id), "name": org.name, "slug": org.slug, "industry": org.industry, "country": org.country,
            "base_currency": org.base_currency, "timezone": org.timezone, "is_demo": org.is_demo,
            "status": org.status, "created_at": org.created_at.isoformat() if org.created_at else None}


def company_out(c: Company) -> dict:
    return {"id": str(c.id), "name": c.name, "legal_name": c.legal_name, "base_currency": c.base_currency,
            "fiscal_year_start_month": c.fiscal_year_start_month, "country": c.country, "industry": c.industry,
            "description": c.description, "is_synthetic": c.is_synthetic}


def store_out(s: Store) -> dict:
    return {"id": str(s.id), "company_id": str(s.company_id), "code": s.code, "name": s.name, "city": s.city,
            "region": s.region, "format": s.format, "opened_on": s.opened_on.isoformat() if s.opened_on else None,
            "closed_on": s.closed_on.isoformat() if s.closed_on else None,
            "selling_area_sqft": float(s.selling_area_sqft) if s.selling_area_sqft is not None else None,
            "status": s.status}


def department_out(d: Department) -> dict:
    return {"id": str(d.id), "company_id": str(d.company_id), "store_id": str(d.store_id) if d.store_id else None,
            "code": d.code, "name": d.name, "function": d.function}


# ---------------------------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------------------------


class OrgCreateIn(BaseModel):
    name: ShortText
    industry: str | None = Field(default=None, max_length=120)
    country: CountryCode | None = None
    base_currency: CurrencyCode = "INR"
    fiscal_year_start_month: int = Field(default=4, ge=1, le=12)


class OrgUpdateIn(BaseModel):
    name: ShortText | None = None
    industry: str | None = Field(default=None, max_length=120)
    country: CountryCode | None = None
    timezone: str | None = Field(default=None, max_length=64)


@router.get("/orgs")
def list_my_orgs(user: CurrentUser, db: DbSession) -> dict:
    return {"memberships": auth_service.session_info(db, user)["memberships"]}


@router.post("/orgs", status_code=status.HTTP_201_CREATED)
def create_org(body: OrgCreateIn, user: CurrentUser, request: Request, db: DbSession) -> dict:
    if user.is_demo:
        raise PermissionDeniedError("Demo accounts cannot create organizations")
    org = Organization(name=body.name, slug=auth_service.unique_slug(db, body.name), industry=body.industry,
                       country=body.country, base_currency=body.base_currency, created_by=user.id)
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=user.id, role=Role.ORG_OWNER.value))
    company = Company(org_id=org.id, name=body.name, base_currency=body.base_currency, country=body.country,
                      fiscal_year_start_month=body.fiscal_year_start_month, industry=body.industry)
    db.add(company)
    db.flush()
    ensure_financial_periods(db, company, date.today().year - 3, date.today().year + 2)
    record_audit(db, action="organization.created", org_id=org.id, actor=user, entity_type="organization",
                 entity_id=org.id, request=request, details={"name": org.name})
    db.flush()
    return org_out(org)


@router.get("/orgs/{org_id}")
def get_org(ctx: OrgCtx, db: DbSession) -> dict:
    member_count = db.scalar(select(func.count()).select_from(Membership).where(Membership.org_id == ctx.org_id))
    company_count = db.scalar(select(func.count()).select_from(Company).where(Company.org_id == ctx.org_id))
    return {**org_out(ctx.org), "member_count": member_count, "company_count": company_count,
            "my_role": ctx.role.value, "my_role_label": ctx.role_label,
            "my_permissions": sorted(p.value for p in ctx.permissions),
            "my_store_scope": [str(s) for s in ctx.store_scope] if ctx.store_scope else None}


@router.patch("/orgs/{org_id}")
def update_org(body: OrgUpdateIn, ctx: Annotated[OrgContext, Depends(require(P.ORG_MANAGE))], db: DbSession,
               request: Request) -> dict:
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(ctx.org, key, value)
    record_audit(db, action="organization.updated", org_id=ctx.org_id, actor=ctx.user, entity_type="organization",
                 entity_id=ctx.org_id, request=request, details=changes)
    return org_out(ctx.org)


@router.get("/orgs/{org_id}/roles")
def list_roles(ctx: OrgCtx) -> dict:
    return {
        "roles": [
            {"role": r.value, "label": ROLE_INFO[r].label, "description": ROLE_INFO[r].description,
             "workspace_path": ROLE_INFO[r].workspace_path, "store_scoped_by_default": ROLE_INFO[r].store_scoped_by_default,
             "permissions": sorted(p.value for p in ROLE_PERMISSIONS[r])}
            for r in MEMBERSHIP_ROLES
        ],
        "assignable_by_me": [r.value for r in assignable_roles(ctx.role)] if ctx.has(P.MEMBERS_MANAGE) else [],
        "all_permissions": [p.value for p in Permission if p is not P.PLATFORM_ADMIN],
    }


# ---------------------------------------------------------------------------------------------
# Members & invitations
# ---------------------------------------------------------------------------------------------


class MemberUpdateIn(BaseModel):
    role: str | None = None
    store_scope: list[uuid.UUID] | None = None
    clear_store_scope: bool = False
    status: str | None = Field(default=None, pattern="^(active|suspended)$")


class InvitationIn(BaseModel):
    email: EmailStr
    role: str
    store_scope: list[uuid.UUID] | None = None


def _validate_role(ctx: OrgContext, role: str) -> Role:
    try:
        parsed = Role(role)
    except ValueError as exc:
        raise ValidationAppError("Unknown role", details={"role": role}) from exc
    if parsed not in MEMBERSHIP_ROLES:
        raise ValidationAppError("This role cannot be assigned within an organization")
    if parsed not in assignable_roles(ctx.role):
        raise PermissionDeniedError("Only organization owners can grant the owner role")
    return parsed


def _validate_store_scope(ctx: OrgContext, db: DbSession, store_ids: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
    if not store_ids:
        return None
    found = set(db.scalars(select(Store.id).where(Store.org_id == ctx.org_id, Store.id.in_(store_ids))))
    missing = [str(s) for s in store_ids if s not in found]
    if missing:
        raise ValidationAppError("Unknown store ids in scope", details={"store_ids": missing})
    return list(dict.fromkeys(store_ids))


def _owner_count(db: DbSession, org_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).select_from(Membership).where(
        Membership.org_id == org_id, Membership.role == Role.ORG_OWNER.value, Membership.status == "active")) or 0


@router.get("/orgs/{org_id}/members")
def list_members(ctx: Annotated[OrgContext, Depends(require(P.MEMBERS_READ))], db: DbSession) -> dict:
    rows = db.execute(select(Membership, User).join(User, User.id == Membership.user_id)
                      .where(Membership.org_id == ctx.org_id).order_by(User.full_name)).all()
    return {"members": [
        {"id": str(m.id), "user_id": str(u.id), "email": u.email, "full_name": u.full_name, "role": m.role,
         "role_label": ROLE_INFO[Role(m.role)].label, "status": m.status,
         "store_scope": [str(s) for s in m.store_scope] if m.store_scope else None,
         "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
         "joined_at": m.created_at.isoformat() if m.created_at else None, "is_me": u.id == ctx.user.id}
        for m, u in rows
    ]}


@router.patch("/orgs/{org_id}/members/{membership_id}")
def update_member(membership_id: uuid.UUID, body: MemberUpdateIn,
                  ctx: Annotated[OrgContext, Depends(require(P.MEMBERS_MANAGE))], db: DbSession,
                  request: Request) -> dict:
    member = ctx.scoped_get(db, Membership, membership_id, "Member")
    changes: dict = {}
    demoting_owner = member.role == Role.ORG_OWNER.value and (
        (body.role and body.role != Role.ORG_OWNER.value) or body.status == "suspended")
    if member.role == Role.ORG_OWNER.value and ctx.role is not Role.ORG_OWNER:
        raise PermissionDeniedError("Only owners can change another owner's membership")
    if demoting_owner and _owner_count(db, ctx.org_id) <= 1:
        raise ConflictError("An organization must keep at least one active owner", code="last_owner")
    if body.role:
        member.role = _validate_role(ctx, body.role).value
        changes["role"] = member.role
    if body.clear_store_scope:
        member.store_scope = None
        changes["store_scope"] = None
    elif body.store_scope is not None:
        member.store_scope = _validate_store_scope(ctx, db, body.store_scope)
        changes["store_scope"] = [str(s) for s in member.store_scope] if member.store_scope else None
    if body.status:
        member.status = body.status
        changes["status"] = body.status
        if body.status == "suspended":
            auth_service.revoke_all_sessions(db, member.user_id, "membership_suspended")
    record_audit(db, action="member.updated", org_id=ctx.org_id, actor=ctx.user, entity_type="membership",
                 entity_id=member.id, request=request, details=changes)
    return {"id": str(member.id), **changes}


@router.delete("/orgs/{org_id}/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(membership_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.MEMBERS_MANAGE))],
                  db: DbSession, request: Request) -> Response:
    member = ctx.scoped_get(db, Membership, membership_id, "Member")
    if member.role == Role.ORG_OWNER.value:
        if ctx.role is not Role.ORG_OWNER:
            raise PermissionDeniedError("Only owners can remove an owner")
        if _owner_count(db, ctx.org_id) <= 1:
            raise ConflictError("An organization must keep at least one active owner", code="last_owner")
    record_audit(db, action="member.removed", org_id=ctx.org_id, actor=ctx.user, entity_type="membership",
                 entity_id=member.id, request=request, details={"user_id": str(member.user_id), "role": member.role})
    db.delete(member)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/orgs/{org_id}/invitations")
def list_invitations(ctx: Annotated[OrgContext, Depends(require(P.MEMBERS_MANAGE))], db: DbSession) -> dict:
    rows = db.scalars(select(Invitation).where(Invitation.org_id == ctx.org_id).order_by(Invitation.created_at.desc()))
    now = datetime.now(UTC)
    return {"invitations": [
        {"id": str(i.id), "email": i.email, "role": i.role, "role_label": ROLE_INFO[Role(i.role)].label,
         "store_scope": [str(s) for s in i.store_scope] if i.store_scope else None,
         "expires_at": i.expires_at.isoformat(),
         "status": "accepted" if i.accepted_at else "revoked" if i.revoked_at else
         "expired" if i.expires_at <= now else "pending",
         "created_at": i.created_at.isoformat() if i.created_at else None}
        for i in rows
    ]}


@router.post("/orgs/{org_id}/invitations", status_code=status.HTTP_201_CREATED)
def create_invitation(body: InvitationIn, ctx: Annotated[OrgContext, Depends(require(P.MEMBERS_MANAGE))],
                      db: DbSession, request: Request) -> dict:
    role = _validate_role(ctx, body.role)
    email = auth_service.normalize_email(body.email)
    existing_member = db.scalar(select(Membership.id).join(User, User.id == Membership.user_id)
                                .where(Membership.org_id == ctx.org_id, User.email == email))
    if existing_member:
        raise ConflictError("This person is already a member", code="already_member")
    token = generate_token(32)
    invitation = Invitation(org_id=ctx.org_id, email=email, role=role.value,
                            store_scope=_validate_store_scope(ctx, db, body.store_scope), token_hash=hash_token(token),
                            invited_by=ctx.user.id,
                            expires_at=datetime.now(UTC) + timedelta(days=get_settings().invitation_ttl_days))
    db.add(invitation)
    db.flush()
    record_audit(db, action="member.invited", org_id=ctx.org_id, actor=ctx.user, entity_type="invitation",
                 entity_id=invitation.id, request=request, details={"email": email, "role": role.value})
    # The raw token is returned exactly once so the inviter can share the link. No e-mail provider is
    # configured by default; see docs/DEPLOYMENT.md for SMTP setup.
    return {"id": str(invitation.id), "email": email, "role": role.value, "token": token,
            "invite_path": f"/sign-up?invite={token}", "expires_at": invitation.expires_at.isoformat()}


@router.delete("/orgs/{org_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(invitation_id: uuid.UUID, ctx: Annotated[OrgContext, Depends(require(P.MEMBERS_MANAGE))],
                      db: DbSession, request: Request) -> Response:
    invitation = ctx.scoped_get(db, Invitation, invitation_id, "Invitation")
    invitation.revoked_at = datetime.now(UTC)
    record_audit(db, action="member.invitation_revoked", org_id=ctx.org_id, actor=ctx.user, entity_type="invitation",
                 entity_id=invitation.id, request=request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------------------------
# Companies, stores, departments, periods
# ---------------------------------------------------------------------------------------------


class CompanyIn(BaseModel):
    name: ShortText
    legal_name: str | None = Field(default=None, max_length=250)
    base_currency: CurrencyCode
    fiscal_year_start_month: int = Field(default=4, ge=1, le=12)
    country: CountryCode | None = None
    industry: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=4000)


class CompanyUpdateIn(BaseModel):
    name: ShortText | None = None
    legal_name: str | None = Field(default=None, max_length=250)
    country: CountryCode | None = None
    industry: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=4000)


class StoreIn(BaseModel):
    company_id: uuid.UUID
    code: Code
    name: ShortText
    city: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    format: str | None = Field(default=None, max_length=60)
    opened_on: date | None = None
    selling_area_sqft: float | None = Field(default=None, gt=0, lt=10_000_000)
    status: str = Field(default="active", pattern="^(planned|active|closed)$")


class StoreUpdateIn(BaseModel):
    name: ShortText | None = None
    city: str | None = Field(default=None, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    format: str | None = Field(default=None, max_length=60)
    opened_on: date | None = None
    closed_on: date | None = None
    selling_area_sqft: float | None = Field(default=None, gt=0, lt=10_000_000)
    status: str | None = Field(default=None, pattern="^(planned|active|closed)$")


class DepartmentIn(BaseModel):
    company_id: uuid.UUID
    store_id: uuid.UUID | None = None
    code: Code
    name: ShortText
    function: str | None = Field(default=None, max_length=60)


@router.get("/orgs/{org_id}/companies")
def list_companies(ctx: OrgCtx, db: DbSession) -> dict:
    rows = db.scalars(select(Company).where(Company.org_id == ctx.org_id).order_by(Company.name))
    return {"companies": [company_out(c) for c in rows]}


@router.post("/orgs/{org_id}/companies", status_code=status.HTTP_201_CREATED)
def create_company(body: CompanyIn, ctx: Annotated[OrgContext, Depends(require(P.ORG_MANAGE))], db: DbSession,
                   request: Request) -> dict:
    if db.scalar(select(Company.id).where(Company.org_id == ctx.org_id, Company.name == body.name)):
        raise ConflictError("A company with this name already exists")
    company = Company(org_id=ctx.org_id, **body.model_dump())
    db.add(company)
    db.flush()
    ensure_financial_periods(db, company, date.today().year - 3, date.today().year + 2)
    record_audit(db, action="company.created", org_id=ctx.org_id, actor=ctx.user, entity_type="company",
                 entity_id=company.id, request=request, details={"name": company.name})
    return company_out(company)


@router.patch("/orgs/{org_id}/companies/{company_id}")
def update_company(company_id: uuid.UUID, body: CompanyUpdateIn,
                   ctx: Annotated[OrgContext, Depends(require(P.ORG_MANAGE))], db: DbSession, request: Request) -> dict:
    company = ctx.get_company(db, company_id)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(company, key, value)
    record_audit(db, action="company.updated", org_id=ctx.org_id, actor=ctx.user, entity_type="company",
                 entity_id=company.id, request=request, details=changes)
    return company_out(company)


@router.get("/orgs/{org_id}/stores")
def list_stores(ctx: OrgCtx, db: DbSession, company_id: uuid.UUID | None = None) -> dict:
    query = select(Store).where(Store.org_id == ctx.org_id)
    if company_id:
        query = query.where(Store.company_id == company_id)
    if ctx.store_scope is not None:
        query = query.where(Store.id.in_(ctx.store_scope))
    rows = db.scalars(query.order_by(Store.code))
    return {"stores": [store_out(s) for s in rows], "scoped": ctx.store_scope is not None}


@router.post("/orgs/{org_id}/stores", status_code=status.HTTP_201_CREATED)
def create_store(body: StoreIn, ctx: Annotated[OrgContext, Depends(require(P.ORG_MANAGE))], db: DbSession,
                 request: Request) -> dict:
    ctx.get_company(db, body.company_id)
    if db.scalar(select(Store.id).where(Store.company_id == body.company_id, Store.code == body.code)):
        raise ConflictError("A store with this code already exists in the company")
    store = Store(org_id=ctx.org_id, **body.model_dump())
    db.add(store)
    db.flush()
    record_audit(db, action="store.created", org_id=ctx.org_id, actor=ctx.user, entity_type="store",
                 entity_id=store.id, request=request, details={"code": store.code, "name": store.name})
    return store_out(store)


@router.patch("/orgs/{org_id}/stores/{store_id}")
def update_store(store_id: uuid.UUID, body: StoreUpdateIn, ctx: Annotated[OrgContext, Depends(require(P.ORG_MANAGE))],
                 db: DbSession, request: Request) -> dict:
    store = ctx.get_store(db, store_id)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(store, key, value)
    record_audit(db, action="store.updated", org_id=ctx.org_id, actor=ctx.user, entity_type="store",
                 entity_id=store.id, request=request, details={k: str(v) for k, v in changes.items()})
    return store_out(store)


@router.get("/orgs/{org_id}/departments")
def list_departments(ctx: OrgCtx, db: DbSession, company_id: uuid.UUID | None = None) -> dict:
    query = select(Department).where(Department.org_id == ctx.org_id)
    if company_id:
        query = query.where(Department.company_id == company_id)
    return {"departments": [department_out(d) for d in db.scalars(query.order_by(Department.name))]}


@router.post("/orgs/{org_id}/departments", status_code=status.HTTP_201_CREATED)
def create_department(body: DepartmentIn, ctx: Annotated[OrgContext, Depends(require(P.ORG_MANAGE))], db: DbSession,
                      request: Request) -> dict:
    ctx.get_company(db, body.company_id)
    if body.store_id:
        ctx.get_store(db, body.store_id)
    if db.scalar(select(Department.id).where(Department.company_id == body.company_id, Department.code == body.code)):
        raise ConflictError("A department with this code already exists")
    department = Department(org_id=ctx.org_id, **body.model_dump())
    db.add(department)
    db.flush()
    record_audit(db, action="department.created", org_id=ctx.org_id, actor=ctx.user, entity_type="department",
                 entity_id=department.id, request=request, details={"code": body.code})
    return department_out(department)


@router.get("/orgs/{org_id}/companies/{company_id}/periods")
def list_periods(company_id: uuid.UUID, ctx: OrgCtx, db: DbSession,
                 fiscal_year: int | None = Query(default=None, ge=1990, le=2100)) -> dict:
    company = ctx.get_company(db, company_id)
    query = select(FinancialPeriod).where(FinancialPeriod.company_id == company.id)
    if fiscal_year:
        query = query.where(FinancialPeriod.fiscal_year == fiscal_year)
    rows = db.scalars(query.order_by(FinancialPeriod.period_start))
    return {"fiscal_year_start_month": company.fiscal_year_start_month, "periods": [
        {"id": str(p.id), "period_start": p.period_start.isoformat(), "period_end": p.period_end.isoformat(),
         "fiscal_year": p.fiscal_year, "fiscal_quarter": p.fiscal_quarter, "fiscal_month": p.fiscal_month,
         "label": p.label, "status": p.status} for p in rows]}


# ---------------------------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------------------------


@router.get("/orgs/{org_id}/audit-events")
def list_audit_events(ctx: Annotated[OrgContext, Depends(require(P.AUDIT_READ))], db: DbSession,
                      action: str | None = Query(default=None, max_length=80),
                      entity_type: str | None = Query(default=None, max_length=60),
                      limit: int = Query(default=50, ge=1, le=500), offset: int = Query(default=0, ge=0)) -> dict:
    query = select(AuditEvent).where(AuditEvent.org_id == ctx.org_id)
    if action:
        query = query.where(AuditEvent.action.ilike(f"{action}%"))
    if entity_type:
        query = query.where(AuditEvent.entity_type == entity_type)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(AuditEvent.created_at.desc()).limit(limit).offset(offset))
    return {"total": total, "limit": limit, "offset": offset, "events": [
        {"id": e.id, "action": e.action, "actor": e.actor_label, "entity_type": e.entity_type, "entity_id": e.entity_id,
         "outcome": e.outcome, "ip_address": e.ip_address, "summary": e.summary, "details": e.details,
         "created_at": e.created_at.isoformat()} for e in rows]}
