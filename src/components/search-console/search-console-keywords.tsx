"use client";

import { RecordTaskControl } from "@/components/agent-tasks/record-task-control";
import { CurateKeywordControl } from "@/components/keywords/curated-keywords";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatFullDate, formatNumber, formatPercent } from "@/lib/format";
import { keywordTaskProposal } from "@/lib/agent-tasks/proposals";
import type { IntentHint } from "@/lib/search-console/keywords/intent";
import { OPPORTUNITY_LABELS, type OpportunityLabel } from "@/lib/search-console/keywords/thresholds";
import {
  INTENT_LABEL,
  OPPORTUNITY_LABEL,
  type KeywordInventoryView,
  type ObservedQueryView,
} from "@/lib/search-console/keywords/view";

/**
 * The observed query inventory (milestone M4), the primary table of the
 * Keyword Intelligence screen since checkpoint 3.4.
 *
 * The screen owns the read (`GET /api/search-console/keywords`), the
 * stored-project selector and the filters, and hands this section the
 * inventory and the rows its filters keep; the lexical groups render on the
 * Groups tab. Every label carries its provenance: an observed figure is
 * Google's, an intent hint is derived from the query's words, an opportunity
 * is a candidate for review. The one control is *Record as task* on each
 * row, which names the exact stored query (Q7: the display cut never
 * reaches the task source).
 */

const date = (iso: string) => formatFullDate(`${iso}T00:00:00Z`);

export const INTENT_TONE: Readonly<Record<IntentHint, "neutral" | "accent" | "positive" | "warning" | "critical">> = {
  informational: "accent",
  commercial: "positive",
  transactional: "warning",
  navigational: "neutral",
  local: "neutral",
  mixed: "neutral",
  unclassified: "neutral",
};

/** The curated keywords of the project, by exact query, and how to record a new one (checkpoint 3.5). */
export type Curation = { readonly ids: ReadonlyMap<string, string>; readonly onAdded: (query: string, keywordId: string) => void };

export function SearchConsoleKeywords({
  projectId,
  view,
  rows,
  filtered,
  curation,
}: {
  /** The stored project the screen chose. */
  projectId: string;
  view: KeywordInventoryView;
  /** The inventory rows the screen's filters keep, in the inventory's order. */
  rows: readonly ObservedQueryView[];
  /** Whether the screen's filters narrow the rows. */
  filtered: boolean;
  /** Null when curated keywords are not kept on this deployment. */
  curation: Curation | null;
}) {
  return (
    <Panel>
      <PanelHeader
        eyebrow="Stored Search Console rows"
        title="Observed query inventory"
        description="Queries Google reported in this product's stored snapshots and query × page pairs, with fixed-rule labels. Figures are Google's; intent hints and opportunity labels are derived."
        actions={
          <Badge tone="accent" title="Derived by fixed rules from Search Console rows this product stored. Figures are Google's; intent hints, groups and opportunity labels are derived. Not fixture data.">
            Observed · derived labels
          </Badge>
        }
      />
      <PanelBody>
        <InventoryBody view={view} rows={rows} filtered={filtered} projectId={projectId} curation={curation} />
      </PanelBody>
      <PanelFooter>
        <span>{view.caveats[0]}</span>
      </PanelFooter>
    </Panel>
  );
}

