import { DEMO_HREF, SIGN_UP_HREF } from "./content";
import { Container, CtaLink } from "./primitives";

export function ClosingCta({
  title = "Start with the demo company, or with your own data.",
  text = "The NovaMart demo opens every workspace with synthetic data. When you're ready, create an organization and connect your first source.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <section aria-labelledby="closing-cta-title" className="border-t bg-muted/60 py-20 sm:py-24">
      <Container className="grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-8">
        <div className="lg:col-span-7">
          <h2
            id="closing-cta-title"
            className="max-w-[24ch] text-balance font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.022em] sm:text-[2.5rem]"
          >
            {title}
          </h2>
          <p className="mt-4 max-w-[56ch] text-[1.0625rem] leading-relaxed text-muted-foreground">{text}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:col-span-5 lg:justify-end">
          <CtaLink href={SIGN_UP_HREF}>Create an account</CtaLink>
          <CtaLink href={DEMO_HREF} variant="secondary">
            Explore the live demo
          </CtaLink>
        </div>
      </Container>
    </section>
  );
}
