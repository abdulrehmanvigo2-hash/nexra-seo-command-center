import { LOW_CONFIDENCE_GAP_DAYS, MIN_GAP_DAYS } from "@/lib/search-console/history/thresholds";
import { MAX_QUERY_LENGTH } from "@/lib/search-console/grounding";
import type { QueryOverlap } from "@/lib/search-console/query-pages/analyse";
import { QUERY_PAGE_ROW_LIMIT } from "@/lib/search-console/query-pages/contract";
import type { QueryPageInput } from "@/lib/search-console/query-pages/intelligence";
import {
  CANDIDATE_MAX_POSITION_GAP,
  CANDIDATE_MIN_IMPRESSIONS,
  CANDIDATE_MIN_PAGES,
  CHANGE_MIN_IMPRESSIONS,
  MAX_OVERLAPS,
  MAX_PAGES_PER_OVERLAP,
} from "@/lib/search-console/query-pages/thresholds";
import type { JsonObject } from "@/types/agent-run";

/**
 * Stored query × page evidence, serialised for an agent (M1 P4c).
 *
 * Appended AFTER the live Search Console report and the stored snapshot
 * history, never in their place, and only when observed pair evidence
 * exists: a deployment that keeps no pairs, a project with none, or a read
 * that failed adds no block at all (the summary names the state). The block
 * is arithmetic over stored pairs and the labels of `thresholds.ts`, named
 * as observations: "potential query overlap" and "cannibalization candidate
 * for review", never a confirmed cannibalisation, a ranking, a search
 * volume, a difficulty, a SERP feature, an indexation state, a cause or a
 * page that "owns" a query. Search Console's own limits are stated at every
 * turn: anonymised queries are absent and the set is a capped cut by
 * clicks, so an overlap absent from it is unknown, not disproved.
 *
 * Bounded: at most MAX_OVERLAPS overlaps, MAX_PAGES_PER_OVERLAP pages each,
 * keys cut as the live block cuts them, and the whole block under
 * MAX_QUERY_PAGE_BYTES with a truncation note when a section is dropped.
 * Both audiences get the same evidence: the pairs are the joined data by
 * design, and the block says so.
 */

export type QueryPageAudience = "keyword" | "analytics";

export type QueryPageStatus = "available" | "no-pairs" | "no-pairs-for-property" | "not-kept" | "read-failed";

export type SearchConsoleQueryPageGrounding = {
  /** Null when there is no observed pair evidence: nothing is appended. */
  readonly text: string | null;
  readonly summary: JsonObject & {
    readonly queryPages: QueryPageStatus;
    readonly audience: QueryPageAudience;
    readonly latestEndDate: string | null;
    readonly previousEndDate: string | null;
    readonly pairs: number;
    readonly overlaps: number;
    readonly candidates: number;
    readonly shownOverlaps: number;
    readonly truncated: boolean;
    readonly bytes: number;
  };
};

export const MAX_QUERY_PAGE_BYTES = 12_000;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

export const QUERY_PAGE_LIMITS_NOTE = [
  "LIMITS OF THIS QUERY × PAGE EVIDENCE",
  `- The pairs are Google's top ${QUERY_PAGE_ROW_LIMIT} query × page rows by clicks for the window, and Search Console leaves anonymised queries out of them. The set is incomplete by design: a query on one page here may be shown on others Google did not return, and a query absent here is unobserved, not absent.`,
  `- "Potential query overlap" means one query was reported on two or more of the site's pages in the set. "Cannibalization candidate for review" means at least ${CANDIDATE_MIN_PAGES} of those pages each had at least ${CANDIDATE_MIN_IMPRESSIONS} impressions for the query with average positions within ${CANDIDATE_MAX_POSITION_GAP} places of each other. Both are fixed arithmetic labels for a person to review; neither is a confirmed cannibalisation, and neither says the pages compete, that one displaces the other, or why Google chose either.`,
  '- "Leading page" is the page with the most impressions for the query in the set. It does not mean that page owns that query; no page owns a query.',
  "- Average position is Search Console's impression-weighted average for that query on that page, not a rank tracker reading and not a complete ranking. There is no search volume, keyword difficulty, SERP feature, indexation or competitor data here; Search Console does not measure them, so do not estimate them.",
  `- Change between two stored windows is arithmetic over two observed cuts, not a trend and not a cause. A change in impressions is named only at ${CHANGE_MIN_IMPRESSIONS} or more.`,
].join("\n");

