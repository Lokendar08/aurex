"""Authentication service: registration, login with lockout, session issuance and refresh rotation."""

from __future__ import annotations

import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, AuthenticationError, ConflictError, ValidationAppError
from app.core.permissions import ROLE_INFO, Role, permissions_for
from app.core.security import (
    create_access_token,
    generate_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    password_policy_errors,
    verify_password,
)
from app.models import AuthSession, Company, Invitation, Membership, Organization, User
from app.services.audit import client_ip, record_audit

ACCESS_COOKIE = "aurex_access"
REFRESH_COOKIE = "aurex_refresh"
CSRF_COOKIE = "aurex_csrf"
SESSION_HINT_COOKIE = "aurex_session"

# A real argon2 hash used to equalise timing when the e-mail does not exist (prevents user enumeration).
_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    return _DUMMY_HASH


def normalize_email(email: str) -> str:
    return email.strip().lower()


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (slug or "org")[:60]


def unique_slug(db: Session, name: str) -> str:
    base = slugify(name)
    candidate = base
    while db.scalar(select(Organization.id).where(Organization.slug == candidate)) is not None:
        candidate = f"{base}-{secrets.token_hex(3)}"
    return candidate


# ---------------------------------------------------------------------------------------------
# Session payload returned to the frontend
# ---------------------------------------------------------------------------------------------


def membership_payload(membership: Membership, org: Organization) -> dict:
    role = Role(membership.role)
    info = ROLE_INFO[role]
    return {
        "org_id": str(org.id),
        "org_name": org.name,
        "org_slug": org.slug,
        "is_demo": org.is_demo,
        "role": role.value,
        "role_label": info.label,
        "permissions": sorted(p.value for p in permissions_for(role)),
        "store_scope": [str(s) for s in membership.store_scope] if membership.store_scope else None,
        "workspace_path": info.workspace_path,
    }


def session_info(db: Session, user: User) -> dict:
    rows = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.org_id)
        .where(Membership.user_id == user.id, Membership.status == "active", Organization.status == "active")
        .order_by(Organization.is_demo.desc(), Organization.name)
    ).all()
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "is_platform_admin": user.is_platform_admin,
        },
        "memberships": [membership_payload(m, o) for m, o in rows],
    }


# ---------------------------------------------------------------------------------------------
# Cookies
# ---------------------------------------------------------------------------------------------


def _set_auth_cookies(response: Response, access: str, access_exp: datetime, refresh: str) -> None:
    settings = get_settings()
    refresh_age = settings.refresh_token_ttl_days * 86400
    common = {"secure": settings.cookie_secure, "domain": settings.cookie_domain}
    response.set_cookie(ACCESS_COOKIE, access, httponly=True, samesite="lax", path=get_settings().api_prefix,
                        max_age=settings.access_token_ttl_minutes * 60, **common)
    response.set_cookie(REFRESH_COOKIE, refresh, httponly=True, samesite="strict", path=f"{get_settings().api_prefix}/auth",
                        max_age=refresh_age, **common)
    response.set_cookie(CSRF_COOKIE, secrets.token_urlsafe(32), httponly=False, samesite="lax", path="/",
                        max_age=refresh_age, **common)
    response.set_cookie(SESSION_HINT_COOKIE, "1", httponly=True, samesite="lax", path="/", max_age=refresh_age, **common)


def clear_auth_cookies(response: Response) -> None:
    settings = get_settings()
    for name, path in ((ACCESS_COOKIE, settings.api_prefix), (REFRESH_COOKIE, f"{settings.api_prefix}/auth"),
                       (CSRF_COOKIE, "/"),
                       (SESSION_HINT_COOKIE, "/")):
        response.delete_cookie(name, path=path, domain=settings.cookie_domain)


# ---------------------------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------------------------


def issue_session(db: Session, user: User, request: Request | None, response: Response,
                  family_id: uuid.UUID | None = None) -> AuthSession:
    settings = get_settings()
    refresh = generate_token()
    session = AuthSession(
        id=uuid.uuid4(),
        user_id=user.id,
        family_id=family_id or uuid.uuid4(),
        refresh_token_hash=hash_token(refresh),
        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days),
        user_agent=(request.headers.get("user-agent", "")[:400] if request else None),
        ip_address=client_ip(request),
    )
    db.add(session)
    db.flush()
    access, access_exp = create_access_token(user.id, session.id)
    _set_auth_cookies(response, access, access_exp, refresh)
    return session


def rotate_refresh_token(db: Session, refresh_token: str | None, request: Request, response: Response) -> User:
    if not refresh_token:
        raise AuthenticationError("No refresh token", code="no_refresh_token")
    session = db.scalar(select(AuthSession).where(AuthSession.refresh_token_hash == hash_token(refresh_token)))
    now = datetime.now(UTC)
    if session is None:
        raise AuthenticationError("Session not found", code="invalid_refresh_token")
    if session.rotated_at is not None or session.revoked_at is not None:
        # Reuse of an already-rotated token: likely theft. Revoke the whole family.
        db.execute(
            update(AuthSession)
            .where(AuthSession.family_id == session.family_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=now, revoke_reason="refresh_token_reuse")
        )
        user = db.get(User, session.user_id)
        record_audit(db, action="auth.refresh_token_reuse_detected", actor=user, entity_type="auth_session",
                     entity_id=session.family_id, outcome="failure", request=request,
                     summary="Rotated refresh token was presented again; session family revoked")
        db.commit()
        raise AuthenticationError("Session revoked", code="refresh_token_reused")
    if session.expires_at <= now:
        raise AuthenticationError("Session expired", code="session_expired")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Account disabled", code="account_disabled")
    session.rotated_at = now
    issue_session(db, user, request, response, family_id=session.family_id)
    return user


