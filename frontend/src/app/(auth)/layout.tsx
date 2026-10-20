import Link from "next/link";
import type { ReactNode } from "react";

import { AurexLogo } from "@/components/brand/logo";
import { AuthField } from "@/components/motion/auth-field";
import { SkipLink } from "@/components/marketing/site-header";

/**
 * Split-screen entry: a dark brand panel on wide screens, the form on ivory beside it. On phones the panel
 * collapses to a compact dark bar. Pages render only their own heading and form.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <SkipLink />
      <aside className="relative isolate hidden overflow-hidden bg-navy-950 text-white lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-10 xl:px-16">
        <div aria-hidden className="mk-glow absolute inset-0 -z-10" />
        <div aria-hidden className="mk-grid absolute inset-0 -z-10" />
        <Link
          href="/"
          aria-label="AUREX home"
          className="-m-1.5 w-fit rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sky-accent"
        >
          <AurexLogo surface="dark" title="" className="h-6" />
        </Link>
        <div>
          <p className="max-w-[14ch] text-balance font-display text-[clamp(2.5rem,3.6vw,3.5rem)] leading-[1] font-semibold tracking-[-0.04em]">
            Understand your business. <span className="mk-gold-text">Simulate</span> the future.
          </p>
          <p className="mt-5 max-w-[38ch] text-[1.0625rem] leading-relaxed text-navy-200">
            Forecast performance and test management decisions on your own authorized data, with every result tied to
            its source.
          </p>
          <AuthField className="mt-10 max-w-[30rem]" />
        </div>
        <p className="max-w-[44ch] text-xs leading-relaxed text-navy-300">
          NovaMart is a fictional retailer used to demonstrate AUREX. All of its data is synthetic.
        </p>
      </aside>

      <div className="flex flex-1 flex-col bg-background">
        <header className="flex h-16 items-center justify-between gap-4 bg-navy-950 px-4 text-white sm:px-6 lg:h-auto lg:bg-transparent lg:px-12 lg:pt-8 lg:text-foreground xl:px-16">
          <Link
            href="/"
            aria-label="AUREX home"
            className="-m-1.5 rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <AurexLogo surface="dark" title="" className="h-[1.375rem]" />
          </Link>
          <Link
            href="/security"
            className="ml-auto inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-navy-200 transition-colors outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-sky-accent lg:text-muted-foreground lg:hover:text-foreground lg:focus-visible:ring-ring"
          >
            How we protect accounts
          </Link>
        </header>
        <main id="main" tabIndex={-1} className="flex flex-1 items-start px-4 py-10 outline-none sm:px-6 sm:py-14 lg:items-center lg:px-12 xl:px-16">
          <div className="mx-auto w-full max-w-[28rem]">{children}</div>
        </main>
        <footer className="px-4 pb-8 text-center text-xs leading-relaxed text-muted-foreground lg:hidden">
          NovaMart is a fictional retailer used to demonstrate AUREX. All of its data is synthetic.
        </footer>
      </div>
    </div>
  );
}
