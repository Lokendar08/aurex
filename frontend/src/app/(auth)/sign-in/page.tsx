import type { Metadata } from "next";

import { DemoPanel } from "@/components/auth/demo-panel";
import { AuthRedirectProvider } from "@/components/auth/redirect";
import { SignInForm } from "@/components/auth/sign-in-form";
import { TextLink } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your AUREX workspace, or explore the NovaMart demo with synthetic data.",
};

export default function SignInPage() {
  return (
    <AuthRedirectProvider>
      <h1 className="font-display text-[2rem] leading-tight font-semibold tracking-[-0.025em]">Sign in to AUREX</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
        Use the email address and password for your AUREX account.
      </p>
      <div className="mt-8 rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-7">
        <SignInForm />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to AUREX? <TextLink href="/sign-up">Create an account</TextLink>
      </p>
      <DemoPanel />
    </AuthRedirectProvider>
  );
}
