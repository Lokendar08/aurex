"use client";

import { ArrowDownRightIcon, ArrowUpRightIcon, CircleAlertIcon, LockIcon, MinusIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { useChartView } from "@/components/app/charts/chart-parts";
import { DataTable, type Column } from "@/components/app/data-table";
import { DetailList, NoteList, Panel, SectionHeading } from "@/components/app/page";
import { periodTitle } from "@/components/app/sections/sales";
import { Notice } from "@/components/app/states";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  cleanAmount,
  cleanFraction,
  formatAmount,
  formatDelta,
  formatFullAmount,
  formatProbability,
  isNum,
} from "@/lib/app/decision-lab-format";
import type { PnlMonth, SimulationResult } from "@/lib/app/decision-lab-types";
import { formatDate, formatMonth, formatNumber, formatPercent, formatPoints, humanize, MISSING } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { CumulativeCashChart, DeltaBarsChart, ScenarioLinesChart, Tornado, tornadoRows } from "./charts";
import { Figure, HashValue, RangeStrip, rangeDomain, ReliabilityBadge, SourceLegend, SyntheticBadge } from "./common";
import { AssumptionRows, LeverResultPanel } from "./lever-results";

type MetricKey = "net_sales" | "operating_expenses" | "ebitda" | "net_profit" | "free_cash_flow" | "gross_profit";

const METRICS: { key: MetricKey; label: string; up: boolean }[] = [
  { key: "net_profit", label: "Net profit", up: true },
  { key: "net_sales", label: "Net sales", up: true },
  { key: "gross_profit", label: "Gross profit", up: true },
  { key: "operating_expenses", label: "Operating expenses", up: false },
  { key: "ebitda", label: "EBITDA", up: true },
  { key: "free_cash_flow", label: "Free cash flow", up: true },
];

function direction(value: number | null, up: boolean): "good" | "bad" | "none" {
  if (value === null || value === 0) return "none";
  return value > 0 === up ? "good" : "bad";
}

/** One delta figure in the outcome band: value, arrow, whether the move is favourable. */
function BandFigure({
  label,
  value,
  text,
  up = true,
  hint,
}: {
  label: string;
  value: number | null;
  text: string;
  up?: boolean;
  hint?: ReactNode;
}) {
  const dir = direction(value, up);
  const Icon = value === null || value === 0 ? MinusIcon : value > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;
  const word = value === null ? "not available" : value === 0 ? "no change" : `${value > 0 ? "increase" : "decrease"}, ${dir === "good" ? "favourable" : "unfavourable"}`;
  return (
    <div role="group" aria-label={`${label} change`} className="min-w-0 border-t border-white/10 px-4 py-3.5 sm:px-5">
      <p className="text-xs text-navy-200">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-lg leading-tight font-semibold text-white">
        <Icon
          className={cn(
            "size-4 shrink-0",
            dir === "good" && "text-[color-mix(in_oklch,var(--success),white_35%)]",
            dir === "bad" && "text-[color-mix(in_oklch,var(--destructive),white_30%)]",
            dir === "none" && "text-navy-300",
          )}
          aria-hidden
        />
        <span>{text}</span>
        <span className="sr-only"> ({word})</span>
      </p>
      {hint ? <p className="mt-0.5 text-xs leading-snug text-navy-300">{hint}</p> : null}
    </div>
  );
}

