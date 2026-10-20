"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, type CSSProperties } from "react";

/*
 * Hero centrepiece: an abstract decision field. History is measured; the forecast carries an
 * uncertainty band; two scenarios branch from a decision point. It is a drawing of the idea, not
 * data, and is labelled "Illustrative" on the page. Drawn in SVG with CSS path animation, so it adds
 * no dependency weight beyond the scroll parallax.
 */

export const HISTORY = "M24 372 C 70 362, 92 318, 132 326 S 204 268, 244 280 S 314 318, 354 258 S 410 228, 452 238";
export const FORECAST = "M452 238 C 500 218, 540 200, 580 188 S 650 160, 696 140";
export const FAN_UPPER = "M452 238 C 500 200, 540 164, 580 142 S 650 96, 696 56";
export const FAN_LOWER = "L696 214 C 650 230, 610 244, 580 250 S 500 262, 452 238 Z";
export const SCENARIO_A = "M452 238 C 520 206, 600 128, 696 84";
export const SCENARIO_B = "M452 238 C 520 248, 610 262, 696 262";

export function HeroField({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.9", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 70]);
  const opacity = useTransform(scrollYProgress, [0, 0.8, 1], [1, 0.55, 0.15]);

  return (
    <motion.div ref={ref} style={{ y, opacity }} className={className}>
      <svg
        viewBox="0 20 720 410"
        role="img"
        aria-label="Illustrative chart: measured history, a forecast with an uncertainty band, and two scenarios branching from a decision point."
        className="h-auto w-full overflow-visible"
      >
        <defs>
          <linearGradient id="hf-gold" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="oklch(0.9 0.09 90)" />
            <stop offset="1" stopColor="oklch(0.78 0.13 82)" />
          </linearGradient>
          <linearGradient id="hf-fan" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="oklch(0.8 0.125 84)" stopOpacity="0.28" />
            <stop offset="1" stopColor="oklch(0.8 0.125 84)" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* fine grid */}
        <g stroke="oklch(1 0 0 / 0.07)" strokeWidth="1">
          {[60, 130, 200, 270, 340, 410].map((yy) => (
            <line key={yy} x1="0" x2="720" y1={yy} y2={yy} />
          ))}
          {[90, 210, 330, 450, 570, 690].map((xx) => (
            <line key={xx} x1={xx} x2={xx} y1="30" y2="420" />
          ))}
        </g>

        {/* decision-point guide */}
        <line x1="452" x2="452" y1="30" y2="420" stroke="oklch(1 0 0 / 0.18)" strokeDasharray="3 6" />
        <text x="440" y="48" textAnchor="end" className="fill-white/50 font-mono text-[12px]">
          Measured
        </text>
        <text x="464" y="48" className="fill-white/50 font-mono text-[12px]">
          Forecast and scenarios
        </text>

        {/* forecast band */}
        <path d={`${FAN_UPPER} ${FAN_LOWER}`} fill="url(#hf-fan)" className="mk-rise" style={{ "--mk-i": 6 } as CSSProperties} />

        {/* measured history */}
        <path
          d={HISTORY}
          pathLength={1}
          fill="none"
          stroke="oklch(0.94 0.006 88)"
          strokeWidth="2.25"
          strokeLinecap="round"
          className="mk-draw"
          style={{ "--mk-d": 200 } as CSSProperties}
        />
        {/* forecast median */}
        <path
          d={FORECAST}
          pathLength={1}
          fill="none"
          stroke="url(#hf-gold)"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="mk-draw"
          style={{ "--mk-d": 1500 } as CSSProperties}
        />
        {/* scenarios */}
        <path
          d={SCENARIO_A}
          pathLength={1}
          fill="none"
          stroke="oklch(0.86 0.1 86)"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="mk-draw"
          style={{ "--mk-d": 2000 } as CSSProperties}
        />
        <path
          d={SCENARIO_B}
          pathLength={1}
          fill="none"
          stroke="oklch(0.76 0.08 215)"
          strokeWidth="1.75"
          strokeLinecap="round"
          className="mk-draw"
          style={{ "--mk-d": 2200 } as CSSProperties}
        />
        <text x="690" y="74" textAnchor="end" className="fill-white/70 font-mono text-[12px]">
          Scenario A
        </text>
        <text x="690" y="286" textAnchor="end" className="fill-white/70 font-mono text-[12px]">
          Scenario B
        </text>

        {/* decision point */}
        <circle cx="452" cy="238" r="5" className="mk-pulse" fill="oklch(0.86 0.1 86)" />
        <circle cx="452" cy="238" r="5.5" fill="oklch(0.94 0.006 88)" stroke="oklch(0.8 0.125 84)" strokeWidth="2" />
        <text x="452" y="404" textAnchor="middle" className="fill-white/55 font-mono text-[12px]">
          Decision point
        </text>
      </svg>
    </motion.div>
  );
}
