import Link from "next/link";
import type { ReactNode } from "react";

import { AurexLogo } from "@/components/brand/logo";
import { Container } from "@/components/marketing/primitives";
import { SkipLink } from "@/components/marketing/site-header";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-muted/60">
      <SkipLink />
      <header className="border-b border-white/10 bg-navy-900 text-white">
        <Container className="flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            aria-label="AUREX home"
            className="-m-1.5 rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sky-accent"
          >
            <AurexLogo surface="dark" title="" className="h-[1.375rem]" />
          </Link>
          <Link
            href="/security"
            className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-navy-200 transition-colors outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-sky-accent"
          >
            How we protect accounts
          </Link>
        </Container>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-12 outline-none sm:py-16">
        <div className="mx-auto w-full max-w-[28rem]">{children}</div>
      </main>
      <footer className="px-4 pb-10 text-center text-xs leading-relaxed text-muted-foreground">
        NovaMart is a fictional retailer used to demonstrate AUREX. All of its data is synthetic.
      </footer>
    </div>
  );
}