function InventoryBody({ view, rows, filtered, projectId, curation }: { view: KeywordInventoryView; rows: readonly ObservedQueryView[]; filtered: boolean; projectId: string; curation: Curation | null }) {
  const opportunityTotal = OPPORTUNITY_LABELS.reduce((sum, label) => sum + view.counts.byOpportunity[label], 0);
  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-subtle">
        Latest stored snapshot window ends {date(view.latestEndDate)}
        {view.latestState === "no-data" ? " (no impressions reported)" : ""}; {view.snapshotsUsed} snapshot{view.snapshotsUsed === 1 ? "" : "s"} listed queries.{" "}
        {view.pairsEndDate ? `Latest stored pair window ends ${date(view.pairsEndDate)}.` : "No stored query × page pairs yet."}
        {view.underOtherProperty && " Snapshots recorded under a previous property are set aside."}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" title="Distinct queries observed in the stored rows">
          {formatNumber(view.counts.queries)} observed
        </Badge>
        <Badge tone="neutral" title="In the latest snapshot's top rows">
          {formatNumber(view.counts.inLatestTop)} in latest top rows
        </Badge>
        <Badge tone="neutral" title="With at least one stored query × page pair">
          {formatNumber(view.counts.withPairs)} with pairs
        </Badge>
        <Badge tone="warning" title="Fixed-rule candidates for review, never predicted wins">
          {formatNumber(opportunityTotal)} opportunity label{opportunityTotal === 1 ? "" : "s"}
        </Badge>
        <Badge tone="neutral" title="P4c: one query on two or more pages; candidates by the P4c rule">
          {view.counts.overlaps} overlap{view.counts.overlaps === 1 ? "" : "s"} · {view.counts.candidates} candidate{view.counts.candidates === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-fg-subtle">Intent hints (lexical, derived):</span>
        {(Object.entries(view.counts.byIntent) as [IntentHint, number][])
          .filter(([, count]) => count > 0)
          .map(([intent, count]) => (
            <Badge key={intent} tone={INTENT_TONE[intent]} title="A lexical hint from the query's own words; not an observation of why anyone searched.">
              {INTENT_LABEL[intent]} {count}
            </Badge>
          ))}
      </div>

      <section className="space-y-1.5">
        <h5 className="text-xs font-medium text-fg">
          Observed queries{" "}
          <span className="font-normal text-fg-subtle">
            ·{" "}
            {filtered
              ? `${rows.length} of ${view.rows.length} shown rows match the filters`
              : view.counts.queries > view.rows.length
                ? `${view.rows.length} of ${view.counts.queries} shown (by the latest window's impressions)`
                : `${view.counts.queries}`}
          </span>
        </h5>
        {rows.length === 0 ? (
          <EmptyState size="sm" icon="search" title="No observed query matches these filters" description="The filters narrow the stored rows shown here; clearing them shows every observed query again." />
        ) : (
          <ObservedQueryTable rows={rows} projectId={projectId} caption="Observed queries" curation={curation} />
        )}
      </section>

      {view.hubs.length > 0 && (
        <section className="space-y-1.5">
          <h5 className="text-xs font-medium text-fg">Page hubs</h5>
          <p className="text-xs text-fg-subtle">Pages under many observed queries in the stored pairs; not pages that own them.</p>
          <Table caption="Page hubs">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Page</TableHeaderCell>
                <TableHeaderCell align="right">Observed queries</TableHeaderCell>
                <TableHeaderCell align="right">Impressions</TableHeaderCell>
                <TableHeaderCell align="right">Clicks</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.hubs.map((hub) => (
                <TableRow key={hub.page}>
                  <TableCell header className="max-w-[28rem] truncate">
                    {hub.page}
                  </TableCell>
                  <TableCell numeric>{hub.queries}</TableCell>
                  <TableCell numeric>{formatNumber(hub.impressions)}</TableCell>
                  <TableCell numeric>{formatNumber(hub.clicks)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <ul className="space-y-1 text-[11.5px] text-fg-subtle">
        {view.caveats.slice(1).map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </div>
  );
}

/** The observed-query table with a *Record as task* control per row; shared with the Opportunities tab. */
export function ObservedQueryTable({ rows, projectId, caption, curation }: { rows: readonly ObservedQueryView[]; projectId: string; caption: string; curation: Curation | null }) {
  return (
    <Table caption={caption}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Query</TableHeaderCell>
          <TableHeaderCell>Intent hint</TableHeaderCell>
          <TableHeaderCell>Group</TableHeaderCell>
          <TableHeaderCell align="right">Windows</TableHeaderCell>
          <TableHeaderCell align="right">Clicks</TableHeaderCell>
          <TableHeaderCell align="right">Impressions</TableHeaderCell>
          <TableHeaderCell align="right">CTR</TableHeaderCell>
          <TableHeaderCell align="right">Avg. position</TableHeaderCell>
          <TableHeaderCell>Pages in stored pairs</TableHeaderCell>
          <TableHeaderCell>Candidates</TableHeaderCell>
          <TableHeaderCell>Task</TableHeaderCell>
          {curation !== null && <TableHeaderCell>Curated</TableHeaderCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <QueryRow key={row.query} row={row} projectId={projectId} curation={curation} />
        ))}
      </TableBody>
    </Table>
  );
}

function QueryRow({ row, projectId, curation }: { row: ObservedQueryView; projectId: string; curation: Curation | null }) {
  const latest = row.latest;
  return (
    <TableRow>
      <TableCell header className="max-w-[20rem] truncate">
        <span title={row.queryLabel}>{row.queryLabel}</span>
        {row.inLatestTop && <span className="ml-1.5 text-[11px] font-normal text-fg-subtle">latest top rows</span>}
      </TableCell>
      <TableCell>
        <Badge tone={INTENT_TONE[row.intent]} title={row.intentMarker ? `Lexical hint from the word "${row.intentMarker}"; not an observation.` : "No word list matched; not a fifth intent."}>
          {INTENT_LABEL[row.intent]} <span className="font-normal opacity-70">hint</span>
        </Badge>
      </TableCell>
      <TableCell>{row.group ?? <span className="text-fg-subtle">—</span>}</TableCell>
      <TableCell numeric>{row.windows}</TableCell>
      <TableCell numeric>{latest ? formatNumber(latest.clicks) : "—"}</TableCell>
      <TableCell numeric>{latest ? formatNumber(latest.impressions) : "—"}</TableCell>
      <TableCell numeric>{latest ? formatPercent(latest.ctr * 100, 2) : "—"}</TableCell>
      <TableCell numeric>
        <span title={row.latestSource === "pairs" ? "Impression-weighted over its stored pairs" : latest ? "Search Console's impression-weighted average for the window" : undefined}>
          {latest && latest.impressions > 0 ? latest.position.toFixed(1) : "—"}
        </span>
        {row.latestSource === "pairs" && <span className="ml-1 text-[11px] text-fg-subtle">(pairs)</span>}
      </TableCell>
      <TableCell className="max-w-[20rem] truncate">
        {row.mapping.state === "no-pairs" && <span className="text-fg-subtle">no stored pair</span>}
        {row.mapping.state === "single-page" && (
          <span title="One page in the stored pairs; Google may show others the set did not return.">
            single page observed · <span className="font-mono text-[11.5px]">{row.mapping.leadingPage}</span>
          </span>
        )}
        {row.mapping.state === "overlap" && (
          <span title="P4c: the page shown most for the query in the stored pairs. No page owns a query.">
            {row.mapping.pageCount} pages · leading <span className="font-mono text-[11.5px]">{row.mapping.leadingPage}</span> ({formatPercent(row.mapping.leadingShare * 100, 1)})
          </span>
        )}
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap gap-1">
          {row.opportunities.length === 0 && <span className="text-fg-subtle">—</span>}
          {row.opportunities.map((label: OpportunityLabel) => (
            <Badge key={label} tone={label === "cannibalization-candidate" ? "warning" : "neutral"} title={OPPORTUNITY_LABEL[label].description}>
              {OPPORTUNITY_LABEL[label].label}
            </Badge>
          ))}
        </span>
      </TableCell>
      <TableCell className="min-w-[10rem]">
        {/* An operator may record this observed query as one persisted task. The exact, uncut stored query text is the source (Q7); recording runs nothing. */}
        <RecordTaskControl projectId={projectId} proposal={keywordTaskProposal(row.query)} compact />
      </TableCell>
      {curation !== null && (
        <TableCell className="min-w-[7rem]">
          {/* Checkpoint 3.5: add the exact stored query to the operator's curated list, or open it once curated. */}
          <CurateKeywordControl projectId={projectId} query={row.query} curatedId={curation.ids.get(row.query) ?? null} onAdded={curation.onAdded} />
        </TableCell>
      )}
    </TableRow>
  );
}
