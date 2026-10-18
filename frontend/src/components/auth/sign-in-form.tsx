"use client";

import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { authApi } from "@/lib/api";

import { authErrorMessage } from "./errors";
import { Field, FormAlert, PasswordInput, SubmitButton, TextInput } from "./fields";
import { useAuthNavigation } from "./redirect";

const signInSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").pipe(z.email("Enter a valid email address.")),
  password: z.string().min(1, "Enter your password."),
});

type FieldName = keyof z.infer<typeof signInSchema>;

export function SignInForm() {
  const navigateAfterAuth = useAuthNavigation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Cache Components keeps this page alive (hidden) after navigating away. Clear the password and
  // any in-flight state when it is hidden, so returning never shows a stale submission.
  useLayoutEffect(() => {
    return () => {
      setPassword("");
      setPending(false);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors;
      setErrors({ email: fieldErrors.email?.[0], password: fieldErrors.password?.[0] });
      setFormError(null);
      (fieldErrors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      const session = await authApi.login(parsed.data.email, parsed.data.password);
      setPassword("");
      navigateAfterAuth(session);
    } catch (error) {
      setPending(false);
      setFormError(authErrorMessage(error, "Check your email address and password, then try again."));
      passwordRef.current?.focus();
    }
  }

  return (
    // Inputs carry no `name`, so a native submit before hydration can never put credentials in the URL.
    <form noValidate onSubmit={handleSubmit} aria-describedby={formError ? "sign-in-error" : undefined}>
      <fieldset disabled={pending} className="space-y-5">
        <legend className="sr-only">Your AUREX account</legend>
        <Field id="sign-in-email" label="Email" error={errors.email}>
          {(control) => (
            <TextInput
              {...control}
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
              }}
            />
          )}
        </Field>
        <Field id="sign-in-password" label="Password" error={errors.password}>
          {(control) => (
            <PasswordInput
              {...control}
              ref={passwordRef}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
              }}
            />
          )}
        </Field>

        {formError ? <FormAlert id="sign-in-error">{formError}</FormAlert> : null}

        <SubmitButton pending={pending} pendingLabel="Signing in">
          Sign in
        </SubmitButton>
      </fieldset>
    </form>
  );
}
