import type { SnapshotHistoryComparison, MetricDelta, CtrDelta, PositionDelta, RowComparison, RowListComparison } from "@/lib/search-console/history/compare";
import { LOW_CONFIDENCE_GAP_DAYS, MIN_GAP_DAYS, OPPORTUNITY_MAX_CTR, OPPORTUNITY_MAX_POSITION, OPPORTUNITY_MIN_IMPRESSIONS } from "@/lib/search-console/history/thresholds";
import { MAX_QUERY_LENGTH } from "@/lib/search-console/grounding";
import { SNAPSHOT_MAX_ROWS } from "@/lib/search-console/snapshots/contract";
import type { JsonObject } from "@/types/agent-run";
import type { SearchPerformance, SearchPerformanceRow } from "@/types/search-console";

/**
 * Stored Search Console history, serialised as evidence an agent may reason
 * over (milestone M1, phase 4, checkpoint P4b).
 *
 * Appended AFTER the live Search Console report, never in its place: the
 * live report is the current evidence, and this block adds what two stored
 * snapshots of the same property said when compared by the fixed rules of
 * `history/compare.ts`. Everything in it is arithmetic over stored rows;
 * the classifications (opportunity, improving, declining, appeared, left)
 * are the deterministic ones, named as such, and the block says at every
 * turn what they are not: not search volume, not difficulty, not a query
 * mapped to a page, not a cannibalisation finding, not a rank tracker, not
 * a trend.
 *
 * Two audiences read it. The Keyword & Search Intent agent gets the query
 * side: query movements, opportunities, improving, declining, appeared and
 * left. The Analytics & Learning agent gets the measurement side: totals
 * and the page lists. Neither gets both lists, so neither can be tempted to
 * join them.
 *
 * Bounded. At most 25 rows in a movement list, at most 10 in each summary
 * list, keys cut as the live block cuts them, and the whole block under
 * MAX_HISTORY_BYTES: sections are added in priority order and the first
 * that would not fit ends the block, marked as cut, with the limits note
 * always kept. When there is no comparable history the block is one short
 * note saying so, and nothing is invented to fill it.
 */

export type HistoryAudience = "keyword" | "analytics";

export type HistoryInput =
  | SnapshotHistoryComparison
  /** This deployment keeps no snapshots (fixture data source). */
  | { readonly available: false; readonly reason: "not-kept" }
  /** The stored history could not be read; the live report stands alone. */
  | { readonly available: false; readonly reason: "read-failed" };

export type HistoryStatus =
  | "available"
  | "insufficient-history"
  | "no-snapshots"
  | "no-history-for-property"
  | "not-kept"
  | "read-failed";

export type SearchConsoleHistoryGrounding = {
  readonly text: string;
  readonly summary: JsonObject & {
    readonly history: HistoryStatus;
    readonly audience: HistoryAudience;
    readonly snapshotsUsed: 0 | 2;
    readonly latestEndDate: string | null;
    readonly previousEndDate: string | null;
    readonly gapDays: number | null;
    readonly confidence: "normal" | "low" | null;
    readonly latestPartial: readonly string[];
    readonly previousPartial: readonly string[];
    readonly truncated: boolean;
    readonly bytes: number;
  };
};

export const MAX_HISTORY_BYTES = 16_000;
export const MAX_HISTORY_MOVEMENT_ROWS = SNAPSHOT_MAX_ROWS;
export const MAX_HISTORY_SUMMARY_ROWS = 10;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

export const SEARCH_CONSOLE_HISTORY_LIMITS_NOTE = [
  "LIMITS OF THIS HISTORY",
  "- Two stored snapshots are two windows. A difference between them is not a long-term trend and says nothing about cause.",
  `- Each list is Google's top ${SNAPSHOT_MAX_ROWS} rows by clicks for its window, an observed cut, not a complete ranking. A row that appeared entered that top ${SNAPSHOT_MAX_ROWS}; a row that left fell out of it, which does not prove it lost all clicks.`,
  "- There is no search volume, keyword difficulty, SERP feature, competitor or ranking-cause data here. Search Console does not measure them; do not estimate them.",
  "- Nothing here maps a query to a page: queries and pages are separate lists. No cannibalisation conclusion can be drawn from this history, and none may be stated.",
  "- Average position is Search Console's impression-weighted average of every position the row was shown at, not a rank tracker reading and not a rank on any one page.",
  `- Opportunity, improving, declining, appeared and left are fixed arithmetic rules (opportunity: at least ${OPPORTUNITY_MIN_IMPRESSIONS} impressions, click-through rate at most ${OPPORTUNITY_MAX_CTR * 100}%, average position at most ${OPPORTUNITY_MAX_POSITION}; movement: at least one whole place with enough impressions on both sides). They are labels for review, not findings.`,
].join("\n");