/** The headline of a simulation: net profit change with its P10–P90 range, then the other deltas. */
function OutcomeBand({ result, scopeLabel }: { result: SimulationResult; scopeLabel: string }) {
  const currency = result.scope.currency;
  const totals = result.delta.totals;
  const net = cleanAmount(totals.net_profit);
  const unc = result.uncertainty;
  const npd = unc?.net_profit_delta;
  const months = result.months;
  const range = months.length ? `${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])}` : null;
  const netDir = direction(net, true);
  return (
    <section aria-label="Simulation outcome" className="overflow-hidden rounded-2xl bg-navy-950 text-white ring-1 ring-white/10">
      <div className="grid gap-0 @4xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="px-5 pt-5 pb-5 sm:px-6">
          <p className="text-[0.8125rem] text-navy-200">
            Net profit change over {result.horizon_months} {result.horizon_months === 1 ? "month" : "months"}
            {range ? <span className="text-navy-300"> · {range}</span> : null}
          </p>
          <p
            role="group"
            aria-label="Net profit change"
            className={cn(
              "mt-2 text-[2.5rem] leading-none font-semibold tracking-[-0.03em] sm:text-[3rem]",
              netDir === "bad" && "text-[color-mix(in_oklch,var(--destructive),white_45%)]",
              netDir === "good" && "text-[color-mix(in_oklch,var(--success),white_50%)]",
            )}
          >
            {formatDelta(net, currency)}
          </p>
          <p className="mt-1.5 text-[0.8125rem] text-navy-200">
            {netDir === "none" ? "No change against the forecast baseline" : `${netDir === "good" ? "Better" : "Worse"} than the forecast baseline`}
            {isNum(totals.net_profit) ? <span className="text-navy-300"> · {formatFullAmount(totals.net_profit, currency)}</span> : null}
          </p>
          <div className="mt-5 max-w-md">
            <p className="mb-1.5 text-xs text-navy-200">Range across {formatNumber(unc?.runs ?? null)} Monte Carlo runs</p>
            <RangeStrip
              surface="dark"
              label="Net profit change"
              low={cleanAmount(npd?.p10)}
              mid={cleanAmount(npd?.p50)}
              high={cleanAmount(npd?.p90)}
              format={(v) => formatDelta(v, currency)}
            />
          </div>
          <p className="mt-4 text-[0.8125rem] text-navy-100">
            Probability net profit improves:{" "}
            <strong className="font-semibold text-white">{formatProbability(unc?.probability_net_profit_positive)}</strong>
          </p>
        </div>
        <div className="grid grid-cols-1 border-white/10 @xs:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-2 @4xl:border-l">
          <BandFigure label="Net sales" value={cleanAmount(totals.net_sales)} text={formatDelta(totals.net_sales, currency)} />
          <BandFigure
            label="Operating expenses"
            value={cleanAmount(totals.operating_expenses)}
            text={formatDelta(totals.operating_expenses, currency)}
            up={false}
          />
          <BandFigure label="EBITDA" value={cleanAmount(totals.ebitda)} text={formatDelta(totals.ebitda, currency)} />
          <BandFigure label="Free cash flow" value={cleanAmount(totals.free_cash_flow)} text={formatDelta(totals.free_cash_flow, currency)} />
          <BandFigure label="Net margin" value={cleanFraction(result.delta.net_margin_pp)} text={formatPoints(cleanFraction(result.delta.net_margin_pp))} />
          <BandFigure label="Gross margin" value={cleanFraction(result.delta.gross_margin_pp)} text={formatPoints(cleanFraction(result.delta.gross_margin_pp))} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/10 px-5 py-3 text-xs text-navy-200 sm:px-6">
        <span>Scope: {scopeLabel}</span>
        <span>Against the forecast baseline{result.baseline?.as_of ? ` with data to ${formatDate(result.baseline.as_of)}` : ""}</span>
        {result.scope.is_synthetic ? <span className="font-medium text-navy-100">Synthetic demonstration data</span> : null}
      </div>
    </section>
  );
}

function monthlyRows(result: SimulationResult, key: MetricKey) {
  const base = result.baseline?.monthly ?? [];
  const scen = result.scenario?.monthly ?? [];
  return result.delta.monthly.map((d, i) => ({
    month: d.month,
    baseline: (base[i]?.[key as keyof PnlMonth] as number | null | undefined) ?? null,
    scenario: (scen[i]?.[key as keyof PnlMonth] as number | null | undefined) ?? null,
    delta: (d[key as keyof PnlMonth] as number | null) ?? null,
  }));
}

