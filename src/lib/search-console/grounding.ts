/**
 * One Search Console report, serialised as evidence an agent may reason over.
 *
 * The only path by which Search Console data reaches a language model, and
 * as narrow as the crawl's. What goes in is what Google reported for the
 * project's own property over one window: totals, the previous window where
 * Google still has it, and the top queries by clicks. What does not go in is
 * everything Search Console does not measure — search volume, difficulty,
 * which page answered which query, competitors, crawl health — and it says so
 * inside the evidence.
 *
 * Two rules from the crawl's grounding hold here too. A reading Google did
 * not give is written as "not established", never as zero; an absent
 * comparison window is a fact about retention, not a flat quarter. And the
 * query list is Google's top rows, not the property's whole demand, which the
 * evidence states beside the list rather than leaving to the reader.
 *
 * The queries are text typed by the public. They are quoted as JSON strings
 * and labelled as third-party data, and the executor's system prompt tells the
 * model to treat them as such. The task input carries no operator text: a
 * range id is all it takes, and the project is the run's own, never named by
 * a caller — so there is no way to ask for another client's property.
 */

import type { GroundingSource } from "@/lib/agent-runs/ai-executor";
import { RANGE_DAYS, isRangeId } from "@/lib/search-console/date-windows";
import type { RangeId } from "@/types/dashboard";
import type {
  SearchConsolePartial,
  SearchConsoleReport,
  SearchConsoleWindow,
  SearchPerformance,
  SearchPerformanceRow,
} from "@/types/search-console";

type ConnectedReport = Extract<SearchConsoleReport, { state: "connected" }>;

/** Reads one project's report for one range. Injected, so tests need no Google. */
export type SearchConsoleReportReader = (projectId: string, rangeId: RangeId) => Promise<SearchConsoleReport>;

export type SearchConsoleGrounding = {
  readonly text: string;
  readonly summary: {
    readonly source: "search-console";
    readonly property: string;
    readonly rangeId: RangeId;
    readonly startDate: string;
    readonly endDate: string;
    readonly days: number;
    /** Whether a previous window was available to compare against. */
    readonly comparison: boolean;
    readonly queriesIncluded: number;
    /** Served from cache after a failed refresh. */
    readonly stale: boolean;
    readonly partial: readonly SearchConsolePartial[];
    readonly bytes: number;
  };
  readonly source: GroundingSource;
};

export type SearchConsoleGroundingRefusal =
  /** The range in the task input is not one the product offers. */
  | "range-invalid"
  /** No credentials on the server, or no property mapped to this project. */
  | "search-console-not-connected"
  /** The service account cannot read the property. */
  | "search-console-access-denied"
  /** Google reported no impressions for the window: nothing to review. */
  | "search-console-no-data"
  /** Google could not be read; a later attempt may succeed. */
  | "search-console-unavailable"
  /** Connected, but the top queries were not returned or were empty. */
  | "queries-unavailable";

export type SearchConsoleGroundingResult =
  | { readonly ok: true; readonly grounding: SearchConsoleGrounding }
  | { readonly ok: false; readonly reason: SearchConsoleGroundingRefusal };

export const SEARCH_CONSOLE_SOURCE: GroundingSource = {
  label: "Search Console evidence",
  description: "what Google Search Console reported for this project's property over the stated window, read by this product",
  heading: "Evidence read by this product from Google Search Console",
  quotes: "the public — the search queries people typed into Google",
};

/**
 * How many query rows are ever described. The provider asks Google for its
 * top 25 by clicks, so this is a ceiling the report already sits under; it is
 * stated here so the evidence can say what it is bounded by.
 */
export const MAX_QUERIES_DESCRIBED = 25;

/**
 * A query is public text of any length. Longer ones are cut and marked. The
 * limit counts code points, not UTF-16 units, so a cut never splits a
 * character in two.
 */
export const MAX_QUERY_LENGTH = 200;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

const NOT_ESTABLISHED = "not established";

/**
 * Reads one project's report, or refuses.
 *
 * The project id is the run's own, handed in by the runtime; the range comes
 * from the validated task input. Every non-connected state is a refusal with
 * its own reason, made before anything is formatted, so a refusal never
 * carries a query back with it.
 */
