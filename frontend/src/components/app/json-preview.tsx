"use client";

import { useLayoutEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** "View" button revealing structured details (raw rows, audit details). Rendered as text only. */
export function JsonPreview({
  label = "View",
  title = "Details",
  summary,
  value,
}: {
  label?: string;
  title?: string;
  summary?: string | null;
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => () => setOpen(false), []);
  const hasValue = value !== null && value !== undefined && !(typeof value === "object" && Object.keys(value as object).length === 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="text-primary">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))] gap-2 p-3">
        <p className="text-sm font-medium">{title}</p>
        {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
        {hasValue ? (
          <pre className="max-h-72 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(value, null, 2)}
          </pre>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
