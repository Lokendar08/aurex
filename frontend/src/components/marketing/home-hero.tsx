import type { CSSProperties } from "react";

import { HeroField } from "@/components/motion/hero-field";
import { WordReveal } from "@/components/motion/reveal";

import { DEMO_HREF } from "./content";
import { IllustrativeLabel } from "./evidence";
import { Container, CtaLink } from "./primitives";

/** First screen: the claim, the plain description, two clear actions, and the decision field. */
export function HomeHero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-navy-950 text-white">
      <div aria-hidden className="mk-glow absolute inset-0 -z-10" />
      <div aria-hidden className="mk-grid absolute inset-0 -z-10" />
      <Container className="grid min-h-[100svh] items-center gap-12 pt-32 pb-28 lg:grid-cols-12 lg:gap-8 lg:pt-28 lg:pb-24">
        <div className="lg:col-span-6">
          <p className="mk-rise flex items-center gap-2.5 text-sm font-medium tracking-wide text-brand-300" style={{ "--mk-i": 0 } as CSSProperties}>
            <span aria-hidden className="h-px w-8 bg-brand-300/70" />
            Decision intelligence for retail and enterprise
          </p>
          <WordReveal
            as="h1"
            id="hero-title"
            text="See beyond the numbers."
            accent={[1]}
            delay={200}
            className="mt-6 max-w-[13ch] text-balance font-display text-[clamp(3rem,6.6vw,5.5rem)] leading-[0.95] font-semibold tracking-[-0.045em]"
          />
          <p
            className="mk-rise mt-7 max-w-[30ch] font-display text-[clamp(1.25rem,2.2vw,1.625rem)] leading-snug font-medium tracking-[-0.015em] text-white"
            style={{ "--mk-i": 4 } as CSSProperties}
          >
            Test a decision before you make it.
          </p>
          <p
            className="mk-rise mt-4 max-w-[48ch] text-pretty text-[1.0625rem] leading-relaxed text-navy-200"
            style={{ "--mk-i": 5 } as CSSProperties}
          >
            AUREX brings your authorized sales, finance, inventory and workforce data into one model, forecasts what
            comes next and simulates management decisions. Every result shows its source and how certain it is.
          </p>
          <div className="mk-rise mt-9 flex flex-col gap-3 sm:flex-row" style={{ "--mk-i": 6 } as CSSProperties}>
            <CtaLink href={DEMO_HREF} variant="inverse" size="lg">
              Explore the live demo
            </CtaLink>
            <CtaLink href="#journey" variant="inverse-outline" size="lg">
              See the intelligence
            </CtaLink>
          </div>
        </div>
        <div className="lg:col-span-6 lg:-mt-6 lg:translate-x-10 lg:scale-[1.1]">
          <HeroField />
          <IllustrativeLabel surface="dark" note="A drawing of the idea, not customer data" className="mt-10 lg:justify-end" />
        </div>
      </Container>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-navy-900" />
      <a
        href="#journey"
        aria-label="Scroll to the next section"
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 rounded-md px-3 py-2 text-xs tracking-widest text-navy-300 uppercase outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-sky-accent sm:flex"
      >
        Scroll
        <span aria-hidden className="relative block h-9 w-px overflow-hidden bg-white/15">
          <span className="mk-scroll-dot absolute inset-x-0 top-0 block h-3 bg-brand-300" />
        </span>
      </a>
    </section>
  );
}
