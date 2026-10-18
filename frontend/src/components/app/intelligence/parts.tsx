"use client";

import { BuildingIcon, CircleDashedIcon, LandmarkIcon, LineChartIcon } from "lucide-react";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/app/badges";
import { ExternalLink, hostOf } from "@/components/app/decision-lab/common";
import { formatDate, formatMoney } from "@/lib/app/format";
import { formatReported, verificationInfo } from "@/lib/app/intelligence-format";
import type { CompanyProfile, MarketDataStatus, VerificationStatus } from "@/lib/app/intelligence-types";
import { cn } from "@/lib/utils";

export function VerificationTag({ status }: { status: VerificationStatus | null | undefined }) {
  const info = verificationInfo(status);
  return <StatusBadge tone={info.tone}>{info.label}</StatusBadge>;
}

/** A source citation: the publisher's name linking to the document, with its host for context. */
export function SourceCitation({ url, name, className }: { url: string | null | undefined; name?: string | null; className?: string }) {
  const host = hostOf(url);
  if (!url && !name) return <span className={cn("text-xs text-muted-foreground", className)}>No source recorded</span>;
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs", className)}>
      <ExternalLink href={url} className="text-xs">
        {name || host || "Source"}
      </ExternalLink>
      {name && host ? <span className="text-muted-foreground">{host}</span> : null}
    </span>
  );
}

export function ListingBadge({ company }: { company: Pick<CompanyProfile, "is_listed" | "securities"> }) {
  if (company.is_listed === false) {
    return (
      <StatusBadge tone="neutral" icon={BuildingIcon}>
        Unlisted
      </StatusBadge>
    );
  }
  if (company.is_listed) {
    const tickers = company.securities.map((s) => `${s.exchange.split(" ")[0]}: ${s.ticker}`).join(" · ");
    return (
      <StatusBadge tone="info" icon={LandmarkIcon} title={tickers || undefined}>
        Listed{tickers ? ` · ${tickers}` : ""}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral" icon={CircleDashedIcon}>
      Listing not confirmed
    </StatusBadge>
  );
}

/**
 * Share price and market value, under the platform's rules: only for listed companies with a
 * recorded security, always as a dated snapshot with its source; never for unlisted companies.
 */
export function MarketSnapshotBlock({
  company,
  marketData,
  compact,
}: {
  company: Pick<CompanyProfile, "is_listed" | "securities" | "market_snapshot" | "display_name">;
  marketData?: MarketDataStatus;
  compact?: boolean;
}) {
  const snap = company.market_snapshot;
  let body: ReactNode;
  if (company.is_listed === false) {
    body = (
      <>
        <p className="font-medium">Unlisted — no share price</p>
        {!compact ? (
          <p className="text-muted-foreground">{company.display_name} is not listed on an exchange, so there is no share price or market capitalisation.</p>
        ) : null}
      </>
    );
  } else if (!company.is_listed) {
    body = <p className="text-muted-foreground">Listing status not confirmed — no share price shown.</p>;
  } else if (!company.securities.length) {
    body = <p className="text-muted-foreground">Listed, but no security is recorded — no share price shown.</p>;
  } else if (!snap) {
    body = (
      <>
        <p className="font-medium">No dated price snapshot stored</p>
        {!compact && marketData && !marketData.configured ? <p className="text-muted-foreground">{marketData.note}</p> : null}
      </>
    );
  } else {
    body = (
      <>
        <p>
          <span className="font-semibold tabular">{formatMoney(snap.close_price, snap.currency ?? "INR", { decimals: 2 })}</span>{" "}
          <span className="text-muted-foreground">
            close on {formatDate(snap.as_of)}
            {snap.exchange ? ` · ${snap.exchange}${snap.ticker ? `: ${snap.ticker}` : ""}` : ""}
          </span>
        </p>
        {snap.market_cap !== null ? (
          <p>
            Market cap <span className="font-semibold tabular">{formatReported(snap.market_cap, snap.market_cap_unit, snap.currency)}</span>
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
          <StatusBadge tone="warning">Dated snapshot, not live</StatusBadge>
          <SourceCitation url={snap.source_url ?? snap.source} name={snap.exchange ? `${snap.exchange} quote page` : null} />
        </p>
        {!compact && snap.notes ? <p className="text-xs text-muted-foreground">{snap.notes}</p> : null}
      </>
    );
  }
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg bg-muted/55 px-3 py-2.5 text-[0.8125rem] leading-relaxed", compact && "py-2")} aria-label="Share price">
      <LineChartIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-1">{body}</div>
    </div>
  );
}

export function MarketDataNote({ status }: { status: MarketDataStatus }) {
  if (status.configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Market data provider: {status.provider}. {status.note}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      <strong className="font-medium text-foreground">Live market data is not configured.</strong> {status.note}
    </p>
  );
}
