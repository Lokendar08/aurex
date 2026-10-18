"use client";

import { BellIcon, CheckCheckIcon, ClipboardListIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { DataTable, type Column } from "@/components/app/data-table";
import { Panel } from "@/components/app/page";
import { useSession } from "@/components/app/session-provider";
import { EmptyState, TableSkeleton } from "@/components/app/states";
import { QueryError, toastError } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInvalidateOrg, useOrgMutation, useOrgQuery } from "@/hooks/use-org-query";
import { formatDate, formatDateTime, formatRelative, humanize } from "@/lib/app/format";
import { PERMISSIONS } from "@/lib/app/nav";
import type { NotificationsResponse, Recommendation, Task } from "@/lib/app/workflows-types";
import { cn } from "@/lib/utils";

import { CreateTaskDialog, type NewTask } from "./dialogs";
import { PriorityBadge, useMembers } from "./shared";

const TASK_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

export function useCreateTask(onDone?: () => void) {
  const invalidate = useInvalidateOrg();
  return useOrgMutation<NewTask, Task>((body, call) => call("/tasks", { json: body }), {
    onSuccess: (task) => {
      void invalidate("/tasks", "/workflows", "/recommendations");
      toast.success("Task created", { description: task.title });
      onDone?.();
    },
  });
}