const HEADING = "STORED SEARCH CONSOLE QUERY × PAGE EVIDENCE (pairs this product recorded from Google Search Console; the live report above is the current evidence)";
const TRUNCATION_NOTE = "(further query × page sections were cut to keep this evidence within its size bound)";

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
const share = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const signed = (value: number, decimals = 0) => `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;

/** A query or a page URL, quoted so it cannot read as prose, cut as the live block cuts it. */
function quoteKey(key: string): string {
  const characters = Array.from(key.replace(/\s+/g, " ").trim());
  const text = characters.length > MAX_QUERY_LENGTH ? `${characters.slice(0, MAX_QUERY_LENGTH).join("")}…` : characters.join("");
  return JSON.stringify(text);
}

const count = (shown: number, total: number) => (shown < total ? `${shown} of ${total}` : `${total}`);

function overlapLines(overlap: QueryOverlap): string[] {
  const pages = overlap.pages.slice(0, MAX_PAGES_PER_OVERLAP);
  const label = overlap.candidate
    ? `CANNIBALIZATION CANDIDATE FOR REVIEW (${overlap.meaningfulPages} pages with at least ${CANDIDATE_MIN_IMPRESSIONS} impressions, positions ${overlap.positionGap?.toFixed(1)} places apart)`
    : "potential query overlap";
  return [
    `- Query ${quoteKey(overlap.query)} on ${overlap.pageCount} pages — ${label}; impressions ${overlap.impressions}, clicks ${overlap.clicks}; leading page ${quoteKey(overlap.leadingPage)} with ${share(overlap.leadingShare)} of the query's impressions${pages.length < overlap.pageCount ? `; ${pages.length} of ${overlap.pageCount} pages shown` : ""}`,
    ...pages.map(
      (page) => `    · ${quoteKey(page.page)} — impressions ${page.impressions} (${share(page.share)}), clicks ${page.clicks}, CTR ${percent(page.ctr)}, average position ${page.position.toFixed(1)}`,
    ),
  ];
}

