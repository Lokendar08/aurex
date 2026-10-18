"use client";

import { LoaderCircleIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { fieldErrors, FormError, MONTHS, SelectField, TextAreaField, TextField } from "@/components/app/form";
import { Panel } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, QueryView, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, formatNumber, humanize } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { Company, Department, Store } from "@/lib/app/types";

const CODE_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function useCompanies() {
  return useOrgQuery<{ companies: Company[] }>("/companies", { staleTime: 5 * 60_000 });
}

function EditorDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  pending,
  submitLabel,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
  error: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onSubmit();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">{children}</div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------------------------

type CompanyDraft = {
  name: string;
  legal_name: string;
  base_currency: string;
  fiscal_year_start_month: string;
  country: string;
  industry: string;
  description: string;
};

function companyDraft(c?: Company): CompanyDraft {
  return {
    name: c?.name ?? "",
    legal_name: c?.legal_name ?? "",
    base_currency: c?.base_currency ?? "INR",
    fiscal_year_start_month: String(c?.fiscal_year_start_month ?? 4),
    country: c?.country ?? "",
    industry: c?.industry ?? "",
    description: c?.description ?? "",
  };
}

function CompanyEditor({ company, open, onOpenChange }: { company?: Company; open: boolean; onOpenChange: (open: boolean) => void }) {
  const invalidate = useInvalidateOrg();
  const [draft, setDraft] = useState<CompanyDraft>(() => companyDraft(company));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (key: keyof CompanyDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const save = useOrgMutation<Record<string, unknown>, Company>(
    (body, call) => (company ? call(`/companies/${company.id}`, { method: "PATCH", json: body }) : call("/companies", { json: body })),
    {
      onSuccess: (saved) => {
        toast.success(company ? `${saved.name} saved` : `${saved.name} created`);
        void invalidate("/companies", "/dashboard/filters", "/stores");
        onOpenChange(false);
      },
      onError: (error) => {
        setErrors(fieldErrors(error));
        setFormError(error.message);
      },
    },
  );
  function submit() {
    const next: Record<string, string> = {};
    if (!draft.name.trim()) next.name = "Enter a name.";
    if (!company && !/^[A-Z]{3}$/.test(draft.base_currency)) next.base_currency = "Use a three-letter currency code, for example INR.";
    if (draft.country && !/^[A-Z]{2}$/.test(draft.country.toUpperCase())) next.country = "Use a two-letter country code.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      legal_name: draft.legal_name.trim() || null,
      country: draft.country ? draft.country.toUpperCase() : null,
      industry: draft.industry.trim() || null,
      description: draft.description.trim() || null,
    };
    if (!company) {
      body.base_currency = draft.base_currency;
      body.fiscal_year_start_month = Number(draft.fiscal_year_start_month);
    }
    save.mutate(body);
  }
  return (
    <EditorDialog
      open={open}
      onOpenChange={onOpenChange}
      title={company ? `Edit ${company.name}` : "New company"}
      description={company ? "Currency and fiscal year are fixed once data exists." : "A legal entity whose stores and data AUREX reports on."}
      onSubmit={submit}
      pending={save.isPending}
      submitLabel={company ? "Save company" : "Create company"}
      error={Object.keys(errors).length ? null : formError}
    >
      <TextField label="Name" required value={draft.name} onChange={set("name")} maxLength={200} error={errors.name} className="sm:col-span-2" />
      <TextField label="Legal name" value={draft.legal_name} onChange={set("legal_name")} maxLength={250} error={errors.legal_name} className="sm:col-span-2" />
      {!company ? (
        <>
          <TextField
            label="Base currency"
            required
            value={draft.base_currency}
            onChange={(v) => set("base_currency")(v.toUpperCase())}
            maxLength={3}
            error={errors.base_currency}
          />
          <SelectField
            label="Fiscal year starts in"
            value={draft.fiscal_year_start_month}
            onChange={set("fiscal_year_start_month")}
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
          />
        </>
      ) : null}
      <TextField label="Country" value={draft.country} onChange={(v) => set("country")(v.toUpperCase())} maxLength={2} hint="Two-letter ISO code" error={errors.country} />
      <TextField label="Industry" value={draft.industry} onChange={set("industry")} maxLength={120} error={errors.industry} />
      <TextAreaField label="Description" value={draft.description} onChange={set("description")} maxLength={4000} className="sm:col-span-2" />
    </EditorDialog>
  );
}

