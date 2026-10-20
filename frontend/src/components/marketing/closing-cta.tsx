import { WordReveal, Reveal } from "@/components/motion/reveal";

import { DEMO_HREF, SIGN_UP_HREF } from "./content";
import { Container, CtaLink } from "./primitives";

export function ClosingCta({
  title = "Your next decision deserves better intelligence.",
  text = "The NovaMart demo opens every workspace with synthetic data. When you're ready, create an organization and connect your first source.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <section aria-labelledby="closing-cta-title" className="relative isolate overflow-hidden bg-navy-950 py-28 text-white sm:py-40">
      <div aria-hidden className="mk-glow absolute inset-0 -z-10" />
      <div aria-hidden className="mk-grid absolute inset-0 -z-10 opacity-70" />
      <Container className="flex flex-col items-start gap-10 lg:items-center lg:text-center">
        <WordReveal
          as="h2"
          id="closing-cta-title"
          text={title}
          accent={title === "Your next decision deserves better intelligence." ? [3] : []}
          className="max-w-[18ch] text-balance font-display text-[clamp(2.5rem,6.4vw,5.25rem)] leading-[0.98] font-semibold tracking-[-0.04em]"
        />
        <Reveal delay={350} className="flex flex-col items-start gap-8 lg:items-center">
          <p className="max-w-[52ch] text-pretty text-[1.0625rem] leading-relaxed text-navy-200">{text}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <CtaLink href={SIGN_UP_HREF} variant="inverse" size="lg">
              Create an account
            </CtaLink>
            <CtaLink href={DEMO_HREF} variant="inverse-outline" size="lg">
              Explore the live demo
            </CtaLink>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
