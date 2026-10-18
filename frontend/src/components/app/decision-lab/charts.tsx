"use client";

import type { ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { ChartLegend, TooltipCard } from "@/components/app/charts/chart-parts";
import { ANCHOR_COLOR, AXIS_TEXT, CONTEXT_COLOR, GRID_COLOR, NEGATIVE_COLOR, POSITIVE_COLOR, SERIES_COLORS } from "@/components/app/charts/palette";
import { periodAxisLabel, periodTitle } from "@/components/app/sections/sales";
import { cleanAmount, formatDelta, isNum } from "@/lib/app/decision-lab-format";
import type { SensitivityRow } from "@/lib/app/decision-lab-types";
import { moneyTick } from "@/lib/app/format";
import { cn } from "@/lib/utils";

const TICK = { fill: AXIS_TEXT, fontSize: 12 };

type Datum = Record<string, number | string | null>;

function monthLabel(value: string) {
  return periodAxisLabel(value, "month");
}

/** Baseline (context grey) against the scenario (brand) for one P&L line, by month. */
export function ScenarioLinesChart({
  data,
  currency,
  metricLabel,
  ariaLabel,
  height = 260,
}: {
  data: { month: string; baseline: number | null; scenario: number | null }[];
  currency: string;
  metricLabel: string;
  ariaLabel: string;
  height?: number;
}) {
  const money = (v: number) => formatDelta(v, currency).replace(/^\+/, "");
  function renderTooltip(props: TooltipContentProps) {
    if (!props.active || !props.payload?.length) return null;
    const point = props.payload[0]?.payload as { month: string; baseline: number | null; scenario: number | null };
    const diff = isNum(point.scenario) && isNum(point.baseline) ? point.scenario - point.baseline : null;
    return (
      <TooltipCard
        title={periodTitle(point.month, "month")}
        rows={[
          { key: "s", label: "Scenario", color: SERIES_COLORS[0], value: isNum(point.scenario) ? money(point.scenario) : "Not available" },
          { key: "b", label: "Baseline", color: CONTEXT_COLOR, value: isNum(point.baseline) ? money(point.baseline) : "Not available" },
        ]}
        footer={diff !== null ? `Change ${formatDelta(diff, currency)}` : undefined}
      />
    );
  }
  return (
    <figure className="flex min-w-0 flex-col gap-3" aria-label={ariaLabel}>
      <ChartLegend
        items={[
          { label: `Scenario ${metricLabel.toLowerCase()}`, color: SERIES_COLORS[0], shape: "line" },
          { label: `Baseline ${metricLabel.toLowerCase()}`, color: CONTEXT_COLOR, shape: "line" },
        ]}
      />
      <div style={{ height }} className="min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={{ stroke: GRID_COLOR }} tick={TICK} minTickGap={12} tickMargin={8} />
            <YAxis tickFormatter={moneyTick(currency)} tickLine={false} axisLine={false} tick={TICK} width={68} tickCount={5} />
            <Tooltip content={renderTooltip} cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="baseline" stroke={CONTEXT_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} isAnimationActive={false} />
            <Line type="monotone" dataKey="scenario" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Monthly change (scenario − baseline) as columns coloured by direction of the change. */
export function DeltaBarsChart({
  data,
  currency,
  metricLabel,
  ariaLabel,
  favourableWhenUp = true,
  height = 240,
}: {
  data: { month: string; delta: number | null }[];
  currency: string;
  metricLabel: string;
  ariaLabel: string;
  favourableWhenUp?: boolean;
  height?: number;
}) {
  const cleaned = data.map((d) => ({ ...d, delta: cleanAmount(d.delta) }));
  function renderTooltip(props: TooltipContentProps) {
    if (!props.active || !props.payload?.length) return null;
    const point = props.payload[0]?.payload as { month: string; delta: number | null };
    const good = isNum(point.delta) && point.delta !== 0 ? point.delta > 0 === favourableWhenUp : null;
    return (
      <TooltipCard
        title={periodTitle(point.month, "month")}
        rows={[
          {
            key: "d",
            label: `Change in ${metricLabel.toLowerCase()}`,
            color: good === null ? CONTEXT_COLOR : good ? POSITIVE_COLOR : NEGATIVE_COLOR,
            value: isNum(point.delta) ? formatDelta(point.delta, currency) : "Not available",
          },
        ]}
      />
    );
  }
  return (
    <figure className="min-w-0" aria-label={ariaLabel}>
      <div style={{ height }} className="min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={cleaned} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={{ stroke: GRID_COLOR }} tick={TICK} minTickGap={12} tickMargin={8} />
            <YAxis
              tickFormatter={moneyTick(currency)}
              tickLine={false}
              axisLine={false}
              tick={TICK}
              width={68}
              tickCount={5}
              domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]}
            />
            <ReferenceLine y={0} stroke={AXIS_TEXT} strokeOpacity={0.6} />
            <Tooltip content={renderTooltip} cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }} isAnimationActive={false} />
            <Bar dataKey="delta" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {cleaned.map((d) => {
                const value = d.delta ?? 0;
                const good = value === 0 ? null : value > 0 === favourableWhenUp;
                return <Cell key={d.month} fill={good === null ? CONTEXT_COLOR : good ? POSITIVE_COLOR : NEGATIVE_COLOR} />;
              })}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: POSITIVE_COLOR }} /> Favourable change
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: NEGATIVE_COLOR }} /> Unfavourable change
        </li>
      </ul>
    </figure>
  );
}