export function CompaniesSettings() {
  const { has } = useSession();
  const canManage = has(PERMISSIONS.orgManage);
  const companies = useCompanies();
  const [editing, setEditing] = useState<Company | "new" | null>(null);
  const columns: Column<Company>[] = [
    {
      key: "name",
      header: "Company",
      cell: (c) => (
        <span className="block min-w-[12rem]">
          <span className="font-medium">{c.name}</span>
          {c.legal_name ? <span className="block text-xs text-muted-foreground">{c.legal_name}</span> : null}
        </span>
      ),
      sortValue: (c) => c.name,
    },
    { key: "currency", header: "Currency", cell: (c) => c.base_currency, sortValue: (c) => c.base_currency },
    { key: "fy", header: "Fiscal year starts", cell: (c) => MONTHS[c.fiscal_year_start_month - 1] ?? "—" },
    { key: "country", header: "Country", cell: (c) => c.country ?? "—" },
    { key: "industry", header: "Industry", cell: (c) => c.industry ?? "—" },
    { key: "type", header: "Data", cell: (c) => (c.is_synthetic ? <StatusBadge tone="info">Synthetic</StatusBadge> : <span className="text-muted-foreground">Real</span>) },
    ...(canManage
      ? [
          {
            key: "edit",
            header: <span className="sr-only">Actions</span>,
            cell: (c: Company) => (
              <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                <PencilIcon aria-hidden />
                Edit
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <Panel
      title="Companies"
      description="Legal entities in this organization"
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon aria-hidden />
            New company
          </Button>
        ) : null
      }
    >
      <QueryView query={companies} loading={<TableSkeleton rows={3} columns={5} />}>
        {(data) => (
          <DataTable caption="Companies" columns={columns} rows={data.companies} rowKey={(c) => c.id} dense empty={<EmptyState compact title="No companies yet" />} />
        )}
      </QueryView>
      {editing ? (
        <CompanyEditor
          key={editing === "new" ? "new" : editing.id}
          company={editing === "new" ? undefined : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------

type StoreDraft = {
  company_id: string;
  code: string;
  name: string;
  city: string;
  region: string;
  format: string;
  opened_on: string;
  closed_on: string;
  selling_area_sqft: string;
  status: string;
};

function StoreEditor({
  store,
  companies,
  open,
  onOpenChange,
}: {
  store?: Store;
  companies: Company[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useInvalidateOrg();
  const [draft, setDraft] = useState<StoreDraft>({
    company_id: store?.company_id ?? companies[0]?.id ?? "",
    code: store?.code ?? "",
    name: store?.name ?? "",
    city: store?.city ?? "",
    region: store?.region ?? "",
    format: store?.format ?? "",
    opened_on: store?.opened_on ?? "",
    closed_on: store?.closed_on ?? "",
    selling_area_sqft: store?.selling_area_sqft !== null && store?.selling_area_sqft !== undefined ? String(store.selling_area_sqft) : "",
    status: store?.status ?? "active",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (key: keyof StoreDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const save = useOrgMutation<Record<string, unknown>, Store>(
    (body, call) => (store ? call(`/stores/${store.id}`, { method: "PATCH", json: body }) : call("/stores", { json: body })),
    {
      onSuccess: (saved) => {
        toast.success(store ? `${saved.name} saved` : `${saved.name} created`);
        void invalidate("/stores", "/dashboard/filters");
        onOpenChange(false);
      },
      onError: (error) => {
        setErrors(fieldErrors(error));
        setFormError(error.message);
      },
    },
  );
  function submit() {
    const next: Record<string, string> = {};
    if (!store && !CODE_PATTERN.test(draft.code.trim())) next.code = "Use letters, numbers, dots, dashes or underscores.";
    if (!draft.name.trim()) next.name = "Enter a name.";
    const area = draft.selling_area_sqft ? Number(draft.selling_area_sqft) : null;
    if (area !== null && (!Number.isFinite(area) || area <= 0)) next.selling_area_sqft = "Enter a positive number.";
    if (draft.opened_on && draft.closed_on && draft.closed_on < draft.opened_on) next.closed_on = "Closing must be after opening.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      city: draft.city.trim() || null,
      region: draft.region.trim() || null,
      format: draft.format.trim() || null,
      opened_on: draft.opened_on || null,
      selling_area_sqft: area,
      status: draft.status,
    };
    if (store) body.closed_on = draft.closed_on || null;
    else {
      body.company_id = draft.company_id;
      body.code = draft.code.trim();
    }
    save.mutate(body);
  }
  return (
    <EditorDialog
      open={open}
      onOpenChange={onOpenChange}
      title={store ? `Edit ${store.name}` : "New store"}
      onSubmit={submit}
      pending={save.isPending}
      submitLabel={store ? "Save store" : "Create store"}
      error={Object.keys(errors).length ? null : formError}
    >
      {!store ? (
        <>
          {companies.length > 1 ? (
            <SelectField
              label="Company"
              required
              value={draft.company_id}
              onChange={set("company_id")}
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              className="sm:col-span-2"
            />
          ) : null}
          <TextField label="Store code" required value={draft.code} onChange={set("code")} maxLength={40} hint="Used to match imported rows, for example S09" error={errors.code} />
        </>
      ) : null}
      <TextField label="Name" required value={draft.name} onChange={set("name")} maxLength={200} error={errors.name} className={store ? "sm:col-span-2" : undefined} />
      <TextField label="City" value={draft.city} onChange={set("city")} maxLength={120} />
      <TextField label="Region" value={draft.region} onChange={set("region")} maxLength={120} />
      <TextField label="Format" value={draft.format} onChange={set("format")} maxLength={60} placeholder="Supermarket" />
      <TextField
        label="Selling area (sq ft)"
        type="number"
        inputMode="decimal"
        value={draft.selling_area_sqft}
        onChange={set("selling_area_sqft")}
        error={errors.selling_area_sqft}
      />
      <TextField label="Opened on" type="date" value={draft.opened_on} onChange={set("opened_on")} />
      {store ? <TextField label="Closed on" type="date" value={draft.closed_on} onChange={set("closed_on")} error={errors.closed_on} /> : null}
      <SelectField
        label="Status"
        value={draft.status}
        onChange={set("status")}
        options={[
          { value: "planned", label: "Planned" },
          { value: "active", label: "Active" },
          { value: "closed", label: "Closed" },
        ]}
      />
    </EditorDialog>
  );
}

export function StoresSettings() {
  const { has } = useSession();
  const canManage = has(PERMISSIONS.orgManage);
  const companies = useCompanies();
  const stores = useOrgQuery<{ stores: Store[]; scoped: boolean }>("/stores");
  const [editing, setEditing] = useState<Store | "new" | null>(null);
  const companyName = (id: string) => companies.data?.companies.find((c) => c.id === id)?.name ?? "—";
  const multiCompany = (companies.data?.companies.length ?? 0) > 1;
  const columns: Column<Store>[] = [
    { key: "code", header: "Code", cell: (s) => <span className="font-mono text-xs">{s.code}</span>, sortValue: (s) => s.code },
    { key: "name", header: "Store", cell: (s) => <span className="font-medium">{s.name}</span>, sortValue: (s) => s.name },
    ...(multiCompany ? [{ key: "company", header: "Company", cell: (s: Store) => companyName(s.company_id) }] : []),
    { key: "city", header: "City", cell: (s) => s.city ?? "—", sortValue: (s) => s.city },
    { key: "region", header: "Region", cell: (s) => s.region ?? "—", sortValue: (s) => s.region },
    { key: "format", header: "Format", cell: (s) => s.format ?? "—", sortValue: (s) => s.format },
    { key: "opened", header: "Opened", cell: (s) => formatDate(s.opened_on), sortValue: (s) => s.opened_on },
    {
      key: "area",
      header: "Selling area",
      align: "right",
      cell: (s) => (s.selling_area_sqft ? `${formatNumber(s.selling_area_sqft)} sq ft` : "—"),
      sortValue: (s) => s.selling_area_sqft,
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => <StatusBadge tone={s.status === "active" ? "good" : s.status === "planned" ? "info" : "neutral"}>{humanize(s.status)}</StatusBadge>,
      sortValue: (s) => s.status,
    },
    ...(canManage
      ? [
          {
            key: "edit",
            header: <span className="sr-only">Actions</span>,
            cell: (s: Store) => (
              <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                <PencilIcon aria-hidden />
                Edit
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <Panel
      title="Stores"
      description={stores.data?.scoped ? "The stores assigned to you" : "Every store, with the codes imports use to match rows"}
      actions={
        canManage && companies.data?.companies.length ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon aria-hidden />
            New store
          </Button>
        ) : null
      }
    >
      <QueryView query={stores} loading={<TableSkeleton rows={6} columns={7} />}>
        {(data) => (
          <DataTable caption="Stores" columns={columns} rows={data.stores} rowKey={(s) => s.id} defaultSort={{ key: "code", dir: "asc" }} dense empty={<EmptyState compact title="No stores yet" />} />
        )}
      </QueryView>
      {editing && companies.data ? (
        <StoreEditor
          key={editing === "new" ? "new" : editing.id}
          store={editing === "new" ? undefined : editing}
          companies={companies.data.companies}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------------------------

function DepartmentEditor({ companies, stores, open, onOpenChange }: { companies: Company[]; stores: Store[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const invalidate = useInvalidateOrg();
  const [draft, setDraft] = useState({ company_id: companies[0]?.id ?? "", store_id: "none", code: "", name: "", function: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const save = useOrgMutation<Record<string, unknown>, Department>((body, call) => call("/departments", { json: body }), {
    onSuccess: (saved) => {
      toast.success(`${saved.name} created`);
      void invalidate("/departments");
      onOpenChange(false);
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      setFormError(error.message);
    },
  });
  const companyStores = stores.filter((s) => s.company_id === draft.company_id);
  function submit() {
    const next: Record<string, string> = {};
    if (!CODE_PATTERN.test(draft.code.trim())) next.code = "Use letters, numbers, dots, dashes or underscores.";
    if (!draft.name.trim()) next.name = "Enter a name.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    save.mutate({
      company_id: draft.company_id,
      store_id: draft.store_id === "none" ? null : draft.store_id,
      code: draft.code.trim(),
      name: draft.name.trim(),
      function: draft.function.trim() || null,
    });
  }
  return (
    <EditorDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New department"
      onSubmit={submit}
      pending={save.isPending}
      submitLabel="Create department"
      error={Object.keys(errors).length ? null : formError}
    >
      {companies.length > 1 ? (
        <SelectField label="Company" required value={draft.company_id} onChange={set("company_id")} options={companies.map((c) => ({ value: c.id, label: c.name }))} className="sm:col-span-2" />
      ) : null}
      <SelectField
        label="Store"
        value={draft.store_id}
        onChange={set("store_id")}
        options={[{ value: "none", label: "Head office (no store)" }, ...companyStores.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))]}
        className="sm:col-span-2"
      />
      <TextField label="Code" required value={draft.code} onChange={set("code")} maxLength={40} error={errors.code} />
      <TextField label="Name" required value={draft.name} onChange={set("name")} maxLength={200} error={errors.name} />
      <TextField label="Function" value={draft.function} onChange={set("function")} maxLength={60} placeholder="store_operations" className="sm:col-span-2" />
    </EditorDialog>
  );
}

export function DepartmentsSettings() {
  const { has } = useSession();
  const canManage = has(PERMISSIONS.orgManage);
  const companies = useCompanies();
  const stores = useOrgQuery<{ stores: Store[] }>("/stores");
  const departments = useOrgQuery<{ departments: Department[] }>("/departments");
  const [creating, setCreating] = useState(false);
  const storeLabel = (id: string | null) => {
    if (!id) return "Head office";
    const store = stores.data?.stores.find((s) => s.id === id);
    return store ? `${store.code} ${store.name}` : "Store";
  };
  const columns: Column<Department>[] = [
    { key: "code", header: "Code", cell: (d) => <span className="font-mono text-xs">{d.code}</span>, sortValue: (d) => d.code },
    { key: "name", header: "Department", cell: (d) => <span className="font-medium">{d.name}</span>, sortValue: (d) => d.name },
    { key: "store", header: "Store", cell: (d) => storeLabel(d.store_id), sortValue: (d) => storeLabel(d.store_id) },
    { key: "function", header: "Function", cell: (d) => (d.function ? humanize(d.function) : "—"), sortValue: (d) => d.function },
  ];
  return (
    <Panel
      title="Departments"
      description="Used to attribute workforce aggregates and expenses"
      actions={
        canManage && companies.data?.companies.length ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden />
            New department
          </Button>
        ) : null
      }
    >
      <QueryView query={departments} loading={<TableSkeleton rows={6} columns={4} />}>
        {(data) => (
          <DataTable
            caption="Departments"
            columns={columns}
            rows={data.departments}
            rowKey={(d) => d.id}
            defaultSort={{ key: "store", dir: "asc" }}
            pageSize={15}
            dense
            empty={<EmptyState compact title="No departments yet" />}
          />
        )}
      </QueryView>
      {creating && companies.data ? (
        <DepartmentEditor companies={companies.data.companies} stores={stores.data?.stores ?? []} open onOpenChange={setCreating} />
      ) : null}
    </Panel>
  );
}
