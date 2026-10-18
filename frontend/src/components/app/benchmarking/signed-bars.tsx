import type { ReactNode } from "react";

import { CONTEXT_COLOR, SERIES_COLORS } from "@/components/app/charts/palette";
import { cn } from "@/lib/utils";

export type SignedBarItem = {
  key: string;
  label: ReactNode;
  sublabel?: ReactNode;
  value: number | null;
  display: string;
  highlight?: boolean;
};

/**
 * Horizontal bars from a shared zero line, so negative values (a net loss, shrinking store
 * count) extend left instead of being drawn as zero. The highlighted entity is in the accent;
 * peers stay in the context grey. Missing values get no bar and say "Not available".
 */
export function SignedBarList({ items, label, className }: { items: SignedBarItem[]; label: string; className?: string }) {
  const values = items.map((i) => i.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const zero = ((0 - min) / span) * 100;
  const emphasis = items.some((i) => i.highlight);
  return (
    <ul className={cn("space-y-2.5", className)} aria-label={label}>
      {items.map((item) => {
        const has = typeof item.value === "number" && Number.isFinite(item.value);
        const width = has ? (Math.abs(item.value as number) / span) * 100 : 0;
        const left = has && (item.value as number) < 0 ? zero - width : zero;
        return (
          <li key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className={cn("truncate text-[0.8125rem]", item.highlight ? "font-semibold" : "font-medium")}>{item.label}</p>
              {item.sublabel ? <p className="truncate text-xs text-muted-foreground">{item.sublabel}</p> : null}
            </div>
            <span className={cn("text-[0.8125rem] tabular", has ? "font-semibold" : "text-muted-foreground")}>{has ? item.display : "Not available"}</span>
            <div className="relative col-span-2 h-2" aria-hidden>
              {min < 0 ? <span className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground/40" style={{ left: `${zero}%` }} /> : null}
              {has && width > 0 ? (
                <span
                  className={cn("absolute top-0 h-2", (item.value as number) < 0 ? "rounded-l-[4px]" : "rounded-r-[4px]")}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 0.6)}%`,
                    background: !emphasis || item.highlight ? SERIES_COLORS[0] : CONTEXT_COLOR,
                    opacity: !emphasis || item.highlight ? 1 : 0.45,
                  }}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
