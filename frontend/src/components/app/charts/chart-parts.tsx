"use client";

import { ChartColumnIcon, TableIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type LegendItem = { label: string; color: string; shape?: "line" | "rect" };

/** Legend above a chart: line keys for lines, swatches for areas and bars. Text stays in text colours. */
export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  if (items.length < 2) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.shape === "line" ? (
            <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: item.color }} />
          ) : (
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: item.color }} />
          )}
          <span className="text-foreground/80">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export type TooltipRow = { key: string; label: string; color: string; value: ReactNode };

/** Tooltip card: the value leads (strong), the series name follows; a short line key carries identity. */
export function TooltipCard({ title, rows, footer }: { title: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="min-w-40 rounded-lg bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10">
      <p className="mb-1.5 font-medium text-foreground">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: row.color }} />
            <span className="font-semibold text-foreground tabular">{row.value}</span>
            <span className="truncate text-muted-foreground">{row.label}</span>
          </li>
        ))}
      </ul>
      {footer ? <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

export type ChartView = "chart" | "table";

/**
 * Chart / table switch. Every chart has a table twin so no value is reachable only by hovering.
 * Returns the current view and the toggle to place in the panel header.
 */
export function useChartView(label: string, initial: ChartView = "chart"): [ChartView, ReactNode] {
  const [view, setView] = useState<ChartView>(initial);
  const toggle = (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      value={view}
      onValueChange={(value) => value && setView(value as ChartView)}
      aria-label={`${label}: display as`}
    >
      <ToggleGroupItem value="chart" aria-label="Show chart" title="Chart">
        <ChartColumnIcon aria-hidden />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" aria-label="Show table" title="Table">
        <TableIcon aria-hidden />
      </ToggleGroupItem>
    </ToggleGroup>
  );
  return [view, toggle];
}

/** Wrapper that names a chart for assistive technology; the table view carries the values. */
export function ChartFigure({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <figure className={cn("min-w-0", className)} aria-label={label}>
      {children}
    </figure>
  );
}
