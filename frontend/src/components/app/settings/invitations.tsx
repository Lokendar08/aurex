"use client";

import { LoaderCircleIcon, MailIcon, StoreIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { CopyButton, fieldErrors, FormError, SelectField, TextField } from "@/components/app/form";
import { Panel } from "@/components/app/page";
import { EmptyState, Notice, QueryView, TableSkeleton } from "@/components/app/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, formatDateTime } from "@/lib/app/format";
import type { CreatedInvitation, Invitation } from "@/lib/app/types";

import { StoreScopeDialog, storeScopeText, useRoles, useStores } from "./members";

const STATUS_TONE: Record<string, "good" | "neutral" | "danger" | "warning" | "info"> = {
  pending: "info",
  accepted: "good",
  revoked: "neutral",
  expired: "warning",
};

function InviteForm() {
  const invalidate = useInvalidateOrg();
  const roles = useRoles();
  const stores = useStores();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const showedLink = useRef(false);

  // The invite link is shown once; don't show a stale one when the member returns to this tab.
  useLayoutEffect(
    () => () => {
      if (showedLink.current) {
        showedLink.current = false;
        setCreated(null);
      }
    },
    [],
  );

  const invite = useOrgMutation<Record<string, unknown>, CreatedInvitation>((body, call) => call("/invitations", { json: body }), {
    onSuccess: (data) => {
      showedLink.current = true;
      setCreated(data);
      setEmail("");
      setScope([]);
      setErrors({});
      setFormError(null);
      toast.success(`Invitation created for ${data.email}`);
      void invalidate("/invitations");
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      setFormError(error.message);
    },
  });

  const assignable = roles.data ? roles.data.roles.filter((r) => roles.data!.assignable_by_me.includes(r.role)) : [];
  const selectedRole = assignable.find((r) => r.role === role);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Enter a valid email address.";
    if (!role) next.role = "Choose a role.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    invite.mutate({ email: email.trim(), role, store_scope: scope.length ? scope : undefined });
  }

  const link = created ? `${window.location.origin}${created.invite_path}` : "";

  return (
    <div className="space-y-4">
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <TextField label="Email" type="email" autoComplete="off" required value={email} onChange={setEmail} maxLength={254} error={errors.email} />
          <SelectField
            label="Role"
            required
            value={role}
            onChange={setRole}
            placeholder="Choose a role"
            options={assignable.map((r) => ({ value: r.role, label: r.label }))}
            error={errors.role}
          />
        </div>
        {selectedRole ? <p className="text-xs text-muted-foreground">{selectedRole.description}</p> : null}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <StoreIcon className="size-4" aria-hidden />
            Store access: {storeScopeText(scope, stores.data?.stores ?? [])}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setScopeOpen(true)} disabled={!stores.data}>
            Change
          </Button>
          {selectedRole?.store_scoped_by_default && !scope.length ? (
            <span className="text-xs text-muted-foreground">This role is usually limited to specific stores.</span>
          ) : null}
        </div>
        <FormError message={Object.keys(errors).length ? null : formError} />
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <MailIcon aria-hidden />}
          Create invitation
        </Button>
      </form>
      {created ? (
        <Notice title={`Invitation link for ${created.email}`}>
          <p>
            Share this link with them; it is shown only once and expires {formatDateTime(created.expires_at)}. No email is sent
            automatically.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md bg-background px-2.5 py-1.5 font-mono text-xs break-all text-foreground ring-1 ring-foreground/10">
              {link}
            </code>
            <CopyButton value={link} label="Copy link" />
          </div>
        </Notice>
      ) : null}
      {stores.data ? (
        <StoreScopeDialog
          open={scopeOpen}
          onOpenChange={setScopeOpen}
          stores={stores.data.stores}
          initial={scope}
          title="Store access for the invitee"
          onSave={(ids) => {
            setScope(ids);
            setScopeOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

export function InvitationsSettings() {
  const invalidate = useInvalidateOrg();
  const stores = useStores();
  const invitations = useOrgQuery<{ invitations: Invitation[] }>("/invitations");
  const revoke = useOrgMutation<{ id: string; email: string }>(({ id }, call) => call(`/invitations/${id}`, { method: "DELETE" }), {
    onSuccess: (_, vars) => {
      toast.success(`Invitation for ${vars.email} revoked`);
      void invalidate("/invitations");
    },
    onError: (error) => toast.error(error.message),
  });
  const columns: Column<Invitation>[] = [
    { key: "email", header: "Email", cell: (i) => <span className="font-medium">{i.email}</span>, sortValue: (i) => i.email },
    { key: "role", header: "Role", cell: (i) => i.role_label, sortValue: (i) => i.role_label },
    { key: "scope", header: "Stores", cell: (i) => storeScopeText(i.store_scope, stores.data?.stores ?? []) },
    {
      key: "status",
      header: "Status",
      cell: (i) => <StatusBadge tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status.charAt(0).toUpperCase() + i.status.slice(1)}</StatusBadge>,
      sortValue: (i) => i.status,
    },
    { key: "created", header: "Created", cell: (i) => formatDate(i.created_at), sortValue: (i) => i.created_at },
    { key: "expires", header: "Expires", cell: (i) => formatDate(i.expires_at), sortValue: (i) => i.expires_at },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (i) =>
        i.status === "pending" ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm">
                Revoke
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke the invitation for {i.email}?</AlertDialogTitle>
                <AlertDialogDescription>The link stops working immediately. You can invite them again later.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep invitation</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => revoke.mutate({ id: i.id, email: i.email })}>
                  Revoke invitation
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null,
    },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <Panel className="xl:col-span-2" title="Invite someone" description="They join with the role you choose once they accept the link">
        <InviteForm />
      </Panel>
      <Panel className="xl:col-span-3" title="Invitations">
        <QueryView query={invitations} loading={<TableSkeleton rows={4} columns={5} />}>
          {(data) => (
            <DataTable
              caption="Invitations"
              columns={columns}
              rows={data.invitations}
              rowKey={(i) => i.id}
              defaultSort={{ key: "created", dir: "desc" }}
              dense
              empty={<EmptyState compact icon={MailIcon} title="No invitations yet" description="Invitations you create appear here with their status." />}
            />
          )}
        </QueryView>
      </Panel>
    </div>
  );
}
