"use client";

import { AwardIcon, GitCompareArrowsIcon, LoaderCircleIcon } from "lucide-react";
import { useId } from "react";

import { StatusBadge } from "@/components/app/badges";
import { NoteList, Panel } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cleanAmount, cleanFraction, formatAmount, formatDelta, formatProbability, isNum } from "@/lib/app/decision-lab-format";
import type { SavedScenario, ScenarioComparison, ScenarioComparisonRow } from "@/lib/app/decision-lab-types";
import { formatDateTime, formatPercent, formatPoints, MISSING } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { QueryError, RangeStrip, rangeDomain } from "./common";
import { leverNames } from "./saved";

type MetricRow = {
  key: string;
  label: string;
  value: (r: ScenarioComparisonRow) => number | null;
  format: (v: number | null, currency: string) => string;
  higherIsBetter?: boolean;
};

const ROWS: MetricRow[] = [
  { key: "ns", label: "Net sales change", value: (r) => cleanAmount(r.delta.net_sales), format: formatDelta, higherIsBetter: true },
  { key: "gp", label: "Gross profit change", value: (r) => cleanAmount(r.delta.gross_profit), format: formatDelta, higherIsBetter: true },
  { key: "ox", label: "Operating expenses change", value: (r) => cleanAmount(r.delta.operating_expenses), format: formatDelta, higherIsBetter: false },
  { key: "eb", label: "EBITDA change", value: (r) => cleanAmount(r.delta.ebitda), format: formatDelta, higherIsBetter: true },
  { key: "np", label: "Net profit change", value: (r) => cleanAmount(r.delta.net_profit), format: formatDelta, higherIsBetter: true },
  { key: "fcf", label: "Free cash flow change", value: (r) => cleanAmount(r.delta.free_cash_flow), format: formatDelta, higherIsBetter: true },
  { key: "nm", label: "Net margin change", value: (r) => cleanFraction(r.net_margin_pp), format: (v) => formatPoints(v), higherIsBetter: true },
  { key: "p10", label: "Net profit P10 (downside)", value: (r) => cleanAmount(r.net_profit_p10), format: formatDelta, higherIsBetter: true },
  { key: "p50", label: "Net profit P50", value: (r) => cleanAmount(r.net_profit_p50), format: formatDelta, higherIsBetter: true },
  { key: "p90", label: "Net profit P90", value: (r) => cleanAmount(r.net_profit_p90), format: formatDelta, higherIsBetter: true },
  { key: "pp", label: "Probability profit improves", value: (r) => r.probability_profit_positive, format: (v) => formatProbability(v), higherIsBetter: true },
  { key: "inv", label: "Investment", value: (r) => cleanAmount(r.investment), format: formatAmount },
  { key: "roi", label: "ROI", value: (r) => r.roi, format: (v) => (isNum(v) ? formatPercent(v) : "Not defined"), higherIsBetter: true },
  { key: "pb", label: "Payback", value: (r) => r.payback_months, format: (v) => (isNum(v) ? `Month ${v}` : "No payback") },
  { key: "npv", label: "NPV", value: (r) => cleanAmount(r.npv), format: formatDelta, higherIsBetter: true },
];

