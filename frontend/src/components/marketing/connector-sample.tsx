import { IllustrativeLabel } from "./evidence";

// NovaMart demo data (synthetic). Read = new + duplicates skipped + rejected.
const RUNS = [
  { started: "14 Oct 2026, 02:10", read: "18,204", added: "18,167", duplicates: "37", rejected: "0", result: "Completed" },
  {
    started: "13 Oct 2026, 02:10",
    read: "17,951",
    added: "17,936",
    duplicates: "11",
    rejected: "4",
    result: "4 rows held for review",
  },
  {
    started: "12 Oct 2026, 02:10",
    read: "18,630",
    added: "18,630",
    duplicates: "0",
    rejected: "0",
    result: "Completed after 1 retry",
  },
] as const;

/** Illustrative connector status and sync history for a file-export connector. */
export function ConnectorRunSample() {
  return (
    <figure className="overflow-hidden rounded-xl border bg-card">
      <figcaption className="space-y-3 border-b px-5 py-4">
        <span className="block">
          <span className="block font-medium">NovaMart POS sales export</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">Approved export, nightly</span>
        </span>
        <IllustrativeLabel />
      </figcaption>

      <dl className="grid grid-cols-2 gap-4 border-b px-5 py-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd className="mt-1 inline-flex items-center gap-2 font-medium">
            <span aria-hidden className="size-2 rounded-full bg-success" />
            Healthy
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last sync</dt>
          <dd className="tabular mt-1">14 Oct 2026, 02:10</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs text-muted-foreground">Mode</dt>
          <dd className="mt-1">Incremental</dd>
        </div>
      </dl>

      <table className="hidden w-full text-left text-sm sm:table">
        <caption className="sr-only">Sync history, last three runs</caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-5 pt-3 pb-2 font-medium">
              Run
            </th>
            <th scope="col" className="px-2 pt-3 pb-2 text-right font-medium">
              Read
            </th>
            <th scope="col" className="px-2 pt-3 pb-2 text-right font-medium">
              New
            </th>
            <th scope="col" className="px-2 pt-3 pb-2 text-right font-medium">
              Duplicates
            </th>
            <th scope="col" className="px-2 pt-3 pb-2 text-right font-medium">
              Rejected
            </th>
            <th scope="col" className="px-5 pt-3 pb-2 font-medium">
              Result
            </th>
          </tr>
        </thead>
        <tbody>
          {RUNS.map((run) => (
            <tr key={run.started} className="border-t align-top">
              <th scope="row" className="tabular px-5 py-3 font-normal whitespace-nowrap">
                {run.started}
              </th>
              <td className="tabular px-2 py-3 text-right">{run.read}</td>
              <td className="tabular px-2 py-3 text-right">{run.added}</td>
              <td className="tabular px-2 py-3 text-right">{run.duplicates}</td>
              <td className="tabular px-2 py-3 text-right">{run.rejected}</td>
              <td className="px-5 py-3 text-muted-foreground">{run.result}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y sm:hidden" aria-label="Sync history, last three runs">
        {RUNS.map((run) => (
          <li key={run.started} className="px-5 py-3 text-sm">
            <p className="tabular font-medium">{run.started}</p>
            <p className="tabular mt-0.5 text-muted-foreground">
              {run.read} read, {run.added} new, {run.duplicates} duplicates skipped, {run.rejected} rejected
            </p>
            <p className="mt-0.5">{run.result}</p>
          </li>
        ))}
      </ul>

      <p className="border-t bg-muted/40 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
        Every imported row keeps its provenance: source system, import batch (2291 for the latest run), import time and file checksum.
      </p>
    </figure>
  );
}
