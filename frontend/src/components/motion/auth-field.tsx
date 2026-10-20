import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/** A quiet, self-drawing forecast line for the sign-in panel. Decorative: no data, no JavaScript. */
export function AuthField({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 170" aria-hidden className={cn("h-auto w-full overflow-visible", className)}>
      <defs>
        <linearGradient id="af-fan" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="oklch(0.8 0.125 84)" stopOpacity="0.22" />
          <stop offset="1" stopColor="oklch(0.8 0.125 84)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="af-grid" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0.7" stopColor="white" stopOpacity="0.07" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="oklch(1 0 0 / 0.05)">
        {[30, 70, 110, 150].map((y) => (
          <line key={y} x1="0" x2="480" y1={y} y2={y} />
        ))}
      </g>
      <path
        d="M0 128 C 40 120, 60 92, 96 98 S 150 70, 186 76 S 226 98, 262 62"
        pathLength={1}
        fill="none"
        stroke="oklch(0.94 0.006 88)"
        strokeWidth="2"
        strokeLinecap="round"
        className="mk-draw"
        style={{ "--mk-d": 300 } as CSSProperties}
      />
      <path d="M262 62 C 300 48, 340 40, 480 14 L480 78 C 380 84, 330 90, 262 62 Z" fill="url(#af-fan)" />
      <path
        d="M262 62 C 310 52, 360 38, 470 40"
        pathLength={1}
        fill="none"
        stroke="oklch(0.84 0.11 86)"
        strokeWidth="2.25"
        strokeLinecap="round"
        className="mk-draw"
        style={{ "--mk-d": 1500 } as CSSProperties}
      />
      <circle cx="262" cy="62" r="4.5" fill="oklch(0.94 0.006 88)" stroke="oklch(0.8 0.125 84)" strokeWidth="2" />
    </svg>
  );
}
