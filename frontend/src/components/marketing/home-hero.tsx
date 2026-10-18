import { DEMO_HREF, SIGN_UP_HREF } from "./content";
import { DecisionLedger } from "./decision-ledger";
import { Container, CtaLink } from "./primitives";

export function HomeHero() {
  return (
    <section aria-labelledby="hero-title" className="bg-navy-900 text-white">
      <Container className="pt-14 pb-16 sm:pt-20 sm:pb-20 lg:pt-24 lg:pb-28">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
          <h1
            id="hero-title"
            className="max-w-[13ch] text-balance font-display text-[2.875rem] leading-[0.98] font-semibold tracking-[-0.038em] sm:text-[4rem] lg:col-span-7 lg:text-[4.75rem] xl:text-[5.25rem]"
          >
            Test a decision before you make it.
          </h1>
          <div className="lg:col-span-5 lg:self-end lg:pb-1.5">
            <p className="max-w-[46ch] text-pretty text-lg leading-relaxed text-navy-200">
              AUREX brings your authorized sales, finance, inventory and workforce data into one model, forecasts
              what comes next and simulates management decisions. Every result shows its source and how certain it
              is.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CtaLink href={SIGN_UP_HREF} variant="inverse">
                Create an account
              </CtaLink>
              <CtaLink href={DEMO_HREF} variant="inverse-outline">
                Explore the live demo
              </CtaLink>
            </div>
          </div>
        </div>
        <div className="mt-14 sm:mt-16 lg:mt-20">
          <DecisionLedger />
        </div>
      </Container>
    </section>
  );
}
