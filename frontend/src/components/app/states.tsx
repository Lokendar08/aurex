"use client";

import {
  CircleAlertIcon,
  DatabaseIcon,
  LockIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

import { useDocumentTitle } from "./page";

/** Centered message for "nothing here yet" with an optional next step. */
export function EmptyState({
  icon: Icon = DatabaseIcon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="max-w-md space-y-1">
        <p className="font-heading text-[0.9375rem] font-medium text-foreground">{title}</p>
        {description ? <div className="text-sm leading-relaxed text-muted-foreground">{description}</div> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

function explain(error: unknown): { title: string; message: string; icon: LucideIcon; noData?: boolean; forbidden?: boolean } {
  if (error instanceof ApiError) {
    if (error.code === "no_data") {
      return { title: "No data yet", message: error.message, icon: DatabaseIcon, noData: true };
    }
    if (error.code === "no_company") {
      return { title: "No company set up", message: error.message, icon: DatabaseIcon, noData: true };
    }
    if (error.status === 403) return { title: "Access restricted", message: error.message, icon: LockIcon, forbidden: true };
    if (error.status === 404) return { title: "Not found", message: error.message, icon: CircleAlertIcon };
    if (error.status === 429) return { title: "Too many requests", message: error.message, icon: TriangleAlertIcon };
    if (error.status >= 500) {
      return {
        title: "The server couldn't complete this request",
        message: error.code.startsWith("http_") ? "AUREX can't be reached right now. Try again in a moment." : error.message,
        icon: TriangleAlertIcon,
      };
    }
    return { title: "Request failed", message: error.message, icon: CircleAlertIcon };
  }
  if (error instanceof TypeError) {
    return { title: "Connection problem", message: "AUREX can't be reached. Check your connection and try again.", icon: TriangleAlertIcon };
  }
  return { title: "Something went wrong", message: errorMessage(error), icon: CircleAlertIcon };
}

/** Error panel for a failed request. Shows the backend's message verbatim (ApiError.message). */
export function ErrorState({
  error,
  onRetry,
  className,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const info = explain(error);
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role={info.noData ? undefined : "alert"} className={className}>
      <EmptyState
        compact={compact}
        icon={info.icon}
        title={info.title}
        description={
          <>
            <span className="block">{info.message}</span>
            {requestId ? <span className="mt-1 block text-xs text-muted-foreground/80">Reference {requestId}</span> : null}
          </>
        }
        action={
          info.noData ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/app/integrations">Open Integration Hub</Link>
            </Button>
          ) : onRetry && !info.forbidden ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/** Friendly 403 for a whole page the member's role doesn't include. */
export function ForbiddenState({ area, role, homeHref }: { area: string; role?: string; homeHref?: string }) {
  useDocumentTitle(`No access to ${area}`);
  return (
    <div className="mx-auto max-w-xl py-10 sm:py-16">
      <div className="rounded-2xl bg-card px-6 py-10 text-center ring-1 ring-foreground/10 sm:px-10">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <LockIcon className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-[-0.02em]">You don’t have access to {area}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
          {role ? `Your role (${role}) doesn’t include this area. ` : "Your role doesn’t include this area. "}
          If you need it, ask an organization owner to change your role.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Error 403: permission required</p>
        <div className="mt-7 flex justify-center">
          <Button asChild>
            <Link href={homeHref || "/app"}>Go to your workspace</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Error shown when the session itself failed to load. `embedded` renders inside the shell. */
export function FullPageError({
  title,
  message,
  onRetry,
  embedded,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  embedded?: boolean;
}) {
  return (
    <div className={cn("flex flex-1 items-center justify-center px-4", embedded ? "py-16" : "min-h-dvh bg-muted/60")}>
      <div role="alert" className="w-full max-w-md rounded-2xl bg-card p-8 text-center ring-1 ring-foreground/10">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlertIcon className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <div className="mt-6 flex justify-center gap-2">
          {onRetry ? (
            <Button onClick={onRetry}>
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <a href="/sign-in">Go to sign in</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Generic skeleton block sized to the content it stands in for. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-lg", className)} />;
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="flex flex-col gap-3" style={{ height }} aria-hidden>
      <div className="flex flex-1 items-end gap-2">
        {[0.45, 0.6, 0.52, 0.7, 0.66, 0.8, 0.74, 0.86, 0.78, 0.9, 0.84, 0.95].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h * 100}%` }} />
        ))}
      </div>
      <Skeleton className="h-3 w-full rounded-sm" />
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-5" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Standard loading / error / empty handling for one query result. */
export function QueryView<T>({
  query,
  loading,
  isEmpty,
  empty,
  children,
  compact,
}: {
  query: { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
  loading?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
  compact?: boolean;
}) {
  if (query.isPending) return <>{loading ?? <TableSkeleton />}</>;
  if (query.error || query.data === undefined) {
    return <ErrorState compact={compact} error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState compact={compact} title="Nothing to show yet" />}</>;
  return <>{children(query.data)}</>;
}

/** Short contextual message inside a panel (method notes, limitations, warnings). */
export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger";
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "info" ? CircleAlertIcon : TriangleAlertIcon;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm leading-relaxed",
        tone === "info" && "bg-muted/70 text-foreground",
        tone === "warning" && "bg-warning/12 text-foreground ring-1 ring-warning/30",
        tone === "danger" && "bg-destructive/6 text-foreground ring-1 ring-destructive/25",
        className,
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "info" && "text-muted-foreground",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive",
        )}
        aria-hidden
      />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className="text-muted-foreground [&_strong]:text-foreground">{children}</div>
      </div>
    </div>
  );
}
