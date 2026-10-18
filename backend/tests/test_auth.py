"""Authentication: registration, login, lockout, CSRF, refresh rotation and reuse detection, invitations."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient


def test_register_sets_httponly_cookies_and_returns_owner_membership(new_org) -> None:  # type: ignore[no-untyped-def]
    actor = new_org()
    me = actor.client.get("/api/v1/auth/me")
    assert me.status_code == 200
    membership = me.json()["memberships"][0]
    assert membership["role"] == "org_owner"
    assert "members:manage" in membership["permissions"]
    assert set(actor.client.cookies.keys()) >= {"aurex_access", "aurex_refresh", "aurex_csrf", "aurex_session"}


def test_password_policy_rejects_weak_passwords(app) -> None:  # type: ignore[no-untyped-def]
    client = TestClient(app)
    r = client.post("/api/v1/auth/register", json={"email": f"x{uuid.uuid4().hex[:6]}@acme.example", "password": "short",
                                                   "full_name": "X", "organization_name": "Weak"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"


def test_duplicate_email_rejected(app, new_org) -> None:  # type: ignore[no-untyped-def]
    actor = new_org()
    r = TestClient(app).post("/api/v1/auth/register", json={"email": actor.user["email"], "password": "Str0ngPassword!",
                                                            "full_name": "Dup", "organization_name": "Dup Org"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"


def test_login_wrong_password_then_lockout(app, new_org) -> None:  # type: ignore[no-untyped-def]
    actor = new_org()
    client = TestClient(app)
    for _ in range(5):
        r = client.post("/api/v1/auth/login", json={"email": actor.user["email"], "password": "wrong-password-1"})
        assert r.status_code == 401
    # Even the correct password is refused while locked
    r = client.post("/api/v1/auth/login", json={"email": actor.user["email"], "password": "Str0ngPassword!"})
    assert r.status_code == 423 and r.json()["error"]["code"] == "account_locked"


def test_unknown_email_gives_same_error_as_bad_password(app) -> None:  # type: ignore[no-untyped-def]
    r = TestClient(app).post("/api/v1/auth/login", json={"email": "nobody@acme.example", "password": "whatever-123"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"


def test_unsafe_requests_require_csrf_token(new_org) -> None:  # type: ignore[no-untyped-def]
    actor = new_org()
    companies = actor.get("/companies").json()["companies"]
    body = {"company_id": companies[0]["id"], "code": "C1", "name": "Store"}
    no_csrf = actor.client.post(actor.url("/stores"), json=body)
    assert no_csrf.status_code == 403 and no_csrf.json()["error"]["code"] == "csrf_failed"
    assert actor.post("/stores", json=body).status_code == 201


def test_bearer_tokens_do_not_need_csrf(new_org) -> None:  # type: ignore[no-untyped-def]
    actor = new_org()
    token = actor.client.cookies.get("aurex_access")
    fresh = TestClient(actor.client.app)
    companies = fresh.get(f"/api/v1/orgs/{actor.org_id}/companies", headers={"Authorization": f"Bearer {token}"})
    assert companies.status_code == 200


def test_refresh_rotation_and_reuse_detection(app, new_org) -> None:  # type: ignore[no-untyped-def]
    actor = new_org()
    old_refresh = actor.client.cookies.get("aurex_refresh")
    csrf = actor.client.cookies.get("aurex_csrf")
    r = actor.client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200
    assert actor.client.cookies.get("aurex_refresh") != old_refresh
    # An attacker replays the rotated (old) refresh token -> whole family revoked
    attacker = TestClient(app)
    attacker.cookies.set("aurex_refresh", old_refresh, path="/api/v1/auth")
    attacker.cookies.set("aurex_csrf", "x", path="/")
    replay = attacker.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": "x"})
    assert replay.status_code == 401 and replay.json()["error"]["code"] == "refresh_token_reused"
    # The legitimate session is now revoked too
    assert actor.client.get("/api/v1/auth/me").status_code == 401


def test_logout_revokes_session(new_org) -> None:  # type: ignore[no-untyped-def]
    actor = new_org()
    access = actor.client.cookies.get("aurex_access")
    assert actor.client.post("/api/v1/auth/logout").status_code == 204
    fresh = TestClient(actor.client.app)
    r = fresh.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 401


def test_invitation_flow(app, new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    email = f"analyst-{uuid.uuid4().hex[:6]}@acme.example"
    invite = owner.post("/invitations", json={"email": email, "role": "business_analyst"})
    assert invite.status_code == 201
    token = invite.json()["token"]
    details = TestClient(app).get(f"/api/v1/auth/invitations/{token}")
    assert details.json()["role"] == "business_analyst"
    invitee = TestClient(app)
    r = invitee.post("/api/v1/auth/register", json={"email": email, "password": "An0therStrongPass",
                                                    "full_name": "Ana Lyst", "invitation_token": token})
    assert r.status_code == 201
    assert r.json()["memberships"][0]["org_id"] == owner.org_id
    assert r.json()["memberships"][0]["role"] == "business_analyst"
    # The token cannot be reused
    again = TestClient(app).post("/api/v1/auth/register", json={"email": f"z{email}", "password": "An0therStrongPass",
                                                                "full_name": "Z", "invitation_token": token})
    assert again.status_code == 409


def test_only_owner_can_grant_owner_role(new_org, app) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    email = f"exec-{uuid.uuid4().hex[:6]}@acme.example"
    token = owner.post("/invitations", json={"email": email, "role": "executive"}).json()["token"]
    executive = TestClient(app)
    executive.post("/api/v1/auth/register", json={"email": email, "password": "An0therStrongPass", "full_name": "E",
                                                  "invitation_token": token})
    r = executive.post(f"/api/v1/orgs/{owner.org_id}/invitations", json={"email": "x@acme.example", "role": "org_owner"},
                       headers={"X-CSRF-Token": executive.cookies.get("aurex_csrf")})
    assert r.status_code == 403  # executives lack members:manage entirely


def test_last_owner_cannot_be_removed(new_org) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    me = next(m for m in owner.get("/members").json()["members"] if m["is_me"])
    r = owner.patch(f"/members/{me['id']}", json={"role": "executive"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "last_owner"


def test_demo_login_lists_all_roles(app) -> None:  # type: ignore[no-untyped-def]
    roles = TestClient(app).get("/api/v1/auth/demo/roles").json()
    assert roles["enabled"] is True
    assert {r["role"] for r in roles["roles"]} >= {"org_owner", "executive", "finance_manager", "operations_manager",
                                                    "inventory_manager", "hr_manager", "business_analyst", "employee",
                                                    "auditor", "platform_admin"}


def test_demo_users_cannot_sign_in_with_a_password(app) -> None:  # type: ignore[no-untyped-def]
    r = TestClient(app).post("/api/v1/auth/login", json={"email": "demo.executive@novamart.example",
                                                         "password": "anything-123"})
    assert r.status_code == 401


def test_production_settings_refuse_dev_secrets() -> None:
    from app.core.config import Settings

    problems = Settings(env="production").validate_for_production()
    assert any("JWT" in p for p in problems) and any("ENCRYPTION" in p for p in problems)
