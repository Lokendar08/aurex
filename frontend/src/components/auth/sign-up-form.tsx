"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { z } from "zod";

import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, authApi } from "@/lib/api";
import { cn } from "@/lib/utils";

import { apiFieldErrors, authErrorMessage } from "./errors";
import { Field, FormAlert, PasswordInput, SubmitButton, TextInput } from "./fields";
import { useAuthNavigation } from "./redirect";

const PASSWORD_MIN = 10;

const fullName = z.string().trim().min(1, "Enter your full name.").max(200, "Use 200 characters or fewer.");
const workEmail = z.string().trim().min(1, "Enter your work email.").pipe(z.email("Enter a valid email address."));
const password = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(256, "Use 256 characters or fewer.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/\d/, "Include at least one number.");
const organizationName = z
  .string()
  .trim()
  .min(2, "Enter your organization's name.")
  .max(200, "Use 200 characters or fewer.");

const ownOrganizationSchema = z.object({
  full_name: fullName,
  email: workEmail,
  password,
  organization_name: organizationName,
});
const invitationSchema = z.object({ full_name: fullName, password });

const FIELDS = ["full_name", "email", "password", "organization_name"] as const;
type FieldName = (typeof FIELDS)[number];
type Values = Record<FieldName, string>;
type Errors = Partial<Record<FieldName, string>>;

const EMPTY: Values = { full_name: "", email: "", password: "", organization_name: "" };

function formatExpiry(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function PasswordPolicy({ value }: { value: string }) {
  const rules = [
    { label: `At least ${PASSWORD_MIN} characters`, met: value.length >= PASSWORD_MIN },
    { label: "Letters and numbers", met: /[A-Za-z]/.test(value) && /\d/.test(value) },
  ];
  return (
    <div>
      <ul className="space-y-1">
        {rules.map((rule) => (
          <li
            key={rule.label}
            className={cn("flex items-center gap-2", rule.met ? "text-foreground" : "text-muted-foreground")}
          >
            <span aria-hidden className="grid size-4 place-items-center">
              {rule.met ? (
                <CheckIcon className="size-4 text-success" strokeWidth={2.5} />
              ) : (
                <span className="size-1.5 rounded-full bg-current" />
              )}
            </span>
            {rule.label}
            <span className="sr-only">{rule.met ? ", met" : ", not met yet"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5">Avoid common passwords and anything containing your email name.</p>
    </div>
  );
}

/** Static-shell placeholder shown until the search params (invitation token) are available. */
export function SignUpFallback() {
  return (
    <div>
      <h1 className="font-display text-[2rem] leading-tight font-semibold tracking-[-0.025em]">
        Create your AUREX account
      </h1>
      <div aria-hidden className="mt-8 space-y-5 rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-7">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}

export function SignUpForm() {
  const params = useSearchParams();
  const inviteToken = params.get("invite")?.trim() || null;
  const navigateAfterAuth = useAuthNavigation();

  const invitation = useQuery({
    queryKey: ["auth", "invitation", inviteToken],
    queryFn: () => authApi.invitation(inviteToken as string),
    enabled: inviteToken !== null,
    retry: false,
    staleTime: 60_000,
  });
  const invite = inviteToken !== null && invitation.isSuccess ? invitation.data : null;
  const checkingInvite = inviteToken !== null && invitation.isPending;
  const inviteFailed = inviteToken !== null && invitation.isError;

  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const fullNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const organizationRef = useRef<HTMLInputElement>(null);
  const refs: Record<FieldName, RefObject<HTMLInputElement | null>> = {
    full_name: fullNameRef,
    email: emailRef,
    password: passwordRef,
    organization_name: organizationRef,
  };

  // Clear the password and in-flight state when the page is hidden after navigating into the app.
  useLayoutEffect(() => {
    return () => {
      setValues((v) => ({ ...v, password: "" }));
      setPending(false);
    };
  }, []);

  function validate(next: Values): { ok: true } | { ok: false; errors: Errors } {
    const result = invite ? invitationSchema.safeParse(next) : ownOrganizationSchema.safeParse(next);
    if (result.success) return { ok: true };
    const fieldErrors = z.flattenError(result.error).fieldErrors as Partial<Record<FieldName, string[]>>;
    const out: Errors = {};
    for (const field of FIELDS) {
      const message = fieldErrors[field]?.[0];
      if (message) out[field] = message;
    }
    return { ok: false, errors: out };
  }

  function focusFirst(fieldErrors: Errors) {
    const first = FIELDS.find((field) => fieldErrors[field]);
    if (first) refs[first].current?.focus();
  }

  function update(field: FieldName, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (attempted) {
      const check = validate(next);
      setErrors(check.ok ? {} : check.errors);
    } else if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || checkingInvite) return;
    setAttempted(true);

    const check = validate(values);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError(null);
      focusFirst(check.errors);
      return;
    }

    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      const session = await authApi.register(
        invite && inviteToken
          ? {
              full_name: values.full_name.trim(),
              email: invite.email,
              password: values.password,
              invitation_token: inviteToken,
            }
          : {
              full_name: values.full_name.trim(),
              email: values.email.trim(),
              password: values.password,
              organization_name: values.organization_name.trim(),
            },
      );
      setValues((v) => ({ ...v, password: "" }));
      navigateAfterAuth(session);
    } catch (error) {
      setPending(false);
      const mapped = apiFieldErrors(error, FIELDS);
      if (invite) delete mapped.email;
      if (error instanceof ApiError && Object.keys(mapped).length === 0) {
        // Single-message errors that clearly belong to one field (password policy, taken email).
        if (/password/i.test(error.message)) mapped.password = error.message;
        else if (!invite && error.status === 409 && /email/i.test(error.message)) mapped.email = error.message;
      }
      if (Object.keys(mapped).length > 0) {
        setErrors(mapped);
        focusFirst(mapped);
      } else {
        setFormError(authErrorMessage(error));
      }
    }
  }

  const expiry = invite ? formatExpiry(invite.expires_at) : null;

  return (
    <div>
      <h1 className="font-display text-[2rem] leading-tight font-semibold tracking-[-0.025em]">
        {invite ? `Join ${invite.organization_name}` : "Create your AUREX account"}
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
        {invite
          ? "Choose your name and a password to accept the invitation."
          : "Set up your organization now and connect data when you're ready. You'll be its owner and can invite colleagues afterwards."}
      </p>

      {checkingInvite ? (
        <p role="status" className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          Checking your invitation
        </p>
      ) : null}

      {invite ? (
        <div className="mt-6 rounded-xl border bg-card px-4 py-3.5">
          <p className="font-medium">
            Join {invite.organization_name} as {invite.role_label}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Invitation for {invite.email}
            {expiry ? `, valid until ${expiry}` : ""}.
          </p>
        </div>
      ) : null}

      {inviteFailed ? (
        <div className="mt-6">
          <FormAlert>
            <p className="font-medium">This invitation can&apos;t be used.</p>
            <p className="mt-1 text-muted-foreground">
              {authErrorMessage(invitation.error)} Ask the person who invited you for a new link, or create a new
              organization below.
            </p>
          </FormAlert>
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={handleSubmit}
        className="mt-8 rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-7"
      >
        <fieldset disabled={pending || checkingInvite} className="space-y-5">
          <legend className="sr-only">{invite ? "Accept your invitation" : "Your account and organization"}</legend>

          <Field id="sign-up-name" label="Full name" error={errors.full_name}>
            {(control) => (
              <TextInput
                {...control}
                ref={fullNameRef}
                autoComplete="name"
                value={values.full_name}
                onChange={(e) => update("full_name", e.target.value)}
              />
            )}
          </Field>

          <Field
            id="sign-up-email"
            label="Work email"
            error={invite ? undefined : errors.email}
            hint={invite ? "Invitations are tied to the address they were sent to." : undefined}
          >
            {(control) =>
              invite ? (
                <TextInput {...control} type="email" value={invite.email} readOnly aria-readonly="true" />
              ) : (
                <TextInput
                  {...control}
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={values.email}
                  onChange={(e) => update("email", e.target.value)}
                />
              )
            }
          </Field>

          <Field
            id="sign-up-password"
            label="Password"
            error={errors.password}
            hint={<PasswordPolicy value={values.password} />}
          >
            {(control) => (
              <PasswordInput
                {...control}
                ref={passwordRef}
                autoComplete="new-password"
                value={values.password}
                onChange={(e) => update("password", e.target.value)}
              />
            )}
          </Field>

          {invite ? null : (
            <Field id="sign-up-organization" label="Organization name" error={errors.organization_name}>
              {(control) => (
                <TextInput
                  {...control}
                  ref={organizationRef}
                  autoComplete="organization"
                  value={values.organization_name}
                  onChange={(e) => update("organization_name", e.target.value)}
                />
              )}
            </Field>
          )}

          {formError ? <FormAlert>{formError}</FormAlert> : null}

          <SubmitButton pending={pending} pendingLabel={invite ? "Joining" : "Creating your account"}>
            {invite ? `Join ${invite.organization_name}` : "Create account"}
          </SubmitButton>
        </fieldset>
      </form>
    </div>
  );
}