def revoke_session(db: Session, session_id: uuid.UUID, reason: str = "logout") -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoke_reason=reason)
    )


def revoke_all_sessions(db: Session, user_id: uuid.UUID, reason: str) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoke_reason=reason)
    )


# ---------------------------------------------------------------------------------------------
# Login & registration
# ---------------------------------------------------------------------------------------------


def authenticate(db: Session, email: str, password: str, request: Request) -> User:
    settings = get_settings()
    email = normalize_email(email)
    user = db.scalar(select(User).where(User.email == email))
    now = datetime.now(UTC)
    if user is None:
        verify_password(_dummy_hash(), password)  # equalise timing
        record_audit(db, action="auth.login_failed", actor_label=email, outcome="failure", request=request,
                     details={"reason": "unknown_email"})
        db.commit()  # persist the audit row even though the request fails
        raise AuthenticationError("Invalid email or password", code="invalid_credentials")
    if user.locked_until and user.locked_until > now:
        record_audit(db, action="auth.login_blocked", actor=user, outcome="failure", request=request,
                     details={"locked_until": user.locked_until.isoformat()})
        db.commit()
        raise AppError("Account temporarily locked after repeated failed sign-ins. Try again later.",
                       code="account_locked", status_code=423,
                       details={"locked_until": user.locked_until.isoformat()})
    if not user.is_active or user.is_demo or not verify_password(user.password_hash, password):
        user.failed_login_count += 1
        locked = False
        if user.failed_login_count >= settings.max_failed_logins:
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            user.failed_login_count = 0
            locked = True
        record_audit(db, action="auth.login_failed", actor=user, outcome="failure", request=request,
                     details={"reason": "bad_password" if user.is_active else "inactive", "locked": locked})
        db.commit()
        raise AuthenticationError("Invalid email or password", code="invalid_credentials")
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    return user


@dataclass
class RegistrationResult:
    user: User
    organization: Organization | None
    joined_via_invitation: bool


def find_valid_invitation(db: Session, token: str) -> Invitation:
    invitation = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    now = datetime.now(UTC)
    if invitation is None or invitation.revoked_at is not None:
        raise AppError("Invitation not found or revoked", code="invitation_invalid", status_code=404)
    if invitation.accepted_at is not None:
        raise ConflictError("Invitation already accepted", code="invitation_used")
    if invitation.expires_at <= now:
        raise AppError("Invitation expired", code="invitation_expired", status_code=410)
    return invitation


def accept_invitation(db: Session, invitation: Invitation, user: User) -> Membership:
    if normalize_email(invitation.email) != user.email:
        raise AppError("This invitation was issued to a different email address", code="invitation_email_mismatch",
                       status_code=403)
    existing = db.scalar(select(Membership).where(Membership.org_id == invitation.org_id,
                                                  Membership.user_id == user.id))
    if existing:
        raise ConflictError("You are already a member of this organization", code="already_member")
    membership = Membership(org_id=invitation.org_id, user_id=user.id, role=invitation.role,
                            store_scope=invitation.store_scope, invited_by=invitation.invited_by)
    db.add(membership)
    invitation.accepted_at = datetime.now(UTC)
    return membership


def register(db: Session, *, email: str, password: str, full_name: str, organization_name: str | None,
             invitation_token: str | None, base_currency: str = "INR", country: str | None = None,
             fiscal_year_start_month: int = 4, request: Request | None = None) -> RegistrationResult:
    email = normalize_email(email)
    errors = password_policy_errors(password, email)
    if errors:
        raise ValidationAppError("Password does not meet the policy", code="weak_password", details=errors)
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise ConflictError("An account with this email already exists", code="email_taken")

    invitation = find_valid_invitation(db, invitation_token) if invitation_token else None
    if invitation is None and not (organization_name and organization_name.strip()):
        raise ValidationAppError("Organization name is required", code="organization_required")

    user = User(email=email, full_name=full_name.strip(), password_hash=hash_password(password),
                password_changed_at=datetime.now(UTC))
    db.add(user)
    db.flush()

    org: Organization | None = None
    if invitation is not None:
        accept_invitation(db, invitation, user)
        org = db.get(Organization, invitation.org_id)
        record_audit(db, action="member.joined", org_id=invitation.org_id, actor=user, entity_type="membership",
                     entity_id=user.id, request=request, details={"role": invitation.role})
    else:
        assert organization_name is not None
        org = Organization(name=organization_name.strip(), slug=unique_slug(db, organization_name),
                           base_currency=base_currency.upper(), country=country, created_by=user.id)
        db.add(org)
        db.flush()
        db.add(Membership(org_id=org.id, user_id=user.id, role=Role.ORG_OWNER.value))
        company = Company(org_id=org.id, name=organization_name.strip(), base_currency=base_currency.upper(),
                          country=country, fiscal_year_start_month=fiscal_year_start_month)
        db.add(company)
        db.flush()
        from app.services.periods import ensure_financial_periods

        today = datetime.now(UTC).date()
        ensure_financial_periods(db, company, today.year - 3, today.year + 2)  # fiscal-year filters work from day one
        record_audit(db, action="organization.created", org_id=org.id, actor=user, entity_type="organization",
                     entity_id=org.id, request=request, details={"name": org.name})
    record_audit(db, action="auth.registered", org_id=org.id if org else None, actor=user, entity_type="user",
                 entity_id=user.id, request=request)
    return RegistrationResult(user=user, organization=org, joined_via_invitation=invitation is not None)
