"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatFullDate, formatNumber } from "@/lib/format";
import {
  KEYWORD_GROUP_MAX_LENGTH,
  KEYWORD_IMPORT_LIMIT,
  KEYWORD_STATUSES,
  STATUS_LABEL,
  checkGroupLabel,
  keywordDetailHref,
  keywordRequestFailure,
  splitImport,
  type CuratedKeywordStatus,
} from "@/lib/keywords/contract";
import { NOT_OBSERVED, NO_STORED_ROWS_COPY, type ObservedLink } from "@/lib/keywords/observed";
import type { CuratedKeywordRow } from "@/lib/keywords/service";

/**
 * Curated keywords on the Keyword Intelligence screen (checkpoint 3.5).
 *
 * The operator's own list: the exact queries a project tracks, with a status,
 * a group label, a target page and a note, and nothing else. Figures come
 * from the stored Search Console rows by exact query text; a keyword with no
 * match reads "not observed in stored rows", never zero. Adding is an
 * operator's deliberate act — from an observed query's row, or a pasted list
 * — and each query is one database call with its own event. Nothing here
 * runs an agent.
 */

export type CuratedLoad =
  | { readonly status: "idle" | "loading" | "unavailable" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly keywords: readonly CuratedKeywordRow[] };

type AddResult = { readonly query: string; readonly outcome: "added" | "exists" | "target-off-host"; readonly keywordId: string | null };

/** Posts one add request; answers the per-query results or a failure message. */
async function postAdd(body: Record<string, unknown>): Promise<{ ok: true; results: readonly AddResult[] } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/keywords", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, message: keywordRequestFailure(response.status, (payload as { error?: unknown } | null)?.error) };
    const results = (payload as { results?: AddResult[] } | null)?.results;
    return Array.isArray(results) ? { ok: true, results } : { ok: false, message: "The server accepted the request but returned no result." };
  } catch {
    return { ok: false, message: keywordRequestFailure(0) };
  }
}

/** One line for a keyword's link to the stored rows. */
export function ObservedCell({ observed }: { observed: ObservedLink }) {
  if (observed.state === "not-observed") return <span className="text-fg-subtle">{NOT_OBSERVED}</span>;
  if (observed.state === "no-stored-rows") return <span className="text-fg-subtle">{NO_STORED_ROWS_COPY[observed.reason]}</span>;
  const latest = observed.latest;
  if (latest === null || latest.impressions === 0) return <span className="text-fg-muted">Observed in {observed.windows} stored window{observed.windows === 1 ? "" : "s"}; not in the latest</span>;
  return (
    <span className="text-fg-muted" title="Google's figures for the latest stored window. Average position is Search Console's, not a rank.">
      {formatNumber(latest.impressions)} impr. · {formatNumber(latest.clicks)} clicks · avg. pos. {latest.position.toFixed(1)}
    </span>
  );
}

/**
 * "Track keyword" on an observed query's row: one click opens a confirmation,
 * the second adds the exact query to the curated list. A query already
 * curated links to its page instead.
 */
export function CurateKeywordControl({
  projectId,
  query,
  curatedId,
  onAdded,
}: {
  projectId: string;
  query: string;
  curatedId: string | null;
  onAdded: (query: string, keywordId: string) => void;
}) {
  const [state, setState] = useState<{ status: "idle" | "confirm" | "sending" } | { status: "refused"; message: string }>({ status: "idle" });
  const sending = useRef(false);

  if (curatedId !== null) {
    return (
      <Link href={keywordDetailHref(curatedId)} className="text-[12px] text-accent hover:underline">
        Curated ›
      </Link>
    );
  }

  const add = async () => {
    if (sending.current) return;
    sending.current = true;
    setState({ status: "sending" });
    const result = await postAdd({ project: projectId, queries: [query] });
    sending.current = false;
    const first = result.ok ? result.results[0] : null;
    if (first && first.keywordId !== null) onAdded(query, first.keywordId);
    else setState({ status: "refused", message: result.ok ? "Not added." : result.message });
  };

  if (state.status === "idle") {
    return (
      <Button variant="ghost" size="sm" icon="star" onClick={() => setState({ status: "confirm" })}>
        Track
      </Button>
    );
  }
  return (
    <span className="flex flex-col gap-1" aria-busy={state.status === "sending"}>
      <span className="text-[11.5px] text-fg-subtle">Add this exact query to the curated list?</span>
      {state.status === "refused" && (
        <span className="text-[11.5px] text-warning" role="status">
          {state.message}
        </span>
      )}
      <span className="flex gap-1">
        <Button variant="primary" size="sm" onClick={() => void add()} disabled={state.status === "sending"}>
          {state.status === "sending" ? "Adding…" : "Add"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setState({ status: "idle" })} disabled={state.status === "sending"}>
          Cancel
        </Button>
      </span>
    </span>
  );
}