/** Cumulative incremental free cash flow with the zero line and the payback month marked. */
export function CumulativeCashChart({
  months,
  values,
  paybackMonth,
  currency,
  height = 240,
}: {
  months: string[];
  values: (number | null)[];
  paybackMonth: number | null;
  currency: string;
  height?: number;
}) {
  const data = months.map((month, i) => ({ month, index: i + 1, value: cleanAmount(values[i] ?? null) }));
  const payback = paybackMonth && paybackMonth >= 1 && paybackMonth <= months.length ? months[paybackMonth - 1] : null;
  function renderTooltip(props: TooltipContentProps) {
    if (!props.active || !props.payload?.length) return null;
    const point = props.payload[0]?.payload as { month: string; index: number; value: number | null };
    return (
      <TooltipCard
        title={`Month ${point.index} · ${periodTitle(point.month, "month")}`}
        rows={[{ key: "v", label: "Cumulative cash vs baseline", color: ANCHOR_COLOR, value: isNum(point.value) ? formatDelta(point.value, currency) : "Not available" }]}
        footer={payback === point.month ? "Payback: cumulative cash turns positive" : undefined}
      />
    );
  }
  return (
    <figure className="min-w-0" aria-label="Cumulative incremental free cash flow by month">
      <div style={{ height }} className="min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={{ stroke: GRID_COLOR }} tick={TICK} minTickGap={12} tickMargin={8} />
            <YAxis tickFormatter={moneyTick(currency)} tickLine={false} axisLine={false} tick={TICK} width={68} tickCount={5} />
            <ReferenceLine y={0} stroke={AXIS_TEXT} strokeOpacity={0.6} />
            {payback ? (
              <ReferenceLine
                x={payback}
                stroke={POSITIVE_COLOR}
                strokeWidth={1.5}
                label={{ value: `Payback · month ${paybackMonth}`, position: "insideTopLeft", fill: "var(--foreground)", fontSize: 11 }}
              />
            ) : null}
            <Tooltip content={renderTooltip} cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={ANCHOR_COLOR}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 2, stroke: "var(--card)", fill: ANCHOR_COLOR }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------
// Tornado (sensitivity)
// ---------------------------------------------------------------------------------------------

export type TornadoRow = SensitivityRow & { lowDelta: number; highDelta: number };

/** Rows with a meaningful swing, relative to the base case; tiny float noise is dropped. */
export function tornadoRows(rows: SensitivityRow[]): { visible: TornadoRow[]; negligible: number } {
  const usable = rows.filter((r) => isNum(r.base) && isNum(r.low_case) && isNum(r.high_case));
  const maxSwing = Math.max(0, ...usable.map((r) => Math.abs(r.swing ?? 0)));
  const threshold = Math.max(1, maxSwing * 0.001);
  const visible: TornadoRow[] = [];
  let negligible = 0;
  for (const r of usable) {
    const lowDelta = (r.low_case as number) - (r.base as number);
    const highDelta = (r.high_case as number) - (r.base as number);
    if (Math.max(Math.abs(lowDelta), Math.abs(highDelta)) < threshold) {
      negligible += 1;
      continue;
    }
    visible.push({ ...r, lowDelta, highDelta });
  }
  visible.sort((a, b) => Math.abs(b.swing ?? 0) - Math.abs(a.swing ?? 0));
  return { visible, negligible };
}

/**
 * Sensitivity ranking: each parameter's unfavourable and favourable case as bars from the base
 * outcome (the centre line). Bars and figures carry the direction; the table view has every value.
 */
export function Tornado({ rows, currency, baseLabel, footer }: { rows: TornadoRow[]; currency: string; baseLabel: ReactNode; footer?: ReactNode }) {
  const extent = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.lowDelta), Math.abs(r.highDelta)]));
  const pct = (v: number) => (Math.abs(v) / extent) * 50;
  return (
    <figure aria-label="Sensitivity of the net profit change to each uncertain parameter" className="min-w-0">
      <div className="mb-2 grid grid-cols-1 gap-x-3 text-xs text-muted-foreground sm:grid-cols-[minmax(7rem,14rem)_minmax(0,1fr)]" aria-hidden>
        <span className="hidden sm:block" />
        <div className="flex justify-between gap-2">
          <span>Lower outcome</span>
          <span className="text-right">Higher outcome</span>
        </div>
      </div>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const segments = [
            { key: "low", delta: r.lowDelta, label: "Low case" },
            { key: "high", delta: r.highDelta, label: "High case" },
          ];
          return (
            <li key={r.parameter} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(7rem,14rem)_minmax(0,1fr)]">
              <span className="text-[0.8125rem] leading-snug">{r.parameter}</span>
              <div className="relative h-7" aria-hidden>
                <span className="absolute top-0 bottom-0 left-1/2 w-px bg-foreground/35" />
                {segments.map((s) => {
                  if (Math.abs(s.delta) < 0.5) return null;
                  const width = Math.max(pct(s.delta), 0.6);
                  const left = s.delta < 0 ? 50 - width : 50;
                  return (
                    <span
                      key={s.key}
                      className={cn("absolute top-1/2 h-3 -translate-y-1/2", s.delta < 0 ? "rounded-l-[4px]" : "rounded-r-[4px]")}
                      style={{ left: `${left}%`, width: `${width}%`, background: s.delta < 0 ? NEGATIVE_COLOR : POSITIVE_COLOR }}
                    />
                  );
                })}
              </div>
              <span className="sr-only">
                {r.parameter}: low case {formatDelta(r.lowDelta, currency)}, high case {formatDelta(r.highDelta, currency)} against the base outcome
              </span>
              <span className="hidden sm:block" />
              <div className="flex justify-between text-xs text-muted-foreground tabular" aria-hidden>
                <span>{formatDelta(Math.min(r.lowDelta, r.highDelta), currency)}</span>
                <span>{formatDelta(Math.max(r.lowDelta, r.highDelta), currency)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-px bg-foreground/50" /> {baseLabel}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: NEGATIVE_COLOR }} /> Lowers the net profit change
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: POSITIVE_COLOR }} /> Raises the net profit change
        </li>
      </ul>
      {footer ? <div className="mt-2 text-xs text-muted-foreground">{footer}</div> : null}
    </figure>
  );
}

export type { Datum };
