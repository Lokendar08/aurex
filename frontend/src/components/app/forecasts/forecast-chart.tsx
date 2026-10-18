"use client";

import {
  Area,
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

import { ChartLegend, TooltipCard, type LegendItem } from "@/components/app/charts/chart-parts";
import { ANCHOR_COLOR, AXIS_TEXT, GRID_COLOR, SERIES_COLORS } from "@/components/app/charts/palette";
import { formatDate, formatMoney, formatMonth, formatNumber, formatShortDate, moneyTick } from "@/lib/app/format";
import type { ChartPoint, Granularity } from "@/lib/app/forecasts-series";
import type { Frequency, ForecastUnit } from "@/lib/app/forecasts-types";

const TICK = { fill: AXIS_TEXT, fontSize: 12 };
const BAND = SERIES_COLORS[0];

export type Period = "day" | "week" | "month";

export function periodOf(frequency: Frequency, granularity: Granularity): Period {
  if (granularity === "week") return "week";
  if (granularity === "month") return "month";
  return frequency === "M" ? "month" : frequency === "W" ? "week" : "day";
}

export function periodLabel(value: string, period: Period): string {
  if (period === "month") return formatMonth(value);
  if (period === "week") return `Week of ${formatDate(value)}`;
  return formatDate(value);
}

function axisLabel(value: string, period: Period): string {
  if (period === "month") {
    const text = formatMonth(value);
    return text.replace(/ (\d{2})(\d{2})$/, " $2");
  }
  return formatShortDate(value);
}

export function unitFormatter(unit: ForecastUnit, currency: string, compact = true) {
  if (unit === "currency") return (v: number) => formatMoney(v, currency, { compact });
  return (v: number) => formatNumber(v, { compact, decimals: compact ? undefined : 0 });
}

function tickFormatter(unit: ForecastUnit, currency: string) {
  if (unit === "currency") return moneyTick(currency);
  return (v: number) => formatNumber(v, { compact: true });
}

/**
 * History (navy anchor line) and forecast (brand line) with the 80% band over a fainter 95%
 * band. The forecast start is marked; everything plotted is also in the table view.
 */
export function ForecastChart({
  points,
  unit,
  currency,
  period,
  forecastStart,
  ariaLabel,
  height = 300,
  showActual = true,
}: {
  points: ChartPoint[];
  unit: ForecastUnit;
  currency: string;
  period: Period;
  forecastStart: string | null;
  ariaLabel: string;
  height?: number;
  showActual?: boolean;
}) {
  const format = unitFormatter(unit, currency);
  const legend: LegendItem[] = [
    ...(showActual ? [{ label: "Actual", color: ANCHOR_COLOR, shape: "line" as const }] : []),
    { label: "Forecast", color: BAND, shape: "line" },
    { label: "80% interval", color: `color-mix(in oklch, ${BAND} 30%, var(--card))`, shape: "rect" },
    { label: "95% interval", color: `color-mix(in oklch, ${BAND} 14%, var(--card))`, shape: "rect" },
  ];

  function renderTooltip(props: TooltipContentProps) {
    if (!props.active || !props.payload?.length) return null;
    const p = props.payload[0]?.payload as ChartPoint | undefined;
    if (!p) return null;
    const isForecast = p.actual === null;
    const rows = [];
    if (!isForecast && p.actual !== null) rows.push({ key: "a", label: "Actual", color: ANCHOR_COLOR, value: format(p.actual) });
    if (isForecast && p.yhat !== null) rows.push({ key: "f", label: p.blended ? "Actual so far + forecast" : "Forecast", color: BAND, value: format(p.yhat) });
    if (isForecast && p.band80) rows.push({ key: "b80", label: "80% interval", color: BAND, value: `${format(p.band80[0])} – ${format(p.band80[1])}` });
    if (isForecast && p.band95) rows.push({ key: "b95", label: "95% interval", color: BAND, value: `${format(p.band95[0])} – ${format(p.band95[1])}` });
    return (
      <TooltipCard
        title={periodLabel(p.period, period)}
        rows={rows}
        footer={p.blended && typeof p.actualPart === "number" ? `Includes ${format(p.actualPart)} of actual sales to date` : undefined}
      />
    );
  }

  return (
    <figure className="flex min-w-0 flex-col gap-3" aria-label={ariaLabel}>
      <ChartLegend items={legend} />
      <div style={{ height }} className="min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID_COLOR} />
            <XAxis
              dataKey="period"
              tickFormatter={(v: string) => axisLabel(v, period)}
              tickLine={false}
              axisLine={{ stroke: GRID_COLOR }}
              tick={TICK}
              minTickGap={24}
              tickMargin={8}
            />
            <YAxis tickFormatter={tickFormatter(unit, currency)} tickLine={false} axisLine={false} tick={TICK} width={68} tickCount={5} domain={["auto", "auto"]} />
            <Tooltip content={renderTooltip} cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }} isAnimationActive={false} />
            <Area dataKey="band95" stroke="none" fill={BAND} fillOpacity={0.09} isAnimationActive={false} connectNulls={false} activeDot={false} />
            <Area dataKey="band80" stroke="none" fill={BAND} fillOpacity={0.18} isAnimationActive={false} connectNulls={false} activeDot={false} />
            {forecastStart ? (
              <ReferenceLine
                x={forecastStart}
                stroke={AXIS_TEXT}
                strokeOpacity={0.55}
                label={{ value: "Forecast", position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 11 }}
              />
            ) : null}
            {showActual ? (
              <Line
                type="monotone"
                dataKey="actual"
                stroke={ANCHOR_COLOR}
                strokeWidth={period === "day" ? 1.5 : 2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="yhat"
              stroke={BAND}
              strokeWidth={period === "day" ? 1.5 : 2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