const HISTORY_HEADING = "STORED SEARCH CONSOLE HISTORY (two snapshots this product recorded from Google Search Console; the live report above is the current evidence)";
const TRUNCATION_NOTE = "(further history sections were cut to keep this evidence within its size bound)";

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
const signed = (value: number, decimals = 0) => `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;

/** A query or a page URL, quoted so it cannot read as prose, cut as the live block cuts it. */
function quoteKey(key: string): string {
  const characters = Array.from(key.replace(/\s+/g, " ").trim());
  const text = characters.length > MAX_QUERY_LENGTH ? `${characters.slice(0, MAX_QUERY_LENGTH).join("")}…` : characters.join("");
  return JSON.stringify(text);
}

const metricText = (d: MetricDelta) => `${d.previous} → ${d.latest} (${signed(d.absolute)}${d.percent === null ? "; previous was 0, so no percentage" : `; ${signed(d.percent, 1)}%`})`;
const ctrText = (d: CtrDelta) => `${percent(d.previous)} → ${percent(d.latest)} (${signed(d.points, 2)} points)`;
function positionText(d: PositionDelta): string {
  if (d.previous === null || d.delta === null) return `${d.latest.toFixed(1)} (previous not established: no impressions)`;
  const move = d.delta === 0 ? "no change" : `${d.delta > 0 ? "up" : "down"} ${Math.abs(d.delta).toFixed(1)} places`;
  return `${d.previous.toFixed(1)} → ${d.latest.toFixed(1)} (${move})`;
}

function describeRow(label: string, row: SearchPerformanceRow): string {
  return `- ${label}: ${quoteKey(row.key)} — clicks ${row.clicks}, impressions ${row.impressions}, CTR ${percent(row.ctr)}, average position ${row.position.toFixed(1)}`;
}

function describeMovement(label: string, row: RowComparison): string {
  const tag = row.movement ? `; ${row.movement}` : "";
  return `- ${label}: ${quoteKey(row.key)} — clicks ${metricText(row.clicks)}, impressions ${metricText(row.impressions)}, CTR ${ctrText(row.ctr)}, average position ${positionText(row.position)}${tag}`;
}

function totalsSection(c: Extract<SnapshotHistoryComparison, { available: true }>): string {
  if (c.totals === null) {
    return "TOTALS, LATEST VS PREVIOUS\n- The latest stored window reported no impressions at all (no-data), so there are no totals to compare.";
  }
  const t = c.totals;
  return [
    `TOTALS, LATEST VS PREVIOUS (all queries and pages, including ones not listed)${t.previousNoData ? " — the previous window reported no impressions, so every count is against zero" : ""}`,
    `- Clicks: ${metricText(t.clicks)}`,
    `- Impressions: ${metricText(t.impressions)}`,
    `- Click-through rate: ${ctrText(t.ctr)}`,
    `- Average position: ${positionText(t.position)}`,
  ].join("\n");
}

function listSections(kind: "queries" | "pages", list: RowListComparison): string[] {
  const noun = kind === "queries" ? "QUERY" : "PAGE";
  const label = kind === "queries" ? "Query" : "Page";
  if (!list.available) {
    const why =
      list.reason === "no-data-latest"
        ? "the latest stored window reported no impressions"
        : `${kind} were unavailable in one of the two snapshots`;
    return [`${noun} LISTS: not compared — ${why}. Nothing is inferred in their place.`];
  }
  const cap = <T,>(rows: readonly T[], max: number) => rows.slice(0, max);
  const count = (shown: number, total: number) => (shown < total ? `${shown} of ${total}` : `${total}`);
  const sections: string[] = [];

  const matched = cap(list.matched, MAX_HISTORY_MOVEMENT_ROWS);
  sections.push(
    [
      `${noun} MOVEMENTS (${count(matched.length, list.matched.length)} ${kind} in both windows' top ${SNAPSHOT_MAX_ROWS}, by latest clicks; previous → latest)${list.previousNoData ? " — none: the previous window had no impressions" : ""}`,
      ...(matched.length ? matched.map((row) => describeMovement(label, row)) : list.previousNoData ? [] : ["- none"]),
    ].join("\n"),
  );

  const summary = (title: string, rows: readonly SearchPerformanceRow[]) => {
    const shown = cap(rows, MAX_HISTORY_SUMMARY_ROWS);
    return [`${title} (${count(shown.length, rows.length)})`, ...(shown.length ? shown.map((row) => describeRow(label, row)) : ["- none"])].join("\n");
  };
  const movementSummary = (title: string, rows: readonly RowComparison[]) => {
    const shown = cap(rows, MAX_HISTORY_SUMMARY_ROWS);
    return [`${title} (${count(shown.length, rows.length)})`, ...(shown.length ? shown.map((row) => describeMovement(label, row)) : ["- none"])].join("\n");
  };

  sections.push(summary(`${noun} OPPORTUNITIES in the latest window — shown at least ${OPPORTUNITY_MIN_IMPRESSIONS} times, clicked at most ${OPPORTUNITY_MAX_CTR * 100}% of the time, average position at most ${OPPORTUNITY_MAX_POSITION}`, list.opportunities));
  sections.push(movementSummary(`${noun} IMPROVING — average position better by at least one place, with impressions on both sides`, list.improving));
  sections.push(movementSummary(`${noun} DECLINING — average position worse by at least one place, with impressions on both sides`, list.declining));
  sections.push(summary(`${noun} ROWS THAT APPEARED in the latest top ${SNAPSHOT_MAX_ROWS} (absent from the previous top ${SNAPSHOT_MAX_ROWS})`, list.appeared));
  sections.push(summary(`${noun} ROWS THAT LEFT the observed top ${SNAPSHOT_MAX_ROWS} (present before, absent now — not proven lost)`, list.left));
  return sections;
}

