"""Test fixtures.

The suite runs against a real PostgreSQL database (``aurex_test``) built with the Alembic migrations,
seeded with the compact NovaMart synthetic dataset through the real ingestion pipeline.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Callable, Iterator

# Configure the application BEFORE importing it.
os.environ["AUREX_ENV"] = "test"
os.environ["AUREX_DATABASE_URL"] = os.environ.get(
    "AUREX_TEST_DATABASE_URL", "postgresql+psycopg://aurex:aurex@127.0.0.1:5433/aurex_test")
os.environ["AUREX_INLINE_JOBS_SYNCHRONOUS"] = "true"
os.environ["AUREX_TASK_BACKEND"] = "inline"
os.environ["AUREX_ARGON2_TIME_COST"] = "1"
os.environ["AUREX_ARGON2_MEMORY_COST_KIB"] = "8192"
os.environ["AUREX_DEMO_MODE"] = "true"
os.environ["AUREX_STORAGE_DIR"] = tempfile.mkdtemp(prefix="aurex-test-")
os.environ.pop("AUREX_ANTHROPIC_API_KEY", None)

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()


def _recreate_database(url: str) -> None:
    from sqlalchemy.engine import make_url

    u = make_url(url)
    admin = psycopg.connect(host=u.host, port=u.port, user=u.username, password=u.password, dbname="postgres",
                            autocommit=True)
    with admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{u.database}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{u.database}"')


@pytest.fixture(scope="session", autouse=True)
def database() -> Iterator[None]:
    from alembic import command
    from alembic.config import Config

    from app.db.session import reset_engine, session_scope

    url = get_settings().database_url
    _recreate_database(url)
    reset_engine()
    cfg = Config(os.path.join(os.path.dirname(os.path.dirname(__file__)), "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(os.path.dirname(__file__)), "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")

    from sqlalchemy import select

    from app.models import Company, Organization, Store
    from app.seed.demo import seed_demo
    from app.seed.reference import load_reference_data
    from app.services.forecasting.service import train_target

    with session_scope() as db:
        seed_demo(db, small=True)
        load_reference_data(db)
    with session_scope() as db:
        org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
        company = db.scalar(select(Company).where(Company.org_id == org.id))
        train_target(db, org_id=org.id, company=company, target="net_sales")
        s04 = db.scalar(select(Store).where(Store.company_id == company.id, Store.code == "S04"))
        train_target(db, org_id=org.id, company=company, target="net_sales", level="store", key=str(s04.id))
    yield
    reset_engine()


@pytest.fixture(autouse=True)
def _reset_rate_limits() -> Iterator[None]:
    from app.core.ratelimit import rate_limiter

    rate_limiter.reset()
    yield


@pytest.fixture
def app():  # type: ignore[no-untyped-def]
    from app.main import app as fastapi_app

    return fastapi_app


class Actor:
    def __init__(self, client: TestClient, org_id: str | None, user: dict) -> None:
        self.client = client
        self.org_id = org_id
        self.user = user

    @property
    def headers(self) -> dict[str, str]:
        return {"X-CSRF-Token": self.client.cookies.get("aurex_csrf") or ""}

    def url(self, path: str) -> str:
        return f"/api/v1/orgs/{self.org_id}{path}"

    def get(self, path: str, **kw):  # type: ignore[no-untyped-def]
        return self.client.get(self.url(path), **kw)

    def post(self, path: str, json: object | None = None, **kw):  # type: ignore[no-untyped-def]
        return self.client.post(self.url(path), json=json, headers={**self.headers, **kw.pop("headers", {})}, **kw)

    def put(self, path: str, json: object | None = None):  # type: ignore[no-untyped-def]
        return self.client.put(self.url(path), json=json, headers=self.headers)

    def patch(self, path: str, json: object | None = None):  # type: ignore[no-untyped-def]
        return self.client.patch(self.url(path), json=json, headers=self.headers)

    def delete(self, path: str):  # type: ignore[no-untyped-def]
        return self.client.delete(self.url(path), headers=self.headers)


@pytest.fixture
def demo(app) -> Callable[[str], Actor]:  # type: ignore[no-untyped-def]
    def login(role: str) -> Actor:
        client = TestClient(app)
        response = client.post("/api/v1/auth/demo/login", json={"role": role})
        assert response.status_code == 200, response.text
        body = response.json()
        org = body["memberships"][0]["org_id"] if body["memberships"] else None
        return Actor(client, org, body["user"])

    return login


@pytest.fixture
def new_org(app) -> Callable[..., Actor]:  # type: ignore[no-untyped-def]
    def create(name: str | None = None, password: str = "Str0ngPassword!") -> Actor:
        suffix = uuid.uuid4().hex[:8]
        client = TestClient(app)
        response = client.post("/api/v1/auth/register", json={
            "email": f"owner-{suffix}@acme.example", "password": password, "full_name": "Test Owner",
            "organization_name": name or f"Acme {suffix}"})
        assert response.status_code == 201, response.text
        body = response.json()
        return Actor(client, body["memberships"][0]["org_id"], body["user"])

    return create
