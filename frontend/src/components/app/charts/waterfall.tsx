import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { ANCHOR_COLOR, NEGATIVE_COLOR, POSITIVE_COLOR } from "./palette";

export type WaterfallStep = {
  key: string;
  label: ReactNode;
  sublabel?: ReactNode;
  /** Signed change contributed by this step. */
  delta: number;
};

/**
 * Bridge from a base total to a current total. Each effect floats from the running total before it
 * to the running total after it; totals are position markers (not bars), so the axis does not need
 * to start at zero and small effects stay visible without overstating the totals.
 */
export function Waterfall({
  base,
  current,
  baseLabel,
  currentLabel,
  steps,
  format,
  formatSigned,
  ariaLabel,
}: {
  base: number;
  current: number;
  baseLabel: ReactNode;
  currentLabel: ReactNode;
  steps: WaterfallStep[];
  format: (value: number) => string;
  formatSigned: (value: number) => string;
  ariaLabel: string;
}) {
  const rows = steps.reduce<(WaterfallStep & { from: number; to: number })[]>((acc, step) => {
    const from = acc.length ? acc[acc.length - 1].to : base;
    acc.push({ ...step, from, to: from + step.delta });
    return acc;
  }, []);
  const running = rows.length ? rows[rows.length - 1].to : base;
  const points = [base, current, ...rows.flatMap((r) => [r.from, r.to])];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.02 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const pos = (value: number) => ((value - min) / (max - min)) * 100;
  const residual = current - running;

  const marker = (value: number) => (
    <div className="relative h-5" aria-hidden>
      <span className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full" style={{ left: `${pos(value)}%`, background: ANCHOR_COLOR }} />
    </div>
  );

  return (
    <figure aria-label={ariaLabel} className="min-w-0">
      <div className="grid grid-cols-[minmax(6.5rem,11rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 text-[0.8125rem]">
        <div className="min-w-0 font-semibold">{baseLabel}</div>
        {marker(base)}
        <div className="text-right font-semibold tabular">{format(base)}</div>

        {rows.map((row) => {
          const left = pos(Math.min(row.from, row.to));
          const width = Math.max(0.6, Math.abs(pos(row.to) - pos(row.from)));
          const up = row.delta >= 0;
          return (
            <div key={row.key} className="contents">
              <div className="min-w-0">
                <p className="truncate">{row.label}</p>
                {row.sublabel ? <p className="truncate text-xs text-muted-foreground">{row.sublabel}</p> : null}
              </div>
              <div className="relative h-5" aria-hidden>
                <span
                  className={cn("absolute top-1/2 h-3 -translate-y-1/2 rounded-[3px]")}
                  style={{ left: `${left}%`, width: `${width}%`, background: up ? POSITIVE_COLOR : NEGATIVE_COLOR }}
                />
              </div>
              <div className={cn("text-right font-medium tabular", up ? "text-foreground" : "text-destructive")}>
                <span className="sr-only">{up ? "Increase " : "Decrease "}</span>
                {formatSigned(row.delta)}
              </div>
            </div>
          );
        })}

        {Math.abs(residual) > Math.max(1, Math.abs(current) * 1e-6) ? (
          <div className="contents">
            <div className="text-muted-foreground">Not attributed</div>
            <div className="h-5" aria-hidden />
            <div className="text-right text-muted-foreground tabular">{formatSigned(residual)}</div>
          </div>
        ) : null}

        <div className="min-w-0 font-semibold">{currentLabel}</div>
        {marker(current)}
        <div className="text-right font-semibold tabular">{format(current)}</div>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(6.5rem,11rem)_minmax(0,1fr)_auto] gap-x-3 text-xs text-muted-foreground" aria-hidden>
        <span />
        <div className="flex justify-between border-t pt-1 tabular">
          <span>{format(min)}</span>
          <span>{format(max)}</span>
        </div>
        <span className="invisible tabular">{format(current)}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: POSITIVE_COLOR }} /> Increase
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: NEGATIVE_COLOR }} /> Decrease
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-[3px] rounded-full" style={{ background: ANCHOR_COLOR }} /> Period total
        </li>
      </ul>
    </figure>
  );
}
