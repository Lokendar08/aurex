"use client";

import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useRef, useState } from "react";

import { FAN_LOWER, FAN_UPPER, FORECAST, HISTORY, SCENARIO_A, SCENARIO_B } from "@/components/motion/hero-field";
import { cn } from "@/lib/utils";

import { IllustrativeLabel } from "./evidence";
import { Container } from "./primitives";

/*
 * Scroll-pinned story: authorized data -> validated forecast -> scenario simulation -> evidence-backed
 * decision. Each step maps to a capability AUREX actually has (see PIPELINE_STAGES and the Decision Lab
 * section). The drawing is illustrative and is labelled as such. On phones, and for visitors who prefer
 * reduced motion, the same content is a plain sequence with the finished drawing.
 */

const STAGES = [
  {
    name: "Authorized data",
    text: "Sales, finance, inventory and workforce records from the systems you choose to connect. Each import is logged and checked before anything is loaded.",
  },
  {
    name: "Validated forecasts",
    text: "Models are scored against simple baselines on periods they have not seen. Every forecast carries an interval, so you see the range as well as the point.",
  },
  {
    name: "Scenario simulation",
    text: "Decision Lab applies a proposed change to the model and shows which figures move, by how much, and what supports each change.",
  },
  {
    name: "Evidence-backed decisions",
    text: "Recommendations cite the calculations and sources behind them, and say how certain they are.",
  },
] as const;

// Deterministic "records": a noisy trend, drawn as dots that the measured line later gathers up.
const DOTS = Array.from({ length: 34 }, (_, i) => {
  const x = 24 + (i / 33) * 428;
  const trend = 372 - (i / 33) * 134;
  const wobble = Math.sin(i * 1.7) * 26 + Math.cos(i * 0.9) * 14;
  return { x, y: trend + wobble * (1 - i / 60) };
});

function useRange(p: MotionValue<number>, from: number, to: number, out: [number, number] = [0, 1]) {
  return useTransform(p, [from, to], out);
}

function JourneyFigure({ p }: { p: MotionValue<number> }) {
  const dots = useTransform(p, [0, 0.04, 0.24, 0.34], [0.5, 1, 1, 0.22]);
  const history = useRange(p, 0.16, 0.34);
  const forecast = useRange(p, 0.34, 0.5);
  const fan = useRange(p, 0.38, 0.52);
  const branchA = useRange(p, 0.54, 0.7);
  const branchB = useRange(p, 0.56, 0.72);
  const labels = useRange(p, 0.64, 0.72);
  const chosenWidth = useRange(p, 0.76, 0.88, [1.75, 4]);
  const otherBranch = useRange(p, 0.76, 0.88, [1, 0.28]);
  const evidence = useRange(p, 0.8, 0.92);
  const evidenceY = useRange(p, 0.8, 0.92, [10, 0]);

  return (
    <figure aria-label="Illustrative drawing of the four steps" className="relative">
      <svg viewBox="0 0 720 440" className="h-auto w-full overflow-visible" role="img" aria-label="Illustrative chart that builds step by step: records, a measured line, a forecast band, two scenarios, and a chosen scenario with its evidence.">
        <defs>
          <linearGradient id="ij-fan" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="oklch(0.8 0.125 84)" stopOpacity="0.3" />
            <stop offset="1" stopColor="oklch(0.8 0.125 84)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <g stroke="oklch(1 0 0 / 0.07)">
          {[60, 130, 200, 270, 340, 410].map((y) => (
            <line key={y} x1="0" x2="720" y1={y} y2={y} />
          ))}
        </g>
        <line x1="452" x2="452" y1="30" y2="420" stroke="oklch(1 0 0 / 0.16)" strokeDasharray="3 6" />

        <g>
          {["Sales", "Finance", "Inventory", "Workforce"].map((label, i) => {
            const w = label.length * 7 + 34;
            const x = 24 + [0, 76, 168, 268][i];
            return (
              <g key={label}>
                <rect x={x} y="30" width={w} height="26" rx="13" fill="oklch(1 0 0 / 0.04)" stroke="oklch(0.8 0.125 84 / 0.4)" />
                <circle cx={x + 13} cy="43" r="2.5" fill="oklch(0.84 0.11 86)" />
                <text x={x + 22} y="47" className="fill-white/75 font-mono text-[11px]">
                  {label}
                </text>
              </g>
            );
          })}
        </g>
        <motion.g style={{ opacity: dots }} fill="oklch(0.9 0.006 88)">
          {DOTS.map((d) => (
            <circle key={d.x} cx={d.x} cy={d.y} r="2.6" />
          ))}
        </motion.g>

        <motion.path d={`${FAN_UPPER} ${FAN_LOWER}`} fill="url(#ij-fan)" style={{ opacity: fan }} />
        <motion.path
          d={HISTORY}
          fill="none"
          stroke="oklch(0.94 0.006 88)"
          strokeWidth="2.25"
          strokeLinecap="round"
          style={{ pathLength: history }}
        />
        <motion.path
          d={FORECAST}
          fill="none"
          stroke="oklch(0.84 0.11 86)"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ pathLength: forecast }}
        />
        <motion.path
          d={SCENARIO_B}
          fill="none"
          stroke="oklch(0.76 0.08 215)"
          strokeLinecap="round"
          strokeWidth="1.75"
          style={{ pathLength: branchB, opacity: otherBranch }}
        />
        <motion.path
          d={SCENARIO_A}
          fill="none"
          stroke="oklch(0.88 0.1 88)"
          strokeLinecap="round"
          style={{ pathLength: branchA, strokeWidth: chosenWidth }}
        />

        <motion.g style={{ opacity: labels }} className="fill-white/70 font-mono text-[12px]">
          <text x="690" y="74" textAnchor="end">
            Scenario A
          </text>
          <text x="690" y="286" textAnchor="end">
            Scenario B
          </text>
        </motion.g>

        <circle cx="452" cy="238" r="5.5" fill="oklch(0.94 0.006 88)" stroke="oklch(0.8 0.125 84)" strokeWidth="2" />

        <motion.g style={{ opacity: evidence, y: evidenceY }}>
          <rect x="436" y="330" width="256" height="58" rx="10" fill="oklch(0.185 0.006 80)" stroke="oklch(0.8 0.125 84 / 0.55)" />
          <text x="452" y="354" className="fill-white font-mono text-[12px]">
            Scenario A is recommended
          </text>
          <text x="452" y="374" className="fill-white/65 font-mono text-[12px]">
            3 calculations, 2 sources cited
          </text>
        </motion.g>
      </svg>
      <figcaption className="mt-4">
        <IllustrativeLabel surface="dark" note="A drawing of the idea, not customer data" />
      </figcaption>
    </figure>
  );
}

