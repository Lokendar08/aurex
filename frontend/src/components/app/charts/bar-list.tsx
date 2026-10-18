import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { SERIES_COLORS } from "./palette";

export type BarListItem = {
  key: string;
  label: ReactNode;
  /** Secondary text under the label (city, code). */
  sublabel?: ReactNode;
  value: number | null;
  /** Formatted value shown at the bar end. */
  display: ReactNode;
  /** Extra figure to the right (growth, share). */
  aside?: ReactNode;
  highlight?: boolean;
};

/**
 * Ranked horizontal bars with direct value labels (one hue: identity is the row label, magnitude
 * is the length). Missing values get no bar and say so, they are never drawn as zero.
 */
export function BarList({
  items,
  color = SERIES_COLORS[0],
  label,
  className,
  max: maxOverride,
}: {
  items: BarListItem[];
  color?: string;
  label: string;
  className?: string;
  max?: number;
}) {
  const max = maxOverride ?? Math.max(0, ...items.map((i) => (i.value !== null && Number.isFinite(i.value) ? i.value : 0)));
  return (
    <ul className={cn("space-y-3", className)} aria-label={label}>
      {items.map((item) => {
        const width = item.value !== null && max > 0 ? Math.max(0.5, (Math.max(item.value, 0) / max) * 100) : 0;
        return (
          <li key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className={cn("truncate text-[0.8125rem]", item.highlight ? "font-semibold" : "font-medium")}>{item.label}</p>
              {item.sublabel ? <p className="truncate text-xs text-muted-foreground">{item.sublabel}</p> : null}
            </div>
            <div className="flex items-baseline gap-2 text-right">
              <span className="text-[0.8125rem] font-semibold tabular">{item.display}</span>
              {item.aside ? <span className="min-w-[3.5rem] text-xs text-muted-foreground tabular">{item.aside}</span> : null}
            </div>
            <div className="col-span-2 h-2" aria-hidden>
              {width > 0 ? (
                <div
                  className="h-2 rounded-r-[4px]"
                  style={{ width: `${width}%`, background: color, opacity: item.highlight === false ? 0.55 : 1 }}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
