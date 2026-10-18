from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.api.deps import CurrentAuth, CurrentUser, DbSession, verify_csrf
from app.core.config import get_settings
from app.core.errors import AuthenticationError, NotFoundError, ValidationAppError
from app.core.permissions import ROLE_INFO, Role
from app.core.ratelimit import rate_limiter
from app.core.security import hash_password, password_policy_errors, verify_password
from app.models import Organization, User
from app.schemas.common import CountryCode, CurrencyCode, ShortText
from app.services import auth as auth_service
from app.services.audit import client_ip, record_audit

router = APIRouter(prefix="/auth", tags=["auth"])

DEMO_EMAIL_DOMAIN = "novamart.example"
PLATFORM_DEMO_EMAIL = "demo.platform@aurex.example"


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    full_name: ShortText
    organization_name: ShortText | None = None
    invitation_token: str | None = Field(default=None, max_length=200)
    base_currency: CurrencyCode = "INR"
    country: CountryCode | None = None
    fiscal_year_start_month: int = Field(default=4, ge=1, le=12)


class DemoLoginIn(BaseModel):
    role: str = Field(min_length=3, max_length=40)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


def _auth_rate_limit(request: Request, key: str) -> None:
    settings = get_settings()
    rate_limiter.check("auth", f"{client_ip(request)}:{key}", settings.rate_limit_auth_per_minute)


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, request: Request, response: Response, db: DbSession) -> dict:
    _auth_rate_limit(request, "register")
    result = auth_service.register(
        db, email=body.email, password=body.password, full_name=body.full_name,
        organization_name=body.organization_name, invitation_token=body.invitation_token,
        base_currency=body.base_currency, country=body.country,
        fiscal_year_start_month=body.fiscal_year_start_month, request=request,
    )
    auth_service.issue_session(db, result.user, request, response)
    db.flush()
    return auth_service.session_info(db, result.user)


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: DbSession) -> dict:
    _auth_rate_limit(request, "login")
    _auth_rate_limit(request, f"login:{body.email.lower()}")
    user = auth_service.authenticate(db, body.email, body.password, request)
    auth_service.issue_session(db, user, request, response)
    info = auth_service.session_info(db, user)
    _audit_sign_in(db, "auth.login", user, request, info)
    return info


@router.post("/refresh")
def refresh(request: Request, response: Response, db: DbSession) -> dict:
    verify_csrf(request)
    _auth_rate_limit(request, "refresh")
    try:
        user = auth_service.rotate_refresh_token(db, request.cookies.get(auth_service.REFRESH_COOKIE), request,
                                                 response)
    except AuthenticationError:
        auth_service.clear_auth_cookies(response)
        raise
    return {"ok": True, "user_id": str(user.id)}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: DbSession) -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    # Logout must work even with an expired access token: use the refresh cookie to find the session.
    token = request.cookies.get(auth_service.REFRESH_COOKIE)
    if token:
        from app.core.security import hash_token
        from app.models import AuthSession

        session = db.scalar(select(AuthSession).where(AuthSession.refresh_token_hash == hash_token(token)))
        if session is not None:
            auth_service.revoke_session(db, session.id)
            record_audit(db, action="auth.logout", actor=db.get(User, session.user_id), request=request)
    auth_service.clear_auth_cookies(response)
    return response