export function formatQueryPageGrounding(input: QueryPageInput, audience: QueryPageAudience): SearchConsoleQueryPageGrounding {
  const base = { audience, previousEndDate: null as string | null, shownOverlaps: 0, truncated: false };

  if (!input.available) {
    return { text: null, summary: { ...base, queryPages: input.reason, latestEndDate: null, pairs: 0, overlaps: 0, candidates: 0, bytes: 0 } };
  }

  const { latest, previous, comparison } = input;
  const a = latest.analysis;
  const shownOverlaps = a.overlaps.slice(0, MAX_OVERLAPS);

  const header = [
    HEADING,
    `Property: ${input.property}. Stored window: ${input.rangeId} (30 days), ${latest.startDate} to ${latest.endDate}. ${a.pairs} query × page pairs over ${a.queries} queries and ${a.pages} pages (Google's top ${QUERY_PAGE_ROW_LIMIT} by clicks, anonymised queries absent).${input.otherProperty ? ` ${input.otherProperty} window(s) under another property set aside.` : ""}`,
    `Observed: ${a.overlapCount} potential query overlap(s), of which ${a.candidateCount} cannibalization candidate(s) for review. Both are labels for a person to review, not findings.`,
  ].join("\n");

  const overlapsSection =
    a.overlapCount === 0
      ? "POTENTIAL QUERY OVERLAPS: none in the stored set. No query was reported on two of the site's pages among these pairs; overlaps outside the set are unobserved, not ruled out."
      : [`POTENTIAL QUERY OVERLAPS (${count(shownOverlaps.length, a.overlapCount)}, by the query's impressions across its pages; candidates marked)`, ...shownOverlaps.flatMap(overlapLines)].join("\n");

  const concentrationSection =
    a.concentration.length === 0
      ? "PAGE CONCENTRATION: none — no overlapping query, so no page leads one."
      : [
          `PAGE CONCENTRATION (pages leading the most overlapping queries, at most ${a.concentration.length})`,
          ...a.concentration.map((c) => `- ${quoteKey(c.page)} — leads ${c.overlapsLed} of the ${c.overlaps} overlapping queries it appears under; ${c.impressions} impressions across them`),
        ].join("\n");

  let changeSection: string;
  if (!previous || !comparison) {
    changeSection = `CHANGE BETWEEN STORED WINDOWS: not established. ${input.windows} stored window(s) for this property; a comparison needs an earlier one ending at least ${MIN_GAP_DAYS} days before ${latest.endDate}.`;
  } else {
    const list = <T,>(title: string, rows: readonly T[], line: (row: T) => string) =>
      [`${title} (${count(Math.min(rows.length, MAX_OVERLAPS), rows.length)})`, ...(rows.length ? rows.slice(0, MAX_OVERLAPS).map(line) : ["- none"])].join("\n");
    changeSection = [
      `CHANGE BETWEEN STORED WINDOWS: previous window ended ${previous.endDate}, ${comparison.gapDays} days before the latest; ${comparison.matched} overlapping quer${comparison.matched === 1 ? "y" : "ies"} in both. Confidence: ${comparison.confidence === "low" ? `low — the two windows end only ${comparison.gapDays} days apart (under ${LOW_CONFIDENCE_GAP_DAYS}) and overlap` : "normal"}.`,
      list("OVERLAPS THAT APPEARED in the latest window (overlapping now, not before)", comparison.appeared, (r) => `- ${quoteKey(r.query)} — ${r.pageCount} pages, ${r.impressions} impressions, leading page ${quoteKey(r.leadingPage)}`),
      list("OVERLAPS THAT DISAPPEARED (overlapping before, not now — unobserved now, not proven resolved)", comparison.disappeared, (r) => `- ${quoteKey(r.query)} — was on ${r.pageCount} pages with ${r.impressions} impressions, leading page ${quoteKey(r.leadingPage)}`),
      list("LEADING PAGE CHANGED", comparison.leaderChanged, (r) => `- ${quoteKey(r.query)} — ${quoteKey(r.previousLeadingPage)} → ${quoteKey(r.latestLeadingPage)}; impressions ${r.previousImpressions} → ${r.latestImpressions}`),
      list(`IMPRESSIONS CHANGED for an overlapping query (by at least ${CHANGE_MIN_IMPRESSIONS})`, comparison.impressionsChanged, (r) => `- ${quoteKey(r.query)} — ${r.previousImpressions} → ${r.latestImpressions} (${signed(r.absolute)}${r.percent === null ? "" : `; ${signed(r.percent, 1)}%`})`),
    ].join("\n\n");
  }

  const ordered = [header, overlapsSection, concentrationSection, changeSection];
  const reserved = byteLength(`\n\n${QUERY_PAGE_LIMITS_NOTE}`) + byteLength(`\n\n${TRUNCATION_NOTE}`);
  const kept: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const section of ordered) {
    const cost = byteLength(section) + (kept.length ? 2 : 0);
    if (bytes + cost + reserved > MAX_QUERY_PAGE_BYTES) {
      truncated = true;
      break;
    }
    kept.push(section);
    bytes += cost;
  }
  if (truncated) kept.push(TRUNCATION_NOTE);
  kept.push(QUERY_PAGE_LIMITS_NOTE);
  const text = kept.join("\n\n");

  return {
    text,
    summary: {
      ...base,
      queryPages: "available",
      latestEndDate: latest.endDate,
      previousEndDate: previous?.endDate ?? null,
      pairs: a.pairs,
      overlaps: a.overlapCount,
      candidates: a.candidateCount,
      shownOverlaps: shownOverlaps.length,
      truncated,
      bytes: byteLength(text),
    },
  };
}
