import type { Metadata } from "next";

import { ClosingCta } from "@/components/marketing/closing-cta";
import { SECURITY_GROUPS } from "@/components/marketing/content";
import { Container, PageMasthead, SectionHeading } from "@/components/marketing/primitives";
import { RoleRegister } from "@/components/marketing/roles";

export const metadata: Metadata = {
  title: "Security",
  description:
    "The security controls implemented in AUREX: Argon2id password hashing, HttpOnly session cookies with rotating refresh tokens, CSRF protection, server-side role-based access, organization isolation, encrypted integration credentials, signed webhooks and an audit trail.",
};

export default function SecurityPage() {
  return (
    <>
      <PageMasthead
        title="Security controls, as built"
        lead="This page lists the controls implemented in AUREX today, in plain terms. It describes the software; it is not a certification or an audit report."
      />

      <section aria-labelledby="controls-title" className="py-20 sm:py-24">
        <Container>
          <h2 id="controls-title" className="sr-only">
            Implemented controls
          </h2>
          <div className="space-y-16 sm:space-y-20">
            {SECURITY_GROUPS.map((group) => {
              const groupId = `controls-${group.name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
              return (
                <div key={group.name} className="grid gap-6 lg:grid-cols-12 lg:gap-8">
                  <h3
                    id={groupId}
                    className="font-display text-[1.5rem] leading-tight font-semibold tracking-[-0.015em] sm:text-[1.75rem] lg:col-span-4"
                  >
                    {group.name}
                  </h3>
                  <dl aria-labelledby={groupId} className="border-t lg:col-span-8">
                    {group.controls.map((control) => (
                      <div key={control.name} className="grid gap-1.5 border-b py-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-8">
                        <dt className="font-medium">{control.name}</dt>
                        <dd className="text-[0.9375rem] leading-relaxed text-muted-foreground">{control.text}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
        </Container>
      </section>

      <section aria-labelledby="roles-title" className="border-y bg-muted/60 py-20 sm:py-24">
        <Container>
          <SectionHeading
            id="roles-title"
            title="Ten roles, enforced on the server"
            lead="Access is decided by the member's role on every request. Owners can also limit a membership to specific stores, and that scope is applied to the data itself, not just the screens."
          />
          <RoleRegister className="mt-14 border-foreground/10 [&>div]:border-foreground/10" />
        </Container>
      </section>

      <ClosingCta
        title="See role-based access for yourself."
        text="The NovaMart demo lets you sign in under different roles and see what each one can open. All of its data is synthetic."
      />
    </>
  );
}