function StageText({ index, p, stage }: { index: number; p: MotionValue<number>; stage: number }) {
  const a = index / 4;
  const b = (index + 1) / 4;
  const first = index === 0;
  const last = index === STAGES.length - 1;
  // Ranges stay inside 0..1: Motion hands scroll-linked values to the browser's native scroll timeline,
  // which rejects offsets outside that interval.
  const input = first ? [0, b - 0.04, b - 0.01] : last ? [a + 0.01, a + 0.04, 1] : [a + 0.01, a + 0.04, b - 0.04, b - 0.01];
  const fade = first ? [1, 1, 0] : last ? [0, 1, 1] : [0, 1, 1, 0];
  const lift = first ? [0, 0, -22] : last ? [22, 0, 0] : [22, 0, 0, -22];
  const opacity = useTransform(p, input, fade);
  const y = useTransform(p, input, lift);
  const item = STAGES[index];
  return (
    <motion.div style={{ opacity, y }} aria-hidden={stage !== index} className="absolute inset-x-0 top-0">
      <h3 className="font-display text-[clamp(1.75rem,3.2vw,2.5rem)] leading-[1.08] font-semibold tracking-[-0.025em]">
        {item.name}
      </h3>
      <p className="mt-4 max-w-[46ch] text-[1.0625rem] leading-relaxed text-navy-200">{item.text}</p>
    </motion.div>
  );
}

function Pinned() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [stage, setStage] = useState(0);
  useMotionValueEvent(p, "change", (v) => setStage(Math.min(STAGES.length - 1, Math.max(0, Math.floor(v * STAGES.length)))));

  return (
    <div ref={ref} className="relative h-[420vh]">
      <div className="sticky top-0 flex h-screen items-center">
        <Container className="grid items-center gap-12 pt-16 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-5">
            <p className="font-mono text-sm tracking-wide text-brand-300">
              {String(stage + 1).padStart(2, "0")} / {String(STAGES.length).padStart(2, "0")}
            </p>
            <h2
              className="mt-3 max-w-[16ch] text-balance font-display text-[clamp(2.25rem,4.6vw,3.75rem)] leading-[1] font-semibold tracking-[-0.035em]"
            >
              From records to a decision.
            </h2>
            <ol aria-label="Steps" className="mt-8 flex gap-2">
              {STAGES.map((s, i) => (
                <li key={s.name} aria-current={i === stage ? "step" : undefined} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/15">
                  <span className={cn("block h-full bg-brand-300 transition-[width] duration-500", i <= stage ? "w-full" : "w-0")} />
                  <span className="sr-only">{s.name}</span>
                </li>
              ))}
            </ol>
            <div className="relative mt-8 h-56 sm:h-52">
              {STAGES.map((s, i) => (
                <StageText key={s.name} index={i} p={p} stage={stage} />
              ))}
            </div>
          </div>
          <div className="lg:col-span-7">
            <JourneyFigure p={p} />
          </div>
        </Container>
      </div>
    </div>
  );
}

function Sequence() {
  const done = useMotionValue(1);
  return (
    <Container className="py-20 sm:py-24">
      <h2
        className="max-w-[16ch] text-balance font-display text-[clamp(2.25rem,6vw,3.5rem)] leading-[1] font-semibold tracking-[-0.035em]"
      >
        From records to a decision.
      </h2>
      <div className="mt-10 grid gap-12 lg:grid-cols-12 lg:gap-10">
        <ol className="grid gap-8 lg:col-span-5">
          {STAGES.map((s, i) => (
            <li key={s.name} className="border-t border-white/12 pt-5">
              <p className="font-mono text-sm text-brand-300">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em]">{s.name}</h3>
              <p className="mt-2 text-[1rem] leading-relaxed text-navy-200">{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="lg:col-span-7 lg:pt-6">
          <JourneyFigure p={done} />
        </div>
      </div>
    </Container>
  );
}

export function IntelligenceJourney() {
  const reduce = useReducedMotion();
  return (
    <section id="journey" aria-label="From records to a decision" className="relative bg-navy-900 text-white">
      <div aria-hidden className="h-24 bg-gradient-to-b from-navy-950 to-navy-900" />
      {reduce ? (
        <Sequence />
      ) : (
        <>
          <div className="hidden md:block">
            <Pinned />
          </div>
          <div className="md:hidden">
            <Sequence />
          </div>
        </>
      )}
      <div aria-hidden className="h-40 bg-gradient-to-b from-navy-900 to-background" />
    </section>
  );
}
