"use client";

import { KeyRoundIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AvailabilityBadge, VerificationBadge } from "@/components/app/badges";
import { CopyButton } from "@/components/app/form";
import { NoteList, Panel } from "@/components/app/page";
import { Notice } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateOrg, useOrgMutation } from "@/hooks/use-org-query";
import { ApiError } from "@/lib/api";
import { humanize } from "@/lib/app/format";
import { LIVE_PROVIDERS } from "@/lib/app/labels";
import type { CatalogEntry, Company, ConfigField, EntitySpec, Integration } from "@/lib/app/types";

const SCHEDULES = [
  { value: "none", label: "No schedule (sync on demand)" },
  { value: "15", label: "Every 15 minutes" },
  { value: "60", label: "Every hour" },
  { value: "360", label: "Every 6 hours" },
  { value: "1440", label: "Every day" },
  { value: "10080", label: "Every week" },
];

const JSON_PLACEHOLDERS: Record<string, string> = {
  column_mapping: '{\n  "business_date": "Date",\n  "store_code": "Branch"\n}',
  entities: '{\n  "sales": { "path": "/sales", "fields": { "business_date": "date" } }\n}',
};

type Values = Record<string, string | boolean>;

function initialValues(fields: ConfigField[]): Values {
  const values: Values = {};
  for (const f of fields) values[f.name] = f.kind === "boolean" ? false : "";
  return values;
}