const STATUS_FILTERS: readonly { readonly value: CuratedKeywordStatus | "all"; readonly label: string }[] = [
  { value: "all", label: "Every status" },
  ...KEYWORD_STATUSES.map((status) => ({ value: status, label: STATUS_LABEL[status].label })),
];

/** The Lists tab: the project's curated keywords and the import form. */
export function CuratedKeywordsList({ projectId, load, onChanged }: { projectId: string; load: CuratedLoad; onChanged: () => void }) {
  const [status, setStatus] = useState<CuratedKeywordStatus | "all">("tracked");
  const rows = load.status === "loaded" ? load.keywords.filter((row) => status === "all" || row.keyword.status === status) : [];
  const counts = load.status === "loaded" ? Object.fromEntries(KEYWORD_STATUSES.map((s) => [s, load.keywords.filter((r) => r.keyword.status === s).length])) : {};

  return (
    <div className="space-y-4">
      <Panel aria-busy={load.status === "loading"}>
        <PanelHeader
          eyebrow="Operator list"
          title="Curated keywords"
          description="The exact queries this project tracks, as an operator recorded them. Figures are joined from the stored Search Console rows by exact query text; a curated keyword holds none of its own."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent" title="Recorded by an operator. Not fixture data.">
                Curated
              </Badge>
              <Select
                size="sm"
                aria-label="Filter by status"
                value={status}
                onChange={(event) => setStatus(event.target.value as CuratedKeywordStatus | "all")}
                options={STATUS_FILTERS.map((o) => ({ ...o, label: o.value === "all" || load.status !== "loaded" ? o.label : `${o.label} (${counts[o.value] ?? 0})` }))}
              />
            </div>
          }
        />
        <PanelBody>
          {load.status === "loading" && <Skeleton className="h-24 w-full" />}
          {load.status === "failed" && (
            <p className="text-sm text-fg-muted" role="status">
              {load.message}
            </p>
          )}
          {load.status === "unavailable" && (
            <EmptyState size="sm" icon="inbox" title="Curated keywords are not kept on this deployment" description="There is nowhere to record them here. Nothing is shown in their place." />
          )}
          {load.status === "loaded" && load.keywords.length === 0 && (
            <EmptyState size="sm" icon="star" title="No curated keyword yet" description="Track an observed query from the Keywords tab, or paste a list below. A query need not have been observed to be tracked." />
          )}
          {load.status === "loaded" && load.keywords.length > 0 && rows.length === 0 && (
            <p className="text-sm text-fg-subtle">No curated keyword has this status.</p>
          )}
          {rows.length > 0 && (
            <Table caption="Curated keywords">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Query</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Group</TableHeaderCell>
                  <TableHeaderCell>Target page</TableHeaderCell>
                  <TableHeaderCell>Stored Search Console rows</TableHeaderCell>
                  <TableHeaderCell>Added</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(({ keyword, observed }) => (
                  <TableRow key={keyword.id}>
                    <TableCell header className="max-w-[20rem] truncate">
                      <Link href={keywordDetailHref(keyword.id)} className="text-fg hover:text-accent hover:underline" title={keyword.query}>
                        {keyword.query}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_LABEL[keyword.status].tone}>{STATUS_LABEL[keyword.status].label}</Badge>
                    </TableCell>
                    <TableCell>{keyword.groupLabel ?? <span className="text-fg-subtle">—</span>}</TableCell>
                    <TableCell className="max-w-[16rem] truncate font-mono text-[11.5px]">{keyword.targetPage ?? <span className="font-sans text-fg-subtle">—</span>}</TableCell>
                    <TableCell>
                      <ObservedCell observed={observed} />
                    </TableCell>
                    <TableCell>{formatFullDate(keyword.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
        <PanelFooter>
          <span>A curated keyword holds no volume, difficulty, rank or traffic; archiving takes it off the list and keeps its history.</span>
        </PanelFooter>
      </Panel>

      {load.status !== "unavailable" && <ImportKeywords projectId={projectId} onAdded={onChanged} />}
    </div>
  );
}

/** Import: paste one query per line; each becomes one curated keyword, or is reported as already tracked. */
function ImportKeywords({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const ids = { list: useId(), group: useId() };
  const [text, setText] = useState("");
  const [group, setGroup] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" } | { status: "refused"; message: string } | { status: "done"; added: number; exists: number }>({ status: "idle" });
  const sending = useRef(false);

  const split = splitImport(text);
  const groupChecked = checkGroupLabel(group);
  const tooMany = split.queries.length > KEYWORD_IMPORT_LIMIT;
  const canSend = split.queries.length > 0 && !tooMany && groupChecked.ok && state.status !== "sending";

  const send = async () => {
    if (sending.current || !canSend) return;
    sending.current = true;
    setState({ status: "sending" });
    const result = await postAdd({ project: projectId, queries: split.queries, ...(groupChecked.ok && groupChecked.value ? { groupLabel: groupChecked.value } : {}) });
    sending.current = false;
    if (!result.ok) return setState({ status: "refused", message: result.message });
    setState({ status: "done", added: result.results.filter((r) => r.outcome === "added").length, exists: result.results.filter((r) => r.outcome === "exists").length });
    setText("");
    onAdded();
  };

  return (
    <Panel>
      <PanelHeader eyebrow="Import" title="Add curated keywords" description="Paste one query per line. Each line is added exactly as written (its surrounding spaces removed), as tracked. A query need not have been observed." />
      <PanelBody>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          aria-busy={state.status === "sending"}
        >
          <Field
            label="Queries"
            htmlFor={ids.list}
            hint={`${split.queries.length} ${split.queries.length === 1 ? "query" : "queries"} to add${split.rejected.length > 0 ? `; ${split.rejected.length} line${split.rejected.length === 1 ? "" : "s"} not valid (over 2,048 characters or with control characters)` : ""}. At most ${KEYWORD_IMPORT_LIMIT} at a time.`}
            error={tooMany ? `At most ${KEYWORD_IMPORT_LIMIT} queries at a time.` : undefined}
          >
            <TextArea id={ids.list} rows={5} value={text} onChange={(event) => setText(event.target.value)} placeholder={"seo agency london\ntechnical seo audit"} />
          </Field>
          <Field label="Group label (optional)" htmlFor={ids.group} error={groupChecked.ok ? undefined : `At most ${KEYWORD_GROUP_MAX_LENGTH} characters, no control characters.`}>
            <TextInput id={ids.group} size="sm" value={group} onChange={(event) => setGroup(event.target.value)} />
          </Field>
          {state.status === "refused" && (
            <p className="text-sm text-warning" role="status">
              <span className="font-medium">Nothing added.</span> {state.message}
            </p>
          )}
          {state.status === "done" && (
            <p className="text-sm text-fg-muted" role="status">
              {state.added} added; {state.exists} already tracked and left unchanged.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="sm" icon="upload" disabled={!canSend}>
              {state.status === "sending" ? "Adding…" : `Add ${split.queries.length || ""} ${split.queries.length === 1 ? "keyword" : "keywords"}`.replace("  ", " ")}
            </Button>
            <span className="text-xs text-fg-subtle">Records the list only. No figure is looked up and no agent is run.</span>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
