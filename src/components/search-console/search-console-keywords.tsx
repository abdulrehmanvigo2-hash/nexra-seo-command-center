"use client";

import { useEffect, useId, useState } from "react";
import { RecordTaskControl } from "@/components/agent-tasks/record-task-control";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatFullDate, formatNumber, formatPercent } from "@/lib/format";
import { keywordTaskProposal } from "@/lib/agent-tasks/proposals";
import type { ProjectOption } from "@/lib/projects/selection";
import type { IntentHint } from "@/lib/search-console/keywords/intent";
import { OPPORTUNITY_LABELS, type OpportunityLabel } from "@/lib/search-console/keywords/thresholds";
import {
  INTENT_LABEL,
  OPPORTUNITY_LABEL,
  describeKeywordStatus,
  keywordsReadFailure,
  keywordsUrl,
  type KeywordInventoryView,
  type KeywordIntelligenceView,
  type ObservedQueryView,
} from "@/lib/search-console/keywords/view";

/**
 * The observed query inventory (milestone M4).
 *
 * Its own panel beneath the Search Console panel on the Keywords tab, kept
 * apart from the modelled keyword universe above both: a tracked keyword
 * in the fixture dataset and a query Google reported are different
 * records, and neither stands in for the other. It reads its own endpoint —
 * the project's stored snapshots and pairs, derived server-side by fixed
 * rules — with its own load, so a failed or empty read never changes the
 * live report. Every label carries its provenance: an observed figure is
 * Google's, an intent hint and a lexical group are derived from the query's
 * words, an opportunity is a candidate for review. Nothing here is a
 * control.
 */

type Load =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "loaded"; readonly view: KeywordIntelligenceView };

const date = (iso: string) => formatFullDate(`${iso}T00:00:00Z`);

const INTENT_TONE: Readonly<Record<IntentHint, "neutral" | "accent" | "positive" | "warning" | "critical">> = {
  informational: "accent",
  commercial: "positive",
  transactional: "warning",
  navigational: "neutral",
  local: "neutral",
  mixed: "neutral",
  unclassified: "neutral",
};

/** The option the selector shows until an operator names a stored project. */
const NO_PROJECT = "";

export function SearchConsoleKeywords({
  projects,
  initialProjectId,
}: {
  /** The stored roster. The panel reads only these projects' own stored rows. */
  projects: readonly ProjectOption[];
  /** The workspace's project filter when it names one project; null for "Every project". */
  initialProjectId: string | null;
}) {
  const selectId = useId();
  // The panel's own selection: seeded from the workspace filter when that
  // names a stored project, otherwise nothing is chosen and nothing is read.
  // The workspace filter sits behind the toolbar's advanced filters, so the
  // panel must be reachable without it; the selection here never changes
  // the modelled views above.
  const [projectId, setProjectId] = useState<string | null>(() =>
    initialProjectId !== null && projects.some((project) => project.id === initialProjectId) ? initialProjectId : null,
  );
  const [load, setLoad] = useState<Load>({ status: "idle" });

  useEffect(() => {
    if (projectId === null) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loading state belongs to this request
    setLoad({ status: "loading" });

    fetch(keywordsUrl(projectId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return setLoad({ status: "failed", message: keywordsReadFailure(response.status) });
        setLoad({ status: "loaded", view: (await response.json()) as KeywordIntelligenceView });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoad({ status: "failed", message: keywordsReadFailure(0) });
      });

    return () => controller.abort();
  }, [projectId]);

  const view = load.status === "loaded" && load.view.status === "inventory" ? load.view : null;

  return (
    <Panel aria-busy={load.status === "loading"}>
      <PanelHeader
        eyebrow="Stored Search Console rows"
        title="Observed query inventory"
        description="Queries Google reported in this product's stored snapshots and query × page pairs, with fixed-rule labels. Not the modelled keyword universe above: an observed query and a tracked keyword are different records."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" title="Derived by fixed rules from Search Console rows this product stored. Figures are Google's; intent hints, groups and opportunity labels are derived. Not fixture data.">
              Observed · derived labels
            </Badge>
            {projects.length > 0 && (
              <>
                <label htmlFor={selectId} className="text-xs text-fg-subtle">
                  Stored project
                </label>
                <Select
                  id={selectId}
                  size="sm"
                  value={projectId ?? NO_PROJECT}
                  onChange={(event) => {
                    const next = event.target.value;
                    setProjectId(next === NO_PROJECT ? null : next);
                    if (next === NO_PROJECT) setLoad({ status: "idle" });
                  }}
                  options={[
                    { value: NO_PROJECT, label: "Choose a project" },
                    ...projects.map((project) => ({ value: project.id, label: project.name })),
                  ]}
                />
              </>
            )}
          </div>
        }
      />

      <PanelBody>
        {projects.length === 0 && (
          <EmptyState
            size="sm"
            icon="projects"
            title="No stored project"
            description="Stored Search Console rows belong to stored projects. Add a project on the Projects screen."
          />
        )}

        {projects.length > 0 && projectId === null && (
          <EmptyState
            size="sm"
            icon="globe"
            title="Choose a single project"
            description="Stored snapshots and query × page pairs belong to one project and its Search Console property, so the inventory is shown for one stored project at a time."
          />
        )}

        {load.status === "loading" && (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full max-w-96" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {load.status === "failed" && (
          <p className="text-sm text-fg-muted" role="status">
            {load.message}
          </p>
        )}

        {load.status === "loaded" && load.view.status !== "inventory" && (
          <EmptyState size="sm" icon="search" title={describeKeywordStatus(load.view).title} description={describeKeywordStatus(load.view).description} />
        )}

        {view !== null && projectId !== null && <InventoryBody view={view} projectId={projectId} />}
      </PanelBody>

      {view !== null && (
        <PanelFooter>
          <span>{view.caveats[0]}</span>
        </PanelFooter>
      )}
    </Panel>
  );
}

