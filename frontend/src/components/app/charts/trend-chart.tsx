"use client";

import type { ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { parseDate } from "@/lib/app/format";

import { ChartLegend, TooltipCard, type LegendItem } from "./chart-parts";
import { AXIS_TEXT, GRID_COLOR } from "./palette";

export type TrendSeries = {
  key: string;
  label: string;
  color: string;
  /** line (default), area (soft 10% wash) or bar (≤ 24px, rounded data end). */
  kind?: "line" | "area" | "bar";
  /** Format for this series in the tooltip (defaults to the y-axis formatter). */
  format?: (value: number) => string;
};

type Datum = Record<string, unknown>;

const TICK = { fill: AXIS_TEXT, fontSize: 12 };

function niceStep(raw: number): number {
  const exponent = Math.floor(Math.log10(raw));
  const base = 10 ** exponent;
  const fraction = raw / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * Round-number ticks (1, 2, 2.5, 5 × 10ⁿ) so money axes read ₹1 Cr, ₹2 Cr… instead of ₹0.95 Cr steps.
 * Bars and areas always include zero (length encodes the value); pure line charts may not.
 */
export function niceTicks(values: number[], includeZero: boolean, count = 4): number[] | undefined {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return undefined;
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (includeZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.1 || 1;
    lo -= includeZero && lo === 0 ? 0 : pad;
    hi += pad;
  }
  const step = niceStep((hi - lo) / count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let i = 0; start + i * step <= end + step / 2 && i < 12; i++) {
    ticks.push(Number((start + i * step).toPrecision(12)));
  }
  return ticks;
}

/**
 * Time-series chart for one measure (one y-axis): lines, soft areas, columns or a combination on the
 * same scale. Two measures with different units belong in two charts, never on a second axis.
 */
export function TrendChart({
  data,
  xKey,
  series,
  yFormat,
  xFormat,
  tooltipTitle,
  height = 260,
  yWidth = 64,
  zeroLine,
  legend = true,
  timeAxis = false,
  ariaLabel,
}: {
  data: Datum[];
  xKey: string;
  series: TrendSeries[];
  yFormat: (value: number) => string;
  xFormat?: (value: string) => string;
  tooltipTitle?: (value: string) => ReactNode;
  height?: number;
  yWidth?: number;
  zeroLine?: boolean;
  legend?: boolean;
  /** Place points by date (for irregular snapshot cadences) instead of evenly by index. */
  timeAxis?: boolean;
  ariaLabel: string;
}) {
  const legendItems: LegendItem[] = series.map((s) => ({
    label: s.label,
    color: s.color,
    shape: s.kind === "bar" || s.kind === "area" ? "rect" : "line",
  }));
  const hasBars = series.some((s) => s.kind === "bar");
  const includeZero = series.some((s) => s.kind === "bar" || s.kind === "area");
  const yTicks = niceTicks(
    data.flatMap((d) => series.map((s) => d[s.key])).filter((v): v is number => typeof v === "number"),
    includeZero,
  );
  const chartData = timeAxis
    ? data.map((d) => ({ ...d, __t: parseDate(String(d[xKey] ?? ""))?.getTime() ?? null }))
    : data;
  const formatTimeTick = (ms: number) => {
    const date = new Date(ms);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return xFormat ? xFormat(iso) : iso;
  };

  function renderTooltip(props: TooltipContentProps) {
    if (!props.active || !props.payload?.length) return null;
    const point = props.payload[0]?.payload as Datum | undefined;
    const label = String(point?.[xKey] ?? props.label ?? "");
    const rows = series.map((s) => {
      const raw = point?.[s.key];
      const value = typeof raw === "number" && Number.isFinite(raw) ? (s.format ?? yFormat)(raw) : "Not available";
      return { key: s.key, label: s.label, color: s.color, value };
    });
    return <TooltipCard title={tooltipTitle ? tooltipTitle(label) : xFormat ? xFormat(label) : label} rows={rows} />;
  }

  return (
    <figure className="flex min-w-0 flex-col gap-3" aria-label={ariaLabel}>
      {legend ? <ChartLegend items={legendItems} /> : null}
      <div style={{ height }} className="min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis
              dataKey={timeAxis ? "__t" : xKey}
              type={timeAxis ? "number" : "category"}
              scale={timeAxis ? "time" : "auto"}
              domain={timeAxis ? ["dataMin", "dataMax"] : undefined}
              tickFormatter={timeAxis ? formatTimeTick : xFormat}
              tickLine={false}
              axisLine={{ stroke: GRID_COLOR }}
              tick={TICK}
              minTickGap={18}
              tickMargin={8}
            />
            <YAxis
              tickFormatter={yFormat}
              tickLine={false}
              axisLine={false}
              tick={TICK}
              width={yWidth}
              ticks={yTicks}
              domain={yTicks ? [yTicks[0], yTicks[yTicks.length - 1]] : undefined}
              interval={0}
            />
            {zeroLine ? <ReferenceLine y={0} stroke={AXIS_TEXT} strokeOpacity={0.5} /> : null}
            <Tooltip
              content={renderTooltip}
              cursor={hasBars ? { fill: "var(--muted)", fillOpacity: 0.6 } : { stroke: AXIS_TEXT, strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {series.map((s) =>
              s.kind === "bar" ? (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              ) : s.kind === "area" ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
