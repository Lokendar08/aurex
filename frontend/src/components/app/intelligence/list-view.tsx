"use client";

import { ArrowRightIcon, Building2Icon, CircleAlertIcon, GlobeIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/app/badges";
import { NoteList, PageHeader, Panel } from "@/components/app/page";
import { PermissionGate } from "@/components/app/access";
import { EmptyState, Notice, SkeletonBlock } from "@/components/app/states";
import { ExternalLink, QueryError } from "@/components/app/decision-lab/common";
import { useOrgQuery } from "@/hooks/use-org-query";
import { formatNumber, MISSING } from "@/lib/app/format";
import { monthName } from "@/lib/app/intelligence-format";
import type { CompaniesResponse, CompanyProfile, Highlight } from "@/lib/app/intelligence-types";

import { AddCompanyDialog } from "./forms";
import { ListingBadge, MarketDataNote, MarketSnapshotBlock, SourceCitation, VerificationTag } from "./parts";

const HIGHLIGHTS: { key: string; label: string }[] = [
  { key: "latest_revenue", label: "Revenue" },
  { key: "revenue_growth", label: "Revenue growth" },
  { key: "net_margin", label: "Net margin" },
  { key: "store_count", label: "Stores" },
];

function HighlightCell({ label, item }: { label: string; item: Highlight | undefined }) {
  return (
    <div className="min-w-0 bg-card px-3.5 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {item ? (
        <>
          <p className="mt-0.5 truncate text-[0.9375rem] font-semibold" title={item.display}>
            {item.display}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.fiscal_year ?? "Year not stated"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.source_url ? <SourceCitation url={item.source_url} name="Source" /> : <span className="text-xs text-muted-foreground">{item.source_name ?? "Derived"}</span>}
          </div>
        </>
      ) : (
        <p className="mt-0.5 text-sm text-muted-foreground">Not available</p>
      )}
    </div>
  );
}

function CompanyCard({ company, marketData }: { company: CompanyProfile; marketData: CompaniesResponse["market_data"] }) {
  const latestFy = company.recent_years?.[company.recent_years.length - 1];
  return (
    <article className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10" aria-labelledby={`co-${company.key}`}>
      <header className="space-y-2 px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={`co-${company.key}`} className="font-heading text-base font-semibold">
              <Link href={`/app/intelligence/${company.key}`} className="rounded-sm outline-none hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                {company.display_name}
              </Link>
            </h2>
            {company.legal_name ? <p className="truncate text-xs text-muted-foreground">{company.legal_name}</p> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ListingBadge company={company} />
            {company.custom ? <StatusBadge tone="info">Tracked by your team</StatusBadge> : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {[company.sector, company.country, company.reporting_currency ? `Reports in ${company.reporting_currency}` : null, company.fiscal_year_end_month ? `Fiscal year ends ${monthName(company.fiscal_year_end_month)}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4 sm:px-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border ring-1 ring-foreground/8">
          {HIGHLIGHTS.map((h) => (
            <HighlightCell key={h.key} label={h.label} item={company.highlights[h.key]} />
          ))}
        </div>
        {company.highlights.latest_revenue?.verification_status ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Revenue: <VerificationTag status={company.highlights.latest_revenue.verification_status} />
            {latestFy?.basis ? <span>· {latestFy.basis} basis</span> : null}
          </p>
        ) : null}
        <MarketSnapshotBlock company={company} marketData={marketData} compact />
        {company.data_gaps.length ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            {formatNumber(company.data_gaps.length)} known data gap{company.data_gaps.length === 1 ? "" : "s"}: {company.data_gaps[0]}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          {company.website ? (
            <ExternalLink href={company.website} className="text-xs">
              <span className="inline-flex items-center gap-1">
                <GlobeIcon className="size-3.5" aria-hidden />
                Website
              </span>
            </ExternalLink>
          ) : (
            <span />
          )}
          <Link
            href={`/app/intelligence/${company.key}`}
            className="inline-flex items-center gap-1 rounded-md text-[0.8125rem] font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Financials and sources
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function IntelligenceList() {
  const router = useRouter();
  const query = useOrgQuery<CompaniesResponse>("/intelligence/companies", { staleTime: 10 * 60_000 });
  const data = query.data;
  return (
    <>
      <PageHeader
        title="Company Intelligence"
        description="Public companies from verified filings and cited sources. Every figure shows its fiscal year, basis and source; nothing about private companies is estimated."
        actions={
          <PermissionGate permission="intelligence:manage">
            <AddCompanyDialog onCreated={(key) => router.push(`/app/intelligence/${key}`)} />
          </PermissionGate>
        }
        meta={data ? <span>{formatNumber(data.companies.length)} companies</span> : null}
      />
      {query.isPending ? (
        <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonBlock key={i} className="h-80" />
          ))}
        </div>
      ) : query.error || !data ? (
        <Panel>
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      ) : (
        <div className="space-y-6">
          <Notice title="How to read these profiles">
            <NoteList
              notes={[
                data.disclaimer,
                "Fiscal years differ: Indian companies mostly close in March, Malaysian ones in December. Amounts stay in each company's reporting currency.",
              ]}
            />
            <div className="mt-2">
              <MarketDataNote status={data.market_data} />
            </div>
          </Notice>
          {data.companies.length === 0 ? (
            <Panel>
              <EmptyState icon={Building2Icon} title="No company profiles yet" description="Track a company to start recording its reported figures with sources." />
            </Panel>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
              {data.companies.map((company) => (
                <CompanyCard key={company.key} company={company} marketData={data.market_data} />
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{MISSING} means a figure is not available from a verified source, never zero.</p>
        </div>
      )}
    </>
  );
}
