"use client";

import {
  BanIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  FlagIcon,
  GaugeIcon,
  HammerIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { StatusBadge, type Tone } from "@/components/app/badges";
import { useSession } from "@/components/app/session-provider";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatDelta } from "@/lib/app/decision-lab-format";
import { formatDate, formatDays, formatNumber, formatPercent, formatRelative, humanize } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import {
  MONEY_METRICS,
  SOURCE_LABELS,
  STATUS_FLOW,
  STATUS_LABELS,
  type MemberLite,
  type Recommendation,
  type RecommendationStatus,
} from "@/lib/app/workflows-types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, { tone: Tone; icon: LucideIcon }> = {
  proposed: { tone: "neutral", icon: CircleDotIcon },
  pending_approval: { tone: "warning", icon: ClockIcon },
  approved: { tone: "good", icon: CircleCheckIcon },
  rejected: { tone: "danger", icon: CircleXIcon },
  in_progress: { tone: "info", icon: HammerIcon },
  implemented: { tone: "info", icon: SendIcon },
  measured: { tone: "good", icon: GaugeIcon },
  dismissed: { tone: "neutral", icon: BanIcon },
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? humanize(status);
}

export function RecStatusBadge({ status }: { status: RecommendationStatus }) {
  const style = STATUS_STYLE[status] ?? { tone: "neutral" as Tone, icon: CircleDotIcon };
  return (
    <StatusBadge tone={style.tone} icon={style.icon}>
      {statusLabel(status)}
    </StatusBadge>
  );
}

const PRIORITY_TONE: Record<string, Tone> = { critical: "danger", high: "warning", medium: "neutral", low: "neutral" };

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <StatusBadge tone={PRIORITY_TONE[priority] ?? "neutral"} icon={FlagIcon}>
      {humanize(priority)} priority
    </StatusBadge>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;
  const tone: Tone = confidence === "high" ? "good" : confidence === "medium" ? "warning" : "neutral";
  return <StatusBadge tone={tone}>{humanize(confidence)} confidence</StatusBadge>;
}

/** A value of an impact metric in its own unit. */
export function formatImpact(metric: string | undefined, value: number | null | undefined, currency: string, signed = true): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not available";
  if (!metric || MONEY_METRICS.has(metric)) return signed ? formatDelta(value, currency) : formatDelta(value, currency).replace(/^\+/, "");
  if (metric.includes("margin") || metric.includes("rate")) return formatPercent(value, { signed });
  if (metric.includes("days")) return formatDays(value);
  return formatNumber(value, { decimals: Number.isInteger(value) ? 0 : 1, signed });
}

export function impactMetricLabel(metric: string | undefined): string {
  const labels: Record<string, string> = {
    net_profit: "Net profit",
    net_sales: "Net sales",
    stockout_positions: "Positions at risk of stockout",
    working_capital_release: "Working capital released",
    lead_time_days: "Supplier lead time",
    store_contribution_margin: "Store contribution margin",
  };
  return metric ? (labels[metric] ?? humanize(metric)) : "Impact";
}

/** One-line predicted impact: "Net profit +₹34.6 L (P10 +₹33.1 L to P90 +₹36.3 L)". */
export function impactSummary(rec: Recommendation, currency: string): string | null {
  const impact = rec.predicted_impact;
  if (!impact || !impact.metric) return null;
  const label = impactMetricLabel(impact.metric);
  if (typeof impact.predicted_delta === "number") {
    const interval = impact.interval && typeof impact.interval.p10 === "number" && typeof impact.interval.p90 === "number"
      ? ` (P10 ${formatImpact(impact.metric, impact.interval.p10, currency)} to P90 ${formatImpact(impact.metric, impact.interval.p90, currency)})`
      : "";
    return `${label} ${formatImpact(impact.metric, impact.predicted_delta, currency)}${interval}`;
  }
  if (typeof impact.baseline_value === "number" && typeof impact.predicted_value === "number") {
    return `${label} ${formatImpact(impact.metric, impact.baseline_value, currency, false)} → ${formatImpact(impact.metric, impact.predicted_value, currency, false)}`;
  }
  return label;
}

/** The lifecycle as a stepper; side outcomes (rejected, dismissed) are shown as the end state. */
export function Pipeline({ status, className }: { status: RecommendationStatus; className?: string }) {
  const side = status === "rejected" || status === "dismissed";
  const reached = side ? (status === "rejected" ? 1 : 0) : STATUS_FLOW.indexOf(status);
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs", className)} aria-label="Recommendation lifecycle">
      {STATUS_FLOW.map((step, i) => {
        const done = i < reached || (!side && i === reached);
        const current = !side && i === reached;
        return (
          <li key={step} className="flex items-center gap-1.5" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full px-2.5 font-medium ring-1",
                current ? "bg-primary text-primary-foreground ring-primary" : done ? "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-800/30 dark:text-brand-200 dark:ring-brand-700/40" : "text-muted-foreground ring-foreground/12",
              )}
            >
              {done && !current ? <CircleCheckIcon className="size-3" aria-hidden /> : null}
              {statusLabel(step)}
            </span>
            {i < STATUS_FLOW.length - 1 ? <span aria-hidden className="h-px w-3 bg-border" /> : null}
          </li>
        );
      })}
      {side ? (
        <li className="flex items-center gap-1.5" aria-current="step">
          <span aria-hidden className="h-px w-3 bg-border" />
          <RecStatusBadge status={status} />
        </li>
      ) : null}
    </ol>
  );
}

/** Member names by user id (only for roles that may list members). */
export function useMembers() {
  const { has, user } = useSession();
  const canList = has(PERMISSIONS.membersRead);
  const query = useOrgQuery<{ members: MemberLite[] }>("/members", { enabled: canList, staleTime: 10 * 60_000 });
  const members = query.data?.members ?? [];
  const byId = Object.fromEntries(members.map((m) => [m.user_id, m])) as Record<string, MemberLite>;
  const nameOf = (id: string | null | undefined): string => {
    if (!id) return "Unassigned";
    if (id === user.id) return "You";
    return byId[id]?.full_name ?? "A colleague";
  };
  return { canList, members: members.filter((m) => m.status === "active"), nameOf, loading: query.isPending && canList };
}

export function RecommendationRow({ rec, currency, nameOf }: { rec: Recommendation; currency: string; nameOf: (id: string | null) => string }) {
  const impact = impactSummary(rec, currency);
  return (
    <li>
      <Link
        href={`/app/workflows/recommendations/${rec.id}`}
        className="block rounded-xl px-4 py-3.5 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <RecStatusBadge status={rec.status} />
          <PriorityBadge priority={rec.priority} />
          <ConfidenceBadge confidence={rec.confidence} />
          <StatusBadge>{humanize(rec.category)}</StatusBadge>
          {rec.store_code ? <StatusBadge tone="info">{rec.store_code}</StatusBadge> : null}
        </div>
        <p className="mt-1.5 font-medium text-foreground">{rec.title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{rec.summary}</p>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {impact ? <span className="font-medium text-foreground/80">{impact}</span> : null}
          <span>{SOURCE_LABELS[rec.source] ?? humanize(rec.source)}</span>
          <span>
            Created {formatRelative(rec.created_at)} by {nameOf(rec.created_by)}
          </span>
          {rec.measurement_end ? <span>Measuring to {formatDate(rec.measurement_end)}</span> : null}
        </p>
      </Link>
    </li>
  );
}
