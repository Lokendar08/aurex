import { Reveal } from "@/components/motion/reveal";

import { DecisionLedger } from "./decision-ledger";
import { Container, SectionHeading, TextLink } from "./primitives";

/** The calculation, shown: the real Decision Lab sample in a product window. */
export function ProductShowcase() {
  return (
    <section aria-labelledby="showcase-title" className="relative overflow-hidden pb-24 sm:pb-32">
      <Container>
        <SectionHeading
          id="showcase-title"
          title="Every number says where it came from."
          lead="Change a decision and watch each line move. Costs are arithmetic on known inputs. Revenue moves only when sales history or a documented assumption supports it, and then always with a range."
        />
        <Reveal className="relative mt-14 sm:mt-16" delay={120}>
          <div aria-hidden className="absolute -inset-x-6 -top-10 -bottom-10 -z-10 rounded-[2.5rem] bg-gradient-to-b from-brand-200/50 via-brand-100/25 to-transparent blur-2xl" />
          <div className="rounded-[1.375rem] bg-navy-950 p-1.5 shadow-[0_40px_80px_-30px_oklch(0.2_0.01_80/0.55)] ring-1 ring-black/10">
            <div className="flex items-center gap-2 px-3 pt-1.5 pb-2.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="ml-3 font-mono text-xs text-navy-300">aurex / decision-lab</span>
            </div>
            <DecisionLedger />
          </div>
        </Reveal>
        <p className="mt-8 text-sm text-muted-foreground">
          This is the same calculation the product runs.{" "}
          <TextLink href="/product#decision-lab">How Decision Lab works</TextLink>
        </p>
      </Container>
    </section>
  );
}
