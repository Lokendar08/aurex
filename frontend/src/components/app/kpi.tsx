"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon, InfoIcon, MinusIcon } from "lucide-react";
import { useLayoutEffect, useState, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  formatDays,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPoints,
  formatRatio,
  formatScore,
  MISSING,
} from "@/lib/app/format";
import type { Kpi } from "@/lib/app/types";
import { cn } from "@/lib/utils";

import { StatusBadge } from "./badges";

/** Readable text for KPI statuses that mean "there is no honest number to show". */
export const KPI_STATUS_TEXT: Record<string, { label: string; detail: string }> = {
  missing_data: { label: "Not available", detail: "The data needed for this figure has not been supplied." },
  zero_denominator: { label: "Not defined", detail: "The comparison base is zero, so a ratio cannot be computed." },
  incomplete: { label: "Incomplete", detail: "Some inputs for this period are missing." },
  not_available_at_store_scope: {
    label: "Not available at store scope",
    detail: "This is a company-level figure and cannot be attributed to individual stores.",
  },
  not_trained: { label: "No model trained yet", detail: "Train a forecast model to measure forecast error." },
  not_permitted: { label: "Not available for your role", detail: "Your role does not include this figure." },
  not_meaningful: { label: "Not meaningful", detail: "The inputs make this figure misleading (for example negative revenue)." },
  insufficient_history: { label: "Insufficient history", detail: "More history is needed to compute this figure." },
  insufficient_granularity: { label: "Approximate", detail: "Inputs are not available at the needed granularity." },
};

export function formatKpiValue(kpi: Pick<Kpi, "value" | "unit" | "currency">, fallbackCurrency?: string | null, compact = true): string {
  const { value, unit } = kpi;
  if (value === null || value === undefined) return MISSING;
  switch (unit) {
    case "currency":
      return formatMoney(value, kpi.currency ?? fallbackCurrency, { compact });
    case "percent":
      return formatPercent(value);
    case "ratio":
      return formatRatio(value);
    case "score":
      return formatScore(value);
    case "days":
      return formatDays(value);
    default:
      return formatNumber(value);
  }
}

/** Is the change good news? Depends on the metric's direction (costs going down is favourable). */
export function changeTone(change: number | null | undefined, direction: "up" | "down" = "up"): "good" | "bad" | "neutral" {
  if (change === null || change === undefined || !Number.isFinite(change) || Math.abs(change) < 1e-9) return "neutral";
  return (change > 0) === (direction === "up") ? "good" : "bad";
}

export function formatChange(change: number | null | undefined, kind: Kpi["change_kind"], unit: Kpi["unit"], currency?: string | null) {
  if (change === null || change === undefined) return MISSING;
  if (kind === "relative") return formatPercent(change, { signed: true });
  if (unit === "percent") return formatPoints(change);
  if (unit === "currency") return formatMoney(change, currency, { compact: true, signed: true });
  return formatNumber(change, { signed: true, decimals: 1 });
}

/** Signed change with an arrow; colour follows whether the move is favourable for this metric. */
export function ChangeIndicator({
  change,
  direction = "up",
  children,
  className,
}: {
  change: number | null | undefined;
  direction?: "up" | "down";
  children: ReactNode;
  className?: string;
}) {
  if (change === null || change === undefined || !Number.isFinite(change)) {
    return <span className={cn("text-muted-foreground", className)}>{MISSING}</span>;
  }
  const tone = changeTone(change, direction);
  const Icon = !change ? MinusIcon : change > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;
  const toneText = tone === "good" ? "favourable" : tone === "bad" ? "unfavourable" : "no change";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[0.8125rem] font-medium tabular",
        tone === "good" && "bg-success/10 text-[color-mix(in_oklch,var(--success),var(--foreground)_30%)]",
        tone === "bad" && "bg-destructive/8 text-destructive",
        tone === "neutral" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
      <span className="sr-only"> ({toneText})</span>
    </span>
  );
}

