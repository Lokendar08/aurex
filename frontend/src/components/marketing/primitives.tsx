import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Page-width container: 1240px max, 16px gutters on phones. */
export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-[77.5rem] px-4 sm:px-6 lg:px-8", className)} {...props} />;
}

type CtaVariant = "primary" | "secondary" | "inverse" | "inverse-outline";

const CTA_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:ring-3";

const CTA_VARIANTS: Record<CtaVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/88 focus-visible:ring-ring/50",
  secondary:
    "border border-border bg-background text-foreground hover:border-foreground/25 hover:bg-muted focus-visible:ring-ring/50",
  inverse: "bg-white text-navy-950 hover:bg-navy-100 focus-visible:ring-sky-accent/70",
  "inverse-outline":
    "border border-white/25 text-white hover:border-white/45 hover:bg-white/8 focus-visible:ring-sky-accent/70",
};

const CTA_SIZES = {
  default: "h-11 px-5 text-[0.9375rem]",
  sm: "h-9 px-3.5 text-sm",
} as const;

export function ctaClasses(variant: CtaVariant = "primary", size: keyof typeof CTA_SIZES = "default") {
  return cn(CTA_BASE, CTA_VARIANTS[variant], CTA_SIZES[size]);
}

/** A link styled as a call to action. Internal routes use next/link. */
export function CtaLink({
  variant = "primary",
  size = "default",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: CtaVariant; size?: keyof typeof CTA_SIZES }) {
  return <Link className={cn(ctaClasses(variant, size), className)} {...props} />;
}

/** Inline text link with a visible focus style on light surfaces. */
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}

export function SectionHeading({
  id,
  title,
  lead,
  className,
  surface = "light",
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
  surface?: "light" | "dark";
}) {
  return (
    <div className={cn("grid gap-5 lg:grid-cols-12 lg:gap-8", className)}>
      <h2
        id={id}
        className="text-balance font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.022em] sm:text-[2.5rem] lg:col-span-7 lg:text-[2.75rem]"
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={cn(
            "max-w-[60ch] text-pretty text-[1.0625rem] leading-relaxed lg:col-span-5 lg:self-end",
            surface === "dark" ? "text-navy-200" : "text-muted-foreground",
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}

/** Navy introduction band used at the top of inner marketing pages. */
export function PageMasthead({
  title,
  lead,
  children,
}: {
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="bg-navy-900 text-white">
      <Container className="pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-24">
        <h1 className="max-w-[18ch] font-display text-[2.5rem] leading-[1.03] font-semibold tracking-[-0.03em] sm:text-[3.5rem] lg:text-[4rem]">
          {title}
        </h1>
        <p className="mt-6 max-w-[62ch] text-pretty text-lg leading-relaxed text-navy-200 sm:text-xl">{lead}</p>
        {children}
      </Container>
    </div>
  );
}