export async function readSearchConsoleGrounding(
  reader: SearchConsoleReportReader,
  request: { readonly projectId: string; readonly rangeId: unknown },
): Promise<SearchConsoleGroundingResult> {
  if (!isRangeId(request.rangeId)) return { ok: false, reason: "range-invalid" };

  const report = await reader(request.projectId, request.rangeId);
  switch (report.state) {
    case "not-connected":
      return { ok: false, reason: "search-console-not-connected" };
    case "access-denied":
      return { ok: false, reason: "search-console-access-denied" };
    case "no-data":
      return { ok: false, reason: "search-console-no-data" };
    case "unavailable":
      return { ok: false, reason: "search-console-unavailable" };
    case "connected":
      break;
  }
  if (report.partial.includes("queries-unavailable") || report.queries.length === 0) {
    return { ok: false, reason: "queries-unavailable" };
  }
  return { ok: true, grounding: formatSearchConsoleGrounding(report) };
}

const windowText = (window: SearchConsoleWindow) =>
  `${window.startDate} to ${window.endDate} (${window.days} days)`;

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

/** Average position is 0 when there were no impressions; 0 is not a rank. */
const position = (performance: SearchPerformance) =>
  performance.impressions === 0 ? `${NOT_ESTABLISHED} (no impressions)` : performance.position.toFixed(1);

function change(current: number, previous: number | null, unit: "percent" | "places"): string {
  if (previous === null) return "";
  if (unit === "places") {
    const delta = previous - current;
    return delta === 0 ? "; no change in position" : `; ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} places`;
  }
  if (previous === 0) return current === 0 ? "; no change" : "; previous was 0, so no percentage";
  const delta = ((current - previous) / previous) * 100;
  return `; ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

function totalsBlock(report: ConnectedReport): string {
  const { totals, previousTotals: previous } = report;
  const prev = (value: string) => `previous window: ${previous === null ? NOT_ESTABLISHED : value}`;
  return [
    "TOTALS FOR THE WINDOW (all queries and pages, including ones not listed below)",
    `- Clicks: ${totals.clicks} (${prev(String(previous?.clicks))}${change(totals.clicks, previous?.clicks ?? null, "percent")})`,
    `- Impressions: ${totals.impressions} (${prev(String(previous?.impressions))}${change(totals.impressions, previous?.impressions ?? null, "percent")})`,
    `- Click-through rate: ${percent(totals.ctr)} (${prev(previous ? percent(previous.ctr) : "")}${
      previous ? `; ${((totals.ctr - previous.ctr) * 100) >= 0 ? "+" : ""}${((totals.ctr - previous.ctr) * 100).toFixed(2)} points` : ""
    })`,
    `- Average position: ${position(totals)} (${prev(previous ? position(previous) : "")}${
      previous && previous.impressions > 0 && totals.impressions > 0 ? change(totals.position, previous.position, "places") : ""
    })`,
  ].join("\n");
}

/** One query, its text quoted so it cannot read as prose or instruction. */
function describeQuery(row: SearchPerformanceRow): string {
  const characters = Array.from(row.key.replace(/\s+/g, " ").trim());
  const text =
    characters.length > MAX_QUERY_LENGTH
      ? `${characters.slice(0, MAX_QUERY_LENGTH).join("")}…`
      : characters.join("");
  return `- Query: ${JSON.stringify(text)} — clicks ${row.clicks}, impressions ${row.impressions}, CTR ${percent(row.ctr)}, average position ${position(row)}`;
}

function header(report: ConnectedReport): string {
  const previous =
    report.previousWindow === null
      ? report.partial.includes("comparison-beyond-retention")
        ? `${NOT_ESTABLISHED} (the previous window reaches past the 16 months Search Console keeps)`
        : `${NOT_ESTABLISHED} (the previous window could not be read)`
      : windowText(report.previousWindow);
  return [
    "SEARCH CONSOLE (read by this product from Google Search Console; read-only)",
    `Property: ${report.property}`,
    `Window: ${windowText(report.window)}, range "${report.window.rangeId}". Final data in Pacific time; Google's most recent days are excluded by its reporting latency.`,
    `Previous window for comparison: ${previous}`,
    `Read from Google at: ${report.fetchedAt}${report.stale ? " — served from cache after a failed refresh; Google could not be reached for a newer answer" : ""}`,
  ].join("\n");
}

