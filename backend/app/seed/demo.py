"""Seed the NovaMart demonstration organization (FICTIONAL company, SYNTHETIC data).

Creates the demo organization, one demo user per role (passwordless; sign-in only through the demo
endpoint while AUREX_DEMO_MODE=true), the company and five synthetic integrations, then pushes the data
through the real ingestion pipeline in two syncs:
  1) initial load "as of" end-7 days, 2) incremental sync "as of" end with a 3-day lookback.
It also creates an example REST integration still awaiting credentials and a CSV import containing
deliberately invalid rows, so sync history, error logs and statuses are demonstrated honestly.

Usage:  python -m app.seed.demo [--small] [--reset]
"""

from __future__ import annotations

import argparse
import io
import logging
import time
from datetime import date, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.permissions import ROLE_INFO, Role
from app.core.security import generate_token, hash_password
from app.db.session import session_scope
from app.models import Company, Integration, Membership, Organization, Store, User
from app.pipeline.runner import run_sync
from app.seed.novamart_generator import SYNTHETIC_LABEL
from app.services.periods import ensure_financial_periods
from app.worker.jobs import create_sync_job

logger = logging.getLogger("aurex.seed")

DEMO_ORG_NAME = "NovaMart Demo (Synthetic)"
DEMO_COMPANY_NAME = "NovaMart Retail (Synthetic)"
# ERP first: it supplies the dimensions (stores, products, suppliers) the other feeds reference.
DEMO_FEEDS = (
    ("erp", "NovaMart ERP · synthetic demo feed", "Products, suppliers, purchase orders, inventory, budgets"),
    ("pos", "NovaMart POS · synthetic demo feed", "Point of sale: daily item sales, refunds, discounts, traffic, loyalty"),
    ("accounting", "NovaMart Accounting · synthetic demo feed", "General ledger expenses, cash flow, bank balances"),
    ("hris", "NovaMart HRIS · synthetic demo feed", "Workforce aggregates by store and department (no personal data)"),
    ("marketing", "NovaMart Marketing · synthetic demo feed", "Weekly campaign spend by channel"),
)
STORE_SCOPES = {Role.OPERATIONS_MANAGER: ("S01", "S02"), Role.EMPLOYEE: ("S04",)}
DEMO_NAMES = {
    Role.ORG_OWNER: "Riya Owner (demo)", Role.EXECUTIVE: "Arjun CEO (demo)", Role.FINANCE_MANAGER: "Meera Finance (demo)",
    Role.OPERATIONS_MANAGER: "Kabir Operations (demo)", Role.INVENTORY_MANAGER: "Sana Inventory (demo)",
    Role.HR_MANAGER: "Dev HR (demo)", Role.BUSINESS_ANALYST: "Isha Analyst (demo)", Role.EMPLOYEE: "Omkar Employee (demo)",
    Role.AUDITOR: "Neha Auditor (demo)", Role.PLATFORM_ADMIN: "Platform Admin (demo)",
}

INVALID_CSV = """store_code,sku,business_date,quantity,gross_amount,discount_amount,refund_amount,net_amount,cost_amount
S01,NM-STAP-001,2026-10-16,3,1500,0,0,1500,1200
S99,NM-STAP-001,2026-10-16,2,1000,0,0,1000,800
S01,NM-UNKNOWN-1,2026-10-16,1,200,0,0,200,150
S01,NM-STAP-002,16/10/2026,1,300,0,0,300,250
S01,NM-STAP-003,2026-10-16,-4,800,0,0,800,600
S01,NM-STAP-004,2026-10-16,2,500,50,0,400,380
S01,NM-STAP-005,2026-10-16,two,500,0,0,500,400
S01,NM-STAP-006,2026-10-16,1,250,0,0,250,
"""


def _demo_email(role: Role) -> str:
    if role is Role.PLATFORM_ADMIN:
        return "demo.platform@aurex.example"
    return f"demo.{role.value.replace('_', '-')}@novamart.example"


def reset_demo(db: Session) -> None:
    org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
    if org is not None:
        # Fact rows reference integrations with ON DELETE RESTRICT; delete facts first via org cascade order.
        for table in ("agg_store_daily", "sales_records", "store_traffic", "inventory_snapshots", "inventory_movements",
                      "purchase_order_lines", "purchase_orders", "expenses", "cash_flow_entries", "cash_balances",
                      "budgets", "workforce_aggregates", "marketing_spend", "customer_metrics"):
            db.execute(text(f"DELETE FROM {table} WHERE org_id = :o"), {"o": org.id})  # noqa: S608
        db.delete(org)
    db.execute(text("DELETE FROM users WHERE is_demo = true"))
    db.commit()


def _ensure_user(db: Session, role: Role) -> User:
    email = _demo_email(role)
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, full_name=DEMO_NAMES[role], is_demo=True,
                    is_platform_admin=role is Role.PLATFORM_ADMIN,
                    password_hash=hash_password(generate_token(24)))  # random, never disclosed: no password sign-in
        db.add(user)
        db.flush()
    return user


