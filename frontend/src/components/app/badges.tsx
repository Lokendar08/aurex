import {
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CircleXIcon,
  ClockIcon,
  FlaskRoundIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { humanize } from "@/lib/app/format";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "good" | "warning" | "danger" | "info" | "live";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-foreground/8",
  info: "bg-brand-50 text-brand-700 ring-brand-200/80 dark:bg-brand-800/30 dark:text-brand-200 dark:ring-brand-700/40",
  good: "bg-success/10 text-[color-mix(in_oklch,var(--success),var(--foreground)_32%)] ring-success/25",
  live: "bg-success/12 text-[color-mix(in_oklch,var(--success),var(--foreground)_32%)] ring-success/35",
  warning: "bg-warning/14 text-[color-mix(in_oklch,var(--warning),var(--foreground)_55%)] ring-warning/35",
  danger: "bg-destructive/8 text-destructive ring-destructive/25",
};

/** Small status pill: always an icon plus a word, never colour alone. */
export function StatusBadge({
  tone = "neutral",
  icon: Icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

// --- Integrations --------------------------------------------------------------------------

const INTEGRATION_STATUS: Record<string, { tone: Tone; icon: LucideIcon; label: string; hint: string }> = {
  connected: { tone: "live", icon: CircleCheckIcon, label: "Connected", hint: "The latest connection test succeeded." },
  configured: {
    tone: "neutral",
    icon: CircleDotIcon,
    label: "Configured",
    hint: "Settings are stored, but there is no verified live connection.",
  },
  awaiting_credentials: {
    tone: "warning",
    icon: KeyRoundIcon,
    label: "Awaiting credentials",
    hint: "Authorization or credentials are still missing. Nothing syncs until they are added.",
  },
  error: { tone: "danger", icon: CircleXIcon, label: "Error", hint: "The latest test or sync failed." },
  disabled: { tone: "neutral", icon: BanIcon, label: "Disabled", hint: "Disabled: no tests, syncs or uploads run." },
  draft: { tone: "neutral", icon: CircleDashedIcon, label: "Draft", hint: "Not configured yet." },
};

export function integrationStatusInfo(status: string) {
  return INTEGRATION_STATUS[status] ?? { tone: "neutral" as Tone, icon: CircleHelpIcon, label: humanize(status), hint: "" };
}

/** Honest connection status: only a passing live test reads as "Connected". */
export function IntegrationStatusBadge({ status, className }: { status: string; className?: string }) {
  const info = integrationStatusInfo(status);
  return (
    <StatusBadge tone={info.tone} icon={info.icon} title={info.hint} className={className}>
      {info.label}
    </StatusBadge>
  );
}

export function SyntheticFeedBadge({ className }: { className?: string }) {
  return (
    <StatusBadge tone="info" icon={FlaskRoundIcon} className={className} title="Built-in generator for the fictional NovaMart retailer. Not an external system.">
      Synthetic demo feed
    </StatusBadge>
  );
}

const JOB_STATUS: Record<string, { tone: Tone; icon: LucideIcon; label: string }> = {
  queued: { tone: "neutral", icon: ClockIcon, label: "Queued" },
  running: { tone: "info", icon: LoaderCircleIcon, label: "Running" },
  succeeded: { tone: "good", icon: CircleCheckIcon, label: "Succeeded" },
  partially_succeeded: { tone: "warning", icon: TriangleAlertIcon, label: "Partially succeeded" },
  failed: { tone: "danger", icon: CircleXIcon, label: "Failed" },
  cancelled: { tone: "neutral", icon: BanIcon, label: "Cancelled" },
};

export function JobStatusBadge({ status, className }: { status: string; className?: string }) {
  const info = JOB_STATUS[status] ?? { tone: "neutral" as Tone, icon: CircleHelpIcon, label: humanize(status) };
  return (
    <StatusBadge tone={info.tone} icon={info.icon} className={cn(status === "running" && "[&_svg]:animate-spin", className)}>
      {info.label}
    </StatusBadge>
  );
}

const AVAILABILITY: Record<string, { tone: Tone; label: string; hint: string }> = {
  available: { tone: "good", label: "Available", hint: "Can be set up now." },
  requires_vendor_authorization: {
    tone: "warning",
    label: "Needs vendor authorization",
    hint: "Requires the retailer's written authorization and vendor-provided access. Approved exports can be uploaded meanwhile.",
  },
  file_import_only: { tone: "neutral", label: "File import only", hint: "No live API; import approved exports." },
  planned: { tone: "neutral", label: "Planned", hint: "Researched but not yet implemented as a connector." },
};

export function AvailabilityBadge({ availability }: { availability: string }) {
  const info = AVAILABILITY[availability] ?? { tone: "neutral" as Tone, label: humanize(availability), hint: "" };
  return (
    <StatusBadge tone={info.tone} title={info.hint}>
      {info.label}
    </StatusBadge>
  );
}

const VERIFICATION: Record<string, { tone: Tone; icon: LucideIcon; label: string }> = {
  verified: { tone: "good", icon: CircleCheckIcon, label: "Verified" },
  partially_verified: { tone: "warning", icon: CircleAlertIcon, label: "Partially verified" },
  unverified: { tone: "neutral", icon: CircleHelpIcon, label: "Unverified" },
};

export function VerificationBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const info = VERIFICATION[status] ?? { tone: "neutral" as Tone, icon: CircleHelpIcon, label: humanize(status) };
  return (
    <StatusBadge tone={info.tone} icon={info.icon} title="How well the vendor research is backed by public evidence">
      {info.label}
    </StatusBadge>
  );
}

// --- Inventory & finance ------------------------------------------------------------------

const RISK: Record<string, { tone: Tone; label: string; icon: LucideIcon }> = {
  stocked_out: { tone: "danger", label: "Stocked out", icon: CircleXIcon },
  high: { tone: "danger", label: "High", icon: TriangleAlertIcon },
  medium: { tone: "warning", label: "Medium", icon: CircleAlertIcon },
  low: { tone: "neutral", label: "Low", icon: CircleDotIcon },
  no_demand_no_stock: { tone: "neutral", label: "No demand", icon: CircleDashedIcon },
};

export function RiskBadge({ risk }: { risk: string }) {
  const info = RISK[risk] ?? { tone: "neutral" as Tone, label: humanize(risk), icon: CircleHelpIcon };
  return (
    <StatusBadge tone={info.tone} icon={info.icon}>
      {info.label}
    </StatusBadge>
  );
}

export function FavourableBadge({ favourable }: { favourable: boolean | null }) {
  if (favourable === null) return <StatusBadge tone="neutral">Not comparable</StatusBadge>;
  return favourable ? (
    <StatusBadge tone="good" icon={CircleCheckIcon}>
      Favourable
    </StatusBadge>
  ) : (
    <StatusBadge tone="danger" icon={TriangleAlertIcon}>
      Unfavourable
    </StatusBadge>
  );
}

export function ActiveBadge({ active, activeLabel = "Active", inactiveLabel = "Suspended" }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return active ? (
    <StatusBadge tone="good" icon={CircleCheckIcon}>
      {activeLabel}
    </StatusBadge>
  ) : (
    <StatusBadge tone="danger" icon={BanIcon}>
      {inactiveLabel}
    </StatusBadge>
  );
}
