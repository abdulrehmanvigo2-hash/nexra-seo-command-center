import { GONE_STATE_LABEL, historyLine, type FindingHistory } from "@/lib/crawl/findings/history";
import type { JsonObject } from "@/types/agent-run";

/**
 * The project's derived finding history (checkpoint 3.3), serialised for the
 * Technical SEO agent's finding-history review (Phase 6, checkpoint 6.5).
 *
 * Appended after one crawl's evidence and its deterministic findings. The
 * history is the same derivation the Issues tab shows — reports at the
 * current rule version compared, consecutive, by finding id — never
 * recomputed here and never stored. Each current finding is named by its
 * rule and its state; each finding the latest report no longer names is
 * resolved, not re-checked or changed, in the history's own fixed words.
 * Bounded; a history that is not kept, not recorded or not readable is
 * stated in one line.
 */

export const HISTORY_ROWS_MAX = 20;

export type FindingHistoryInput =
  | { readonly status: "derived"; readonly history: FindingHistory }
  | { readonly status: "none" }
  | { readonly status: "unavailable" }
  | { readonly status: "read-failed" };

const HEADING = "FINDING HISTORY (derived on read from the findings reports this product recorded for the project's own crawls; nothing recomputed)";

const short = (id: string) => id.slice(0, 8);

export function formatFindingHistoryGrounding(input: FindingHistoryInput): { readonly text: string; readonly summary: JsonObject } {
  if (input.status === "read-failed") return { text: `${HEADING}\nThe finding history could not be read for this run; nothing is inferred in its place.`, summary: { history: "read-failed" } };
  if (input.status === "unavailable") return { text: `${HEADING}\nFinding history is not kept on this deployment.`, summary: { history: "not-kept" } };
  if (input.status === "none") return { text: `${HEADING}\nNo own-site crawl of this project is recorded, so there is no history.`, summary: { history: "none" } };

  const h = input.history;
  const compared = h.compared.length;
  const current = h.current.slice(0, HISTORY_ROWS_MAX);
  const gone = h.gone.slice(0, HISTORY_ROWS_MAX);
  const text = [
    HEADING,
    `Rule version ${h.ruleVersion}. Compared reports (oldest first): ${compared === 0 ? "none" : h.compared.map((c) => `crawl ${short(c.id)} (${c.startedAt.slice(0, 10)})`).join(", ")}.`,
    `Summary: ${h.summary}`,
    [
      `IN THE LATEST REPORT (${current.length < h.current.length ? `${current.length} of ${h.current.length}` : h.current.length})`,
      ...(current.length ? current.map((row) => `- [${row.rule}] finding ${short(row.key)} — ${row.state}: ${historyLine(row, compared)}`) : ["- none"]),
    ].join("\n"),
    [
      `NO LONGER IN THE LATEST REPORT (${gone.length < h.gone.length ? `${gone.length} of ${h.gone.length}` : h.gone.length})`,
      ...(gone.length ? gone.map((row) => `- [${row.rule}] finding ${short(row.key)} — ${GONE_STATE_LABEL[row.state]}`) : ["- none"]),
    ].join("\n"),
    ...(h.notRecorded.length ? [`Crawls with no recorded findings (not recomputed): ${h.notRecorded.map((c) => short(c.id)).join(", ")}.`] : []),
    ...(h.otherRules.length ? [`Reports under earlier rules (not compared): ${h.otherRules.map((c) => `${short(c.id)} at version ${c.ruleVersion}`).join(", ")}.`] : []),
  ].join("\n\n");
  return {
    text,
    summary: {
      history: "derived",
      ruleVersion: h.ruleVersion,
      compared,
      current: h.current.length,
      gone: h.gone.length,
      notRecorded: h.notRecorded.length,
      otherRules: h.otherRules.length,
      truncated: current.length < h.current.length || gone.length < h.gone.length,
    },
  };
}
