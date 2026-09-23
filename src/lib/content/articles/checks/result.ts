/**
 * The result of one article check unit, and the article version's check
 * state derived from its units (Stage 5, milestone C4).
 *
 * THE PASS RULE. A unit's verdict is built here from the run's parsed
 * answer and the run's own evidence summary, never read from the model's
 * words:
 *
 *   * every record tag is verified against the paths and window the run's
 *     evidence actually carried; a supported or partial line whose tag names
 *     nothing in that evidence is moved to unverifiable, because a citation
 *     that cannot be checked is not support;
 *   * every line must open its quotation with a statement number, `S1:` …
 *     `Sn:`; the check's coverage is complete only when each of S1 … Sn is
 *     placed exactly once and no line is unnumbered or out of range — so a
 *     statement left out and another placed twice cannot pass by count;
 *   * the unit is `passed` only when coverage is complete and no line is
 *     partial, unsupported or unverifiable. Editorial lines never count
 *     against a unit, so a unit with no factual claim — a call to action,
 *     say — passes;
 *   * otherwise the unit `needs-review`. An unsupported statement is a
 *     finding for a person to review, not a failure: absence from the
 *     records is not falsehood.
 *
 * `failed` is never a content verdict. It is recorded only when the check
 * itself did not produce one: the run failed, was cancelled, or answered
 * outside the fixed form.
 *
 * THE ARTICLE STATE is derived from the unit rows of one exact version and
 * never stored as a second truth (see `deriveArticleCheckState`).
 *
 * Pure: no store, no network; safe to import from either side.
 */

import { tagNamesRecord, type FactCheckEvidence, type ParsedFactCheckItem, type ParsedFactCheckOutput } from "@/lib/content/drafts/parse-fact-check-output";
import type {
  ArticleCheckCounts,
  ArticleCheckFailureReason,
  ArticleCheckState,
  ArticleCheckUnitRecord,
  ArticleCheckUnitResult,
  ArticleCheckUnitStatus,
  ArticleCheckUnitVerdict,
} from "@/types/content-article-check";
import type { FactCheckItem } from "@/types/content-draft";

const NO_TAG = "no record in the evidence is named for this statement";
const UNKNOWN_TAG = "the record named is not among the evidence the check was given";

function verified(item: ParsedFactCheckItem, evidence: FactCheckEvidence): string | null {
  return item.evidence !== null && tagNamesRecord(item.evidence, evidence) ? item.evidence : null;
}

/** The statement number a line's quotation opens with, `S3: …`, or null. */
export function statementNumberOf(text: string): number | null {
  const match = /^S([1-9][0-9]?)\s*:/.exec(text.trim());
  return match === null ? null : Number(match[1]);
}

