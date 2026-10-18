"use client";

import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { fieldErrors, FormError, MONTHS, SelectField, TextAreaField, TextField } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useInvalidateOrg, useOrgMutation } from "@/hooks/use-org-query";
import { errorText } from "@/lib/app/decision-lab-format";
import { UNIT_LABELS } from "@/lib/app/intelligence-format";
import { UNITS } from "@/lib/app/intelligence-types";

type CompanyForm = {
  key: string;
  display_name: string;
  legal_name: string;
  aliases: string;
  country: string;
  sector: string;
  website: string;
  is_listed: string;
  fiscal_year_end_month: string;
  reporting_currency: string;
};

const EMPTY_COMPANY: CompanyForm = {
  key: "",
  display_name: "",
  legal_name: "",
  aliases: "",
  country: "",
  sector: "",
  website: "",
  is_listed: "unknown",
  fiscal_year_end_month: "",
  reporting_currency: "",
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Track a company that is not in the curated reference set (intelligence:manage). */
export function AddCompanyDialog({ onCreated }: { onCreated?: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CompanyForm>(EMPTY_COMPANY);
  const [keyEdited, setKeyEdited] = useState(false);
  const [local, setLocal] = useState<Record<string, string>>({});
  const invalidate = useInvalidateOrg();
  const create = useOrgMutation<Record<string, unknown>, { key: string; display_name: string }>((body, call) => call("/intelligence/companies", { json: body }));
  const server = fieldErrors(create.error);
  const errors = { ...server, ...local };
  const set = (patch: Partial<CompanyForm>) => setForm((f) => ({ ...f, ...patch }));

  function submit() {
    const problems: Record<string, string> = {};
    if (!/^[a-z0-9_]{3,60}$/.test(form.key)) problems.key = "3–60 lowercase letters, digits or underscores";
    if (!form.display_name.trim()) problems.display_name = "Required";
    if (form.country && !/^[A-Z]{2}$/.test(form.country.trim().toUpperCase())) problems.country = "Two-letter country code, for example IN";
    if (form.reporting_currency && !/^[A-Z]{3}$/.test(form.reporting_currency.trim().toUpperCase())) problems.reporting_currency = "Three-letter currency code, for example INR";
    if (form.website && !/^https?:\/\//i.test(form.website.trim())) problems.website = "Start with https://";
    setLocal(problems);
    if (Object.keys(problems).length) return;
    create.mutate(
      {
        key: form.key,
        display_name: form.display_name.trim(),
        legal_name: form.legal_name.trim() || undefined,
        aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 10),
        country: form.country.trim().toUpperCase() || undefined,
        sector: form.sector.trim() || undefined,
        website: form.website.trim() || undefined,
        is_listed: form.is_listed === "unknown" ? undefined : form.is_listed === "yes",
        fiscal_year_end_month: form.fiscal_year_end_month ? Number(form.fiscal_year_end_month) : undefined,
        reporting_currency: form.reporting_currency.trim().toUpperCase() || undefined,
      },
      {
        onSuccess: (company) => {
          void invalidate("/intelligence", "/benchmarking");
          toast.success(`Now tracking ${company.display_name}`, { description: "Add figures with their source on the company page." });
          setOpen(false);
          setForm(EMPTY_COMPANY);
          setKeyEdited(false);
          onCreated?.(company.key);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          create.reset();
          setLocal({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <PlusIcon aria-hidden />
          Track a company
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Track a company</DialogTitle>
            <DialogDescription>
              Adds a profile visible to your organization. It starts empty: every figure you add needs a source link, and nothing is estimated.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Display name"
              required
              value={form.display_name}
              onChange={(display_name) => set({ display_name, ...(keyEdited ? {} : { key: slug(display_name) }) })}
              error={errors.display_name}
              maxLength={200}
            />
            <TextField
              label="Key"
              required
              value={form.key}
              onChange={(key) => {
                setKeyEdited(true);
                set({ key: key.toLowerCase() });
              }}
              error={errors.key}
              hint="Used in links, for example reliance_retail"
              maxLength={60}
            />
            <TextField label="Legal name" value={form.legal_name} onChange={(legal_name) => set({ legal_name })} maxLength={250} />
            <TextField label="Other names" value={form.aliases} onChange={(aliases) => set({ aliases })} hint="Comma-separated, used to match news" />
            <TextField label="Country" value={form.country} onChange={(country) => set({ country })} error={errors.country} hint="ISO code, for example IN" maxLength={2} />
            <TextField label="Sector" value={form.sector} onChange={(sector) => set({ sector })} maxLength={200} />
            <TextField label="Website" value={form.website} onChange={(website) => set({ website })} error={errors.website} placeholder="https://" />
            <SelectField
              label="Listed on an exchange"
              value={form.is_listed}
              onChange={(is_listed) => set({ is_listed })}
              options={[
                { value: "unknown", label: "Not confirmed" },
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
            />
            <SelectField
              label="Fiscal year ends in"
              value={form.fiscal_year_end_month}
              onChange={(fiscal_year_end_month) => set({ fiscal_year_end_month })}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              placeholder="Choose a month"
            />
            <TextField
              label="Reporting currency"
              value={form.reporting_currency}
              onChange={(reporting_currency) => set({ reporting_currency })}
              error={errors.reporting_currency}
              hint="ISO code, for example INR"
              maxLength={3}
            />
          </div>
          <FormError message={create.error ? errorText(create.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              Track company
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ObservationForm = {
  fiscal_year: string;
  period_end: string;
  metric: string;
  value: string;
  unit: string;
  basis: string;
  source_url: string;
  source_name: string;
  source_type: string;
  notes: string;
};

const EMPTY_OBSERVATION: ObservationForm = {
  fiscal_year: "",
  period_end: "",
  metric: "revenue_from_operations",
  value: "",
  unit: "INR_crore",
  basis: "consolidated",
  source_url: "",
  source_name: "",
  source_type: "annual_report",
  notes: "",
};

const METRIC_OPTIONS = [
  "revenue_from_operations",
  "total_income",
  "gross_profit",
  "ebitda",
  "profit_before_tax",
  "net_profit",
  "operating_cash_flow",
  "capex",
  "cash_and_equivalents",
  "inventories",
  "store_count",
  "retail_area_sqft",
  "employees",
];

/** Add a reported figure to a tracked company. A source link is mandatory. */
export function AddObservationDialog({ companyKey, currency }: { companyKey: string; currency?: string | null }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ObservationForm>({ ...EMPTY_OBSERVATION, unit: currency === "MYR" ? "MYR_million" : "INR_crore" });
  const [local, setLocal] = useState<Record<string, string>>({});
  const invalidate = useInvalidateOrg();
  const create = useOrgMutation<Record<string, unknown>, { id: number; verification_status: string }>((body, call) =>
    call(`/intelligence/companies/${companyKey}/observations`, { json: body }),
  );
  const errors = { ...fieldErrors(create.error), ...local };
  const set = (patch: Partial<ObservationForm>) => setForm((f) => ({ ...f, ...patch }));

  function submit() {
    const problems: Record<string, string> = {};
    if (form.fiscal_year.trim().length < 2) problems.fiscal_year = "For example FY2026";
    if (!form.period_end) problems.period_end = "Required";
    const value = Number(form.value.replace(/,/g, ""));
    if (!form.value.trim() || !Number.isFinite(value)) problems.value = "Enter the reported number";
    if (!/^https?:\/\/\S+$/i.test(form.source_url.trim())) problems.source_url = "A link to the filing or report is required";
    setLocal(problems);
    if (Object.keys(problems).length) return;
    create.mutate(
      {
        fiscal_year: form.fiscal_year.trim(),
        period_end: form.period_end,
        metric: form.metric,
        value,
        unit: form.unit,
        basis: form.basis.trim() || "consolidated",
        source_url: form.source_url.trim(),
        source_name: form.source_name.trim() || undefined,
        source_type: form.source_type || undefined,
        notes: form.notes.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          void invalidate("/intelligence", "/benchmarking");
          toast.success("Figure added", { description: `Recorded as ${res.verification_status.replace(/_/g, " ")}.` });
          setOpen(false);
          setForm((f) => ({ ...EMPTY_OBSERVATION, unit: f.unit }));
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          create.reset();
          setLocal({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <PlusIcon aria-hidden />
          Add a reported figure
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a reported figure</DialogTitle>
            <DialogDescription>Enter the number exactly as the source reports it, with its unit and basis. Figures without a source are not accepted.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Measure"
              required
              value={form.metric}
              onChange={(metric) => set({ metric })}
              options={METRIC_OPTIONS.map((m) => ({ value: m, label: m.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }))}
            />
            <TextField label="Fiscal year" required value={form.fiscal_year} onChange={(fiscal_year) => set({ fiscal_year })} error={errors.fiscal_year} placeholder="FY2026" maxLength={40} />
            <TextField label="Period end" required type="date" value={form.period_end} onChange={(period_end) => set({ period_end })} error={errors.period_end} />
            <TextField label="Basis" value={form.basis} onChange={(basis) => set({ basis })} hint="Consolidated or standalone" maxLength={40} />
            <TextField label="Value" required value={form.value} onChange={(value) => set({ value })} error={errors.value} inputMode="decimal" />
            <SelectField label="Unit" required value={form.unit} onChange={(unit) => set({ unit })} options={UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] ?? u }))} />
            <TextField
              className="sm:col-span-2"
              label="Source link"
              required
              value={form.source_url}
              onChange={(source_url) => set({ source_url })}
              error={errors.source_url}
              placeholder="https://"
            />
            <TextField label="Source name" value={form.source_name} onChange={(source_name) => set({ source_name })} placeholder="Annual report FY2026" maxLength={300} />
            <SelectField
              label="Source type"
              value={form.source_type}
              onChange={(source_type) => set({ source_type })}
              options={[
                { value: "annual_report", label: "Annual report" },
                { value: "exchange_filing", label: "Exchange filing" },
                { value: "investor_presentation", label: "Investor presentation" },
                { value: "press_release", label: "Press release" },
                { value: "news", label: "News report" },
                { value: "other", label: "Other" },
              ]}
            />
            <TextAreaField className="sm:col-span-2" label="Notes" value={form.notes} onChange={(notes) => set({ notes })} rows={2} maxLength={2000} />
          </div>
          <FormError message={create.error ? errorText(create.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              Add figure
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
