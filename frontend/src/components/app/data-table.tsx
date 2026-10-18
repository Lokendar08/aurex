"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Pagination } from "./pagination";

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Accessible name when the header is not plain text. */
  label?: string;
  cell: (row: T, index: number) => ReactNode;
  /** Enables sorting on this column. Nulls always sort last. */
  sortValue?: (row: T) => number | string | null | undefined;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  /** Keep this column visible while scrolling horizontally. */
  sticky?: boolean;
};

type Sort = { key: string; dir: "asc" | "desc" };

function compare(a: number | string | null | undefined, b: number | string | null | undefined, dir: "asc" | "desc") {
  const aMissing = a === null || a === undefined || (typeof a === "number" && Number.isNaN(a));
  const bMissing = b === null || b === undefined || (typeof b === "number" && Number.isNaN(b));
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
  return dir === "asc" ? result : -result;
}

/**
 * Accessible data table: real <table> semantics, sortable headers (buttons with aria-sort),
 * right-aligned tabular figures, horizontal scroll on narrow screens, optional client paging.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  defaultSort,
  pageSize,
  empty,
  className,
  dense,
  footer,
  rowClassName,
  maxHeight,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Describes the table for assistive technology (visually hidden). */
  caption: string;
  defaultSort?: Sort;
  pageSize?: number;
  empty?: ReactNode;
  className?: string;
  dense?: boolean;
  footer?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  maxHeight?: number;
}) {
  const [sort, setSort] = useState<Sort | undefined>(defaultSort);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const getValue = column.sortValue;
    return [...rows].sort((a, b) => compare(getValue(a), getValue(b), sort.dir));
  }, [rows, columns, sort]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const visible = pageSize ? sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize) : sorted;

  function toggleSort(key: string) {
    setPage(0);
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "desc" };
      return prev.dir === "desc" ? { key, dir: "asc" } : undefined;
    });
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  const cellPad = dense ? "px-3 py-1.5" : "px-3 py-2.5";

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className="relative w-full overflow-x-auto rounded-lg ring-1 ring-foreground/8"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
        tabIndex={0}
        role="region"
        aria-label={caption}
      >
        <table className="w-full caption-bottom border-collapse text-[0.8125rem]">
          <caption className="sr-only">{caption}</caption>
          <thead className={cn("bg-muted/60", maxHeight && "sticky top-0 z-10 bg-muted")}>
            <tr className="border-b">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : column.sortValue ? "none" : undefined;
                const alignClass =
                  column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left";
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      "h-9 font-medium whitespace-nowrap text-muted-foreground",
                      column.sortValue ? "px-1.5" : "px-3",
                      alignClass,
                      column.sticky && "sticky left-0 z-[1] bg-muted",
                      column.headerClassName,
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-md px-1.5 transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                          active && "text-foreground",
                          column.align === "right" && "flex-row-reverse",
                        )}
                        aria-label={column.label ? `Sort by ${column.label}` : undefined}
                      >
                        <span>{column.header}</span>
                        {active ? (
                          sort.dir === "asc" ? (
                            <ArrowUpIcon className="size-3.5" aria-hidden />
                          ) : (
                            <ArrowDownIcon className="size-3.5" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDownIcon className="size-3.5 opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className={cn("border-b transition-colors last:border-b-0 hover:bg-muted/40", rowClassName?.(row))}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      cellPad,
                      "align-middle",
                      column.align === "right" && "text-right tabular whitespace-nowrap",
                      column.align === "center" && "text-center",
                      column.sticky && "sticky left-0 z-[1] bg-card whitespace-nowrap",
                      column.className,
                    )}
                  >
                    {column.cell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer ? <tfoot className="border-t bg-muted/50 font-medium">{footer}</tfoot> : null}
        </table>
      </div>
      {pageSize && sorted.length > pageSize ? (
        <Pagination
          className="mt-3"
          page={currentPage}
          pageSize={pageSize}
          total={sorted.length}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
