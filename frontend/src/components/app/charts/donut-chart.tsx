"use client";

import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipContentProps } from "recharts";

import { formatPercent } from "@/lib/app/format";

import { TooltipCard } from "./chart-parts";
import { OTHER_COLOR, seriesColor } from "./palette";

export type DonutSlice = { key: string; label: string; value: number };

/**
 * Part-to-whole at a glance, capped at six segments: the tail folds into "Other". Every segment is
 * labelled with its value and share in the legend beside it, so the ring is never the only channel.
 */
export function DonutChart({
  slices,
  format,
  centerLabel,
  centerValue,
  ariaLabel,
  maxSlices = 6,
}: {
  slices: DonutSlice[];
  format: (value: number) => string;
  centerLabel: ReactNode;
  centerValue: ReactNode;
  ariaLabel: string;
  maxSlices?: number;
}) {
  const positive = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const head = positive.slice(0, maxSlices - 1);
  const tail = positive.slice(maxSlices - 1);
  const folded: (DonutSlice & { color: string })[] = head.map((s, i) => ({ ...s, color: seriesColor(i) }));
  if (tail.length === 1) folded.push({ ...tail[0], color: seriesColor(head.length) });
  else if (tail.length > 1) {
    folded.push({
      key: "__other",
      label: `Other (${tail.length})`,
      value: tail.reduce((sum, s) => sum + s.value, 0),
      color: OTHER_COLOR,
    });
  }
  const total = folded.reduce((sum, s) => sum + s.value, 0);

  function renderTooltip(props: TooltipContentProps) {
    if (!props.active || !props.payload?.length) return null;
    const slice = props.payload[0]?.payload as (DonutSlice & { color: string }) | undefined;
    if (!slice) return null;
    return (
      <TooltipCard
        title={slice.label}
        rows={[{ key: slice.key, label: `${formatPercent(total ? slice.value / total : null)} of total`, color: slice.color, value: format(slice.value) }]}
      />
    );
  }

  return (
    <figure className="grid items-center gap-5 sm:grid-cols-[minmax(9rem,11rem)_minmax(0,1fr)]" aria-label={ariaLabel}>
      <div className="relative mx-auto aspect-square w-full max-w-[11rem]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={folded}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {folded.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={renderTooltip} isAnimationActive={false} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
          <span className="text-base font-semibold">{centerValue}</span>
        </div>
      </div>
      <ul className="min-w-0 space-y-2">
        {folded.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2.5 text-[0.8125rem]">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="font-semibold tabular">{format(slice.value)}</span>
            <span className="w-12 text-right text-xs text-muted-foreground tabular">
              {formatPercent(total ? slice.value / total : null, { decimals: 0 })}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