function InventoryBody({ view, projectId }: { view: KeywordInventoryView; projectId: string }) {
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
          <span className="font-normal text-fg-subtle">· {view.counts.queries > view.rows.length ? `${view.rows.length} of ${view.counts.queries} shown (by the latest window's impressions)` : `${view.counts.queries}`}</span>
        </h5>
        <Table caption="Observed queries">
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
            </TableRow>
          </TableHead>
          <TableBody>
            {view.rows.map((row) => (
              <QueryRow key={row.query} row={row} projectId={projectId} />
            ))}
          </TableBody>
        </Table>
      </section>

      {view.groups.length > 0 && (
        <section className="space-y-1.5">
          <h5 className="text-xs font-medium text-fg">
            Lexical groups{" "}
            <span className="font-normal text-fg-subtle">· {view.counts.groups > view.groups.length ? `${view.groups.length} of ${view.counts.groups}` : `${view.counts.groups}`} · a shared word, not a topic · {view.counts.ungrouped} ungrouped</span>
          </h5>
          <ul className="space-y-1">
            {view.groups.map((group) => (
              <li key={group.term} className="text-[12.5px] text-fg-muted">
                <span className="font-medium text-fg">{group.term}</span> · {group.queryCount} queries: {group.queries.join(", ")}
                {group.queryCount > group.queries.length && ` (+${group.queryCount - group.queries.length} more)`}
              </li>
            ))}
          </ul>
        </section>
      )}

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

function QueryRow({ row, projectId }: { row: ObservedQueryView; projectId: string }) {
  const latest = row.latest;
  return (
    <TableRow>
      <TableCell header className="max-w-[20rem] truncate">
        <span title={row.query}>{row.query}</span>
        {row.inLatestTop && <span className="ml-1.5 text-[11px] font-normal text-fg-subtle">latest top rows</span>}
      </TableCell>
      <TableCell>
        <Badge tone={INTENT_TONE[row.intent]} title={row.intentMarker ? `Lexical hint from the word "${row.intentMarker}"; not an observation.` : "No word list matched; not a fifth intent."}>
          {INTENT_LABEL[row.intent]}
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
        {/* An operator may record this observed query as one persisted task. The exact stored query text is the source; recording runs nothing. */}
        <RecordTaskControl projectId={projectId} proposal={keywordTaskProposal(row.query)} compact />
      </TableCell>
    </TableRow>
  );
}
