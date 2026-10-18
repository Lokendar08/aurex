"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/app/badges";
import { fieldErrors, FormError, TextField } from "@/components/app/form";
import { DetailList, Panel } from "@/components/app/page";
import { SESSION_QUERY_KEY, useOrgId, useSession } from "@/components/app/session-provider";
import { QueryView, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { useApiQuery } from "@/hooks/use-org-query";
import { api, type ApiError } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { Organization } from "@/lib/app/types";

function OrganizationForm({ org }: { org: Organization }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(org.name);
  const [industry, setIndustry] = useState(org.industry ?? "");
  const [country, setCountry] = useState(org.country ?? "");
  const [timezone, setTimezone] = useState(org.timezone ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation<Organization, ApiError, Record<string, unknown>>({
    mutationFn: (body) => api<Organization>(`/orgs/${org.id}`, { method: "PATCH", json: body }),
    onSuccess: () => {
      toast.success("Organization saved");
      setErrors({});
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["api", `/orgs/${org.id}`] });
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      setFormError(error.message);
    },
  });
  const dirty = name !== org.name || industry !== (org.industry ?? "") || country !== (org.country ?? "") || timezone !== (org.timezone ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Enter the organization name.";
    if (country && !/^[A-Za-z]{2}$/.test(country)) next.country = "Use a two-letter country code, for example IN.";
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate({
      name: name.trim(),
      industry: industry.trim() || null,
      country: country ? country.toUpperCase() : null,
      timezone: timezone.trim() || null,
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <TextField label="Name" required value={name} onChange={setName} maxLength={200} error={errors.name} />
        <TextField label="Industry" value={industry} onChange={setIndustry} maxLength={120} error={errors.industry} />
        <TextField label="Country" value={country} onChange={setCountry} maxLength={2} hint="Two-letter ISO code" error={errors.country} />
        <TextField label="Time zone" value={timezone} onChange={setTimezone} maxLength={64} placeholder="Asia/Kolkata" error={errors.timezone} />
      </div>
      <FormError message={Object.keys(errors).length ? null : formError} />
      <Button type="submit" disabled={!dirty || save.isPending}>
        {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
        Save changes
      </Button>
    </form>
  );
}

export function OrganizationSettings() {
  const { has } = useSession();
  const orgId = useOrgId();
  const org = useApiQuery<Organization>(`/orgs/${orgId}`);
  return (
    <QueryView query={org} loading={<Panel><TableSkeleton rows={4} columns={2} /></Panel>}>
      {(data) => (
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel className="xl:col-span-2" title="Organization profile" description={has(PERMISSIONS.orgManage) ? "Visible to every member" : "Only owners can change these details"}>
            {has(PERMISSIONS.orgManage) ? (
              <OrganizationForm key={`${data.name}-${data.industry}-${data.country}-${data.timezone}`} org={data} />
            ) : (
              <DetailList
                items={[
                  { label: "Name", value: data.name },
                  { label: "Industry", value: data.industry ?? "Not set" },
                  { label: "Country", value: data.country ?? "Not set" },
                  { label: "Time zone", value: data.timezone ?? "Not set" },
                ]}
              />
            )}
          </Panel>
          <Panel title="Account">
            <DetailList
              className="sm:grid-cols-1"
              items={[
                { label: "Status", value: <StatusBadge tone={data.status === "active" ? "good" : "danger"}>{data.status === "active" ? "Active" : "Suspended"}</StatusBadge> },
                { label: "Identifier", value: <span className="font-mono text-xs">{data.slug}</span> },
                { label: "Base currency", value: data.base_currency },
                { label: "Members", value: formatNumber(data.member_count ?? null) },
                { label: "Companies", value: formatNumber(data.company_count ?? null) },
                { label: "Your role", value: data.my_role_label ?? "—" },
                { label: "Created", value: formatDate(data.created_at) },
                ...(data.is_demo ? [{ label: "Type", value: <StatusBadge tone="info">Demo organization (synthetic data)</StatusBadge> }] : []),
              ]}
            />
          </Panel>
        </div>
      )}
    </QueryView>
  );
}