export function CompareSelector({
  scenarios,
  selectedIds,
  onSelectionChange,
  onCompare,
  comparing,
}: {
  scenarios: SavedScenario[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onCompare: () => void;
  comparing: boolean;
}) {
  const baseId = useId();
  const count = selectedIds.length;
  return (
    <Panel
      title="Choose scenarios"
      description="Pick between two and six saved scenarios"
      actions={
        <Button onClick={onCompare} disabled={count < 2 || count > 6 || comparing}>
          {comparing ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <GitCompareArrowsIcon aria-hidden />}
          Compare {count >= 2 ? count : ""} scenarios
        </Button>
      }
    >
      {scenarios.length < 2 ? (
        <EmptyState compact icon={GitCompareArrowsIcon} title="Save at least two scenarios to compare them" />
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3" aria-label="Saved scenarios">
          {scenarios.map((s) => {
            const id = `${baseId}-${s.id}`;
            const checked = selectedIds.includes(s.id);
            return (
              <li key={s.id}>
                <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-muted", checked && "bg-muted/70")}>
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={checked}
                    disabled={!checked && count >= 6}
                    onCheckedChange={(value) => onSelectionChange(value === true ? [...selectedIds, s.id] : selectedIds.filter((x) => x !== s.id))}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      v{s.version} · {leverNames(s.levers).join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {count > 6 ? <p className="mt-2 text-xs text-destructive">At most six scenarios can be compared.</p> : null}
    </Panel>
  );
}

export function ComparisonResult({ data, currency }: { data: ScenarioComparison; currency: string }) {
  const rows = data.scenarios;
  const best = rows.find((r) => r.scenario_id === data.best_risk_adjusted) ?? null;
  const domain = rangeDomain(rows.flatMap((r) => [cleanAmount(r.net_profit_p10), cleanAmount(r.net_profit_p90)]));
  const others = rows.filter((r) => r !== best && isNum(r.net_profit_p10));
  const runnerUp = others.sort((a, b) => (b.net_profit_p10 ?? 0) - (a.net_profit_p10 ?? 0))[0];
  const bestByMedian = [...rows].filter((r) => isNum(r.net_profit_p50)).sort((a, b) => (b.net_profit_p50 ?? 0) - (a.net_profit_p50 ?? 0))[0];
  return (
    <div className="space-y-6">
      {best ? (
        <section aria-label="Best risk-adjusted scenario" className="rounded-xl bg-navy-950 px-5 py-4 text-white ring-1 ring-white/10 sm:px-6">
          <p className="flex items-center gap-2 text-[0.8125rem] text-navy-200">
            <AwardIcon className="size-4 text-sky-accent" aria-hidden />
            Best risk-adjusted outcome
          </p>
          <p className="mt-1 font-heading text-xl font-semibold">{best.name}</p>
          <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-navy-100">
            Even in a 1-in-10 unfavourable outcome its net profit changes by{" "}
            <strong className="font-semibold text-white">{formatDelta(best.net_profit_p10, currency)}</strong>
            {runnerUp ? (
              <>
                , ahead of {runnerUp.name} at {formatDelta(runnerUp.net_profit_p10, currency)}
              </>
            ) : null}
            .{" "}
            {bestByMedian && bestByMedian.scenario_id !== best.scenario_id
              ? `${bestByMedian.name} has the higher median (${formatDelta(bestByMedian.net_profit_p50, currency)}) but a weaker downside.`
              : "It also has the highest median outcome."}
          </p>
          <p className="mt-2 text-xs text-navy-300">{data.ranking_basis}</p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No scenario has a Monte Carlo downside, so no risk-adjusted ranking is possible.</p>
      )}

      <Panel title="Net profit range" description="P10 to P90 change in net profit; the tick is the median. Same scale for every scenario.">
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.scenario_id} className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-[0.8125rem] font-medium">{r.name}</p>
                {r.scenario_id === data.best_risk_adjusted ? (
                  <StatusBadge tone="good" icon={AwardIcon}>
                    Best risk-adjusted
                  </StatusBadge>
                ) : null}
              </div>
              <RangeStrip
                label={r.name}
                low={cleanAmount(r.net_profit_p10)}
                mid={cleanAmount(r.net_profit_p50)}
                high={cleanAmount(r.net_profit_p90)}
                format={(v) => formatDelta(v, currency)}
                domain={domain}
                emphasis={r.scenario_id === data.best_risk_adjusted}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Side by side" description="Change against each scenario's forecast baseline over its horizon" footer={<NoteList notes={data.notes} />}>
        <div className="relative w-full overflow-x-auto rounded-lg ring-1 ring-foreground/8" tabIndex={0} role="region" aria-label="Scenario comparison table">
          <table className="w-full border-collapse text-[0.8125rem]">
            <caption className="sr-only">Scenario comparison: metrics by scenario</caption>
            <thead className="bg-muted/60">
              <tr className="border-b">
                <th scope="col" className="sticky left-0 z-[1] min-w-[12rem] bg-muted px-3 py-2 text-left font-medium text-muted-foreground">
                  Measure
                </th>
                {rows.map((r) => (
                  <th
                    key={r.scenario_id}
                    scope="col"
                    className={cn(
                      "min-w-[9rem] px-3 py-2 text-right align-bottom font-semibold whitespace-nowrap",
                      r.scenario_id === data.best_risk_adjusted && "bg-success/10",
                    )}
                  >
                    <span className="block truncate">{r.name}</span>
                    <span className="block text-[0.6875rem] font-normal text-muted-foreground">
                      v{r.version} · {r.horizon_months ?? MISSING} mo · {formatDateTime(r.computed_at)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((metric) => {
                const values = rows.map(metric.value);
                const numeric = values.filter(isNum);
                const top = metric.higherIsBetter === undefined || numeric.length < 2 ? null : metric.higherIsBetter ? Math.max(...numeric) : Math.min(...numeric);
                return (
                  <tr key={metric.key} className={cn("border-b last:border-b-0", metric.key === "p10" && "bg-muted/30")}>
                    <th scope="row" className="sticky left-0 z-[1] bg-card px-3 py-2 text-left font-normal whitespace-nowrap">
                      {metric.label}
                    </th>
                    {rows.map((r, i) => (
                      <td
                        key={r.scenario_id}
                        className={cn(
                          "px-3 py-2 text-right whitespace-nowrap tabular",
                          r.scenario_id === data.best_risk_adjusted && "bg-success/6",
                          top !== null && values[i] === top && "font-semibold",
                        )}
                      >
                        {metric.format(values[i], currency)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="border-b last:border-b-0">
                <th scope="row" className="sticky left-0 z-[1] bg-card px-3 py-2 text-left font-normal whitespace-nowrap">
                  Warnings
                </th>
                {rows.map((r) => (
                  <td key={r.scenario_id} className="px-3 py-2 text-right whitespace-nowrap tabular">
                    {r.warnings.length}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Bold marks the best value in each row where better has a direction.</p>
      </Panel>
    </div>
  );
}

export function CompareError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Panel>
      <QueryError error={error} onRetry={onRetry} />
    </Panel>
  );
}
