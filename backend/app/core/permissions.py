"""Roles, permissions and role workspaces.

Authorization is enforced server-side: every org-scoped endpoint declares the permission it needs
(``require_permission``) and data queries apply the membership's optional store scope. The frontend
uses the same matrix (served by ``GET /orgs/{id}/roles``) only to decide what to display.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Role(StrEnum):
    PLATFORM_ADMIN = "platform_admin"  # platform level (users.is_platform_admin), never a membership role
    ORG_OWNER = "org_owner"
    EXECUTIVE = "executive"
    FINANCE_MANAGER = "finance_manager"
    OPERATIONS_MANAGER = "operations_manager"
    INVENTORY_MANAGER = "inventory_manager"
    HR_MANAGER = "hr_manager"
    BUSINESS_ANALYST = "business_analyst"
    EMPLOYEE = "employee"
    AUDITOR = "auditor"


MEMBERSHIP_ROLES: tuple[Role, ...] = tuple(r for r in Role if r is not Role.PLATFORM_ADMIN)


class Permission(StrEnum):
    ORG_READ = "org:read"
    ORG_MANAGE = "org:manage"
    MEMBERS_READ = "members:read"
    MEMBERS_MANAGE = "members:manage"
    INTEGRATIONS_READ = "integrations:read"
    INTEGRATIONS_MANAGE = "integrations:manage"
    DATA_IMPORT = "data:import"
    DATA_QUALITY_READ = "data_quality:read"
    DASHBOARD_READ = "dashboard:read"
    SALES_READ = "sales:read"
    FINANCE_READ = "finance:read"
    INVENTORY_READ = "inventory:read"
    SUPPLIERS_READ = "suppliers:read"
    WORKFORCE_READ = "workforce:read"
    FORECASTS_READ = "forecasts:read"
    FORECASTS_RUN = "forecasts:run"
    SCENARIOS_READ = "scenarios:read"
    SCENARIOS_WRITE = "scenarios:write"
    ADVISOR_USE = "advisor:use"
    INTELLIGENCE_READ = "intelligence:read"
    INTELLIGENCE_MANAGE = "intelligence:manage"
    REPORTS_READ = "reports:read"
    REPORTS_GENERATE = "reports:generate"
    RECOMMENDATIONS_READ = "recommendations:read"
    RECOMMENDATIONS_WRITE = "recommendations:write"
    RECOMMENDATIONS_APPROVE = "recommendations:approve"
    TASKS_READ = "tasks:read"
    TASKS_MANAGE = "tasks:manage"
    AUDIT_READ = "audit:read"
    PLATFORM_ADMIN = "platform:admin"


P = Permission

_READ_ALL_BUSINESS = {
    P.ORG_READ, P.MEMBERS_READ, P.INTEGRATIONS_READ, P.DATA_QUALITY_READ, P.DASHBOARD_READ, P.SALES_READ,
    P.FINANCE_READ, P.INVENTORY_READ, P.SUPPLIERS_READ, P.WORKFORCE_READ, P.FORECASTS_READ, P.SCENARIOS_READ,
    P.INTELLIGENCE_READ, P.REPORTS_READ, P.RECOMMENDATIONS_READ, P.TASKS_READ,
}

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.PLATFORM_ADMIN: frozenset({P.PLATFORM_ADMIN}),
    Role.ORG_OWNER: frozenset(p for p in Permission if p is not P.PLATFORM_ADMIN),
    Role.EXECUTIVE: frozenset(
        _READ_ALL_BUSINESS
        | {P.SCENARIOS_WRITE, P.ADVISOR_USE, P.REPORTS_GENERATE, P.RECOMMENDATIONS_WRITE,
           P.RECOMMENDATIONS_APPROVE, P.TASKS_MANAGE}
    ),
    Role.FINANCE_MANAGER: frozenset(
        _READ_ALL_BUSINESS
        | {P.DATA_IMPORT, P.FORECASTS_RUN, P.SCENARIOS_WRITE, P.ADVISOR_USE, P.REPORTS_GENERATE,
           P.RECOMMENDATIONS_WRITE, P.RECOMMENDATIONS_APPROVE, P.TASKS_MANAGE}
    ),
    Role.OPERATIONS_MANAGER: frozenset(
        {P.ORG_READ, P.INTEGRATIONS_READ, P.DATA_QUALITY_READ, P.DASHBOARD_READ, P.SALES_READ, P.FINANCE_READ,
         P.INVENTORY_READ, P.SUPPLIERS_READ, P.WORKFORCE_READ, P.FORECASTS_READ, P.SCENARIOS_READ,
         P.SCENARIOS_WRITE, P.ADVISOR_USE, P.INTELLIGENCE_READ, P.REPORTS_READ, P.REPORTS_GENERATE,
         P.RECOMMENDATIONS_READ, P.RECOMMENDATIONS_WRITE, P.TASKS_READ, P.TASKS_MANAGE}
    ),
    Role.INVENTORY_MANAGER: frozenset(
        {P.ORG_READ, P.INTEGRATIONS_READ, P.DATA_IMPORT, P.DATA_QUALITY_READ, P.SALES_READ, P.INVENTORY_READ,
         P.SUPPLIERS_READ, P.FORECASTS_READ, P.FORECASTS_RUN, P.SCENARIOS_READ, P.SCENARIOS_WRITE, P.ADVISOR_USE,
         P.INTELLIGENCE_READ, P.REPORTS_READ, P.REPORTS_GENERATE, P.RECOMMENDATIONS_READ, P.RECOMMENDATIONS_WRITE,
         P.TASKS_READ, P.TASKS_MANAGE}
    ),
    Role.HR_MANAGER: frozenset(
        {P.ORG_READ, P.MEMBERS_READ, P.DATA_IMPORT, P.DATA_QUALITY_READ, P.SALES_READ, P.WORKFORCE_READ,
         P.FORECASTS_READ, P.SCENARIOS_READ, P.SCENARIOS_WRITE, P.ADVISOR_USE, P.INTELLIGENCE_READ, P.REPORTS_READ,
         P.REPORTS_GENERATE, P.RECOMMENDATIONS_READ, P.RECOMMENDATIONS_WRITE, P.TASKS_READ, P.TASKS_MANAGE}
    ),
    Role.BUSINESS_ANALYST: frozenset(
        _READ_ALL_BUSINESS
        | {P.DATA_IMPORT, P.FORECASTS_RUN, P.SCENARIOS_WRITE, P.ADVISOR_USE, P.INTELLIGENCE_MANAGE,
           P.REPORTS_GENERATE, P.RECOMMENDATIONS_WRITE}
    ),
    Role.EMPLOYEE: frozenset({P.ORG_READ, P.SALES_READ, P.INTELLIGENCE_READ, P.ADVISOR_USE}),
    # Strictly read-only: no writes, imports, runs, approvals, report generation or AI usage.
    Role.AUDITOR: frozenset(_READ_ALL_BUSINESS | {P.AUDIT_READ}),
}


@dataclass(frozen=True)
class RoleInfo:
    role: Role
    label: str
    description: str
    workspace_path: str
    store_scoped_by_default: bool


ROLE_INFO: dict[Role, RoleInfo] = {
    Role.PLATFORM_ADMIN: RoleInfo(Role.PLATFORM_ADMIN, "Platform Administrator",
                                  "Operates the AUREX platform: tenants, users, jobs and system health. "
                                  "Cannot read tenant business data without a membership.", "/app/platform", False),
    Role.ORG_OWNER: RoleInfo(Role.ORG_OWNER, "Organization Owner",
                             "Full control of the organization: members, roles, integrations, data and settings.",
                             "/app/dashboard", False),
    Role.EXECUTIVE: RoleInfo(Role.EXECUTIVE, "CEO / Executive",
                             "Company-wide performance, forecasts, scenarios and approval of recommendations.",
                             "/app/dashboard", False),
    Role.FINANCE_MANAGER: RoleInfo(Role.FINANCE_MANAGER, "Finance Manager",
                                   "Financial reporting, budgets vs actuals, expenses, cash flow and forecasts.",
                                   "/app/finance", False),
    Role.OPERATIONS_MANAGER: RoleInfo(Role.OPERATIONS_MANAGER, "Operations / Store Manager",
                                      "Store performance, staffing, inventory health and tasks for assigned stores.",
                                      "/app/operations", True),
    Role.INVENTORY_MANAGER: RoleInfo(Role.INVENTORY_MANAGER, "Inventory Manager",
                                     "Stock levels, stockout and overstock risk, suppliers, lead times and reorders.",
                                     "/app/inventory", False),
    Role.HR_MANAGER: RoleInfo(Role.HR_MANAGER, "HR / Workforce Manager",
                              "Workforce aggregates, labor cost, productivity and staffing scenarios.",
                              "/app/workforce", False),
    Role.BUSINESS_ANALYST: RoleInfo(Role.BUSINESS_ANALYST, "Business Analyst",
                                    "Analytics, forecasting, scenario modelling, benchmarking and reports.",
                                    "/app/analytics", False),
    Role.EMPLOYEE: RoleInfo(Role.EMPLOYEE, "Employee",
                            "Assigned tasks, notifications and sales summaries for assigned stores.",
                            "/app/my-work", True),
    Role.AUDITOR: RoleInfo(Role.AUDITOR, "Read-Only Auditor",
                           "Read-only access to business data, reports and the audit trail.", "/app/audit", False),
}


def permissions_for(role: Role | str) -> frozenset[Permission]:
    return ROLE_PERMISSIONS[Role(role)]


def role_has(role: Role | str, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[Role(role)]


# Roles an inviter may grant. Only owners can create other owners.
def assignable_roles(inviter_role: Role | str) -> list[Role]:
    if Role(inviter_role) is Role.ORG_OWNER:
        return list(MEMBERSHIP_ROLES)
    return [r for r in MEMBERSHIP_ROLES if r is not Role.ORG_OWNER]
