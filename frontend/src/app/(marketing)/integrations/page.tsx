import {
  BracesIcon,
  DatabaseIcon,
  FileOutputIcon,
  FileSpreadsheetIcon,
  KeyRoundIcon,
  WebhookIcon,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";

import { ClosingCta } from "@/components/marketing/closing-cta";
import { ConnectorRunSample } from "@/components/marketing/connector-sample";
import { CONNECTION_METHODS, CONNECTOR_FRAMEWORK } from "@/components/marketing/content";
import { IntegrationCatalog } from "@/components/marketing/integration-catalog";
import { Container, PageMasthead, SectionHeading } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "How AUREX connects to POS, ERP, inventory, accounting and HR systems: documented APIs, authorized OAuth, signed webhooks, approved exports, CSV and Excel imports, and read-only database access.",
};

const METHOD_ICONS: Record<(typeof CONNECTION_METHODS)[number]["key"], LucideIcon> = {
  rest_api: BracesIcon,
  oauth: KeyRoundIcon,
  webhook: WebhookIcon,
  export: FileOutputIcon,
  file_import: FileSpreadsheetIcon,
  database: DatabaseIcon,
};

export default function IntegrationsPage() {
  return (
    <>
      <PageMasthead
        title="Connect the systems you already run"
        lead="AUREX reads from POS, ERP, inventory, accounting and HR systems through documented, authorized methods, and records where every row came from."
      >
        <div className="mt-10 max-w-3xl border-l-2 border-sky-accent pl-5">
          <p className="font-medium text-white">Nothing connects until you authorize it.</p>
          <p className="mt-1.5 leading-relaxed text-navy-200">
            Vendor connections activate only after your organization authorizes access and AUREX tests the
            credentials. A provider listed on this page is not a claim that AUREX is connected to it.
          </p>
        </div>
      </PageMasthead>

      <section aria-labelledby="methods-title" className="py-20 sm:py-24">
        <Container>
          <SectionHeading
            id="methods-title"
            title="Six ways to connect"
            lead="Use whichever your systems support. Each method is either documented by the vendor or fully under your control."
          />
          <ul className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTION_METHODS.map((method) => {
              const Icon = METHOD_ICONS[method.key];
              return (
                <li key={method.key} className="border-t pt-5">
                  <Icon className="size-5 text-primary" aria-hidden strokeWidth={1.75} />
                  <h3 className="mt-4 font-display text-lg font-semibold tracking-[-0.01em]">{method.name}</h3>
                  <p className="mt-1.5 max-w-[44ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
                    {method.text}
                  </p>
                </li>
              );
            })}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="framework-title" className="border-y bg-muted/60 py-20 sm:py-24">
        <Container>
          <SectionHeading
            id="framework-title"
            title="Every connector runs on the same framework"
            lead="Whichever method you use, imports behave the same way: incremental, deduplicated, validated and traceable back to their source."
          />
          <div className="mt-14 grid gap-12 lg:grid-cols-12 lg:gap-10">
            <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:col-span-6">
              {CONNECTOR_FRAMEWORK.map((item) => (
                <div key={item.name} className="border-t border-foreground/10 pt-4">
                  <dt className="font-medium">{item.name}</dt>
                  <dd className="mt-1 text-[0.9375rem] leading-relaxed text-muted-foreground">{item.text}</dd>
                </div>
              ))}
            </dl>
            <div className="lg:col-span-6">
              <ConnectorRunSample />
            </div>
          </div>
        </Container>
      </section>

      <section aria-labelledby="catalogue-title" className="py-20 sm:py-24">
        <Container>
          <SectionHeading
            id="catalogue-title"
            title="Provider catalogue"
            lead="Vendors whose systems AUREX can work with, and how. Availability says what is possible today. Verification says how far the listed methods have been checked against the vendor's own documentation."
          />
          <IntegrationCatalog />
        </Container>
      </section>

      <ClosingCta
        title="Try the platform before you connect anything."
        text="The NovaMart demo runs on synthetic data, so you can explore every module without authorizing a single system."
      />
    </>
  );
}
