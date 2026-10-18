"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { fieldErrors, FormError, SelectField, TextAreaField, TextField } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorText } from "@/lib/app/decision-lab-format";
import { humanize } from "@/lib/app/format";
import type { FilterStore } from "@/lib/app/types";
import { CATEGORY_OPTIONS, type MemberLite, type Recommendation } from "@/lib/app/workflows-types";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Confirm a lifecycle action with an optional note (submit, approve, reject, dismiss). */
export function NoteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  submitting,
  error,
  onConfirm,
  noteLabel = "Note",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  submitting: boolean;
  error: unknown;
  onConfirm: (note: string | undefined) => void;
  noteLabel?: string;
  children?: ReactNode;
}) {
  const [note, setNote] = useState("");
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setNote("");
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(note.trim() || undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <TextAreaField label={noteLabel} value={note} onChange={setNote} rows={3} maxLength={2000} hint="Optional. Recorded in the audit trail." />
          <FormError message={error ? errorText(error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={submitting}>
              {submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ImplementedDialog({
  open,
  onOpenChange,
  submitting,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  error: unknown;
  onConfirm: (input: { implemented_on: string; measurement_days: number }) => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [days, setDays] = useState("90");
  const [local, setLocal] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setDate(todayIso());
      setDays("90");
      setLocal({});
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const problems: Record<string, string> = {};
            if (!date) problems.date = "Required";
            else if (date > todayIso()) problems.date = "The implementation date cannot be in the future";
            const n = Number(days);
            if (!Number.isInteger(n) || n < 7 || n > 730) problems.days = "A whole number from 7 to 730";
            setLocal(problems);
            if (Object.keys(problems).length) return;
            onConfirm({ implemented_on: date, measurement_days: n });
          }}
        >
          <DialogHeader>
            <DialogTitle>Mark as implemented</DialogTitle>
            <DialogDescription>The measurement window starts on the implementation date. Outcomes compare actual results with the prediction over that window.</DialogDescription>
          </DialogHeader>
          <TextField label="Implemented on" type="date" required value={date} onChange={setDate} max={todayIso()} error={local.date} />
          <TextField label="Measurement window (days)" required value={days} onChange={setDays} inputMode="numeric" error={local.days} hint="7 to 730 days; 90 is typical." />
          <FormError message={error ? errorText(error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              Mark implemented
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type NewRecommendation = {
  title: string;
  summary: string;
  category: string;
  priority: string;
  store_id?: string;
  assumptions: string[];
  predicted_impact: Record<string, unknown>;
};

export function CreateRecommendationDialog({
  open,
  onOpenChange,
  stores,
  storeRequired,
  submitting,
  error,
  onSubmit,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: FilterStore[];
  storeRequired: boolean;
  submitting: boolean;
  error: unknown;
  onSubmit: (input: NewRecommendation) => void;
  currency: string;
}) {
  const empty = { title: "", summary: "", category: "general", priority: "medium", store: "", assumptions: "", metric: "", delta: "", horizon: "" };
  const [form, setForm] = useState(empty);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm(empty);
      setLocal({});
    }
  }
  const server = fieldErrors(error);
  const errors = { ...server, ...local };
  const set = (patch: Partial<typeof empty>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const problems: Record<string, string> = {};
            if (form.title.trim().length < 5) problems.title = "At least 5 characters";
            if (form.summary.trim().length < 5) problems.summary = "At least 5 characters";
            if (storeRequired && !form.store) problems.store_id = "Choose one of your stores";
            const delta = form.delta.trim() ? Number(form.delta.replace(/[,\s]/g, "")) : null;
            if (form.metric && delta !== null && !Number.isFinite(delta)) problems.delta = "Enter a number";
            const horizon = form.horizon.trim() ? Number(form.horizon) : null;
            if (horizon !== null && (!Number.isInteger(horizon) || horizon < 1 || horizon > 60)) problems.horizon = "1 to 60 months";
            setLocal(problems);
            if (Object.keys(problems).length) return;
            const impact: Record<string, unknown> = {};
            if (form.metric) {
              impact.metric = form.metric;
              if (delta !== null) impact.predicted_delta = delta;
              if (horizon !== null) impact.horizon_months = horizon;
            }
            onSubmit({
              title: form.title.trim(),
              summary: form.summary.trim(),
              category: form.category,
              priority: form.priority,
              store_id: form.store || undefined,
              assumptions: form.assumptions
                .split("\n")
                .map((a) => a.trim())
                .filter(Boolean)
                .slice(0, 20),
              predicted_impact: impact,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New recommendation</DialogTitle>
            <DialogDescription>
              A proposal for a decision. Once submitted, another member with approval rights reviews it; you cannot approve your own recommendation.
            </DialogDescription>
          </DialogHeader>
          <TextField label="Title" required value={form.title} onChange={(title) => set({ title })} error={errors.title} maxLength={300} />
          <TextAreaField label="Summary" required value={form.summary} onChange={(summary) => set({ summary })} error={errors.summary} rows={3} maxLength={4000} />
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField label="Category" value={form.category} onChange={(category) => set({ category })} options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: humanize(c) }))} />
            <SelectField
              label="Priority"
              value={form.priority}
              onChange={(priority) => set({ priority })}
              options={["low", "medium", "high", "critical"].map((p) => ({ value: p, label: humanize(p) }))}
            />
            <SelectField
              label="Store"
              required={storeRequired}
              value={form.store}
              onChange={(store) => set({ store: store === "__none" ? "" : store })}
              error={errors.store_id}
              placeholder={storeRequired ? "Choose a store" : "Whole company"}
              options={[...(storeRequired ? [] : [{ value: "__none", label: "Whole company" }]), ...stores.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))]}
            />
          </div>
          <TextAreaField
            label="Assumptions"
            value={form.assumptions}
            onChange={(assumptions) => set({ assumptions })}
            rows={3}
            hint="One per line. Reviewers see them next to the predicted impact."
          />
          <fieldset className="grid gap-4 rounded-lg bg-muted/40 p-3 sm:grid-cols-3">
            <legend className="px-1 text-sm font-medium">Predicted impact (optional)</legend>
            <SelectField
              label="Measure"
              value={form.metric}
              onChange={(metric) => set({ metric: metric === "__none" ? "" : metric })}
              placeholder="None"
              options={[
                { value: "__none", label: "None" },
                { value: "net_profit", label: "Net profit" },
                { value: "net_sales", label: "Net sales" },
                { value: "gross_profit", label: "Gross profit" },
                { value: "operating_expenses", label: "Operating expenses" },
              ]}
            />
            <TextField label={`Change (${currency})`} value={form.delta} onChange={(delta) => set({ delta })} error={errors.delta} inputMode="decimal" />
            <TextField label="Horizon (months)" value={form.horizon} onChange={(horizon) => set({ horizon })} error={errors.horizon} inputMode="numeric" />
          </fieldset>
          <p className="-mt-2 text-xs text-muted-foreground">
            Manual predictions carry low confidence. For an evidence-based prediction with an interval, create the recommendation from a Decision Lab scenario.
          </p>
          <FormError message={error ? errorText(error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              Create recommendation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type NewTask = { title: string; description?: string; assignee_id?: string; recommendation_id?: string; due_date?: string; priority: string };

export function CreateTaskDialog({
  open,
  onOpenChange,
  members,
  canAssign,
  recommendations,
  fixedRecommendation,
  submitting,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MemberLite[];
  canAssign: boolean;
  recommendations: Pick<Recommendation, "id" | "title">[];
  fixedRecommendation?: Pick<Recommendation, "id" | "title"> | null;
  submitting: boolean;
  error: unknown;
  onSubmit: (task: NewTask) => void;
}) {
  const empty = { title: "", description: "", assignee: "", recommendation: fixedRecommendation?.id ?? "", due: "", priority: "medium" };
  const [form, setForm] = useState(empty);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm(empty);
      setLocal({});
    }
  }
  const set = (patch: Partial<typeof empty>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const problems: Record<string, string> = {};
            if (form.title.trim().length < 3) problems.title = "At least 3 characters";
            setLocal(problems);
            if (Object.keys(problems).length) return;
            onSubmit({
              title: form.title.trim(),
              description: form.description.trim() || undefined,
              assignee_id: form.assignee || undefined,
              recommendation_id: form.recommendation || undefined,
              due_date: form.due || undefined,
              priority: form.priority,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>{fixedRecommendation ? `For “${fixedRecommendation.title}”.` : "Track the work needed to carry out a decision."}</DialogDescription>
          </DialogHeader>
          <TextField label="Title" required value={form.title} onChange={(title) => set({ title })} error={local.title} maxLength={300} />
          <TextAreaField label="Description" value={form.description} onChange={(description) => set({ description })} rows={3} maxLength={4000} />
          <div className="grid gap-4 sm:grid-cols-2">
            {canAssign ? (
              <SelectField
                label="Assignee"
                value={form.assignee}
                onChange={(assignee) => set({ assignee: assignee === "__none" ? "" : assignee })}
                placeholder="Unassigned"
                options={[{ value: "__none", label: "Unassigned" }, ...members.map((m) => ({ value: m.user_id, label: `${m.full_name} · ${m.role_label}` }))]}
              />
            ) : null}
            <SelectField
              label="Priority"
              value={form.priority}
              onChange={(priority) => set({ priority })}
              options={["low", "medium", "high", "critical"].map((p) => ({ value: p, label: humanize(p) }))}
            />
            <TextField label="Due date" type="date" value={form.due} onChange={(due) => set({ due })} />
            {!fixedRecommendation ? (
              <SelectField
                label="Recommendation"
                value={form.recommendation}
                onChange={(recommendation) => set({ recommendation: recommendation === "__none" ? "" : recommendation })}
                placeholder="None"
                options={[{ value: "__none", label: "None" }, ...recommendations.map((r) => ({ value: r.id, label: r.title.length > 70 ? `${r.title.slice(0, 70)}…` : r.title }))]}
              />
            ) : null}
          </div>
          {!canAssign ? <p className="text-xs text-muted-foreground">Your role cannot list members, so the task is created unassigned.</p> : null}
          <FormError message={error ? errorText(error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
