import { cacheLife } from "next/cache";
import Link from "next/link";

import { AurexLogo } from "@/components/brand/logo";

import { DEMO_HREF, SIGN_IN_HREF, SIGN_UP_HREF } from "./content";
import { Container } from "./primitives";

const FOOTER_GROUPS = [
  {
    title: "Platform",
    links: [
      { href: "/product", label: "Product" },
      { href: "/integrations", label: "Integrations" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Company",
    links: [{ href: "/about", label: "About AUREX" }],
  },
  {
    title: "Get started",
    links: [
      { href: SIGN_UP_HREF, label: "Create an account" },
      { href: SIGN_IN_HREF, label: "Sign in" },
      { href: DEMO_HREF, label: "Explore the live demo" },
    ],
  },
] as const;

/** The year is computed once per cache lifetime rather than per request. */
async function CurrentYear() {
  "use cache";
  cacheLife("days");
  return <>{new Date().getFullYear()}</>;
}

export function SiteFooter() {
  return (
    <footer className="bg-navy-950 text-white/70">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <AurexLogo surface="dark" className="h-6" />
            <p className="mt-5 max-w-[40ch] text-sm leading-relaxed text-white/60">
              Decision intelligence built on authorized data, validated calculations and an honest account of
              uncertainty.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="font-sans text-sm font-medium tracking-normal text-white">{group.title}</h2>
                <ul className="mt-4 space-y-3">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="rounded-sm text-sm text-white/75 transition-colors outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-sky-accent focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs leading-relaxed text-white/55 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-[72ch]">
            NovaMart is a fictional retailer used to demonstrate AUREX. All NovaMart figures on this website and in
            the demo are synthetic.
          </p>
          <p className="shrink-0">
            &copy; <CurrentYear /> AUREX
          </p>
        </div>
      </Container>
    </footer>
  );
}
