import Link from "next/link";

import { AurexLogo } from "@/components/brand/logo";

import { SIGN_IN_HREF, SIGN_UP_HREF } from "./content";
import { Container, CtaLink } from "./primitives";
import { DesktopNav, MobileNav } from "./site-nav";

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-md bg-white px-4 py-2 text-sm font-medium text-navy-950 shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-2 focus:outline-offset-2 focus:outline-sky-accent"
    >
      Skip to content
    </a>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-900 text-white">
      <Container className="flex h-16 items-center gap-6 lg:gap-10">
        <Link
          href="/"
          aria-label="AUREX home"
          className="-m-1.5 shrink-0 rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sky-accent"
        >
          <AurexLogo surface="dark" title="" className="h-[1.375rem]" />
        </Link>
        <DesktopNav />
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Link
            href={SIGN_IN_HREF}
            className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-navy-100 transition-colors outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-sky-accent"
          >
            Sign in
          </Link>
          <CtaLink href={SIGN_UP_HREF} variant="inverse" size="sm">
            Create an account
          </CtaLink>
        </div>
        <div className="ml-auto md:hidden">
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
