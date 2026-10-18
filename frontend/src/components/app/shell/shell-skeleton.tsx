import { AurexLogo } from "@/components/brand/logo";
import { Skeleton } from "@/components/ui/skeleton";

/*
 * Static placeholders for the workspace. They are the prerendered HTML of every /app route (the
 * session-dependent parts render in the browser), so they use no hooks and no browser APIs.
 */

export function SidebarSkeleton() {
  return (
    <div className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 bg-sidebar px-4 py-5 lg:flex" aria-hidden>
      <AurexLogo surface="dark" title="" className="h-[1.2rem]" />
      <div className="space-y-2.5 pt-2">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="h-7 rounded-md bg-white/6" />
        ))}
      </div>
    </div>
  );
}

export function TopBarSkeleton() {
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background px-4 sm:px-6 lg:px-8" aria-hidden>
      <div className="size-8 rounded-md bg-muted lg:hidden" />
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-44" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="ml-auto h-5 w-32" />
      <Skeleton className="size-8 rounded-full" />
    </div>
  );
}

/** Placeholder for a page's content while the session and data load. */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="space-y-3 bg-card p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