/** Shown once after creating a webhook connection: the signing secret is never retrievable again. */
function WebhookSecret({ integration }: { integration: Integration }) {
  const router = useRouter();
  const webhook = integration.webhook;
  if (!webhook) return null;
  const url = `${window.location.origin}${webhook.url}`;
  return (
    <Panel title="Store the signing secret now" description="It is shown once. AUREX keeps only an encrypted copy and cannot display it again.">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Endpoint</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{url}</code>
            <CopyButton value={url} label="Copy URL" />
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Signing secret</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{webhook.signing_secret}</code>
            <CopyButton value={webhook.signing_secret} label="Copy secret" />
          </div>
        </div>
        <Notice tone="warning">
          Sign each request with HMAC-SHA256 over the timestamp and body, and send X-Aurex-Timestamp, X-Aurex-Signature and a unique
          X-Aurex-Event-Id. {webhook.note}
        </Notice>
        <Button onClick={() => router.push(`/app/integrations/${integration.id}`)}>I’ve stored the secret, open the connection</Button>
      </div>
    </Panel>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  error,
  entityLabels,
}: {
  field: ConfigField;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  error?: string;
  entityLabels: Record<string, string>;
}) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, field.help ? `${id}-help` : null].filter(Boolean).join(" ") || undefined;
  const label = (
    <Label htmlFor={id} className="text-sm">
      {field.label}
      {field.required ? <span className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}
      {field.secret ? <KeyRoundIcon className="size-3.5 text-muted-foreground" aria-label="Stored encrypted" /> : null}
    </Label>
  );
  let control: React.ReactNode;
  if (field.kind === "boolean") {
    control = (
      <div className="flex items-center gap-2">
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked)} aria-describedby={describedBy} />
        <span className="text-sm text-muted-foreground">{value ? "On" : "Off"}</span>
      </div>
    );
  } else if (field.kind === "select") {
    control = (
      <Select value={typeof value === "string" && value ? value : undefined} onValueChange={(v) => onChange(v)}>
        <SelectTrigger id={id} className="w-full bg-background" aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
          <SelectValue placeholder="Choose an option" />
        </SelectTrigger>
        <SelectContent position="popper">
          {field.options.map((option) => (
            <SelectItem key={option} value={option}>
              {entityLabels[option] ?? humanize(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (field.kind === "json") {
    control = (
      <Textarea
        id={id}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={JSON_PLACEHOLDERS[field.name] ?? "{ }"}
        className="bg-background font-mono text-xs"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
    );
  } else {
    control = (
      <Input
        id={id}
        type={field.kind === "password" ? "password" : field.kind === "integer" ? "number" : field.kind === "url" ? "url" : "text"}
        inputMode={field.kind === "integer" ? "numeric" : undefined}
        autoComplete={field.secret ? "off" : undefined}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        placeholder={field.kind === "url" ? "https://" : undefined}
      />
    );
  }
  return (
    <div className="space-y-1.5">
      {label}
      {control}
      {field.help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {field.help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlertIcon className="size-3.5" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * New connection form generated from the provider's `config_fields`. Secret fields are sent in
 * `credentials` (encrypted at rest, never echoed back); everything else goes in `config`.
 */
export function ConnectionForm({ entry, companies, entities }: { entry: CatalogEntry; companies: Company[]; entities: EntitySpec[] }) {
  const router = useRouter();
  const invalidate = useInvalidateOrg();
  const formId = useId();
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [schedule, setSchedule] = useState("none");
  const [values, setValues] = useState<Values>(() => initialValues(entry.config_fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<Integration | null>(null);
  const entityLabels = Object.fromEntries(entities.map((e) => [e.key, e.label]));
  const live = LIVE_PROVIDERS.has(entry.key);
  const secretFields = entry.config_fields.filter((f) => f.secret);
  const configFields = entry.config_fields.filter((f) => !f.secret);

  const create = useOrgMutation<Record<string, unknown>, Integration>((body, call) => call("/integrations", { json: body }), {
    onSuccess: (integration) => {
      void invalidate("/integrations", "/sync-jobs");
      if (integration.webhook) {
        setCreated(integration);
        return;
      }
      toast.success(`${integration.display_name} created`);
      router.push(`/app/integrations/${integration.id}`);
    },
    onError: (error) => {
      setFormError(error.message);
      if (error instanceof ApiError && error.details && typeof error.details === "object" && "fields" in error.details) {
        const fields = (error.details as { fields?: string[] }).fields ?? [];
        setErrors(Object.fromEntries(fields.map((f) => [f, "Check this value"])));
      }
    },
  });

  if (created) return <WebhookSecret integration={created} />;

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const config: Record<string, unknown> = {};
    const credentials: Record<string, string> = {};
    if (!name.trim()) nextErrors.__name = "Enter a name for this connection.";
    for (const field of entry.config_fields) {
      const raw = values[field.name];
      const text = typeof raw === "string" ? raw.trim() : raw;
      if (text === "" || text === undefined) {
        if (field.required) nextErrors[field.name] = "This field is required.";
        continue;
      }
      if (field.secret) {
        credentials[field.name] = String(text);
        continue;
      }
      if (field.kind === "json") {
        try {
          config[field.name] = JSON.parse(String(text));
        } catch {
          nextErrors[field.name] = "Enter valid JSON.";
        }
      } else if (field.kind === "integer") {
        const n = Number(text);
        if (!Number.isInteger(n)) nextErrors[field.name] = "Enter a whole number.";
        else config[field.name] = n;
      } else if (field.kind === "url") {
        if (!/^https:\/\//i.test(String(text))) nextErrors[field.name] = "Use an https:// address.";
        else config[field.name] = text;
      } else {
        config[field.name] = text;
      }
    }
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) {
      const first = document.querySelector<HTMLElement>(`#${CSS.escape(formId)} [aria-invalid="true"]`);
      first?.focus();
      return;
    }
    create.mutate({
      provider_key: entry.key,
      display_name: name.trim(),
      company_id: companyId || undefined,
      config,
      credentials,
      schedule_minutes: live && schedule !== "none" ? Number(schedule) : undefined,
    });
  }

  return (
    <form id={formId} noValidate onSubmit={submit} className="space-y-6">
      <Panel title="Connection" description={entry.summary}>
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            <AvailabilityBadge availability={entry.availability} />
            <VerificationBadge status={entry.verification_status} />
          </div>
          {entry.activation_requirements.length ? (
            <Notice title="Before this connection can sync">
              <NoteList notes={entry.activation_requirements} />
            </Notice>
          ) : null}
          {entry.availability === "requires_vendor_authorization" ? (
            <Notice tone="warning" title="No live connection yet">
              This vendor needs the retailer’s written authorization and vendor-provided access. The connection is created as “awaiting
              credentials”; you can upload approved exports to it in the meantime.
            </Notice>
          ) : null}
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-name`} className="text-sm">
                Name<span className="text-destructive"> *</span>
              </Label>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                placeholder={`${entry.name} for head office`}
                className="bg-background"
                aria-invalid={errors.__name ? true : undefined}
                aria-describedby={errors.__name ? `${formId}-name-error` : undefined}
              />
              {errors.__name ? (
                <p id={`${formId}-name-error`} className="text-xs text-destructive">
                  {errors.__name}
                </p>
              ) : null}
            </div>
            {companies.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-company`} className="text-sm">
                  Company
                </Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger id={`${formId}-company`} className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {live ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-schedule`} className="text-sm">
                  Sync schedule
                </Label>
                <Select value={schedule} onValueChange={setSchedule}>
                  <SelectTrigger id={`${formId}-schedule`} className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {SCHEDULES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Scheduled syncs run only after a successful connection test.</p>
              </div>
            ) : null}
          </div>
        </div>
      </Panel>

      {configFields.length ? (
        <Panel title="Settings" description="Stored with the connection and visible to integration managers">
          <div className="grid gap-5 md:grid-cols-2">
            {configFields.map((field) => (
              <div key={field.name} className={field.kind === "json" ? "md:col-span-2" : undefined}>
                <FieldControl
                  field={field}
                  value={values[field.name] ?? ""}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                  error={errors[field.name]}
                  entityLabels={entityLabels}
                />
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {secretFields.length ? (
        <Panel title="Credentials" description="Encrypted at rest. They are never shown again, only a fingerprint confirms they are stored.">
          <div className="grid gap-5 md:grid-cols-2">
            {secretFields.map((field) => (
              <FieldControl
                key={field.name}
                field={field}
                value={values[field.name] ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
                error={errors[field.name]}
                entityLabels={entityLabels}
              />
            ))}
          </div>
          {live ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Without credentials the connection is saved as “awaiting credentials”. With credentials it is “configured” until a connection test passes.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {formError ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-destructive/6 px-3.5 py-3 text-sm ring-1 ring-destructive/25">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
          {create.isPending ? "Creating connection" : "Create connection"}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/app/integrations?tab=catalog">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
