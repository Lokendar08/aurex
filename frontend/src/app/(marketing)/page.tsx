import type { Metadata } from "next";

import { AdvisorSection } from "@/components/marketing/advisor";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { DecisionLabSection } from "@/components/marketing/decision-lab";
import { HomeHero } from "@/components/marketing/home-hero";
import { IntelligenceJourney } from "@/components/marketing/intelligence-journey";
import { ModuleIndexSection } from "@/components/marketing/module-index";
import { PipelineSection } from "@/components/marketing/pipeline";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { RolesSection } from "@/components/marketing/roles";

export const metadata: Metadata = {
  title: { absolute: "AUREX: test a decision before you make it" },
  description:
    "AUREX connects authorized business data, forecasts performance with validated models and simulates management decisions. Every result shows its source and its uncertainty.",
};

export default function HomePage() {
  return (
    <>
      <HomeHero />
      <IntelligenceJourney />
      <ProductShowcase />
      <PipelineSection />
      <ModuleIndexSection />
      <DecisionLabSection />
      <AdvisorSection />
      <RolesSection />
      <ClosingCta />
    </>
  );
}
