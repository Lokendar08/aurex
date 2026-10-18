"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/app/format";
import { cn } from "@/lib/utils";

/** Previous / next paging with a range summary ("51–100 of 342"). Zero-based page index. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
  disabled,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
  disabled?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <p className="text-xs text-muted-foreground tabular" aria-live="polite">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 0}
          aria-label="Previous page"
        >
          <ChevronLeftIcon aria-hidden />
          Previous
        </Button>
        <span className="px-1 text-xs text-muted-foreground tabular">
          Page {page + 1} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= pageCount - 1}
          aria-label="Next page"
        >
          Next
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
