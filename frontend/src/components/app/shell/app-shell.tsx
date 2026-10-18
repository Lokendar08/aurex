"use client";

import { FlaskRoundIcon, MenuIcon, XIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AurexLogo } from "@/components/brand/logo";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useFilterOptions } from "@/hooks/use-filter-options";
import { useFilters } from "@/hooks/use-filters";
import { useLocalStorageState } from "@/hooks/use-local-storage";
import { routeUsesFilters } from "@/lib/app/nav";

import { SessionIsland, useSession } from "../session-provider";
import { OrgSwitcher, UserMenu } from "./account-menus";
import { DataAsOf } from "./data-as-of";
import { FilterBar } from "./filter-bar";
import { SidebarSkeleton, TopBarSkeleton } from "./shell-skeleton";
import { Sidebar, SidebarNav } from "./sidebar";

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-md bg-white px-4 py-2 text-sm font-medium text-navy-950 shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
    >
      Skip to content
    </a>
  );
}

function MobileNav({ filterQuery }: { filterQuery: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="-ml-1 grid size-9 shrink-0 place-items-center rounded-lg text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
        >
          <MenuIcon className="size-5" aria-hidden />
          <span className="sr-only">Open navigation</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground data-[side=left]:w-[86%] data-[side=left]:max-w-[19rem]"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <SheetTitle className="text-white">
            <AurexLogo surface="dark" title="" className="h-[1.15rem]" />
            <span className="sr-only">AUREX navigation</span>
          </SheetTitle>
          <SheetClose asChild>
            <button
              type="button"
              className="grid size-9 place-items-center rounded-lg text-navy-100 ring-1 ring-white/15 transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-accent"
            >
              <XIcon className="size-4" aria-hidden />
              <span className="sr-only">Close navigation</span>
            </button>
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav filterQuery={filterQuery} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Persistent notice that the numbers on screen are synthetic (NovaMart demo organization). */
function SyntheticBanner() {
  const { membership } = useSession();
  const { companyId } = useFilters();
  const options = useFilterOptions(companyId);
  const company = options.data?.companies.find((c) => c.id === (companyId ?? options.data?.company_id));
  if (!membership?.is_demo && !company?.is_synthetic) return null;
  return (
    <div className="border-b border-brand-200/70 bg-brand-50 text-navy-800 dark:border-white/10 dark:bg-navy-900 dark:text-navy-100">
      <p className="flex items-start gap-2 px-4 py-2 text-[0.8125rem] leading-snug sm:items-center sm:px-6 lg:px-8">
        <FlaskRoundIcon className="mt-px size-4 shrink-0 text-brand-600 sm:mt-0 dark:text-sky-accent" aria-hidden />
        <span>
          <strong className="font-semibold">Synthetic demonstration data — fictional company NovaMart.</strong>{" "}
          <span className="text-navy-600 dark:text-navy-300">No figure here describes a real business.</span>
        </span>
      </p>
    </div>
  );
}

/** Top bar: navigation trigger (phones), organization, data freshness, account and filters. */
function TopBar() {
  const pathname = usePathname();
  const { hasMembership } = useSession();
  const { filterQueryString } = useFilters();
  const showFilters = hasMembership && routeUsesFilters(pathname);
  return (
    <>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/85">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
          <MobileNav filterQuery={filterQueryString} />
          <div className="min-w-0 flex-1">
            <OrgSwitcher />
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {hasMembership ? <DataAsOf /> : null}
            <UserMenu />
          </div>
        </div>
        {showFilters ? (
          <div className="border-t bg-muted/40 px-4 py-2 sm:px-6 lg:px-8">
            <FilterBar />
          </div>
        ) : null}
      </header>
      {hasMembership ? <SyntheticBanner /> : null}
    </>
  );
}

function DesktopSidebar() {
  const { filterQueryString } = useFilters();
  const [sidebar, setSidebar] = useLocalStorageState<"expanded" | "collapsed">("aurex.sidebar", "expanded");
  const collapsed = sidebar === "collapsed";
  return (
    <Sidebar
      collapsed={collapsed}
      onToggle={() => setSidebar(collapsed ? "expanded" : "collapsed")}
      filterQuery={filterQueryString}
    />
  );
}

/**
 * Workspace frame. It renders on the server as a static skeleton; the sidebar and top bar are
 * session islands, and `children` (the page) always renders so each page owns its loading state.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1">
      <SkipLink />
      <SessionIsland fallback={<SidebarSkeleton />}>
        <DesktopSidebar />
      </SessionIsland>
      <div className="flex min-w-0 flex-1 flex-col">
        <SessionIsland fallback={<TopBarSkeleton />}>
          <TopBar />
        </SessionIsland>
        <main id="main" tabIndex={-1} className="flex-1 px-4 pt-6 pb-16 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[96rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}

