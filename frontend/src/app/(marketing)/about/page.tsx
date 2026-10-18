import type { Metadata } from "next";

import { ClosingCta } from "@/components/marketing/closing-cta";
import { PRINCIPLES } from "@/components/marketing/content";
import { Container, PageMasthead } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why AUREX exists and the principles it is built on: evidence over assumptions, no fabricated numbers, disclosed uncertainty, customer-owned data and clearly labelled synthetic demo data.",
};

export default function AboutPage() {
  return (
    <>
      <PageMasthead
        title="Management decisions should rest on evidence"
        lead="AUREX helps companies decide with their own authorized data, calculations that have been validated, and an honest account of what isn't known yet."
      />

      <section aria-labelledby="principles-title" className="py-20 sm:py-24">
        <Container>
          <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
            <h2
              id="principles-title"
              className="font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.022em] sm:text-[2.5rem] lg:col-span-4"
            >
              Principles
            </h2>
            <p className="max-w-[60ch] text-[1.0625rem] leading-relaxed text-muted-foreground lg:col-span-7 lg:col-start-6">
              These are design rules, not slogans. Each one changes what the product will and won&apos;t do, and
              each one is visible somewhere you can check.
            </p>
          </div>

          <dl className="mt-14 border-t">
            {PRINCIPLES.map((principle) => (
              <div key={principle.name} className="grid gap-4 border-b py-8 lg:grid-cols-12 lg:gap-8 lg:py-10">
                <dt className="font-display text-[1.375rem] leading-snug font-semibold tracking-[-0.015em] lg:col-span-4">
                  {principle.name}
                </dt>
                <dd className="lg:col-span-7 lg:col-start-6">
                  <p className="max-w-[62ch] text-[1.0625rem] leading-relaxed">{principle.text}</p>
                  <p className="mt-3 max-w-[62ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">In practice: </span>
                    {principle.practice}
                  </p>
                </dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <section aria-labelledby="demo-data-title" className="border-y bg-muted/60 py-20 sm:py-24">
        <Container className="grid gap-8 lg:grid-cols-12 lg:gap-8">
          <h2
            id="demo-data-title"
            className="font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.022em] sm:text-[2.5rem] lg:col-span-4"
          >
            About the data you see here
          </h2>
          <div className="space-y-5 text-[1.0625rem] leading-relaxed lg:col-span-7 lg:col-start-6">
            <p>
              NovaMart, the retailer in every example on this website and in the demo, is fictional. Its stores,
              products, staff numbers and results are synthetic, generated to behave like a real retail business.
            </p>
            <p className="text-muted-foreground">
              Company Intelligence covers real public companies, such as DMart, MR D.I.Y. and Wellness Forever,
              using figures from their public filings. A profile doesn&apos;t mean the company uses AUREX or has
              any relationship with it.
            </p>
          </div>
        </Container>
      </section>

      <ClosingCta />
    </>
  );
}