export function TaskStatusSelect({ task, disabled }: { task: Task; disabled?: boolean }) {
  const invalidate = useInvalidateOrg();
  const update = useOrgMutation<{ status: string }, Task>((body, call) => call(`/tasks/${task.id}`, { method: "PATCH", json: body }));
  const id = `task-status-${task.id}`;
  return (
    <>
      <Label htmlFor={id} className="sr-only">
        Status of {task.title}
      </Label>
      <Select
        value={task.status}
        disabled={disabled || update.isPending}
        onValueChange={(status) =>
          update.mutate(
            { status },
            {
              onSuccess: () => {
                void invalidate("/tasks", "/workflows", "/recommendations");
                toast.success(`Task marked ${humanize(status).toLowerCase()}`);
              },
              onError: (error) => toastError(error, "The task wasn't updated"),
            },
          )
        }
      >
        <SelectTrigger id={id} size="sm" className="h-7 w-[8.5rem] bg-background text-[0.8125rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {TASK_STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function AssigneeSelect({ task, members, nameOf }: { task: Task; members: { user_id: string; full_name: string }[]; nameOf: (id: string | null) => string }) {
  const invalidate = useInvalidateOrg();
  const update = useOrgMutation<{ assignee_id: string }, Task>((body, call) => call(`/tasks/${task.id}`, { method: "PATCH", json: body }));
  const id = `task-assignee-${task.id}`;
  return (
    <>
      <Label htmlFor={id} className="sr-only">
        Assignee of {task.title}
      </Label>
      <Select
        value={task.assignee_id ?? undefined}
        disabled={update.isPending}
        onValueChange={(assignee_id) =>
          update.mutate(
            { assignee_id },
            {
              onSuccess: () => {
                void invalidate("/tasks", "/workflows");
                toast.success(`Assigned to ${nameOf(assignee_id)}`);
              },
              onError: (error) => toastError(error, "The task wasn't reassigned"),
            },
          )
        }
      >
        <SelectTrigger id={id} size="sm" className="h-7 w-[11rem] bg-background text-[0.8125rem]">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent position="popper">
          {members.map((m) => (
            <SelectItem key={m.user_id} value={m.user_id}>
              {m.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

export function TasksPanel({ recommendations }: { recommendations: Pick<Recommendation, "id" | "title">[] }) {
  const { has, user } = useSession();
  const canReadAll = has(PERMISSIONS.tasksRead);
  const canManage = has("tasks:manage");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState<string>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const { canList, members, nameOf } = useMembers();
  const query = useOrgQuery<{ tasks: Task[] }>("/tasks", {
    query: { mine: scope === "mine", status: status === "active" || status === "all" ? undefined : status },
    keepPrevious: true,
    staleTime: 30_000,
  });
  const create = useCreateTask(() => setCreateOpen(false));
  const recTitle = Object.fromEntries(recommendations.map((r) => [r.id, r.title])) as Record<string, string>;
  const rows = (query.data?.tasks ?? []).filter((t) => (status === "active" ? t.status === "open" || t.status === "in_progress" : true));

  const columns: Column<Task>[] = [
    {
      key: "title",
      header: "Task",
      cell: (t) => (
        <div className="min-w-[14rem]">
          <p className="font-medium">{t.title}</p>
          {t.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p> : null}
          {t.recommendation_id ? (
            <Link href={`/app/workflows/recommendations/${t.recommendation_id}`} className="text-xs text-primary underline-offset-3 hover:underline">
              {recTitle[t.recommendation_id] ? `For: ${recTitle[t.recommendation_id]}` : "Linked recommendation"}
            </Link>
          ) : null}
        </div>
      ),
      sortValue: (t) => t.title,
    },
    {
      key: "status",
      header: "Status",
      cell: (t) => <TaskStatusSelect task={t} disabled={!(canManage || t.assignee_id === user.id)} />,
      sortValue: (t) => t.status,
    },
    { key: "priority", header: "Priority", cell: (t) => <PriorityBadge priority={t.priority} />, sortValue: (t) => ["low", "medium", "high", "critical"].indexOf(t.priority) },
    {
      key: "assignee",
      header: "Assignee",
      cell: (t) => (canManage && canList ? <AssigneeSelect task={t} members={members} nameOf={nameOf} /> : nameOf(t.assignee_id)),
    },
    {
      key: "due",
      header: "Due",
      cell: (t) => {
        const overdue = t.due_date && t.status !== "done" && t.status !== "cancelled" && t.due_date < new Date().toISOString().slice(0, 10);
        return <span className={cn("whitespace-nowrap", overdue && "font-medium text-destructive")}>{t.due_date ? `${formatDate(t.due_date)}${overdue ? " · overdue" : ""}` : "No due date"}</span>;
      },
      sortValue: (t) => t.due_date,
    },
    { key: "created", header: "Created", cell: (t) => <span className="whitespace-nowrap">{formatRelative(t.created_at)}</span>, sortValue: (t) => t.created_at },
  ];

  return (
    <Panel
      title="Tasks"
      description={scope === "mine" ? "Assigned to you" : "Every task in the organization"}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canReadAll ? (
            <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={scope} onValueChange={(v) => v && setScope(v as "mine" | "all")} aria-label="Whose tasks">
              <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          <Label htmlFor="task-status-filter" className="sr-only">
            Filter by status
          </Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="task-status-filter" size="sm" className="h-7 w-[9.5rem] bg-background text-[0.8125rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectItem value="active">Open and in progress</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon aria-hidden />
              New task
            </Button>
          ) : null}
        </div>
      }
    >
      {query.isPending ? (
        <TableSkeleton rows={4} columns={5} />
      ) : query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={ClipboardListIcon}
          title={scope === "mine" ? "No tasks assigned to you" : "No tasks match"}
          description={canManage ? "Create tasks for approved recommendations to track the work." : "Tasks assigned to you appear here."}
        />
      ) : (
        <div className={query.isPlaceholderData ? "opacity-55" : undefined}>
          <DataTable caption="Tasks" columns={columns} rows={rows} rowKey={(t) => t.id} dense pageSize={20} />
        </div>
      )}
      <CreateTaskDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (open) create.reset();
        }}
        members={members}
        canAssign={canList}
        recommendations={recommendations}
        submitting={create.isPending}
        error={create.error}
        onSubmit={(task) => create.mutate(task)}
      />
    </Panel>
  );
}

/** Only internal workspace links are followed; anything else is shown as text. */
function internalLink(link: string | null): string | null {
  if (!link || !link.startsWith("/app/") || link.startsWith("//")) return null;
  return link;
}

export function NotificationsPanel() {
  const invalidate = useInvalidateOrg();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useOrgQuery<NotificationsResponse>("/notifications", { query: { unread_only: unreadOnly || undefined, limit: 100 }, keepPrevious: true, staleTime: 15_000 });
  const markOne = useOrgMutation<number, unknown>((id, call) => call(`/notifications/${id}/read`, { method: "POST" }));
  const markAll = useOrgMutation<void, { marked: number }>((_, call) => call("/notifications/read-all", { method: "POST" }));
  const data = query.data;
  return (
    <Panel
      title="Notifications"
      description={data ? `${data.unread} unread` : undefined}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="notif-unread" className="flex items-center gap-2 text-sm">
            <Switch id="notif-unread" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
            Unread only
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={!data?.unread || markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onSuccess: (res) => {
                  void invalidate("/notifications", "/workflows");
                  toast.success(`Marked ${res.marked} notification${res.marked === 1 ? "" : "s"} as read`);
                },
                onError: (error) => toastError(error),
              })
            }
          >
            <CheckCheckIcon aria-hidden />
            Mark all as read
          </Button>
        </div>
      }
    >
      {query.isPending ? (
        <TableSkeleton rows={4} columns={2} />
      ) : query.error || !data ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : data.notifications.length === 0 ? (
        <EmptyState compact icon={BellIcon} title={unreadOnly ? "No unread notifications" : "No notifications"} description="Approval requests, decisions, task assignments and finished reports appear here." />
      ) : (
        <ul className={cn("divide-y", query.isPlaceholderData && "opacity-55")}>
          {data.notifications.map((n) => {
            const link = internalLink(n.link);
            return (
              <li key={n.id} className="flex items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent ring-1 ring-foreground/20" : "bg-primary")} />
                  <div className="min-w-0">
                    <p className={cn("text-sm", n.read ? "text-foreground/80" : "font-medium")}>
                      {link ? (
                        <Link
                          href={link}
                          className="underline-offset-3 hover:underline"
                          onClick={() => {
                            if (!n.read) markOne.mutate(n.id, { onSuccess: () => void invalidate("/notifications", "/workflows") });
                          }}
                        >
                          {n.title}
                        </Link>
                      ) : (
                        n.title
                      )}
                      <span className="sr-only">{n.read ? " (read)" : " (unread)"}</span>
                    </p>
                    {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p> : null}
                    <p className="mt-0.5 text-xs text-muted-foreground" title={formatDateTime(n.created_at)}>
                      {humanize(n.kind)} · {formatRelative(n.created_at)}
                    </p>
                  </div>
                </div>
                {!n.read ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="shrink-0 text-primary"
                    disabled={markOne.isPending}
                    onClick={() => markOne.mutate(n.id, { onSuccess: () => void invalidate("/notifications", "/workflows"), onError: (error) => toastError(error) })}
                  >
                    Mark read
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