@router.get("/me")
def me(auth: CurrentAuth, db: DbSession) -> dict:
    return auth_service.session_info(db, auth.user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChangeIn, auth: CurrentAuth, request: Request, db: DbSession) -> Response:
    user = auth.user
    if user.is_demo:
        raise ValidationAppError("Demo accounts cannot change passwords", code="demo_account")
    if not verify_password(user.password_hash, body.current_password):
        raise AuthenticationError("Current password is incorrect", code="invalid_credentials")
    errors = password_policy_errors(body.new_password, user.email)
    if errors:
        raise ValidationAppError("Password does not meet the policy", code="weak_password", details=errors)
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = datetime.now(UTC)
    # Revoke every other session; keep the current one.
    from sqlalchemy import update

    from app.models import AuthSession

    db.execute(update(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id != auth.session_id,
                                         AuthSession.revoked_at.is_(None))
               .values(revoked_at=datetime.now(UTC), revoke_reason="password_changed"))
    record_audit(db, action="auth.password_changed", actor=user, request=request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/invitations/{token}")
def invitation_details(token: str, request: Request, db: DbSession) -> dict:
    _auth_rate_limit(request, "invitation")
    invitation = auth_service.find_valid_invitation(db, token)
    org = db.get(Organization, invitation.org_id)
    role = Role(invitation.role)
    return {
        "email": invitation.email,
        "organization_name": org.name if org else "",
        "role": role.value,
        "role_label": ROLE_INFO[role].label,
        "expires_at": invitation.expires_at.isoformat(),
    }


@router.post("/invitations/{token}/accept")
def accept_invitation(token: str, user: CurrentUser, request: Request, db: DbSession) -> dict:
    invitation = auth_service.find_valid_invitation(db, token)
    auth_service.accept_invitation(db, invitation, user)
    record_audit(db, action="member.joined", org_id=invitation.org_id, actor=user, entity_type="membership",
                 entity_id=user.id, request=request, details={"role": invitation.role})
    db.flush()
    return auth_service.session_info(db, user)


# ---------------------------------------------------------------------------------------------
# Demo mode (NovaMart synthetic organization). Disabled when AUREX_DEMO_MODE=false.
# ---------------------------------------------------------------------------------------------


def _demo_email(role: Role) -> str:
    if role is Role.PLATFORM_ADMIN:
        return PLATFORM_DEMO_EMAIL
    return f"demo.{role.value.replace('_', '-')}@{DEMO_EMAIL_DOMAIN}"


@router.get("/demo/roles")
def demo_roles(db: DbSession) -> dict:
    settings = get_settings()
    if not settings.demo_mode:
        return {"enabled": False, "organization": None, "roles": []}
    org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
    if org is None:
        return {"enabled": False, "organization": None, "roles": []}
    roles = []
    for role in Role:
        email = _demo_email(role)
        if db.scalar(select(User.id).where(User.email == email, User.is_demo.is_(True))) is None:
            continue
        info = ROLE_INFO[role]
        roles.append({"role": role.value, "label": info.label, "description": info.description, "email": email})
    return {"enabled": True, "organization": org.name, "roles": roles}


@router.post("/demo/login")
def demo_login(body: DemoLoginIn, request: Request, response: Response, db: DbSession) -> dict:
    settings = get_settings()
    if not settings.demo_mode:
        raise NotFoundError("Demo mode is disabled")
    _auth_rate_limit(request, "demo")
    try:
        role = Role(body.role)
    except ValueError as exc:
        raise ValidationAppError("Unknown role", details={"role": body.role}) from exc
    user = db.scalar(select(User).where(User.email == _demo_email(role), User.is_demo.is_(True)))
    if user is None or not user.is_active:
        raise NotFoundError("Demo user not found. Run the NovaMart seed first.", code="demo_not_seeded")
    user.last_login_at = datetime.now(UTC)
    auth_service.issue_session(db, user, request, response)
    info = auth_service.session_info(db, user)
    _audit_sign_in(db, "auth.demo_login", user, request, info, {"role": role.value})
    return info


def _audit_sign_in(db: DbSession, action: str, user: User, request: Request, info: dict,
                   details: dict | None = None) -> None:
    """One platform-level event plus one per organization, so each org's auditors see member sign-ins."""
    import uuid as _uuid

    record_audit(db, action=action, actor=user, request=request, details=details)
    for membership in info["memberships"]:
        record_audit(db, action=action, org_id=_uuid.UUID(membership["org_id"]), actor=user, request=request,
                     details=details)
