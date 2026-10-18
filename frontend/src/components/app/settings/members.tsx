"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, StoreIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ActiveBadge, StatusBadge } from "@/components/app/badges";
import { DataTable, type Column } from "@/components/app/data-table";
import { SESSION_QUERY_KEY, useSession } from "@/components/app/session-provider";
import { EmptyState, QueryView, TableSkeleton } from "@/components/app/states";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, formatRelative } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { Member, RolesResponse, Store } from "@/lib/app/types";

export function useStores() {
  return useOrgQuery<{ stores: Store[]; scoped: boolean }>("/stores", { staleTime: 5 * 60_000 });
}

export function useRoles() {
  return useOrgQuery<RolesResponse>("/roles", { staleTime: 10 * 60_000 });
}

/** Choose which stores a member can see. Empty means every store. */
export function StoreScopeDialog({
  open,
  onOpenChange,
  stores,
  initial,
  title,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: Store[];
  initial: string[] | null;
  title: string;
  onSave: (storeIds: string[]) => void;
  saving?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(initial ?? []);
  const listId = useId();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setSelected(initial ?? []);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Restrict the member to these stores. Leave all unchecked for access to every store.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg p-1 ring-1 ring-foreground/10">
          {stores.map((store) => {
            const id = `${listId}-${store.id}`;
            return (
              <li key={store.id}>
                <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox
                    id={id}
                    checked={selected.includes(store.id)}
                    onCheckedChange={(checked) =>
                      setSelected((prev) => (checked === true ? [...prev, store.id] : prev.filter((s) => s !== store.id)))
                    }
                  />
                  <span className="text-muted-foreground">{store.code}</span>
                  <span className="truncate font-medium">{store.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSave(selected)} disabled={saving}>
            {selected.length ? `Limit to ${selected.length} ${selected.length === 1 ? "store" : "stores"}` : "Allow all stores"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function storeScopeText(scope: string[] | null, stores: Store[]): string {
  if (!scope?.length) return "All stores";
  const codes = scope.map((id) => stores.find((s) => s.id === id)?.code ?? "Unknown store");
  return codes.length > 3 ? `${codes.slice(0, 3).join(", ")} and ${codes.length - 3} more` : codes.join(", ");
}

export function MembersSettings() {
  const { has } = useSession();
  const canManage = has(PERMISSIONS.membersManage);
  const queryClient = useQueryClient();
  const invalidate = useInvalidateOrg();
  const members = useOrgQuery<{ members: Member[] }>("/members");
  const roles = useRoles();
  const stores = useStores();
  const [scopeFor, setScopeFor] = useState<Member | null>(null);
  const [confirm, setConfirm] = useState<{ member: Member; action: "suspend" | "remove" } | null>(null);

  const onDone = (message: string) => {
    toast.success(message);
    void invalidate("/members");
    void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  };
  const update = useOrgMutation<{ id: string; body: Record<string, unknown>; message: string }>(
    ({ id, body }, call) => call(`/members/${id}`, { method: "PATCH", json: body }),
    { onSuccess: (_, vars) => onDone(vars.message), onError: (error) => toast.error(error.message) },
  );
  const remove = useOrgMutation<{ id: string; name: string }>(({ id }, call) => call(`/members/${id}`, { method: "DELETE" }), {
    onSuccess: (_, vars) => onDone(`${vars.name} removed from the organization`),
    onError: (error) => toast.error(error.message),
  });

  const assignable = roles.data ? roles.data.roles.filter((r) => roles.data!.assignable_by_me.includes(r.role)) : [];
  const storeList = stores.data?.stores ?? [];
  const activeOwners = (members.data?.members ?? []).filter((m) => m.role === "org_owner" && m.status === "active").length;
  // The backend refuses to demote, suspend or remove the last active owner; say so before trying.
  const isLastOwner = (m: Member) => m.role === "org_owner" && m.status === "active" && activeOwners <= 1;

  return (
    <QueryView query={members} loading={<TableSkeleton rows={8} columns={5} />}>
      {(data) => {
        const columns: Column<Member>[] = [
          {
            key: "name",
            header: "Member",
            cell: (m) => (
              <span className="block min-w-[13rem]">
                <span className="font-medium">
                  {m.full_name}
                  {m.is_me ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                </span>
                <span className="block text-xs text-muted-foreground">{m.email}</span>
              </span>
            ),
            sortValue: (m) => m.full_name,
          },
          {
            key: "role",
            header: "Role",
            cell: (m) =>
              canManage && !m.is_me && assignable.length && !isLastOwner(m) ? (
                <Select
                  value={m.role}
                  disabled={update.isPending}
                  onValueChange={(role) => update.mutate({ id: m.id, body: { role }, message: `${m.full_name} is now ${assignable.find((r) => r.role === role)?.label ?? role}` })}
                >
                  <SelectTrigger size="sm" className="w-60 bg-background" aria-label={`Role for ${m.full_name}`}>
                    <SelectValue>{m.role_label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {assignable.map((r) => (
                      <SelectItem key={r.role} value={r.role}>
                        {r.label}
                      </SelectItem>
                    ))}
                    {!assignable.some((r) => r.role === m.role) ? (
                      <SelectItem value={m.role} disabled>
                        {m.role_label}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              ) : (
                m.role_label
              ),
            sortValue: (m) => m.role_label,
          },
          {
            key: "scope",
            header: "Stores",
            cell: (m) => (
              <span className="inline-flex items-center gap-1.5 text-[0.8125rem]">
                <StoreIcon className="size-3.5 text-muted-foreground" aria-hidden />
                {storeScopeText(m.store_scope, storeList)}
              </span>
            ),
          },
          { key: "status", header: "Status", cell: (m) => <ActiveBadge active={m.status === "active"} />, sortValue: (m) => m.status },
          {
            key: "login",
            header: "Last sign-in",
            cell: (m) => <span title={formatDate(m.last_login_at)}>{m.last_login_at ? formatRelative(m.last_login_at) : "Never"}</span>,
            sortValue: (m) => m.last_login_at,
          },
          ...(canManage
            ? [
                {
                  key: "actions",
                  header: <span className="sr-only">Actions</span>,
                  cell: (m: Member) =>
                    m.is_me ? null : isLastOwner(m) ? (
                      <span className="text-xs text-muted-foreground">Last owner</span>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.full_name}`}>
                            <MoreHorizontalIcon aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => setScopeFor(m)}>Change store access</DropdownMenuItem>
                          {m.status === "active" ? (
                            <DropdownMenuItem onSelect={() => setConfirm({ member: m, action: "suspend" })}>Suspend</DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => update.mutate({ id: m.id, body: { status: "active" }, message: `${m.full_name} reactivated` })}
                            >
                              Reactivate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ member: m, action: "remove" })}>
                            Remove from organization
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ),
                },
              ]
            : []),
        ];
        return (
          <div className="space-y-3">
            {!canManage ? <p className="text-sm text-muted-foreground">You can see the members of this organization. Only owners can change them.</p> : null}
            <DataTable
              caption="Members"
              columns={columns}
              rows={data.members}
              rowKey={(m) => m.id}
              defaultSort={{ key: "name", dir: "asc" }}
              dense
              empty={<EmptyState compact title="No members yet" />}
            />
            {data.members.some((m) => m.status !== "active") ? (
              <p className="text-xs text-muted-foreground">
                <StatusBadge tone="danger">Suspended</StatusBadge> members keep their history but cannot sign in to this organization.
              </p>
            ) : null}

            {scopeFor ? (
              <StoreScopeDialog
                open={Boolean(scopeFor)}
                onOpenChange={(open) => !open && setScopeFor(null)}
                stores={storeList}
                initial={scopeFor.store_scope}
                title={`Store access for ${scopeFor.full_name}`}
                saving={update.isPending}
                onSave={(ids) => {
                  update.mutate(
                    {
                      id: scopeFor.id,
                      body: ids.length ? { store_scope: ids } : { clear_store_scope: true },
                      message: `Store access updated for ${scopeFor.full_name}`,
                    },
                    { onSuccess: () => setScopeFor(null) },
                  );
                }}
              />
            ) : null}

            <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {confirm?.action === "remove" ? `Remove ${confirm.member.full_name}?` : `Suspend ${confirm?.member.full_name}?`}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {confirm?.action === "remove"
                      ? "They lose access to this organization immediately. Their past actions stay in the audit trail."
                      : "Their sessions end now and they cannot open this organization until reactivated."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      if (!confirm) return;
                      if (confirm.action === "remove") remove.mutate({ id: confirm.member.id, name: confirm.member.full_name });
                      else update.mutate({ id: confirm.member.id, body: { status: "suspended" }, message: `${confirm.member.full_name} suspended` });
                    }}
                  >
                    {confirm?.action === "remove" ? "Remove member" : "Suspend member"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        );
      }}
    </QueryView>
  );
}
