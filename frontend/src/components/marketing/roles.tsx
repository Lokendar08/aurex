import { cn } from "@/lib/utils";

import { ROLES } from "./content";
import { Container, SectionHeading } from "./primitives";

/** The ten roles as a two-column register. */
export function RoleRegister({ className }: { className?: string }) {
  return (
    <dl className={cn("grid border-t sm:grid-cols-2 sm:gap-x-10", className)}>
      {ROLES.map((role) => (
        <div key={role.label} className="border-b py-5">
          <dt className="font-medium">{role.label}</dt>
          <dd className="mt-1 max-w-[52ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
            {role.description}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function RolesSection() {
  return (
    <section aria-labelledby="roles-title" className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="roles-title"
          title="A workspace for each role"
          lead="Ten roles, enforced on the server. Each person lands in the workspace for their job, and store managers and employees can be limited to the stores they're assigned."
        />
        <RoleRegister className="mt-14" />
      </Container>
    </section>
  );
}
