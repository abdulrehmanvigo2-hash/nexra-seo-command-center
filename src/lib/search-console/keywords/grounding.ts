import { MAX_QUERY_LENGTH } from "@/lib/search-console/grounding";
import { INTENT_PROVENANCE } from "@/lib/search-console/keywords/intent";
import type { KeywordIntelligenceInput, ObservedQuery } from "@/lib/search-console/keywords/inventory";
import {
  BAND_MAX_POSITION,
  BAND_MIN_IMPRESSIONS,
  BAND_MIN_POSITION,
  HUB_MIN_QUERIES,
  MAX_GROUPS,
  MAX_HUBS,
  MAX_QUERIES_PER_GROUP,
  OPPORTUNITY_LABEL_META,
  OPPORTUNITY_MAX_CTR,
  OPPORTUNITY_MAX_POSITION,
  OPPORTUNITY_MIN_IMPRESSIONS,
  WEAK_LEAD_MAX_SHARE,
} from "@/lib/search-console/keywords/thresholds";
import { QUERY_PAGE_ROW_LIMIT } from "@/lib/search-console/query-pages/contract";
import { SNAPSHOT_MAX_ROWS } from "@/lib/search-console/snapshots/contract";
import type { JsonObject } from "@/types/agent-run";

/**
 * The observed query inventory, serialised for the Keyword & Search Intent
 * agent (milestone M4).
 *
 * Appended AFTER the live Search Console report, the stored history and the
 * query × page block, never in their place, and only when an inventory
 * exists: a deployment that keeps no snapshots, a project with none, or a
 * read that failed adds no block at all (the summary names the state). The
 * block is arithmetic over stored rows and the labels of `thresholds.ts`,
 * with the intent hints and lexical groups named as derived labels the
 * agent may accept, refine or reject in its own inference — never as
 * observations. Opportunity labels are candidates for review. Search
 * Console's limits are stated inside the block.
 *
 * Bounded: at most MAX_GROUNDING_QUERIES rows, MAX_GROUPS groups of
 * MAX_QUERIES_PER_GROUP queries, MAX_HUBS hubs, keys cut as the live block
 * cuts them, and the whole block under MAX_KEYWORD_BYTES with a truncation
 * note when a section is dropped.
 */

export type KeywordGroundingStatus = "available" | "no-snapshots" | "no-history-for-property" | "no-queries" | "not-kept" | "read-failed";

export type SearchConsoleKeywordGrounding = {
  /** Null when there is no inventory: nothing is appended. */
  readonly text: string | null;
  readonly summary: JsonObject & {
    readonly keywords: KeywordGroundingStatus;
    readonly latestEndDate: string | null;
    readonly pairsEndDate: string | null;
    readonly queries: number;
    readonly shownQueries: number;
    readonly groups: number;
    readonly hubs: number;
    readonly opportunities: number;
    readonly truncated: boolean;
    readonly bytes: number;
  };
};

export const MAX_KEYWORD_BYTES = 8_000;
export const MAX_GROUNDING_QUERIES = 25;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

export const KEYWORD_LIMITS_NOTE = [
  "LIMITS OF THIS OBSERVED QUERY INVENTORY",
  `- The inventory is derived from stored rows: each snapshot's top ${SNAPSHOT_MAX_ROWS} queries by clicks and the latest window's top ${QUERY_PAGE_ROW_LIMIT} query × page pairs. Anonymised queries are absent and the sets are cut by clicks, so this is never the property's whole demand; a query absent here is unobserved, not absent, and the inventory must not be totalled as if it were demand.`,
  `- An intent hint is a ${INTENT_PROVENANCE}. Treat it as a suggestion to confirm or overturn in your own INFERENCE, never as OBSERVED. A lexical group shares a word, not necessarily a topic.`,
  `- Opportunity labels are fixed arithmetic rules naming candidates for a person's review, never predicted wins: low CTR (at least ${OPPORTUNITY_MIN_IMPRESSIONS} impressions, CTR at most ${(OPPORTUNITY_MAX_CTR * 100).toFixed(0)}%, position within ${OPPORTUNITY_MAX_POSITION}), position band (${BAND_MIN_POSITION} to ${BAND_MAX_POSITION}, at least ${BAND_MIN_IMPRESSIONS} impressions), no strong landing page (leading page under ${(WEAK_LEAD_MAX_SHARE * 100).toFixed(0)}% of the query's impressions across two or more pages), and the cannibalization candidate rule of the query × page block. None confirms cannibalisation, predicts a movement or says why Google chose a page.`,
  `- "Single page observed" means one page in the stored pairs, not that Google shows the query nowhere else; no page owns a query. A page hub is a page under at least ${HUB_MIN_QUERIES} observed queries, not a page that owns them.`,
  "- Average position is Search Console's impression-weighted average, not a rank tracker reading. There is no search volume, keyword difficulty, cost per click, SERP feature, indexation or competitor data here; Search Console does not measure them, so do not estimate them.",
].join("\n");

const HEADING = "OBSERVED QUERY INVENTORY (derived by fixed rules from Search Console rows this product stored; the live report above is the current evidence)";
const TRUNCATION_NOTE = "(further inventory sections were cut to keep this evidence within its size bound)";

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
const share = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

function quoteKey(key: string): string {
  const characters = Array.from(key.replace(/\s+/g, " ").trim());
  const text = characters.length > MAX_QUERY_LENGTH ? `${characters.slice(0, MAX_QUERY_LENGTH).join("")}…` : characters.join("");
  return JSON.stringify(text);
}

const count = (shown: number, total: number) => (shown < total ? `${shown} of ${total}` : `${total}`);

