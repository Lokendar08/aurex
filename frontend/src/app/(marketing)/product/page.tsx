import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdvisorSample } from "@/components/marketing/advisor";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { MODULE_GROUPS, MODULES, ORDERED_MODULES, type ModuleInfo } from "@/components/marketing/content";
import { DecisionLabDetail, DecisionPrinciple } from "@/components/marketing/decision-lab";
import { Container, PageMasthead, TextLink } from "@/components/marketing/primitives";
import { ForecastingDetail, OutcomeTrackingSample } from "@/components/marketing/product-details";
import { SectionIndex, type SectionIndexGroup } from "@/components/marketing/section-index";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Eleven AUREX modules on one validated data model: integrations, data pipeline, dashboards, analytics, forecasting, Decision Lab, the AI Business Advisor, company intelligence, market news, benchmarking, and reports and workflows.",
};

const INDEX_GROUPS: SectionIndexGroup[] = MODULE_GROUPS.map((group) => ({
  name: group.name,
  items: MODULES.filter((m) => m.group === group.name).map((m) => ({ id: m.id, label: m.name })),
}));

// Extra material for modules that need more than a list.
const DETAILS: Partial<Record<string, ReactNode>> = {
  "integration-hub": (
    <p className="mt-6">
      <TextLink href="/integrations">See connection methods and the provider catalogue</TextLink>
    </p>
  ),
  forecasting: <ForecastingDetail />,
  "decision-lab": (
    <div className="mt-10">
      <DecisionPrinciple className="max-w-[34ch] text-[1.5rem] leading-[1.22] sm:text-[1.875rem] lg:text-[2rem]" />
      <DecisionLabDetail layout="stacked" className="mt-10" />
    </div>
  ),
  advisor: (
    <div className="mt-10">
      <AdvisorSample />
    </div>
  ),
  "reports-workflows": <OutcomeTrackingSample className="mt-10" />,
};

function ModuleSection({ module }: { module: ModuleInfo }) {
  const titleId = `${module.id}-title`;
  return (
    <section
      id={module.id}
      aria-labelledby={titleId}
      className="scroll-mt-24 border-t py-14 first-of-type:border-t-0 first-of-type:pt-0 sm:py-16"
    >
      <p className="text-sm text-muted-foreground">{module.group}</p>
      <h2
        id={titleId}
        className="mt-1.5 font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] sm:text-[2.25rem]"
      >
        {module.name}
      </h2>
      <p className="mt-4 max-w-[64ch] text-pretty text-[1.0625rem] leading-relaxed text-muted-foreground">
        {module.lead}
      </p>
      {module.capabilities.length > 0 ? (
        <ul className="mt-8 grid max-w-4xl gap-x-10 gap-y-3 sm:grid-cols-2">
          {module.capabilities.map((capability) => (
            <li key={capability} className="flex gap-3 text-[0.9375rem] leading-relaxed">
              <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary" />
              {capability}
            </li>
          ))}
        </ul>
      ) : null}
      {module.note ? (
        <p className="mt-8 max-w-[72ch] border-l-2 border-primary/60 pl-4 text-[0.9375rem] leading-relaxed">
          {module.note}
        </p>
      ) : null}
      {DETAILS[module.id] ?? null}
    </section>
  );
}

export default function ProductPage() {
  return (
    <>
      <PageMasthead
        title="Everything from the first import to the final report"
        lead="Eleven modules share one validated data model, so a figure on the dashboard, in a forecast and in the advisor's answer is the same figure."
      />

      <Container className="py-14 sm:py-20 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-16 xl:gap-20">
        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <SectionIndex groups={INDEX_GROUPS} label="Modules" />
          </div>
        </aside>

        <div className="min-w-0">
          <nav aria-label="Modules" className="mb-12 lg:hidden">
            <p className="text-sm font-medium">Jump to a module</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {ORDERED_MODULES.map((module) => (
                <li key={module.id}>
                  <a
                    href={`#${module.id}`}
                    className="inline-flex h-9 items-center rounded-full border bg-background px-3.5 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {module.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {ORDERED_MODULES.map((module) => (
            <ModuleSection key={module.id} module={module} />
          ))}
        </div>
      </Container>

      <ClosingCta />
    </>
  );
}
