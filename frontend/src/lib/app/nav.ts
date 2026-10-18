import {
  BotIcon,
  BoxesIcon,
  Building2Icon,
  CableIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GaugeIcon,
  InboxIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  NewspaperIcon,
  ScaleIcon,
  ScrollTextIcon,
  ServerCogIcon,
  SettingsIcon,
  StoreIcon,
  TrendingUpIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

/** Permission strings issued by the backend (backend/app/core/permissions.py). */
export const PERMISSIONS = {
  orgRead: "org:read",
  orgManage: "org:manage",
  membersRead: "members:read",
  membersManage: "members:manage",
  integrationsRead: "integrations:read",
  integrationsManage: "integrations:manage",
  dataImport: "data:import",
  dataQualityRead: "data_quality:read",
  dashboardRead: "dashboard:read",
  salesRead: "sales:read",
  financeRead: "finance:read",
  inventoryRead: "inventory:read",
  suppliersRead: "suppliers:read",
  workforceRead: "workforce:read",
  forecastsRead: "forecasts:read",
  scenariosRead: "scenarios:read",
  advisorUse: "advisor:use",
  intelligenceRead: "intelligence:read",
  reportsRead: "reports:read",
  recommendationsRead: "recommendations:read",
  tasksRead: "tasks:read",
  auditRead: "audit:read",
} as const;

export type AccessContext = {
  has: (permission: string) => boolean;
  hasMembership: boolean;
  isPlatformAdmin: boolean;
};

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Whether the current member can use this area. The backend enforces the same rule. */
  visible: (ctx: AccessContext) => boolean;
  /** Shows the company / store / period filter row and carries filters between these pages. */
  filters?: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

const P = PERMISSIONS;
const member = (fn: (ctx: AccessContext) => boolean) => (ctx: AccessContext) => ctx.hasMembership && fn(ctx);

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboardIcon, visible: member((c) => c.has(P.dashboardRead)), filters: true },
      { href: "/app/my-work", label: "My Work", icon: InboxIcon, visible: member(() => true), filters: true },
    ],
  },
  {
    label: "Workspaces",
    items: [
      { href: "/app/finance", label: "Finance", icon: LandmarkIcon, visible: member((c) => c.has(P.financeRead)), filters: true },
      {
        href: "/app/operations",
        label: "Operations",
        icon: StoreIcon,
        visible: member((c) => c.has(P.salesRead) && c.has(P.inventoryRead)),
        filters: true,
      },
      { href: "/app/inventory", label: "Inventory", icon: BoxesIcon, visible: member((c) => c.has(P.inventoryRead)), filters: true },
      { href: "/app/workforce", label: "Workforce", icon: UsersIcon, visible: member((c) => c.has(P.workforceRead)), filters: true },
      { href: "/app/analytics", label: "Analytics", icon: ChartColumnIcon, visible: member((c) => c.has(P.salesRead)), filters: true },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/app/forecasts", label: "Forecasts", icon: TrendingUpIcon, visible: member((c) => c.has(P.forecastsRead)) },
      { href: "/app/decision-lab", label: "Decision Lab", icon: FlaskConicalIcon, visible: member((c) => c.has(P.scenariosRead)) },
      { href: "/app/advisor", label: "AI Advisor", icon: BotIcon, visible: member((c) => c.has(P.advisorUse)) },
    ],
  },
  {
    label: "Market",
    items: [
      { href: "/app/intelligence", label: "Company Intelligence", icon: Building2Icon, visible: member((c) => c.has(P.intelligenceRead)) },
      { href: "/app/news", label: "Market News", icon: NewspaperIcon, visible: member((c) => c.has(P.intelligenceRead)) },
      { href: "/app/benchmarking", label: "Benchmarking", icon: ScaleIcon, visible: member((c) => c.has(P.intelligenceRead)) },
    ],
  },
  {
    label: "Delivery",
    items: [
      { href: "/app/reports", label: "Reports", icon: FileTextIcon, visible: member((c) => c.has(P.reportsRead)) },
      {
        href: "/app/workflows",
        label: "Workflows",
        icon: ClipboardListIcon,
        visible: member((c) => c.has(P.recommendationsRead) || c.has(P.tasksRead)),
      },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/app/integrations", label: "Integration Hub", icon: CableIcon, visible: member((c) => c.has(P.integrationsRead)) },
      { href: "/app/data-quality", label: "Data Quality", icon: GaugeIcon, visible: member((c) => c.has(P.dataQualityRead)) },
      { href: "/app/audit", label: "Audit", icon: ScrollTextIcon, visible: member((c) => c.has(P.auditRead)) },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/app/settings", label: "Settings", icon: SettingsIcon, visible: member((c) => c.has(P.orgRead)) },
      { href: "/app/platform", label: "Platform", icon: ServerCogIcon, visible: (c) => c.isPlatformAdmin },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item that owns a pathname (longest matching prefix). */
export function navItemFor(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.filter((item) => isActivePath(pathname, item.href)).sort((a, b) => b.href.length - a.href.length)[0];
}

export function routeUsesFilters(pathname: string): boolean {
  return Boolean(navItemFor(pathname)?.filters);
}