def seed_demo(db: Session, *, small: bool = False, run_syncs: bool = True) -> dict:
    settings = get_settings()
    started = time.perf_counter()
    org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
    if org is None:
        org = Organization(name=DEMO_ORG_NAME, slug="novamart-demo", industry="Retail (fictional)", country="IN",
                           base_currency="INR", is_demo=True,
                           settings={"synthetic_notice": SYNTHETIC_LABEL})
        db.add(org)
        db.flush()
    company = db.scalar(select(Company).where(Company.org_id == org.id, Company.name == DEMO_COMPANY_NAME))
    if company is None:
        company = Company(org_id=org.id, name=DEMO_COMPANY_NAME, legal_name="NovaMart Retail (fictional demo company)",
                          base_currency="INR", fiscal_year_start_month=4, country="IN", industry="Grocery & general retail",
                          description="Fictional multi-store retailer used for demonstration. All figures are synthetic.",
                          is_synthetic=True)
        db.add(company)
        db.flush()
    end = date.fromisoformat(settings.demo_end_date)
    ensure_financial_periods(db, company, 2023, end.year + 2)

    users = {role: _ensure_user(db, role) for role in Role}
    for role, user in users.items():
        if role is Role.PLATFORM_ADMIN:
            continue  # platform admins are NOT members of tenant organizations
        if db.scalar(select(Membership.id).where(Membership.org_id == org.id, Membership.user_id == user.id)) is None:
            db.add(Membership(org_id=org.id, user_id=user.id, role=role.value))
    db.flush()

    integrations: list[Integration] = []
    for feed, name, description in DEMO_FEEDS:
        integ = db.scalar(select(Integration).where(Integration.org_id == org.id, Integration.display_name == name))
        if integ is None:
            integ = Integration(org_id=org.id, company_id=company.id, provider_key="novamart_synthetic", display_name=name,
                                status="connected", auth_type="none", is_demo=True,
                                status_detail="Built-in synthetic demo feed (no external system).",
                                config={"feed": feed, "small": small, "lookback_days": 3,
                                        "as_of": (end - timedelta(days=7)).isoformat(), "description": description},
                                created_by=users[Role.ORG_OWNER].id)
            db.add(integ)
        integrations.append(integ)
    rest = db.scalar(select(Integration).where(Integration.org_id == org.id, Integration.provider_key == "generic_rest"))
    if rest is None:
        db.add(Integration(
            org_id=org.id, company_id=company.id, provider_key="generic_rest",
            display_name="Supplier portal API (example, awaiting credentials)", status="awaiting_credentials",
            auth_type="api_key_header",
            status_detail="Example connection: the supplier has not issued API credentials yet. Nothing is synced.",
            config={"base_url": "https://api.supplier-portal.example/v1", "auth_type": "api_key_header",
                    "api_key_header": "X-API-Key", "test_endpoint": "/me", "entities": {}},
            created_by=users[Role.ORG_OWNER].id))
    db.flush()

    summary: dict = {"org_id": str(org.id), "company_id": str(company.id), "jobs": []}
    if run_syncs:
        for integ in integrations:
            integ.config = {**integ.config, "as_of": (end - timedelta(days=7)).isoformat()}
        db.commit()
        for integ in integrations:  # initial load
            job = create_sync_job(db, integ, trigger="seed", user_id=users[Role.ORG_OWNER].id, dispatch=False)
            db.commit()
            job = run_sync(db, job.id)
            summary["jobs"].append({"integration": integ.display_name, "phase": "initial", "status": job.status,
                                    "inserted": job.records_inserted, "unchanged": job.records_unchanged})
        for integ in integrations:  # incremental sync with lookback overlap
            integ = db.get(Integration, integ.id)
            integ.config = {**integ.config, "as_of": end.isoformat()}
            db.commit()
            job = create_sync_job(db, integ, trigger="schedule", dispatch=False)
            db.commit()
            job = run_sync(db, job.id)
            summary["jobs"].append({"integration": integ.display_name, "phase": "incremental", "status": job.status,
                                    "inserted": job.records_inserted, "updated": job.records_updated,
                                    "unchanged": job.records_unchanged})
        summary["csv_example"] = _seed_invalid_csv(db, org, company, users[Role.BUSINESS_ANALYST])

    # Store scopes for store-level roles
    store_ids = {s.code: s.id for s in db.scalars(select(Store).where(Store.company_id == company.id))}
    for role, codes in STORE_SCOPES.items():
        membership = db.scalar(select(Membership).where(Membership.org_id == org.id,
                                                        Membership.user_id == users[role].id))
        scope = [store_ids[c] for c in codes if c in store_ids]
        if membership is not None and scope:
            membership.store_scope = scope
    db.commit()
    summary["roles"] = {r.value: {"email": _demo_email(r), "label": ROLE_INFO[r].label} for r in Role}
    summary["seconds"] = round(time.perf_counter() - started, 1)
    return summary


