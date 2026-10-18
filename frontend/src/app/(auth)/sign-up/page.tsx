import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthRedirectProvider } from "@/components/auth/redirect";
import { SignUpFallback, SignUpForm } from "@/components/auth/sign-up-form";
import { TextLink } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create an AUREX account and organization, or accept an invitation to join your team's workspace.",
};

export default function SignUpPage() {
  return (
    <AuthRedirectProvider>
      {/* The form reads ?invite= with useSearchParams, so it renders inside its own Suspense boundary. */}
      <Suspense fallback={<SignUpFallback />}>
        <SignUpForm />
      </Suspense>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
      </p>
    </AuthRedirectProvider>
  );
}
