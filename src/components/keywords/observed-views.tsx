"use client";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { StackedMeter, type MeterTone } from "@/components/ui/meter";
import { SearchConsoleHistory } from "@/components/search-console/search-console-history";
import { INTENT_TONE, ObservedQueryTable, type Curation } from "@/components/search-console/search-console-keywords";
import { SearchConsoleQueryPages } from "@/components/search-console/search-console-query-pages";
import { cn } from "@/lib/cn";
import {
  CANNIBALIZATION_NOTE,
  GROUP_NOTE,
  MOVEMENT_NOTE,
  POSITION_NOTE,
  type KeywordScreen,
  type PositionBucketId,
} from "@/lib/search-console/keywords/screen";
import { INTENT_LABEL, type KeywordInventoryView } from "@/lib/search-console/keywords/view";

/**
 * The Keyword Intelligence tabs over observed data (Phase 3, checkpoint
 * 3.4). Each is a reading of the stored Search Console rows the screen read,
 * or of the existing P4a/P4d and P4c sections with their own reads. No
 * volume, difficulty, cost per click, SERP feature, predicted upside or
 * target CTR appears anywhere: the product holds nothing to back them.
 */

const BUCKET_TONE: Readonly<Record<PositionBucketId, MeterTone>> = {
  "top-3": "positive",
  "4-10": "accent",
  "11-20": "neutral",
  "21-50": "warning",
  "over-50": "critical",
  none: "neutral",
};

const BUCKET_DOT: Readonly<Record<PositionBucketId, string>> = {
  "top-3": "bg-positive",
  "4-10": "bg-accent",
  "11-20": "bg-fg-subtle",
  "21-50": "bg-warning",
  "over-50": "bg-critical",
  none: "bg-border",
};

/** Where the observed queries sit by Search Console's average position, and their intent hints. */
export function ObservedPortfolio({ screen }: { screen: KeywordScreen }) {
  const { buckets, intents, over, observed } = screen.portfolio;
  const describing = over === observed ? `Describing all ${observed} observed queries.` : `Describing the ${over} shown rows of ${observed} observed queries.`;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel>
        <PanelHeader eyebrow="Distribution" title="Where the observed queries sit" description={`${POSITION_NOTE}: each query's impression-weighted average in the latest stored window.`} />
        <PanelBody>
          {over === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-fg-subtle">No observed query in the current selection.</p>
          ) : (
            <>
              <StackedMeter label="Observed queries by Search Console average position" segments={buckets.map((b) => ({ id: b.id, value: b.count, tone: BUCKET_TONE[b.id] }))} />
              <ul className="mt-3.5 grid gap-2 sm:grid-cols-2">
                {buckets.map((bucket) => (
                  <li key={bucket.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", BUCKET_DOT[bucket.id])} />
                      <span className="truncate text-[12px] text-fg-muted">{bucket.id === "none" ? bucket.label : `Avg. position ${bucket.label}`}</span>
                    </span>
                    <span className="tabular text-[13px] font-semibold text-fg">{bucket.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </PanelBody>
        <PanelFooter>
          <span>{describing} Average position is not a rank tracker&apos;s reading.</span>
        </PanelFooter>
      </Panel>

      <Panel>
        <PanelHeader eyebrow="Intent hints" title="What the queries' words suggest" description="A lexical hint from each query's own words, never an observation of why anyone searched." />
        <PanelBody>
          {intents.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-fg-subtle">No observed query in the current selection.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {intents.map(({ intent, count }) => (
                <li key={intent}>
                  <Badge tone={INTENT_TONE[intent]} title="A lexical hint derived from the query's words; not an observation.">
                    {INTENT_LABEL[intent]} hint · {count}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
        <PanelFooter>
          <span>{describing} Hints are derived labels for review.</span>
        </PanelFooter>
      </Panel>
    </div>
  );
}

/** Lexical groups, inline (decision Q2: no cluster detail route). */
export function ObservedGroups({ view }: { view: KeywordInventoryView }) {
  return (
    <Panel>
      <PanelHeader
        eyebrow="Derived from the stored rows"
        title="Lexical groups"
        description={`Observed queries filed under their most frequent shared word: ${GROUP_NOTE}.`}
        actions={<Badge tone="accent">Observed · derived labels</Badge>}
      />
      <PanelBody>
        {view.groups.length === 0 ? (
          <EmptyState size="sm" icon="layers" title="No lexical group" description="No word is shared by two or more observed queries. A group needs at least two; nothing is inferred in its place." />
        ) : (
          <ul className="space-y-2">
            {view.groups.map((group) => (
              <li key={group.term} className="rounded-md border border-border bg-surface-raised px-3 py-2.5">
                <p className="text-[12.5px] font-medium text-fg">
                  {group.term} <span className="font-normal text-fg-subtle">· {group.queryCount} observed {group.queryCount === 1 ? "query" : "queries"}</span>
                </p>
                <p className="mt-1 text-[12px] text-fg-muted">
                  {group.queries.join(", ")}
                  {group.queryCount > group.queries.length && ` (+${group.queryCount - group.queries.length} more)`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
      <PanelFooter>
        <span>
          {view.counts.groups > view.groups.length ? `${view.groups.length} of ${view.counts.groups} groups shown` : `${view.counts.groups} group${view.counts.groups === 1 ? "" : "s"}`} · {view.counts.grouped} grouped, {view.counts.ungrouped} ungrouped queries
        </span>
        <span>A group is {GROUP_NOTE}.</span>
      </PanelFooter>
    </Panel>
  );
}

/** The four M4 rule labels, each with the rows it names. Candidates for review, never predicted gains. */
export function ObservedOpportunities({ screen, projectId, curation }: { screen: KeywordScreen; projectId: string; curation: Curation | null }) {
  return (
    <div className="space-y-4">
      {screen.opportunities.map((group) => (
        <Panel key={group.label}>
          <PanelHeader eyebrow="Fixed rule" title={group.title} description={group.description} actions={<Badge tone="warning">{group.rows.length} candidate{group.rows.length === 1 ? "" : "s"}</Badge>} />
          <PanelBody>
            {group.rows.length === 0 ? (
              <p className="text-[12.5px] text-fg-subtle">No shown query meets this rule in the stored rows.</p>
            ) : (
              <ObservedQueryTable rows={group.rows} projectId={projectId} caption={group.title} curation={curation} />
            )}
          </PanelBody>
        </Panel>
      ))}
      <p className="text-xs text-fg-subtle">Labels name candidates for a person&apos;s review. No upside, target CTR or forecast is computed: the stored rows cannot support one.</p>
    </div>
  );
}

/** P4a/P4d: the change between the project's two newest comparable stored windows. */
export function ObservedMovement({ projectId }: { projectId: string }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Stored history" title="Movement between stored windows" description={`${MOVEMENT_NOTE} Two 30-day windows this product stored from Search Console, compared by fixed rules.`} />
      <SearchConsoleHistory projectId={projectId} view="queries" />
    </Panel>
  );
}

/** P4c: query × page overlap in the stored pairs. */
export function ObservedCannibalization({ projectId }: { projectId: string }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Stored query × page pairs" title="Query-to-page overlap" description={CANNIBALIZATION_NOTE} />
      <SearchConsoleQueryPages projectId={projectId} />
    </Panel>
  );
}
