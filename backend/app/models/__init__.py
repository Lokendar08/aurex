"""Import every model module so ``Base.metadata`` is complete (Alembic autogenerate, create_all in tests)."""

from app.models.analytics import (
    ForecastBacktest,
    ForecastModel,
    ForecastPoint,
    ForecastRun,
    Scenario,
    ScenarioRun,
)
from app.models.business import Company, Department, FinancialPeriod, Store
from app.models.facts import (
    AggStoreDaily,
    Budget,
    CashBalance,
    CashFlowEntry,
    CustomerMetric,
    DataQualityNote,
    Expense,
    FxRate,
    InventoryMovement,
    InventorySnapshot,
    MarketingSpend,
    Product,
    ProductCategory,
    PurchaseOrder,
    PurchaseOrderLine,
    SalesRecord,
    StoreTraffic,
    Supplier,
    WorkforceAggregate,
)
from app.models.identity import AuditEvent, AuthSession, Invitation, Membership, Organization, User
from app.models.integration import (
    EntityAuthority,
    Integration,
    SourceRecord,
    SyncError,
    SyncJob,
    UploadedFile,
    WebhookEvent,
)
from app.models.intelligence import (
    FinancialObservation,
    ListedSecurity,
    MarketEntity,
    MarketObservation,
    NewsArticle,
    NewsSource,
)
from app.models.workflow import (
    AdvisorConversation,
    AdvisorMessage,
    Approval,
    BackgroundJob,
    Notification,
    Recommendation,
    RecommendationOutcome,
    RecommendationRuleRun,
    Report,
    Task,
)

__all__ = [
    "AdvisorConversation", "AdvisorMessage", "AggStoreDaily", "Approval", "AuditEvent", "AuthSession",
    "BackgroundJob", "Budget", "CashBalance", "CashFlowEntry", "Company", "CustomerMetric", "DataQualityNote",
    "Department", "EntityAuthority", "Expense", "FinancialObservation", "FinancialPeriod", "ForecastBacktest",
    "ForecastModel", "ForecastPoint", "ForecastRun", "FxRate", "Integration", "InventoryMovement",
    "InventorySnapshot", "Invitation", "ListedSecurity", "MarketEntity", "MarketObservation", "MarketingSpend",
    "Membership", "NewsArticle", "NewsSource", "Notification", "Organization", "Product", "ProductCategory",
    "PurchaseOrder", "PurchaseOrderLine", "Recommendation", "RecommendationOutcome", "RecommendationRuleRun",
    "Report", "SalesRecord", "Scenario", "ScenarioRun", "SourceRecord", "Store", "StoreTraffic", "Supplier",
    "SyncError", "SyncJob", "Task", "UploadedFile", "User", "WebhookEvent", "WorkforceAggregate",
]