/** Info button explaining how a figure is calculated. A popover so it works by touch and keyboard. */
export function DefinitionButton({
  label,
  formula,
  description,
  note,
  source,
  status,
}: {
  label: string;
  formula?: string | null;
  description?: string | null;
  note?: string | null;
  source?: string | null;
  status?: string;
}) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => () => setOpen(false), []);
  const statusInfo = status && status !== "ok" ? KPI_STATUS_TEXT[status] : undefined;
  if (!formula && !description && !note && !source && !statusInfo) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="-m-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/80 transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`How ${label} is calculated`}
      >
        <InfoIcon className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 p-3.5 text-[0.8125rem] leading-relaxed">
        <p className="font-medium text-foreground">{label}</p>
        {formula ? (
          <p className="rounded-md bg-muted px-2.5 py-1.5 text-foreground">
            <span className="sr-only">Formula: </span>
            {formula}
          </p>
        ) : null}
        {description ? <p className="text-muted-foreground">{description}</p> : null}
        {statusInfo ? (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{statusInfo.label}.</span> {statusInfo.detail}
          </p>
        ) : null}
        {note ? <p className="text-muted-foreground">{note}</p> : null}
        {source ? <p className="text-xs text-muted-foreground">Source: {source}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

/** One KPI: value, comparison and change, honest status, and its definition. */
export function KpiCell({
  kpi,
  currency,
  comparisonLabel = "comparison period",
  className,
}: {
  kpi: Kpi;
  currency?: string | null;
  comparisonLabel?: string;
  className?: string;
}) {
  const statusInfo = kpi.status !== "ok" ? KPI_STATUS_TEXT[kpi.status] : undefined;
  const hasValue = kpi.value !== null && kpi.value !== undefined;
  const fullValue = kpi.unit === "currency" && hasValue ? formatKpiValue(kpi, currency, false) : undefined;
  const showChange = hasValue && kpi.comparison !== null && kpi.comparison !== undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 bg-card px-4 py-4 sm:px-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.8125rem] leading-snug font-medium text-muted-foreground">{kpi.label}</p>
        <DefinitionButton
          label={kpi.label}
          formula={kpi.definition?.formula}
          description={kpi.definition?.description}
          note={kpi.note}
          source={kpi.source}
          status={kpi.status}
        />
      </div>

      {hasValue ? (
        <p className="text-[1.5rem] leading-none font-semibold tracking-[-0.02em] text-foreground" title={fullValue}>
          {formatKpiValue(kpi, currency)}
        </p>
      ) : (
        <p className="pt-1 text-[0.9375rem] leading-tight font-medium text-muted-foreground">
          {statusInfo?.label ?? "Not available"}
        </p>
      )}

      <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
        {showChange ? (
          <>
            {kpi.change !== null ? (
              <ChangeIndicator change={kpi.change} direction={kpi.direction}>
                {formatChange(kpi.change, kpi.change_kind, kpi.unit, kpi.currency ?? currency)}
              </ChangeIndicator>
            ) : (
              <span className="text-xs text-muted-foreground">Change not defined</span>
            )}
            <span className="text-xs text-muted-foreground">
              vs {formatKpiValue({ ...kpi, value: kpi.comparison }, currency)} {comparisonLabel}
            </span>
          </>
        ) : kpi.note ? (
          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{kpi.note}</span>
        ) : null}
      </div>
      {showChange && kpi.note && !kpi.estimated ? (
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground" title={kpi.note}>
          {kpi.note}
        </p>
      ) : null}

      {kpi.estimated || (hasValue && kpi.status !== "ok") ? (
        <div className="flex flex-wrap gap-1.5">
          {kpi.estimated ? <StatusBadge tone="warning">Estimated</StatusBadge> : null}
          {hasValue && kpi.status !== "ok" && statusInfo ? <StatusBadge tone="warning">{statusInfo.label}</StatusBadge> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * KPI ledger: one surface divided by hairlines, read like the summary strip of a statement.
 * Cells keep their borders when the last row is short.
 */
export function KpiLedger({
  kpis,
  currency,
  comparisonLabel,
  className,
  columns = "grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
}: {
  kpis: Kpi[];
  currency?: string | null;
  comparisonLabel?: string;
  className?: string;
  columns?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10", className)}>
      <div className={cn("-mt-px -ml-px grid", columns)}>
        {kpis.map((kpi) => (
          <KpiCell
            key={kpi.key}
            kpi={kpi}
            currency={currency}
            comparisonLabel={comparisonLabel}
            className="border-t border-l border-border"
          />
        ))}
      </div>
    </div>
  );
}