function unavailableNote(input: Exclude<HistoryInput, { available: true }>): string {
  switch (input.reason) {
    case "not-kept":
      return "STORED SEARCH CONSOLE HISTORY: none. This deployment keeps no stored snapshots, so only the live report above is available. Do not infer any history.";
    case "read-failed":
      return "STORED SEARCH CONSOLE HISTORY: unavailable. The stored snapshots could not be read for this run, so only the live report above is available. Do not infer any history.";
    case "no-snapshots":
      return "STORED SEARCH CONSOLE HISTORY: none yet. No snapshot has been stored for this project, so only the live report above is available. Do not infer any history.";
    case "no-history-for-property":
      return `STORED SEARCH CONSOLE HISTORY: none for the current property. ${input.otherProperty} stored snapshot(s) describe a property this project was mapped to earlier and are set aside. Only the live report above is available; do not infer any history.`;
    case "insufficient-history":
      return `STORED SEARCH CONSOLE HISTORY: insufficient. ${input.eligible} stored snapshot(s) for this property${input.latestEndDate ? `, the latest ending ${input.latestEndDate}` : ""}; a comparison needs two at least ${MIN_GAP_DAYS} days apart. Only the live report above is available; do not infer any history.`;
  }
}

function confidenceText(c: Extract<SnapshotHistoryComparison, { available: true }>): string {
  const reasons: string[] = [];
  if (c.gapDays < LOW_CONFIDENCE_GAP_DAYS) reasons.push(`the two windows end only ${c.gapDays} days apart and overlap`);
  if (c.latestState === "no-data") reasons.push("the latest window reported no impressions");
  if (c.previousState === "no-data") reasons.push("the previous window reported no impressions");
  if (c.coverage.latestPartial.length) reasons.push(`the latest snapshot is partial (${c.coverage.latestPartial.join(", ")})`);
  if (c.coverage.previousPartial.length) reasons.push(`the previous snapshot is partial (${c.coverage.previousPartial.join(", ")})`);
  return c.coverage.confidence === "normal" ? "normal" : `low — ${reasons.join("; ")}`;
}

export function formatSearchConsoleHistory(input: HistoryInput, audience: HistoryAudience): SearchConsoleHistoryGrounding {
  const base = { audience, latestPartial: [] as string[], previousPartial: [] as string[], truncated: false };

  if (!input.available) {
    const text = unavailableNote(input);
    return {
      text,
      summary: { ...base, history: input.reason, snapshotsUsed: 0, latestEndDate: input.reason === "insufficient-history" ? input.latestEndDate : null, previousEndDate: null, gapDays: null, confidence: null, bytes: byteLength(text) },
    };
  }

  const header = [
    HISTORY_HEADING,
    `Property: ${input.property}. Stored window: ${input.rangeId} (30 days). Latest window ended ${input.latestEndDate}; previous window ended ${input.previousEndDate}; ${input.gapDays} days apart. Missing days between them are gaps, not filled in.`,
    `States: latest ${input.latestState}, previous ${input.previousState}. Confidence: ${confidenceText(input)}.${input.coverage.otherProperty ? ` ${input.coverage.otherProperty} snapshot(s) under another property set aside.` : ""}`,
  ].join("\n");

  const ordered = [header, totalsSection(input), ...listSections(audience === "keyword" ? "queries" : "pages", audience === "keyword" ? input.queries : input.pages)];

  // Priority order; the first section that would not fit ends the block. The limits note always fits.
  const reserved = byteLength(`\n\n${SEARCH_CONSOLE_HISTORY_LIMITS_NOTE}`) + byteLength(`\n\n${TRUNCATION_NOTE}`);
  const kept: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const section of ordered) {
    const cost = byteLength(section) + (kept.length ? 2 : 0);
    if (bytes + cost + reserved > MAX_HISTORY_BYTES) {
      truncated = true;
      break;
    }
    kept.push(section);
    bytes += cost;
  }
  if (truncated) kept.push(TRUNCATION_NOTE);
  kept.push(SEARCH_CONSOLE_HISTORY_LIMITS_NOTE);
  const text = kept.join("\n\n");

  return {
    text,
    summary: {
      ...base,
      history: "available",
      snapshotsUsed: 2,
      latestEndDate: input.latestEndDate,
      previousEndDate: input.previousEndDate,
      gapDays: input.gapDays,
      confidence: input.coverage.confidence,
      latestPartial: [...input.coverage.latestPartial],
      previousPartial: [...input.coverage.previousPartial],
      truncated,
      bytes: byteLength(text),
    },
  };
}

export type { SearchPerformance };