/** Which of S1 … Sn the lines placed, once, twice or not at all, and how many lines named none in range. */
export function statementCoverage(
  texts: readonly string[],
  statementCount: number,
): { readonly complete: boolean; readonly missing: readonly number[]; readonly duplicate: readonly number[]; readonly unnumbered: number } {
  const seen = new Map<number, number>();
  let unnumbered = 0;
  for (const text of texts) {
    const n = statementNumberOf(text);
    if (n === null || n > statementCount) unnumbered += 1;
    else seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  const missing: number[] = [];
  const duplicate: number[] = [];
  for (let n = 1; n <= statementCount; n += 1) {
    const times = seen.get(n) ?? 0;
    if (times === 0) missing.push(n);
    if (times > 1) duplicate.push(n);
  }
  return { complete: statementCount > 0 && missing.length === 0 && duplicate.length === 0 && unnumbered === 0, missing, duplicate, unnumbered };
}

/** The unit's status: the pass rule above, and nothing else. */
export function deriveUnitStatus(groups: {
  readonly partial: readonly unknown[];
  readonly unsupported: readonly unknown[];
  readonly unverifiable: readonly unknown[];
  readonly coverageComplete: boolean;
}): "passed" | "needs-review" {
  if (groups.partial.length > 0 || groups.unsupported.length > 0 || groups.unverifiable.length > 0) return "needs-review";
  return groups.coverageComplete ? "passed" : "needs-review";
}

/** A completed check's verdict: tags verified, coverage counted by statement number, the status derived. */
export function buildUnitVerdict(input: {
  readonly output: ParsedFactCheckOutput;
  readonly evidence: FactCheckEvidence;
  readonly statementCount: number;
  readonly checkedByRunId: string;
  readonly checkedAt: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
}): ArticleCheckUnitVerdict {
  const { output, evidence } = input;
  const supported: FactCheckItem[] = [];
  const partial: FactCheckItem[] = [];
  const unverifiable: FactCheckItem[] = output.unverifiable.map((item) => ({ text: item.text, evidence: verified(item, evidence), note: item.note }));
  for (const item of output.supported) {
    const tag = verified(item, evidence);
    if (tag !== null) supported.push({ text: item.text, evidence: tag, note: item.note });
    else unverifiable.push({ text: item.text, evidence: null, note: item.evidence === null ? NO_TAG : UNKNOWN_TAG });
  }
  for (const item of output.partial) {
    const tag = verified(item, evidence);
    if (tag !== null) partial.push({ text: item.text, evidence: tag, note: item.note });
    else unverifiable.push({ text: item.text, evidence: null, note: item.evidence === null ? NO_TAG : UNKNOWN_TAG });
  }
  const unsupported: FactCheckItem[] = output.unsupported.map((item) => ({ text: item.text, evidence: verified(item, evidence), note: item.note }));
  const editorial: FactCheckItem[] = output.editorial.map((item) => ({ text: item.text, evidence: null, note: item.note }));

  const counts: ArticleCheckCounts = {
    supported: supported.length,
    partial: partial.length,
    unsupported: unsupported.length,
    unverifiable: unverifiable.length,
    editorial: editorial.length,
  };
  const all = [...supported, ...partial, ...unsupported, ...unverifiable, ...editorial];
  const coverage = statementCoverage(all.map((item) => item.text), input.statementCount);
  return {
    status: deriveUnitStatus({ partial, unsupported, unverifiable, coverageComplete: coverage.complete }),
    counts,
    statementCount: input.statementCount,
    classifiedCount: all.length,
    coverageComplete: coverage.complete,
    missingStatements: coverage.missing,
    duplicateStatements: coverage.duplicate,
    unnumberedLines: coverage.unnumbered,
    summary: output.summary,
    supported,
    partial,
    unsupported,
    unverifiable,
    editorial,
    crawlId: evidence.crawlId,
    searchWindow: evidence.searchWindow,
    checkedByRunId: input.checkedByRunId,
    checkedAt: input.checkedAt,
    recordedBy: input.recordedBy,
    recordedAt: input.recordedAt,
  };
}

export function unitFailure(reason: ArticleCheckFailureReason, runId: string, recordedBy: string, recordedAt: string): ArticleCheckUnitResult {
  return { status: "failed", reason, checkedByRunId: runId, recordedBy, recordedAt };
}

function items(list: unknown): readonly FactCheckItem[] | null {
  if (!Array.isArray(list)) return null;
  const out: FactCheckItem[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.text !== "string") return null;
    out.push({ text: item.text, evidence: typeof item.evidence === "string" ? item.evidence : null, note: typeof item.note === "string" ? item.note : null });
  }
  return out;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

const FAILURE_REASONS: readonly ArticleCheckFailureReason[] = ["run-failed", "run-cancelled", "output-malformed"];

/** The stored object read back as a unit result, or null where it is not one. Field by field; nothing is assumed. */
export function readUnitResult(value: unknown): ArticleCheckUnitResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.checkedByRunId !== "string" || typeof r.recordedBy !== "string" || typeof r.recordedAt !== "string") return null;
  if (r.status === "failed") {
    const reason = FAILURE_REASONS.find((entry) => entry === r.reason);
    return reason === undefined ? null : { status: "failed", reason, checkedByRunId: r.checkedByRunId, recordedBy: r.recordedBy, recordedAt: r.recordedAt };
  }
  if (r.status !== "passed" && r.status !== "needs-review") return null;
  const supported = items(r.supported);
  const partial = items(r.partial);
  const unsupported = items(r.unsupported);
  const unverifiable = items(r.unverifiable);
  const editorial = items(r.editorial);
  const counts = typeof r.counts === "object" && r.counts !== null && !Array.isArray(r.counts) ? (r.counts as Record<string, unknown>) : null;
  const statementCount = count(r.statementCount);
  const classifiedCount = count(r.classifiedCount);
  const unnumberedLines = count(r.unnumberedLines);
  const numbers = (list: unknown): readonly number[] | null =>
    Array.isArray(list) && list.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1) ? (list as number[]) : null;
  const missingStatements = numbers(r.missingStatements);
  const duplicateStatements = numbers(r.duplicateStatements);
  if (
    supported === null || partial === null || unsupported === null || unverifiable === null || editorial === null || counts === null ||
    statementCount === null || classifiedCount === null || unnumberedLines === null || missingStatements === null || duplicateStatements === null ||
    typeof r.coverageComplete !== "boolean" || typeof r.summary !== "string" ||
    typeof r.crawlId !== "string" || typeof r.checkedAt !== "string"
  ) {
    return null;
  }
  const c = {
    supported: count(counts.supported),
    partial: count(counts.partial),
    unsupported: count(counts.unsupported),
    unverifiable: count(counts.unverifiable),
    editorial: count(counts.editorial),
  };
  if (c.supported === null || c.partial === null || c.unsupported === null || c.unverifiable === null || c.editorial === null) return null;
  return {
    status: r.status,
    counts: { supported: c.supported, partial: c.partial, unsupported: c.unsupported, unverifiable: c.unverifiable, editorial: c.editorial },
    statementCount,
    classifiedCount,
    coverageComplete: r.coverageComplete,
    missingStatements,
    duplicateStatements,
    unnumberedLines,
    summary: r.summary,
    supported,
    partial,
    unsupported,
    unverifiable,
    editorial,
    crawlId: r.crawlId,
    searchWindow: typeof r.searchWindow === "string" ? r.searchWindow : null,
    checkedByRunId: r.checkedByRunId,
    checkedAt: r.checkedAt,
    recordedBy: r.recordedBy,
    recordedAt: r.recordedAt,
  };
}

