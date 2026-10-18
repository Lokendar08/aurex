"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AurexLogo, AurexMark } from "@/components/brand/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_GROUPS, isActivePath, type NavItem } from "@/lib/app/nav";
import { cn } from "@/lib/utils";

import { useSession } from "../session-provider";

function useVisibleGroups() {
  const session = useSession();
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.visible(session)) })).filter(
    (group) => group.items.length > 0,
  );
}

function NavLink({
  item,
  active,
  collapsed,
  href,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  href: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group/nav relative flex h-9 items-center gap-3 rounded-md text-[0.875rem] font-medium transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-sky-accent focus-visible:ring-offset-0",
        collapsed ? "justify-center px-0" : "px-2.5",
        active
          ? "bg-sidebar-accent text-white"
          : "text-sidebar-foreground/72 hover:bg-white/6 hover:text-white",
      )}
    >
      {/* Active marker: the sky accent used by the public site's navigation. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-sky-accent transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon className={cn("size-[1.05rem] shrink-0", active ? "text-sky-accent" : "text-current")} aria-hidden />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Navigation list shared by the desktop rail and the mobile drawer. */
export function SidebarNav({
  collapsed = false,
  filterQuery,
  onNavigate,
}: {
  collapsed?: boolean;
  /** Current filter query string, carried to other filter-enabled pages. */
  filterQuery?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = useVisibleGroups();
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {collapsed ? (
            <div className="mx-auto mb-1 h-px w-6 bg-sidebar-border first:hidden" aria-hidden />
          ) : (
            <p className="mb-1 px-2.5 text-xs font-medium text-navy-300">{group.label}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  collapsed={collapsed}
                  active={isActivePath(pathname, item.href)}
                  href={item.filters && filterQuery ? `${item.href}?${filterQuery}` : item.href}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop sidebar: navy rail that collapses to icons. */
export function Sidebar({
  collapsed,
  onToggle,
  filterQuery,
}: {
  collapsed: boolean;
  onToggle: () => void;
  filterQuery?: string;
}) {
  const { membership } = useSession();
  const home = membership?.workspace_path ?? "/app";
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out lg:flex",
        collapsed ? "w-[3.75rem]" : "w-60",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "px-4")}>
        <Link
          href={home}
          aria-label="AUREX home"
          className="-m-1.5 rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sky-accent"
        >
          {collapsed ? (
            <AurexMark surface="dark" className="size-6" />
          ) : (
            <AurexLogo surface="dark" title="" className="h-[1.2rem]" />
          )}
        </Link>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto pt-2 pb-4", collapsed ? "px-2" : "px-3")}>
        <SidebarNav collapsed={collapsed} filterQuery={filterQuery} />
      </div>
      <div className={cn("shrink-0 border-t border-sidebar-border py-3", collapsed ? "px-2" : "px-3")}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className={cn(
            "flex h-9 w-full items-center gap-3 rounded-md text-sm text-sidebar-foreground/72 transition-colors outline-none hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-accent",
            collapsed ? "justify-center" : "px-2.5",
          )}
        >
          {collapsed ? (
            <PanelLeftOpenIcon className="size-4" aria-hidden />
          ) : (
            <PanelLeftCloseIcon className="size-4" aria-hidden />
          )}
          {collapsed ? <span className="sr-only">Expand sidebar</span> : <span>Collapse sidebar</span>}
        </button>
      </div>
    </aside>
  );
}