function MonthlyPanel({ result }: { result: SimulationResult }) {
  const [metric, setMetric] = useState<MetricKey>("net_profit");
  const [view, toggle] = useChartView("Month by month");
  const currency = result.scope.currency;
  const info = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const rows = useMemo(() => monthlyRows(result, metric), [result, metric]);
  const absolute = Boolean(result.baseline && result.scenario);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "month", header: "Month", cell: (r) => periodTitle(r.month, "month"), sortValue: (r) => r.month },
    ...(absolute
      ? ([
          { key: "baseline", header: "Baseline", align: "right", cell: (r) => formatAmount(r.baseline, currency), sortValue: (r) => r.baseline },
          { key: "scenario", header: "Scenario", align: "right", cell: (r) => formatAmount(r.scenario, currency), sortValue: (r) => r.scenario },
        ] as Column<(typeof rows)[number]>[])
      : []),
    { key: "delta", header: "Change", align: "right", cell: (r) => formatDelta(r.delta, currency), sortValue: (r) => r.delta },
  ];
  const selectId = "dl-monthly-metric";
  return (
    <Panel
      title="Month by month"
      description={absolute ? "Scenario against the forecast baseline" : "Change against the forecast baseline"}
      actions={
        <>
          <Label htmlFor={selectId} className="sr-only">
            Measure
          </Label>
          <Select value={metric} onValueChange={(value) => setMetric(value as MetricKey)}>
            <SelectTrigger id={selectId} size="sm" className="h-7 w-[11.5rem] bg-background text-[0.8125rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {METRICS.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {toggle}
        </>
      }
      footer={
        absolute
          ? undefined
          : "Absolute baseline and scenario P&L require finance access; the changes are shown."
      }
    >
      {view === "table" ? (
        <DataTable caption={`${info.label} by month`} columns={columns} rows={rows} rowKey={(r) => r.month} dense maxHeight={340} />
      ) : absolute ? (
        <ScenarioLinesChart data={rows} currency={currency} metricLabel={info.label} ariaLabel={`${info.label}: scenario against baseline by month`} />
      ) : (
        <DeltaBarsChart
          data={rows.map((r) => ({ month: r.month, delta: r.delta }))}
          currency={currency}
          metricLabel={info.label}
          favourableWhenUp={info.up}
          ariaLabel={`Change in ${info.label.toLowerCase()} by month`}
        />
      )}
    </Panel>
  );
}

function UncertaintyPanel({ result }: { result: SimulationResult }) {
  const currency = result.scope.currency;
  const unc = result.uncertainty;
  if (!unc) {
    return (
      <Panel title="Uncertainty">
        <p className="text-sm text-muted-foreground">The Monte Carlo summary is not available for this run.</p>
      </Panel>
    );
  }
  const rows = [
    { key: "np", label: "Net profit change", q: unc.net_profit_delta },
    { key: "ns", label: "Net sales change", q: unc.net_sales_delta },
    { key: "fcf", label: "Free cash flow change", q: unc.free_cash_flow_delta },
  ];
  const money = (v: number) => formatDelta(v, currency);
  return (
    <Panel
      title="Uncertainty"
      description={`P10, median and P90 across ${formatNumber(unc.runs)} runs (seed ${unc.seed})`}
      footer={<NoteList notes={[unc.method, ...(result.downside ? [`Downside case: ${result.downside.definition}`] : [])]} />}
    >
      <ul className="space-y-5">
        {rows.map((row) => (
          <li key={row.key}>
            <p className="mb-1.5 text-[0.8125rem] font-medium">{row.label}</p>
            <RangeStrip
              label={row.label}
              low={cleanAmount(row.q?.p10)}
              mid={cleanAmount(row.q?.p50)}
              high={cleanAmount(row.q?.p90)}
              format={money}
              domain={rangeDomain([cleanAmount(row.q?.p10), cleanAmount(row.q?.p90)])}
            />
          </li>
        ))}
      </ul>
      <div className="@container mt-5 border-t pt-4">
        <div className="grid gap-4 @md:grid-cols-3">
          <Figure label="Probability net profit improves" value={formatProbability(unc.probability_net_profit_positive)} />
          <Figure
            label="Downside net profit change"
            value={formatDelta(result.downside?.net_profit_delta, currency)}
            hint="1-in-10 unfavourable outcome"
          />
          <Figure
            label="ROI range (P10–P90)"
            value={unc.roi && isNum(unc.roi.p10) && isNum(unc.roi.p90) ? `${formatPercent(unc.roi.p10)} to ${formatPercent(unc.roi.p90)}` : "Not available"}
            hint={unc.roi ? undefined : "ROI is undefined without upfront investment."}
          />
        </div>
      </div>
    </Panel>
  );
}

