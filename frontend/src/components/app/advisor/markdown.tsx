import { Fragment, type ReactNode } from "react";

import { ExternalLink } from "@/components/app/decision-lab/common";
import { cn } from "@/lib/utils";

/*
 * A small, safe Markdown renderer for advisor answers. It builds React elements only (no HTML
 * string, no dangerouslySetInnerHTML), so markup in the text is shown as text. Supported:
 * paragraphs and line breaks, "-", "*", "+" and "1." lists, "#" headings, **bold**, *italic*,
 * `code` and [links](https://…) (http and https only).
 */

const INLINE =
  /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/)[^)\s]+\)|(?<![*\w])\*(?!\s)[^*\n]+?\*(?![*\w])|(?<![A-Za-z0-9_])_(?!\s)[^_\n]+?_(?![A-Za-z0-9_]))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**") || token.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {inline(token.slice(2, -2), key)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const close = token.indexOf("](");
      const label = token.slice(1, close);
      const href = token.slice(close + 2, -1);
      out.push(
        <ExternalLink key={key} href={href}>
          {label}
        </ExternalLink>,
      );
    } else {
      out.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "h"; level: number; text: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    const bullet = /^\s*[-*+•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2] });
    } else if (bullet || numbered) {
      const kind: "ul" | "ol" = bullet ? "ul" : "ol";
      const text = (bullet ?? numbered)![1];
      const open = current as Block | null;
      if (open && (open.kind === "ul" || open.kind === "ol") && open.kind === kind) open.items.push(text);
      else {
        flush();
        current = kind === "ul" ? { kind: "ul", items: [text] } : { kind: "ol", items: [text] };
      }
    } else {
      const open = current as Block | null;
      if (open && open.kind === "p") open.lines.push(line.trim());
      else if (open && (open.kind === "ul" || open.kind === "ol") && /^\s{2,}/.test(raw)) {
        // Indented continuation of the previous list item.
        open.items[open.items.length - 1] += ` ${line.trim()}`;
      } else {
        flush();
        current = { kind: "p", lines: [line.trim()] };
      }
    }
  }
  flush();
  return blocks;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parse(text ?? "");
  return (
    <div className={cn("space-y-3 text-[0.9375rem] leading-relaxed text-foreground/90", className)}>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        if (block.kind === "h") {
          return (
            <p key={key} className="font-heading text-[0.9375rem] font-semibold text-foreground">
              {inline(block.text, key)}
            </p>
          );
        }
        if (block.kind === "ul" || block.kind === "ol") {
          const List = block.kind === "ul" ? "ul" : "ol";
          return (
            <List key={key} className={cn("space-y-1 pl-5", block.kind === "ul" ? "list-disc marker:text-muted-foreground" : "list-decimal")}>
              {block.items.map((item, j) => (
                <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((line, j) => (
              <Fragment key={`${key}-${j}`}>
                {j > 0 ? <br /> : null}
                {inline(line, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
