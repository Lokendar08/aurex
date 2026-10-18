"use client";

import { CheckIcon, CircleAlertIcon, CopyIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Field errors from a FastAPI validation response, keyed by the last string in `loc`. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return out;
  for (const detail of error.details as { loc?: unknown[]; msg?: string }[]) {
    const field = [...(detail.loc ?? [])].reverse().find((p): p is string => typeof p === "string" && p !== "body");
    if (field && detail.msg && !out[field]) out[field] = detail.msg.replace(/^Value error, /i, "");
  }
  return out;
}

type BaseProps = {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
};

function FieldShell({
  id,
  label,
  error,
  hint,
  required,
  className,
  children,
}: BaseProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-xs text-destructive">
          <CircleAlertIcon className="size-3.5" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode) {
  return [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
}

export function TextField({
  value,
  onChange,
  type = "text",
  placeholder,
  maxLength,
  disabled,
  autoComplete,
  inputMode,
  min,
  max,
  ...base
}: BaseProps & {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email";
  min?: string;
  max?: string;
}) {
  const id = useId();
  return (
    <FieldShell id={id} {...base}>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete={autoComplete}
        inputMode={inputMode}
        min={min}
        max={max}
        required={base.required}
        aria-invalid={base.error ? true : undefined}
        aria-describedby={describedBy(id, base.error, base.hint)}
        className="bg-background"
      />
    </FieldShell>
  );
}

export function TextAreaField({
  value,
  onChange,
  rows = 3,
  maxLength,
  ...base
}: BaseProps & { value: string; onChange: (value: string) => void; rows?: number; maxLength?: number }) {
  const id = useId();
  return (
    <FieldShell id={id} {...base}>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={base.error ? true : undefined}
        aria-describedby={describedBy(id, base.error, base.hint)}
        className="bg-background"
      />
    </FieldShell>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder = "Choose",
  disabled,
  ...base
}: BaseProps & {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <FieldShell id={id} {...base}>
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="w-full bg-background"
          aria-invalid={base.error ? true : undefined}
          aria-describedby={describedBy(id, base.error, base.hint)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

/** Copy a value to the clipboard with confirmation. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Copy failed. Select the text and copy it manually.");
        }
      }}
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-destructive/6 px-3.5 py-3 text-sm ring-1 ring-destructive/25">
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