function CashPanel({ result }: { result: SimulationResult }) {
  const currency = result.scope.currency;
  const inv = result.investment;
  const [view, toggle] = useChartView("Cumulative cash");
  const rows = result.months.map((month, i) => ({ month, index: i + 1, value: inv.cumulative_free_cash_flow[i] ?? null }));
  return (
    <Panel
      title="Cash and payback"
      description="Cumulative change in free cash flow against the baseline"
      actions={toggle}
      footer={<NoteList notes={[inv.roi_note, inv.payback_note].filter((n): n is string => Boolean(n))} />}
    >
      <div className="@container mb-4">
        <div className="grid grid-cols-2 gap-4 @lg:grid-cols-4">
          <Figure
            label="Investment"
            value={formatAmount(inv.investment, currency)}
            hint={`Capex ${formatAmount(inv.capex, currency)} · working capital ${formatAmount(inv.working_capital, currency)}`}
          />
          <Figure label="ROI" value={isNum(inv.roi) ? formatPercent(inv.roi) : "Not defined"} hint={isNum(inv.roi) ? undefined : "See the note below"} />
          <Figure
            label="Payback"
            value={isNum(inv.payback_months) ? `Month ${inv.payback_months}` : "No payback"}
            hint={isNum(inv.payback_months) ? undefined : "Within the horizon"}
          />
          <Figure
            label={`NPV at ${formatPercent(inv.discount_rate_annual, { decimals: 0 })}`}
            value={formatDelta(inv.npv, currency)}
            hint="Discounted incremental cash flow"
          />
        </div>
      </div>
      {view === "table" ? (
        <DataTable
          caption="Cumulative incremental free cash flow by month"
          columns={[
            { key: "m", header: "Month", cell: (r) => `${r.index} · ${periodTitle(r.month, "month")}`, sortValue: (r) => r.index },
            { key: "v", header: "Cumulative cash vs baseline", align: "right", cell: (r) => formatDelta(r.value, currency), sortValue: (r) => r.value },
          ]}
          rows={rows}
          rowKey={(r) => r.month}
          dense
          maxHeight={300}
        />
      ) : (
        <CumulativeCashChart months={result.months} values={inv.cumulative_free_cash_flow} paybackMonth={inv.payback_months} currency={currency} />
      )}
    </Panel>
  );
}

function SensitivityPanel({ result }: { result: SimulationResult }) {
  const currency = result.scope.currency;
  const [view, toggle] = useChartView("Sensitivity");
  const { visible, negligible } = tornadoRows(result.sensitivity ?? []);
  const base = result.sensitivity?.find((r) => isNum(r.base))?.base ?? null;
  return (
    <Panel
      title="What moves the result"
      description="Net profit change when each uncertain parameter is set to its low and high case, others at base"
      actions={visible.length ? toggle : undefined}
      footer={negligible ? `${negligible} parameter${negligible === 1 ? "" : "s"} with a negligible effect not shown.` : undefined}
    >
      {!visible.length ? (
        <p className="text-sm text-muted-foreground">
          No uncertain parameter moves this result: every effect in this scenario is a known cost or an accounting identity.
        </p>
      ) : view === "table" ? (
        <DataTable
          caption="Sensitivity of the net profit change"
          columns={[
            { key: "p", header: "Parameter", cell: (r) => r.parameter },
            { key: "l", header: "Low case", align: "right", cell: (r) => formatDelta(r.low_case, currency), sortValue: (r) => r.low_case },
            { key: "h", header: "High case", align: "right", cell: (r) => formatDelta(r.high_case, currency), sortValue: (r) => r.high_case },
            { key: "s", header: "Swing", align: "right", cell: (r) => formatAmount(r.swing, currency), sortValue: (r) => r.swing },
          ]}
          rows={visible}
          rowKey={(r) => r.parameter}
          dense
        />
      ) : (
        <Tornado rows={visible} currency={currency} baseLabel={`Base case ${formatDelta(base, currency)}`} />
      )}
    </Panel>
  );
}