function rowLine(row: ObservedQuery): string {
  const figures = row.latest
    ? `clicks ${row.latest.clicks}, impressions ${row.latest.impressions}, CTR ${percent(row.latest.ctr)}, average position ${row.latest.impressions > 0 ? row.latest.position.toFixed(1) : "not established (no impressions)"} (${row.latestSource === "snapshot" ? "latest snapshot row" : "sum of its stored pairs"})`
    : "no figures for the latest window (listed in an earlier snapshot only)";
  const mapping =
    row.mapping.state === "no-pairs"
      ? "no stored pair"
      : row.mapping.state === "single-page"
        ? `single page observed ${quoteKey(row.mapping.leadingPage)}`
        : `${row.mapping.candidate ? "CANNIBALIZATION CANDIDATE FOR REVIEW" : "potential query overlap"} on ${row.mapping.pages.length} pages, leading page ${quoteKey(row.mapping.leadingPage)} with ${share(row.mapping.leadingShare)}`;
  const labels = row.opportunities.filter((label) => label !== "cannibalization-candidate").map((label) => OPPORTUNITY_LABEL_META[label].label.toLowerCase());
  return `- ${quoteKey(row.query)} — ${figures}; seen in ${row.windows} stored window(s)${row.inLatestTop ? ", in the latest top rows" : ""}; intent hint ${row.intent}${row.intentMarker ? ` (word ${quoteKey(row.intentMarker)})` : ""}; group ${row.group ? quoteKey(row.group) : "none"}; ${mapping}${labels.length ? `; candidate: ${labels.join(", ")}` : ""}`;
}

export function formatKeywordGrounding(input: KeywordIntelligenceInput): SearchConsoleKeywordGrounding {
  const base = { latestEndDate: null as string | null, pairsEndDate: null as string | null, queries: 0, shownQueries: 0, groups: 0, hubs: 0, opportunities: 0, truncated: false, bytes: 0 };
  if (!input.available) return { text: null, summary: { ...base, keywords: input.reason } };

  const shownRows = input.rows.slice(0, MAX_GROUNDING_QUERIES);
  const opportunities = input.rows.filter((row) => row.opportunities.length > 0).length;
  const c = input.counts;

  const header = [
    HEADING,
    `Property: ${input.property}. Latest stored snapshot window ends ${input.latestEndDate} (${input.latestState}); ${input.snapshotsUsed} stored snapshot(s) listed queries. ${input.pairsEndDate ? `Latest stored pair window ends ${input.pairsEndDate}.` : "No stored query × page pairs for this property yet."}${input.otherProperty ? ` ${input.otherProperty} snapshot(s) under another property set aside.` : ""}`,
    `Observed queries: ${c.queries} (${c.inLatestTop} in the latest top rows, ${c.withPairs} with stored pairs). Intent hints: ${Object.entries(c.byIntent).filter(([, n]) => n > 0).map(([intent, n]) => `${intent} ${n}`).join(", ") || "none"}. Opportunity candidates: ${Object.entries(c.byOpportunity).filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`).join(", ") || "none"}. Overlaps ${c.overlaps}, cannibalization candidates ${c.candidates}. Lexical groups: ${input.groups.length} (${c.grouped} queries grouped, ${c.ungrouped} ungrouped).`,
  ].join("\n");

  const rowsSection = [`QUERIES (${count(shownRows.length, c.queries)}, by the latest window's impressions)`, ...shownRows.map(rowLine)].join("\n");

  const groupsSection =
    input.groups.length === 0
      ? "LEXICAL GROUPS: none — no word is shared by two or more observed queries."
      : [
          `LEXICAL GROUPS (${count(Math.min(input.groups.length, MAX_GROUPS), input.groups.length)}, by query count; a shared word, not a topic)`,
          ...input.groups.slice(0, MAX_GROUPS).map((group) => `- ${quoteKey(group.term)} — ${group.queryCount} queries: ${group.queries.slice(0, MAX_QUERIES_PER_GROUP).map(quoteKey).join(", ")}${group.queryCount > MAX_QUERIES_PER_GROUP ? ` (+${group.queryCount - MAX_QUERIES_PER_GROUP} more)` : ""}`),
        ].join("\n");

  const hubsSection =
    input.hubs.length === 0
      ? `PAGE HUBS: none — no page appears under ${HUB_MIN_QUERIES} or more observed queries in the stored pairs.`
      : [
          `PAGE HUBS (${count(Math.min(input.hubs.length, MAX_HUBS), input.hubs.length)}; pages under many observed queries, not pages that own them)`,
          ...input.hubs.slice(0, MAX_HUBS).map((hub) => `- ${quoteKey(hub.page)} — ${hub.queries} observed queries, ${hub.impressions} impressions, ${hub.clicks} clicks across them`),
        ].join("\n");

  const ordered = [header, rowsSection, groupsSection, hubsSection];
  const reserved = byteLength(`\n\n${KEYWORD_LIMITS_NOTE}`) + byteLength(`\n\n${TRUNCATION_NOTE}`);
  const kept: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const section of ordered) {
    const cost = byteLength(section) + (kept.length ? 2 : 0);
    if (bytes + cost + reserved > MAX_KEYWORD_BYTES) {
      truncated = true;
      break;
    }
    kept.push(section);
    bytes += cost;
  }
  if (truncated) kept.push(TRUNCATION_NOTE);
  kept.push(KEYWORD_LIMITS_NOTE);
  const text = kept.join("\n\n");

  return {
    text,
    summary: {
      ...base,
      keywords: "available",
      latestEndDate: input.latestEndDate,
      pairsEndDate: input.pairsEndDate,
      queries: c.queries,
      shownQueries: shownRows.length,
      groups: input.groups.length,
      hubs: input.hubs.length,
      opportunities,
      truncated,
      bytes: byteLength(text),
    },
  };
}
