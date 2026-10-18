"""Request dependencies: authentication, CSRF, organization context and permission checks.

``OrgContext`` is the single gateway to tenant data. It is resolved from the ``{org_id}`` path
parameter and the caller's *active membership*; non-members get 404 (the organization's existence is
not revealed). Store-scoped memberships additionally restrict every analytics query to their stores.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends, Path, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AuthenticationError, NotFoundError, PermissionDeniedError
from app.core.permissions import ROLE_INFO, Permission, Role, permissions_for
from app.core.ratelimit import rate_limiter
from app.core.security import constant_time_equals, decode_access_token
from app.db.session import get_db
from app.models import AuthSession, Company, Membership, Organization, Store, User
from app.services.auth import ACCESS_COOKIE, CSRF_COOKIE

# scope="function": commit/rollback happens before the response is sent, so a failed commit is a 500,
# never a silently lost write.
DbSession = Annotated[Session, Depends(get_db, scope="function")]

_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass
class AuthenticatedUser:
    user: User
    session_id: uuid.UUID
    via: str  # cookie | bearer


def verify_csrf(request: Request) -> None:
    header = request.headers.get("x-csrf-token", "")
    cookie = request.cookies.get(CSRF_COOKIE, "")
    if not header or not cookie or not constant_time_equals(header, cookie):
        raise PermissionDeniedError("CSRF token missing or invalid", code="csrf_failed")


def get_current_auth(request: Request, db: DbSession) -> AuthenticatedUser:
    token: str | None = None
    via = "cookie"
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        via = "bearer"
    else:
        token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise AuthenticationError("Authentication required")
    claims = decode_access_token(token)
    if claims is None:
        raise AuthenticationError("Access token invalid or expired", code="token_invalid")
    session = db.get(AuthSession, claims.session_id)
    if session is None or session.revoked_at is not None or session.expires_at <= datetime.now(UTC):
        raise AuthenticationError("Session is no longer valid", code="session_revoked")
    user = db.get(User, claims.user_id)
    if user is None or not user.is_active or user.id != session.user_id:
        raise AuthenticationError("Account disabled", code="account_disabled")
    if via == "cookie" and request.method in _UNSAFE_METHODS:
        verify_csrf(request)
    request.state.user_id = str(user.id)
    settings = get_settings()
    rate_limiter.check("api", f"user:{user.id}", settings.rate_limit_api_per_minute)
    return AuthenticatedUser(user=user, session_id=claims.session_id, via=via)


CurrentAuth = Annotated[AuthenticatedUser, Depends(get_current_auth)]


def get_current_user(auth: CurrentAuth) -> User:
    return auth.user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_platform_admin(user: CurrentUser) -> User:
    if not user.is_platform_admin:
        raise PermissionDeniedError("Platform administrator access required")
    return user


PlatformAdmin = Annotated[User, Depends(require_platform_admin)]


@dataclass
class OrgContext:
    org: Organization
    membership: Membership
    user: User
    role: Role
    permissions: frozenset[Permission]
    store_scope: list[uuid.UUID] | None
    request: Request | None = None
    _company_cache: dict[uuid.UUID, Company] = field(default_factory=dict)

    @property
    def org_id(self) -> uuid.UUID:
        return self.org.id

    @property
    def role_label(self) -> str:
        return ROLE_INFO[self.role].label

    def has(self, permission: Permission) -> bool:
        return permission in self.permissions

    def require(self, *permissions: Permission) -> None:
        missing = [p.value for p in permissions if p not in self.permissions]
        if missing:
            raise PermissionDeniedError(
                f"Your role ({self.role_label}) does not have permission for this action",
                details={"missing_permissions": missing, "role": self.role.value},
            )

    def resolve_store_ids(self, requested: Iterable[uuid.UUID] | None) -> list[uuid.UUID] | None:
        """Intersect requested stores with the membership scope.

        Returns None for "all stores" (unscoped member, nothing requested). Raises 403 if a scoped
        member asks for a store outside the scope.
        """
        requested_list = list(requested) if requested else []
        if self.store_scope is None:
            return requested_list or None
        if not requested_list:
            return list(self.store_scope)
        outside = [s for s in requested_list if s not in self.store_scope]
        if outside:
            raise PermissionDeniedError("You do not have access to one or more of the requested stores",
                                        details={"store_ids": [str(s) for s in outside]})
        return requested_list

    def get_company(self, db: Session, company_id: uuid.UUID) -> Company:
        if company_id in self._company_cache:
            return self._company_cache[company_id]
        company = db.scalar(select(Company).where(Company.id == company_id, Company.org_id == self.org_id))
        if company is None:
            raise NotFoundError("Company not found")
        self._company_cache[company_id] = company
        return company

    def default_company(self, db: Session, company_id: uuid.UUID | None = None) -> Company:
        if company_id is not None:
            return self.get_company(db, company_id)
        company = db.scalar(select(Company).where(Company.org_id == self.org_id).order_by(Company.created_at))
        if company is None:
            raise NotFoundError("This organization has no company yet", code="no_company")
        self._company_cache[company.id] = company
        return company

    def get_store(self, db: Session, store_id: uuid.UUID) -> Store:
        store = db.scalar(select(Store).where(Store.id == store_id, Store.org_id == self.org_id))
        if store is None:
            raise NotFoundError("Store not found")
        if self.store_scope is not None and store.id not in self.store_scope:
            raise PermissionDeniedError("You do not have access to this store")
        return store

    def scoped_get(self, db: Session, model: Any, entity_id: Any, label: str = "Resource") -> Any:
        """Fetch a tenant row by id, guaranteeing it belongs to this organization."""
        row = db.scalar(select(model).where(model.id == entity_id, model.org_id == self.org_id))
        if row is None:
            raise NotFoundError(f"{label} not found")
        return row


def get_org_context(
    request: Request,
    db: DbSession,
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Path(description="Organization id")],
) -> OrgContext:
    row = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.org_id == org_id, Membership.user_id == user.id)
    ).first()
    if row is None:
        # Same response whether the organization exists or not.
        raise NotFoundError("Organization not found")
    membership, org = row
    if membership.status != "active" or org.status != "active":
        raise PermissionDeniedError("Your membership in this organization is not active", code="membership_inactive")
    role = Role(membership.role)
    request.state.org_id = str(org.id)
    return OrgContext(org=org, membership=membership, user=user, role=role, permissions=permissions_for(role),
                      store_scope=list(membership.store_scope) if membership.store_scope else None, request=request)


OrgCtx = Annotated[OrgContext, Depends(get_org_context)]


def require(*permissions: Permission) -> Callable[..., OrgContext]:
    """Dependency factory: ``ctx: Annotated[OrgContext, Depends(require(P.FINANCE_READ))]``."""

    def _dependency(ctx: OrgCtx) -> OrgContext:
        ctx.require(*permissions)
        return ctx

    return _dependency