def _seed_invalid_csv(db: Session, org: Organization, company: Company, user: User) -> dict:
    """Upload a small CSV with deliberate errors through the real file-import path."""
    import hashlib

    from app.models import UploadedFile
    from app.services.storage import store_upload

    integ = db.scalar(select(Integration).where(Integration.org_id == org.id, Integration.provider_key == "csv_upload"))
    if integ is None:
        integ = Integration(org_id=org.id, company_id=company.id, provider_key="csv_upload",
                            display_name="Manual sales corrections (CSV)", status="configured", auth_type="none",
                            config={"entity_type": "sales"}, created_by=user.id,
                            status_detail="File-based import: validated on upload.")
        db.add(integ)
        db.flush()
    from app.services.analytics.base import data_bounds

    _, data_end = data_bounds(db, company.id)
    example_day = (data_end - timedelta(days=1)) if data_end else date.today()
    content = INVALID_CSV.replace("2026-10-16", example_day.isoformat()).replace(
        "16/10/2026", example_day.strftime("%d/%m/%Y")).encode()
    sha = hashlib.sha256(content).hexdigest()
    existing = db.scalar(select(UploadedFile).where(UploadedFile.integration_id == integ.id, UploadedFile.sha256 == sha))
    if existing:
        return {"skipped": "already uploaded"}
    path = store_upload(org.id, sha, ".csv", io.BytesIO(content))
    uploaded = UploadedFile(org_id=org.id, integration_id=integ.id, entity_type="sales",
                            filename=f"sales_corrections_{example_day.isoformat()}.csv", content_type="text/csv",
                            size_bytes=len(content), sha256=sha, storage_path=str(path), uploaded_by=user.id)
    db.add(uploaded)
    db.flush()
    job = create_sync_job(db, integ, trigger="upload", user_id=user.id, uploaded_file_id=uploaded.id, dispatch=False)
    db.commit()
    job = run_sync(db, job.id)
    return {"status": job.status, "inserted": job.records_inserted, "rejected": job.records_rejected}


BULK_TABLES = ("sales_records", "store_traffic", "inventory_snapshots", "inventory_movements", "purchase_orders",
               "purchase_order_lines", "expenses", "cash_flow_entries", "cash_balances", "budgets",
               "workforce_aggregates", "marketing_spend", "customer_metrics", "agg_store_daily")


def vacuum_analyze() -> None:
    """Refresh planner statistics and the visibility map after a bulk seed.

    Otherwise autovacuum processes the freshly loaded tables later, during first use, and the first dashboard
    requests run on a cold, contended database.
    """
    from app.db.session import get_engine

    with get_engine().connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        for table in BULK_TABLES:
            conn.execute(text(f"VACUUM (ANALYZE) {table}"))  # noqa: S608 - fixed table names


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--small", action="store_true", help="compact dataset (tests / quick demos)")
    parser.add_argument("--reset", action="store_true", help="delete the existing demo organization first")
    parser.add_argument("--train", action="store_true",
                        help="train the default forecast plan afterwards (company, every store, every category)")
    parser.add_argument("--if-empty", action="store_true",
                        help="do nothing when the demo organization already exists (used by launch.bat)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if args.if_empty and not args.reset:
        with session_scope() as db:
            if db.scalar(select(Organization.id).where(Organization.is_demo.is_(True))) is not None:
                print("NovaMart demo data already present; nothing to do.")
                return
    from app.seed.reference import load_reference_data

    with session_scope() as db:
        if args.reset:
            reset_demo(db)
        summary = seed_demo(db, small=args.small)
        summary["reference"] = load_reference_data(db)
    for job in summary["jobs"]:
        print(f"  {job}")
    print(f"CSV example: {summary.get('csv_example')}")
    print(f"Reference data: {summary.get('reference')}")
    print(f"Seeded NovaMart demo in {summary['seconds']}s (org {summary['org_id']})")
    started_vacuum = time.perf_counter()
    vacuum_analyze()
    print(f"VACUUM (ANALYZE) of the loaded tables in {time.perf_counter() - started_vacuum:.0f}s")
    if args.train:
        import uuid

        from app.models import Company
        from app.services.forecasting.service import train_targets

        started = time.perf_counter()
        with session_scope() as db:
            org_id = uuid.UUID(str(summary["org_id"]))
            company = db.scalar(select(Company).where(Company.org_id == org_id))
            result = train_targets(db, org_id=org_id, company_id=company.id)
        for row in result["results"]:
            print(f"  forecast {row}")
        print(f"Trained {len(result['results'])} forecast models in {time.perf_counter() - started:.0f}s")


if __name__ == "__main__":
    main()