/** Serialises a connected report into the evidence block. */
export function formatSearchConsoleGrounding(report: ConnectedReport): SearchConsoleGrounding {
  const rows = report.queries.slice(0, MAX_QUERIES_DESCRIBED);
  const sections = [
    header(report),
    totalsBlock(report),
    [
      `TOP QUERIES BY CLICKS (${rows.length} — Google's top rows for this window, not every query the property received)`,
      rows.map(describeQuery).join("\n"),
    ].join("\n"),
    SEARCH_CONSOLE_LIMITS_NOTE,
  ];
  const text = sections.join("\n\n");
  return {
    text,
    summary: {
      source: "search-console",
      property: report.property,
      rangeId: report.window.rangeId,
      startDate: report.window.startDate,
      endDate: report.window.endDate,
      days: report.window.days,
      comparison: report.previousTotals !== null,
      queriesIncluded: rows.length,
      stale: report.stale,
      partial: [...report.partial],
      bytes: byteLength(text),
    },
    source: SEARCH_CONSOLE_SOURCE,
  };
}

/**
 * What the evidence cannot support, stated inside the evidence itself, so a
 * model that attends to the data reads the caveat attached to it.
 */
export const SEARCH_CONSOLE_LIMITS_NOTE = [
  "LIMITS OF THIS EVIDENCE",
  `- The query list is Google's top ${MAX_QUERIES_DESCRIBED} rows by clicks for this window, not every query the property received. Queries Google anonymises are never listed. Do not treat the list as the property's whole search demand, and do not total it as if it were.`,
  "- There is no search volume, keyword difficulty, ranking history, competitor data, or crawl data here. Search Console does not measure them.",
  "- Nothing here maps a query to a page. Search Console reports queries and pages as separate lists, and this evidence carries queries.",
  "- Average position is an impression-weighted average of every position the query was shown at, not a rank on any one page, and it is unknown where there were no impressions.",
  "- A change against the previous window compares two windows. It is not a trend and says nothing about cause; a window without a comparison is a fact about retention, not a flat result.",
  "- These figures describe what Google showed and what was clicked. They say nothing about whether a page is indexed, crawlable, or healthy.",
].join("\n");

/**
 * What the Keyword & Search Intent agent is asked to produce from a report.
 *
 * The same OBSERVED / INFERENCE / RECOMMENDATION discipline as the crawl
 * reviews. Intent classification is the one thing this agent is for, and it
 * is always an inference: Search Console records what was typed and clicked,
 * never why. The evidence is a top-rows list and the instructions say so
 * twice, because "our top query" and "our whole demand" are one careless
 * sentence apart.
 */
export const SEARCH_QUERY_REVIEW_INSTRUCTIONS = [
  "Review the Search Console evidence supplied with this task: the window totals, the comparison with the previous window where one exists, and the top queries by clicks with their clicks, impressions, click-through rate and average position.",
  "Structure every finding as: OBSERVED (what the evidence literally states, quoting the exact query or naming the exact total it comes from), then INFERENCE (what you conclude from it — including the likely search intent of a query, as informational, commercial, transactional, or navigational — and how confident you are), then RECOMMENDATION (one concrete next step for a person to take).",
  "Use only the supplied evidence. Every finding must cite at least one listed query or one stated total. Only the queries listed were examined; do not name a query that is not in the evidence.",
  "Where a reading is marked 'not established', say it is unknown and say what would establish it. Never treat it as a pass, a failure, a zero, or a no.",
  "Do not state or estimate search volume, keyword difficulty, rankings on specific pages, which page answered a query, competitors, indexation, crawl health, or Core Web Vitals; none of it is in the evidence.",
  "Do not describe the query list as the property's whole search demand or state totals derived from it; the window totals cover queries not listed. Say plainly that the list is Google's top rows for the window.",
  "Treat a change against the previous window as a comparison of two windows, not a trend, and do not assert a cause for it.",
  "You cannot change anything: every recommendation is a proposed next step for an operator to review, and you must not describe it as done.",
  "End with one line naming the single query whose figures most deserve attention, and why.",
].join(" ");

export { RANGE_DAYS };