function ReproducibilityPanel({ result, engineVersion }: { result: SimulationResult; engineVersion?: string }) {
  const source = result.baseline?.revenue_source ?? result.evidence_summary?.baseline_revenue_model ?? null;
  const window = result.baseline?.trailing_window ?? result.evidence_summary?.trailing_window ?? null;
  return (
    <Panel title="Baseline and reproducibility" description="What the scenario is compared against, and how to reproduce it">
      <DetailList
        items={[
          {
            label: "Baseline revenue model",
            value: source?.algorithm ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                {humanize(source.algorithm)} v{source.version ?? MISSING}
                <ReliabilityBadge reliability={source.reliability} />
              </span>
            ) : (
              "Not available"
            ),
          },
          { label: "Daily forecast error (WAPE)", value: isNum(source?.wape_daily) ? formatPercent(source?.wape_daily) : "Not available" },
          { label: "Cost structure window", value: window ? `${formatDate(window.start)} to ${formatDate(window.end)}` : "Not available" },
          { label: "Engine version", value: result.engine_version ?? engineVersion ?? MISSING },
          {
            label: "Monte Carlo",
            value: result.uncertainty ? `${formatNumber(result.uncertainty.runs)} runs, seed ${result.uncertainty.seed}` : "Not available",
          },
          { label: "Discount rate", value: formatPercent(result.investment.discount_rate_annual, { decimals: 0 }) },
          { label: "Inputs hash", value: <HashValue value={result.inputs_hash} /> },
        ]}
      />
      {result.baseline?.notes?.length ? <NoteList className="mt-4" notes={result.baseline.notes} /> : null}
      {source?.model_id ? (
        <p className="mt-3 text-xs text-muted-foreground">
          The same inputs and seed reproduce these figures exactly.{" "}
          <Link href="/app/forecasts" className="font-medium text-primary underline-offset-3 hover:underline">
            See the forecast model
          </Link>
        </p>
      ) : null}
    </Panel>
  );
}

/** The full result of one simulation (fresh run or a saved scenario's latest run). */
export function SimulationResults({
  result,
  scopeLabel,
  categories,
  engineVersion,
  title,
}: {
  result: SimulationResult;
  scopeLabel: string;
  categories: Record<string, string>;
  engineVersion?: string;
  title?: ReactNode;
}) {
  const currency = result.scope.currency;
  const revenueNotes = result.levers.filter((l) => l.revenue_effect_note);
  return (
    <div className="@container space-y-6">
      {title}
      <OutcomeBand result={result} scopeLabel={scopeLabel} />

      {revenueNotes.length ? (
        <div className="space-y-2" aria-label="Revenue effects">
          {revenueNotes.map((lever) => (
            <div
              key={lever.index}
              className="flex items-start gap-2.5 rounded-lg bg-brand-50 px-4 py-3 text-sm leading-relaxed text-navy-800 ring-1 ring-brand-200/80 dark:bg-brand-800/25 dark:text-navy-100 dark:ring-brand-700/40"
            >
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-sky-accent" aria-hidden />
              <p>
                <strong className="font-semibold">Revenue effect{revenueNotes.length > 1 ? ` (lever ${lever.index + 1})` : ""}:</strong>{" "}
                {lever.revenue_effect_note}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {result.warnings?.length ? (
        <Notice tone="warning" title={`${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`}>
          <NoteList notes={result.warnings} />
        </Notice>
      ) : null}

      {result.redacted ? (
        <div className="flex items-start gap-2.5 rounded-lg bg-muted/70 px-3.5 py-3 text-sm leading-relaxed">
          <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">{result.redacted}</p>
        </div>
      ) : null}

      <div className="grid gap-6 @5xl:grid-cols-2">
        <MonthlyPanel result={result} />
        <UncertaintyPanel result={result} />
        <CashPanel result={result} />
        <SensitivityPanel result={result} />
      </div>

      <SectionHeading
        title="Levers"
        description="What each change does, the evidence behind it and the assumptions it rests on"
        actions={<SourceLegend />}
      />
      <div className="grid gap-4 @5xl:grid-cols-2">
        {result.levers.map((lever) => (
          <LeverResultPanel key={lever.index} lever={lever} currency={currency} categories={categories} />
        ))}
      </div>

      <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="All assumptions" description="Every input the result depends on, with its source">
          <AssumptionRows assumptions={result.assumptions} currency={currency} showLever />
        </Panel>
        <ReproducibilityPanel result={result} engineVersion={engineVersion} />
      </div>
      {result.scope.is_synthetic ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <SyntheticBadge /> Computed on synthetic demonstration data for the fictional NovaMart retailer.
        </p>
      ) : null}
    </div>
  );
}

export function WarningInline({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      {children}
    </p>
  );
}
