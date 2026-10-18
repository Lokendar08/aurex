"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

import { cn } from "@/lib/utils";

import { SERIES_COLORS } from "./palette";

/** Small trend line for a stat tile. Decorative: the figure beside it carries the value. */
export function Sparkline({
  data,
  dataKey,
  color = SERIES_COLORS[0],
  height = 44,
  className,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  color?: string;
  height?: number;
  className?: string;
}) {
  if (data.length < 2) return null;
  return (
    <div className={cn("min-w-0", className)} style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }} accessibilityLayer={false}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.75}
            fill={color}
            fillOpacity={0.1}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ratio against a fixed scale (0–100 score, completeness). Track is a lighter step of the same ramp. */
export function Meter({
  value,
  max = 100,
  label,
  className,
  tone = "brand",
}: {
  value: number | null;
  max?: number;
  label: string;
  className?: string;
  tone?: "brand" | "warning" | "danger";
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value ?? undefined}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full",
        tone === "brand" && "bg-brand-100 dark:bg-brand-800/40",
        tone === "warning" && "bg-warning/20",
        tone === "danger" && "bg-destructive/15",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full",
          tone === "brand" && "bg-primary",
          tone === "warning" && "bg-warning",
          tone === "danger" && "bg-destructive",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
