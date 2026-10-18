/**
 * Copy and structured content for the public website.
 *
 * Truthfulness rules: no customers, testimonials, usage figures, certifications or live vendor
 * connections are claimed anywhere. Every number shown in a sample is NovaMart demo data
 * (synthetic) and is labeled as such where it is rendered.
 */

export const NAV_ITEMS = [
  { href: "/product", label: "Product" },
  { href: "/integrations", label: "Integrations" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
] as const;

export const DEMO_HREF = "/sign-in#demo";
export const SIGN_UP_HREF = "/sign-up";
export const SIGN_IN_HREF = "/sign-in";

// ---------------------------------------------------------------------------------------------
// Pipeline (home)
// ---------------------------------------------------------------------------------------------

export const PIPELINE_STAGES = [
  {
    name: "Authorized business data",
    text: "POS, ERP, inventory, accounting and workforce systems you choose to connect, with access you grant.",
    trace: "pos_sales_2026-10-14.csv, approved export",
  },
  {
    name: "Ingestion",
    text: "Each import is logged and checked. Only new records are loaded, and duplicates are skipped.",
    trace: "batch 2291: 18,204 rows read, 37 duplicates skipped",
  },
  {
    name: "Normalization",
    text: "Records are mapped to one model of stores, products, suppliers and calendar periods.",
    trace: "store NM-012, sku 4471, qty 2, net 23.80",
  },
  {
    name: "Analytics",
    text: "Validated calculations turn records into sales, margin, inventory and labor metrics.",
    trace: "gross margin, NM-012, week 41: 31.4%",
  },
  {
    name: "Forecasting",
    text: "Models are scored against simple baselines on periods they haven't seen, and every forecast carries an interval.",
    trace: "NM-012, week 42 forecast: 84,300 (80% interval 79,700 to 89,100)",
  },
  {
    name: "Simulation",
    text: "Decision Lab applies a proposed change and attributes every figure it moves to history, an assumption or arithmetic.",
    trace: "scenario S-07: +6 associates, basis: sales history",
  },
  {
    name: "Explainable recommendations",
    text: "Suggestions cite the calculations and sources behind them, and say how certain they are.",
    trace: "R-118 cites 3 calculations and 2 sources",
  },
  {
    name: "Reports",
    text: "PDF, CSV and Excel reports go out for approval, and outcomes are tracked against the prediction.",
    trace: "ops-review-week-42.pdf, awaiting approval",
  },
] as const;

// ---------------------------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------------------------

export type ModuleGroup = "Connect" | "Understand" | "Look outward" | "Plan and decide" | "Act";

export type ModuleInfo = {
  id: string;
  name: string;
  group: ModuleGroup;
  /** One line for the home page index. */
  summary: string;
  /** Opening paragraph on the product page. */
  lead: string;
  capabilities: readonly string[];
  note?: string;
};

export const MODULE_GROUPS: readonly { name: ModuleGroup; text: string }[] = [
  { name: "Connect", text: "Bring authorized data in, once, and keep it consistent." },
  { name: "Understand", text: "See how the business is performing, on shared definitions." },
  { name: "Plan and decide", text: "Look ahead, test decisions and ask questions." },
  { name: "Look outward", text: "Context from public filings and the news." },
  { name: "Act", text: "Turn analysis into accountable action." },
];

export const MODULES: readonly ModuleInfo[] = [
  {
    id: "integration-hub",
    name: "Integration Hub",
    group: "Connect",
    summary: "Connect POS, ERP, inventory, accounting and HR systems through documented, authorized methods.",
    lead: "Connect the systems where your business data already lives: POS, ERP, inventory, accounting, HR and e-commerce. AUREX uses the methods each vendor documents, and only with access your organization grants.",
    capabilities: [
      "Documented REST APIs and authorized OAuth connections",
      "Signed webhooks for events the vendor pushes",
      "Approved exports and CSV or Excel imports",
      "Authorized read-only database access",
      "Status, sync history and error logs for every connector",
      "Credentials encrypted at rest and never sent back to the browser",
    ],
    note: "A vendor connection activates only after your organization authorizes access and AUREX tests the credentials.",
  },
  {
    id: "data-pipeline",
    name: "Automatic Data Pipeline",
    group: "Connect",
    summary: "Ingests, validates and normalizes every import, without double-counting.",
    lead: "Every import goes through the same steps: ingest, validate, normalize. The result is one consistent model of stores, products, suppliers, customers and time that every other module reads from.",
    capabilities: [
      "Incremental imports that read only new or changed records",
      "Duplicate prevention, so totals are never counted twice",
      "Validation rules, with rejected rows reported rather than dropped",
      "Automatic retries for transient failures",
      "Data-quality checks you can review by source",
      "Provenance on every record: source system, import batch and time",
    ],
  },
  {
    id: "executive-dashboard",
    name: "Executive Dashboard",
    group: "Understand",
    summary: "Company performance on one screen, each figure linked to the calculation behind it.",
    lead: "Company-wide performance on one screen: sales, margin, cash, inventory health and workforce, with forecasts shown next to actuals.",
    capabilities: [
      "Headline figures linked to the calculation that produced them",
      "Period-over-period and forecast-versus-actual comparisons",
      "Drill-down from company to region and store",
      "The same figures the advisor and reports use",
    ],
  },
  {
    id: "analytics",
    name: "Financial & Operational Analytics",
    group: "Understand",
    summary: "Sales, margin, expenses, cash flow, inventory health and labor productivity.",
    lead: "Validated calculations for the questions finance and operations teams ask every week.",
    capabilities: [
      "Sales, gross margin and contribution by store, category and product",
      "Budget versus actual, and expense analysis",
      "Cash flow",
      "Inventory health: stock cover, stockout risk and overstock risk",
      "Supplier lead times and reorder points",
      "Labor cost and productivity from aggregated workforce data",
    ],
  },
  {
    id: "benchmarking",
    name: "Benchmarking",
    group: "Understand",
    summary: "Compare stores, regions and periods, and set them against public company profiles.",
    lead: "See how stores, regions and periods compare with each other and, where public filings allow a fair comparison, with public companies.",
    capabilities: [
      "Store, region and period comparisons on shared definitions",
      "Comparisons with public company figures, labeled with the filing they came from",
    ],
  },
  {
    id: "company-intelligence",
    name: "Company Intelligence",
    group: "Look outward",
    summary: "Profiles of public companies, compiled from their public filings.",
    lead: "Profiles of public companies compiled from their public filings. Useful context for benchmarking, planning and market conversations.",
    capabilities: [
      "Financial and operating figures as reported, with the filing cited",
      "Profiles kept separate from your organization's own data",
    ],
    note: "Profiles cover public companies such as DMart, MR D.I.Y. and Wellness Forever, based on their public filings. A profile doesn't imply any relationship with the company.",
  },
  {
    id: "market-news",
    name: "Market News",
    group: "Look outward",
    summary: "News for your sector and the companies you follow, linked to the original source.",
    lead: "News relevant to your sector and the companies you follow. Each item links to its original source and stays separate from your business data.",
    capabilities: [],
  },
  {
    id: "forecasting",
    name: "ML Forecasting",
    group: "Plan and decide",
    summary: "Models checked against baselines on held-out periods, with prediction intervals.",
    lead: "Forecasts you can check before you rely on them. Every model is compared with simple baselines on time periods it has never seen.",
    // Baselines, validation, metrics and intervals are explained in the product page detail block.
    capabilities: [],
  },
  {
    id: "decision-lab",
    name: "Business Decision Lab",
    group: "Plan and decide",
    summary: "Simulate a decision and see which figures move, by how much, and why.",
    lead: "Simulate a decision before you make it. Change one lever or several, and AUREX shows which figures move, by how much, and whether each change rests on your history, a documented assumption or plain arithmetic.",
    // Levers and analysis types are listed in the product page detail block.
    capabilities: [],
  },
  {
    id: "advisor",
    name: "AI Business Advisor",
    group: "Plan and decide",
    summary: "Plain-language answers built on validated calculations, with sources cited.",
    lead: "Ask a question in plain language. The advisor answers by running AUREX's validated calculations, cites what it used, and says how certain it is.",
    capabilities: [
      "Figures come from the same calculations as dashboards and reports, not from the language model's own arithmetic",
      "Every answer cites its data sources, periods and calculations",
      "Uncertainty and data gaps are stated, along with what would reduce them",
      "Answers respect the asker's role and store access",
    ],
  },
  {
    id: "reports-workflows",
    name: "Reports & Workflows",
    group: "Act",
    summary: "Reports, approvals, tasks and an audit trail, with outcomes tracked against predictions.",
    lead: "Turn analysis into decisions people can act on, and check later whether they worked.",
    capabilities: [
      "PDF, CSV and Excel reports",
      "Approval steps for recommendations",
      "Tasks and notifications for the people who act on them",
      "An audit trail of who did what, and when",
      "Predicted-versus-actual tracking once a decision is made",
    ],
  },
];

/** Modules in display order: grouped, groups in MODULE_GROUPS order. */
export const ORDERED_MODULES: readonly ModuleInfo[] = MODULE_GROUPS.flatMap((group) =>
  MODULES.filter((module) => module.group === group.name),
);

export const DECISION_LEVERS = [
  "Workforce and staffing",
  "Pricing",
  "Marketing spend",
  "Supplier costs",
  "Inventory and reorder points",
  "New stores",
  "Operating expenses",
  "Customer retention",
  "Product mix",
  "Combined scenarios",
] as const;

export const DECISION_ANALYSES = [
  {
    name: "Sensitivity",
    text: "Find the inputs that move the result most, so you know which assumptions deserve scrutiny.",
  },
  {
    name: "Downside",
    text: "Stress a scenario with weaker demand or higher costs, and see what still holds.",
  },
  {
    name: "Goal optimization",
    text: "Set a target, such as a margin or stock-cover level, and find lever settings that reach it within your limits.",
  },
] as const;

export const DECISION_PRINCIPLE =
  "Hiring 10 more people adds a known staffing cost. Revenue only changes when historical data or a documented assumption supports it.";

// ---------------------------------------------------------------------------------------------
// Roles (mirrors backend/app/core/permissions.py ROLE_INFO)
// ---------------------------------------------------------------------------------------------

export const ROLES = [
  {
    label: "Platform Administrator",
    description:
      "Runs the AUREX platform: tenants, users, jobs and system health. Can't read a tenant's business data without a membership.",
  },
  {
    label: "Organization Owner",
    description: "Full control of the organization: members, roles, integrations, data and settings.",
  },
  {
    label: "CEO / Executive",
    description: "Company-wide performance, forecasts and scenarios, and approval of recommendations.",
  },
  {
    label: "Finance Manager",
    description: "Financial reporting, budget versus actual, expenses, cash flow and forecasts.",
  },
  {
    label: "Operations / Store Manager",
    description: "Store performance, staffing, inventory health and tasks for the stores they're assigned.",
  },
  {
    label: "Inventory Manager",
    description: "Stock levels, stockout and overstock risk, suppliers, lead times and reorders.",
  },
  {
    label: "HR / Workforce Manager",
    description: "Workforce aggregates, labor cost, productivity and staffing scenarios.",
  },
  {
    label: "Business Analyst",
    description: "Analytics, forecasting, scenario modeling, benchmarking and reports.",
  },
  {
    label: "Employee",
    description: "Assigned tasks, notifications and sales summaries for the stores they're assigned.",
  },
  {
    label: "Read-Only Auditor",
    description: "Read-only access to business data, reports and the audit trail.",
  },
] as const;

// ---------------------------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------------------------

export const CONNECTION_METHODS = [
  {
    key: "rest_api",
    name: "Documented REST APIs",
    text: "Scheduled reads from the vendor's published API, within the endpoints and rate limits the vendor documents.",
  },
  {
    key: "oauth",
    name: "Authorized OAuth",
    text: "You approve scoped access on the vendor's own sign-in screen. AUREX never sees your vendor password.",
  },
  {
    key: "webhook",
    name: "Signed webhooks",
    text: "The vendor pushes events to AUREX. Each one must carry a valid signature and a fresh timestamp to be accepted.",
  },
  {
    key: "export",
    name: "Approved exports",
    text: "Files your system already produces on a schedule, such as nightly sales exports, imported once you approve the format.",
  },
  {
    key: "file_import",
    name: "CSV and Excel import",
    text: "Upload a file and map its columns once. AUREX validates every row and reports any it rejects.",
  },
  {
    key: "database",
    name: "Read-only database access",
    text: "Read-only credentials you create and scope to the tables you choose. AUREX can't write to your database.",
  },
] as const;

export const CONNECTOR_FRAMEWORK = [
  { name: "Status", text: "Each connector shows whether it's working and when it last synced." },
  { name: "Sync history", text: "Every run is recorded with its time, duration and row counts." },
  { name: "Incremental imports", text: "After the first load, only new or changed records are read." },
  { name: "Duplicate prevention", text: "Records that were already imported are recognized and skipped." },
  { name: "Validation", text: "Rows that break validation rules are held back and reported, not silently dropped." },
  { name: "Retries", text: "Transient failures, like a source file arriving late, are retried automatically." },
  { name: "Error logs", text: "Failures are logged with their reason, so they can be fixed at the source." },
  { name: "Data provenance", text: "Every record keeps its source system, import batch and import time." },
] as const;

// ---------------------------------------------------------------------------------------------
// Security (implemented controls only)
// ---------------------------------------------------------------------------------------------

export const SECURITY_GROUPS = [
  {
    name: "Sign-in and sessions",
    controls: [
      {
        name: "Argon2id password hashing",
        text: "Passwords are stored only as Argon2id hashes, a memory-hard algorithm designed to make brute-force cracking expensive.",
      },
      {
        name: "Short-lived access tokens in HttpOnly cookies",
        text: "Sessions use short-lived JWT access tokens held in HttpOnly, SameSite cookies, so scripts running in the page can't read them.",
      },
      {
        name: "Rotating refresh tokens with reuse detection",
        text: "Each refresh issues a new refresh token and retires the old one. Presenting a retired token again is detected as reuse and ends the session.",
      },
      {
        name: "Double-submit CSRF protection",
        text: "Requests that change data must carry a CSRF token matching a cookie value, which blocks cross-site request forgery.",
      },
      {
        name: "Account lockout and rate limiting",
        text: "Repeated failed sign-ins lock the account for a period, and request rates are limited to slow automated attacks.",
      },
    ],
  },
  {
    name: "Access and isolation",
    controls: [
      {
        name: "Server-side role-based access control",
        text: "Every request is authorized on the server against the member's role. The interface hides what a role can't use, but the server is what enforces it.",
      },
      {
        name: "Optional store-level scoping",
        text: "A membership can be limited to specific stores, and data queries apply that scope.",
      },
      {
        name: "Strict organization isolation",
        text: "Each organization's data is isolated from every other organization. Platform administrators can't read a tenant's business data without a membership in that organization.",
      },
    ],
  },
  {
    name: "Data protection",
    controls: [
      {
        name: "Encrypted integration credentials",
        text: "Credentials for connected systems are encrypted at rest with Fernet (AES) and are never returned to the browser once saved.",
      },
      {
        name: "Secret redaction in logs",
        text: "Passwords, tokens and credentials are redacted from application logs.",
      },
      {
        name: "Aggregates-only workforce data",
        text: "Workforce analytics use aggregated figures such as headcount, hours and labor cost. Individual employees' personal data isn't stored.",
      },
    ],
  },
  {
    name: "Integrations",
    controls: [
      {
        name: "Signed webhooks with replay protection",
        text: "Incoming webhooks must carry a valid signature and a recent timestamp, so forged or replayed events are rejected.",
      },
    ],
  },
  {
    name: "Accountability and operations",
    controls: [
      {
        name: "Audit trail",
        text: "Security-relevant actions are recorded in an audit trail that organization owners and Read-Only Auditors can review.",
      },
      {
        name: "Configurable data retention",
        text: "Retention periods for audit records, sync errors, notifications and reports are configurable, and expired records are purged.",
      },
      {
        name: "PostgreSQL backups",
        text: "The PostgreSQL database is backed up so data can be restored after a failure.",
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------------------------

export const PRINCIPLES = [
  {
    name: "Evidence over assumptions",
    text: "Results come from your own history first. When an assumption is needed, it's written down, attributed to an owner and visible in every result it affects.",
    practice: "Decision Lab tags each changed figure with its basis: sales history, a documented assumption or plain arithmetic.",
  },
  {
    name: "No fabricated numbers",
    text: "If the data can't support a figure, AUREX doesn't produce one. It says what's missing instead.",
    practice: "An analysis without enough data returns an “insufficient data” result rather than a guess.",
  },
  {
    name: "Disclose uncertainty",
    text: "A single number hides how sure anyone is about it. AUREX shows the range and the track record along with the estimate.",
    practice: "Forecasts carry prediction intervals and error metrics, and the advisor states how confident each answer is.",
  },
  {
    name: "The customer owns its data",
    text: "You decide which systems connect and what access they get. Nothing is read until you authorize it.",
    practice: "Connections activate only after authorization and a credential test, credentials are encrypted, and each organization's data is isolated.",
  },
  {
    name: "Synthetic demo data, always labeled",
    text: "NovaMart, the demo company, is fictional. Its data is synthetic and is labeled that way wherever it appears.",
    practice: "Every sample figure on this website carries the label “NovaMart demo data (synthetic)”.",
  },
] as const;
