"use client";

import {
  BotIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  LockIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { StatusBadge, type Tone } from "@/components/app/badges";
import { JsonPreview } from "@/components/app/json-preview";
import { NoteList } from "@/components/app/page";
import { SyntheticBadge } from "@/components/app/decision-lab/common";
import { Button } from "@/components/ui/button";
import type { AdvisorAnswer, AdvisorMessage, KeyFigure, ToolCall } from "@/lib/app/advisor-types";
import { formatDate, formatDateTime, formatNumber, humanize } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { Markdown } from "./markdown";

const CONFIDENCE: Record<string, { tone: Tone; label: string }> = {
  high: { tone: "good", label: "High confidence" },
  medium: { tone: "warning", label: "Medium confidence" },
  low: { tone: "danger", label: "Low confidence" },
};

function figureLabel(item: string | KeyFigure): string {
  return typeof item === "string" ? item : `${item.label}: ${item.display}`;
}

function toolAnchor(messageId: string | number, ref: string) {
  return `msg-${messageId}-tool-${ref}`;
}

function ToolStatus({ call }: { call: ToolCall }) {
  if (call.status === "ok")
    return (
      <StatusBadge tone="good" icon={CircleCheckIcon}>
        Completed
      </StatusBadge>
    );
  if (call.status === "denied")
    return (
      <StatusBadge tone="warning" icon={LockIcon}>
        Permission denied
      </StatusBadge>
    );
  return (
    <StatusBadge tone="danger" icon={CircleXIcon}>
      {humanize(call.status)}
    </StatusBadge>
  );
}

function ToolCalls({
  calls,
  messageId,
  open,
  setOpen,
}: {
  calls: ToolCall[];
  messageId: string | number;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const listId = useId();
  if (!calls.length) return null;
  return (
    <div className="rounded-lg ring-1 ring-foreground/10">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-left text-[0.8125rem] font-medium outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2">
          <WrenchIcon className="size-4 text-muted-foreground" aria-hidden />
          {calls.length} tool call{calls.length === 1 ? "" : "s"} behind this answer
        </span>
        <ChevronDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ul id={listId} className="divide-y border-t">
          {calls.map((call) => (
            <li key={call.ref} id={toolAnchor(messageId, call.ref)} tabIndex={-1} className="scroll-mt-24 space-y-2 px-3.5 py-3 outline-none focus-visible:bg-muted/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{call.ref}</code>
                  <span className="font-medium">{humanize(call.name)}</span>
                  <span className="font-mono text-xs text-muted-foreground">{call.name}</span>
                </p>
                <div className="flex items-center gap-2">
                  <ToolStatus call={call} />
                  {typeof call.duration_ms === "number" ? (
                    <span className="text-xs text-muted-foreground tabular">{formatNumber(call.duration_ms, { decimals: 0 })} ms</span>
                  ) : null}
                </div>
              </div>
              {call.error ? (
                <p className={cn("text-[0.8125rem]", call.status === "denied" ? "text-foreground" : "text-destructive")}>
                  {call.status === "denied" ? "Not run with your permissions: " : "Error: "}
                  {call.error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1">
                <JsonPreview label="View input" title={`${call.ref} input`} value={call.input} />
                {call.output !== null && call.output !== undefined ? (
                  <JsonPreview label="View output" title={`${call.ref} output`} summary="Validated AUREX calculation returned to the advisor." value={call.output} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SourceRef({ refName, onReveal, className }: { refName: string; onReveal: (ref: string) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onReveal(refName)}
      className={cn(
        "rounded font-mono text-xs outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      title="Show the tool call this comes from"
    >
      {refName}
    </button>
  );
}

function KeyFigures({ figures, onReveal }: { figures: KeyFigure[]; onReveal: (ref: string) => void }) {
  if (!figures.length) return null;
  return (
    <ul className="grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-foreground/10 sm:grid-cols-2 xl:grid-cols-3" aria-label="Key figures">
      {figures.map((f, i) => (
        <li key={`${f.label}-${i}`} className="bg-card px-3.5 py-3">
          <p className="text-xs text-muted-foreground">{f.label}</p>
          <p className="mt-0.5 text-lg leading-tight font-semibold">{f.display}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {f.verified === false ? (
              <span className="inline-flex items-center gap-1 text-[color-mix(in_oklch,var(--warning),var(--foreground)_45%)]">
                <TriangleAlertIcon className="size-3.5 text-warning" aria-hidden />
                Not traced to a tool output
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[color-mix(in_oklch,var(--success),var(--foreground)_30%)]">
                <CircleCheckIcon className="size-3.5 text-success" aria-hidden />
                Verified
              </span>
            )}
            {f.source_ref ? <SourceRef refName={f.source_ref} onReveal={onReveal} className="text-muted-foreground hover:text-foreground" /> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

function VerificationLine({ answer }: { answer: AdvisorAnswer }) {
  const v = answer.verification;
  if (!v) return null;
  const untraced = (v.unverified_numbers_in_text ?? []).length;
  const traced = Math.max(0, (v.checked_numbers ?? 0) - untraced);
  const figures = v.unverified_key_figures ?? [];
  if (v.all_numbers_traced && !figures.length) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-success/8 px-3.5 py-2.5 text-[0.8125rem] ring-1 ring-success/25" title={v.method}>
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <span>
          <strong className="font-semibold">
            Numbers traced: {formatNumber(traced)}/{formatNumber(v.checked_numbers)}
          </strong>{" "}
          to tool outputs. {v.method}
        </span>
      </p>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg bg-warning/12 px-3.5 py-2.5 text-[0.8125rem] ring-1 ring-warning/30" role="note">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p>
          <strong className="font-semibold">
            Numbers traced: {formatNumber(traced)}/{formatNumber(v.checked_numbers)}
          </strong>
          . Treat the untraced figures as unverified.
        </p>
        {untraced ? <p className="text-muted-foreground">Not found in any tool output: {v.unverified_numbers_in_text.map(String).join(", ")}</p> : null}
        {figures.length ? <p className="text-muted-foreground">Unverified key figures: {figures.map(figureLabel).join("; ")}</p> : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

export function AssistantAnswer({ message, onFollowUp, busy }: { message: AdvisorMessage; onFollowUp: (q: string) => void; busy: boolean }) {
  const answer = message.answer;
  const calls = message.tool_calls ?? [];
  const denied = calls.filter((c) => c.status === "denied");
  const confidence = answer ? (CONFIDENCE[answer.confidence] ?? { tone: "neutral" as Tone, label: humanize(answer.confidence) }) : null;
  const [toolsOpen, setToolsOpen] = useState(false);
  const reveal = (ref: string) => {
    setToolsOpen(true);
    window.setTimeout(() => {
      const target = document.getElementById(toolAnchor(message.id, ref));
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }, 60);
  };
  return (
    <article className="rounded-xl bg-card ring-1 ring-foreground/10" aria-label="Advisor answer">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <p className="flex items-center gap-2 text-[0.8125rem] font-medium">
          <span className="grid size-6 place-items-center rounded-md bg-navy-950 text-white">
            <BotIcon className="size-3.5" aria-hidden />
          </span>
          AUREX Advisor
          <span className="font-normal text-muted-foreground">
            {answer?.mode === "llm" ? (answer.model ?? "Language model") : "Deterministic analysis"} · {formatDateTime(message.created_at)}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {confidence ? (
            <StatusBadge tone={confidence.tone} icon={confidence.tone === "good" ? CircleCheckIcon : CircleHelpIcon} title={answer?.confidence_reason}>
              {confidence.label}
            </StatusBadge>
          ) : null}
          {answer?.is_synthetic ? <SyntheticBadge /> : null}
        </div>
      </header>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <Markdown text={message.content || answer?.answer || ""} />
        {denied.length ? (
          <p className="flex items-start gap-2 rounded-lg bg-muted/70 px-3.5 py-2.5 text-[0.8125rem]">
            <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              {denied.length === 1 ? "One analysis was" : `${denied.length} analyses were`} not run because your role lacks the permission:{" "}
              {denied.map((c) => humanize(c.name)).join(", ")}. The answer uses only what you are allowed to see.
            </span>
          </p>
        ) : null}
        {answer ? (
          <>
            <KeyFigures figures={answer.key_figures ?? []} onReveal={reveal} />
            <VerificationLine answer={answer} />
            <div className="grid gap-4 md:grid-cols-2">
              {answer.evidence?.length ? (
                <Section title="Evidence">
                  <ul className="space-y-1 text-[0.8125rem]">
                    {answer.evidence.map((e, i) => (
                      <li key={i} className="flex gap-2">
                        <SourceRef refName={e.source_ref} onReveal={reveal} className="h-fit shrink-0 bg-muted px-1.5 py-0.5 hover:bg-brand-50" />
                        <span>{e.summary}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              <Section title="Confidence">
                <p className="text-[0.8125rem]">
                  <span className="font-medium">{confidence?.label}.</span> {answer.confidence_reason}
                </p>
              </Section>
              {answer.assumptions?.length ? (
                <Section title="Assumptions">
                  <NoteList notes={answer.assumptions} />
                </Section>
              ) : null}
              {answer.limitations?.length ? (
                <Section title="Limitations">
                  <NoteList notes={answer.limitations} />
                </Section>
              ) : null}
            </div>
            {answer.notice && answer.mode !== "deterministic" ? <p className="text-xs text-muted-foreground">{answer.notice}</p> : null}
            <p className="text-xs text-muted-foreground">
              {answer.data_end ? `Data through ${formatDate(answer.data_end)}. ` : ""}
              {answer.is_synthetic ? "Computed on synthetic demonstration data." : ""}
            </p>
          </>
        ) : null}
        <div id={`msg-${message.id}-tools`}>
          <ToolCalls calls={calls} messageId={message.id} open={toolsOpen} setOpen={setToolsOpen} />
        </div>
        {answer?.follow_up_questions?.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Ask next</p>
            <div className="flex flex-wrap gap-2">
              {answer.follow_up_questions.map((q) => (
                <Button key={q} variant="outline" size="sm" className="h-auto min-h-7 py-1 text-left whitespace-normal max-w-full shrink" onClick={() => onFollowUp(q)} disabled={busy}>
                  {q}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