export type ArticleCheckTally = {
  readonly total: number;
  readonly passed: number;
  readonly needsReview: number;
  readonly failed: number;
  readonly pending: number;
  readonly unchecked: number;
};

/**
 * The version's check state from its units' rows, one entry per unit the
 * version's content yields (a row for a unit the content does not yield, or
 * with another hash, must not be passed in: the caller matches rows to units
 * by index, key and hash).
 *
 * `checking` while any unit is pending; `passed` when every unit is passed;
 * `needs-review` when every unit is finished and at least one is not passed;
 * otherwise `unchecked`. With no units at all, `unchecked`.
 */
export function deriveArticleCheckState(units: readonly { readonly record: Pick<ArticleCheckUnitRecord, "status"> | null }[]): {
  readonly state: ArticleCheckState;
  readonly tally: ArticleCheckTally;
} {
  const statuses: (ArticleCheckUnitStatus | null)[] = units.map((unit) => unit.record?.status ?? null);
  const tally: ArticleCheckTally = {
    total: statuses.length,
    passed: statuses.filter((s) => s === "passed").length,
    needsReview: statuses.filter((s) => s === "needs-review").length,
    failed: statuses.filter((s) => s === "failed").length,
    pending: statuses.filter((s) => s === "pending").length,
    unchecked: statuses.filter((s) => s === null).length,
  };
  if (tally.total === 0) return { state: "unchecked", tally };
  if (tally.pending > 0) return { state: "checking", tally };
  if (tally.unchecked > 0) return { state: "unchecked", tally };
  return { state: tally.passed === tally.total ? "passed" : "needs-review", tally };
}
