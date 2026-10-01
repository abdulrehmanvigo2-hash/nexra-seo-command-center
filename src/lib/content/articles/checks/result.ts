/**
 * The result of one article check unit, and the article version's check
 * state derived from its units (Stage 5, milestone C4).
 *
 * THE PASS RULE. A unit's verdict is built here from the run's parsed
 * answer and the run's own evidence summary, never read from the model's
 * words:
 *
 *   * every line is one of three things, by its own opening words:
 *     a CLASSIFICATION, whose quotation opens with one of the unit's
 *     statement numbers, `S1:` … `Sn:`, under any heading; an OBSERVATION,
 *     an unnumbered line under EDITORIAL that opens `Observation:` — a note
 *     about no statement, kept apart, never counted, never evidence; or an
 *     INVALID line — anything else, including an unnumbered line under a
 *     factual heading, a number out of range, or a malformed number;
 *   * the check covered the unit only when each of S1 … Sn is classified
 *     exactly once, no line is invalid, and there are at most
 *     `MAX_UNIT_OBSERVATIONS` observations. Otherwise the check did not do
 *     its job and produced no verdict: the unit is `failed`
 *     (`coverage-incomplete`), so a new run may check it again. Nothing is
 *     dropped to make coverage pass, and a malformed answer can never pass;
 *   * every record tag is verified against the paths and window the run's
 *     evidence actually carried; a supported or partial line whose tag names
 *     nothing in that evidence is moved to unverifiable, because a citation
 *     that cannot be checked is not support;
 *   * a covered unit is `passed` only when no statement is partial,
 *     unsupported or unverifiable. Editorial statements never count against
 *     a unit, so a unit with no factual claim — a call to action, say —
 *     passes; observations neither help nor hurt;
 *   * otherwise the unit `needs-review`. An unsupported statement is a
 *     finding for a person to review, not a failure: absence from the
 *     records is not falsehood.
 *
 * ATTESTED (Phase 6, checkpoint 6.8b). A line under ATTESTED is a
 * classification only when its statement is one the unit marks as
 * operator-attested and its note names that statement's basis exactly
 * (`experience` or `opinion`). An ATTESTED line on an unmarked statement, or
 * with another basis, is an invalid line, so the answer is
 * `coverage-incomplete`. An attested statement never counts against a unit,
 * as an editorial one does not; a marked statement placed under any other
 * heading is judged as that heading says.
 *
 * `failed` is never a content verdict. It is recorded only when the check
 * itself did not produce one: the run failed, was cancelled, answered
 * outside the fixed form, or did not classify each statement exactly once.
 *
 * THE ARTICLE STATE is derived from the unit rows of one exact version and
 * never stored as a second truth (see `deriveArticleCheckState`).
 *
 * Pure: no store, no network; safe to import from either side.
 */

import { tagNamesRecord, type FactCheckEvidence, type ParsedFactCheckItem, type ParsedFactCheckOutput } from "@/lib/content/drafts/parse-fact-check-output";
import type { ArticleAttestationBasis } from "@/types/content-article";
import type {
  ArticleCheckCarry,
  ArticleCheckCounts,
  ArticleCheckStatement,
  ArticleCheckCoverageDefect,
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

/** The most observations one answer may carry; more is commentary the answer's form does not allow. */
export const MAX_UNIT_OBSERVATIONS = 3;
/** Invalid lines kept on a `coverage-incomplete` failure, and how much of each: enough to see, bounded in size. */
const MAX_INVALID_LINES_KEPT = 10;
const MAX_INVALID_LINE_LENGTH = 120;

/** An unnumbered EDITORIAL line that says, in its own first word, that it is an observation. */
const OBSERVATION = /^Observation\s*:\s*\S/;

type Group = "supported" | "partial" | "unsupported" | "unverifiable" | "editorial" | "attested";
const GROUPS: readonly Group[] = ["supported", "partial", "unsupported", "unverifiable", "editorial", "attested"];

/** An ATTESTED line's basis, as its note names it: `experience` or `opinion`, nothing else. */
function basisOfNote(note: string | null): ArticleAttestationBasis | null {
  const word = (note ?? "").trim().replace(/[.!]+$/, "").toLowerCase();
  return word === "experience" || word === "opinion" ? word : null;
}

export type StatementCoverage = {
  /** Each group's classifications of S1 … Sn, in answer order. */
  readonly classified: Readonly<Record<Group, readonly ParsedFactCheckItem[]>>;
  readonly observations: readonly ParsedFactCheckItem[];
  /** Statement numbers no line placed. */
  readonly missing: readonly number[];
  /** Statement numbers more than one line placed. */
  readonly duplicate: readonly number[];
  /** Lines that are neither a classification of S1 … Sn nor an EDITORIAL observation, as quoted. */
  readonly invalid: readonly string[];
  /** True only when S1 … Sn are each classified exactly once, no line is invalid, and observations are within bounds. */
  readonly complete: boolean;
};

/**
 * Every line of the answer sorted into classifications, observations and
 * invalid lines, and whether the classifications cover S1 … Sn exactly
 * once. Nothing is discarded: every line lands in exactly one of the three.
 */
export function statementCoverage(
  output: Pick<ParsedFactCheckOutput, Exclude<Group, "attested">> & { readonly attested?: readonly ParsedFactCheckItem[] },
  statementCount: number,
  /** Each statement's attestation basis, S1 first; undefined where a statement is not attested. */
  bases: readonly (ArticleAttestationBasis | undefined)[] = [],
): StatementCoverage {
  const classified: Record<Group, ParsedFactCheckItem[]> = { supported: [], partial: [], unsupported: [], unverifiable: [], editorial: [], attested: [] };
  const observations: ParsedFactCheckItem[] = [];
  const invalid: string[] = [];
  const seen = new Map<number, number>();
  for (const group of GROUPS) {
    for (const item of output[group] ?? []) {
      const n = statementNumberOf(item.text);
      if (group === "attested" && (n === null || n > statementCount || bases[n - 1] === undefined || basisOfNote(item.note) !== bases[n - 1])) {
        invalid.push(item.text);
      } else if (n !== null && n <= statementCount) {
        classified[group].push(item);
        seen.set(n, (seen.get(n) ?? 0) + 1);
      } else if (n === null && group === "editorial" && OBSERVATION.test(item.text.trim())) {
        observations.push(item);
      } else {
        invalid.push(item.text);
      }
    }
  }
  const missing: number[] = [];
  const duplicate: number[] = [];
  for (let n = 1; n <= statementCount; n += 1) {
    const times = seen.get(n) ?? 0;
    if (times === 0) missing.push(n);
    if (times > 1) duplicate.push(n);
  }
  const complete =
    statementCount > 0 && missing.length === 0 && duplicate.length === 0 && invalid.length === 0 && observations.length <= MAX_UNIT_OBSERVATIONS;
  return { classified, observations, missing, duplicate, invalid, complete };
}

/** The unit's status for a covered check: the pass rule above, and nothing else. */
export function deriveUnitStatus(groups: {
  readonly partial: readonly unknown[];
  readonly unsupported: readonly unknown[];
  readonly unverifiable: readonly unknown[];
  readonly coverageComplete: boolean;
}): "passed" | "needs-review" {
  if (groups.partial.length > 0 || groups.unsupported.length > 0 || groups.unverifiable.length > 0) return "needs-review";
  return groups.coverageComplete ? "passed" : "needs-review";
}

function clip(text: string): string {
  const characters = Array.from(text);
  return characters.length > MAX_INVALID_LINE_LENGTH ? `${characters.slice(0, MAX_INVALID_LINE_LENGTH).join("")}…` : text;
}

/**
 * A completed check's result: coverage counted by statement number, tags
 * verified, the status derived — or, when the answer did not classify each
 * statement exactly once, a `coverage-incomplete` failure, which is no
 * verdict and may be checked again with a new run.
 */
export function buildUnitVerdict(input: {
  readonly output: ParsedFactCheckOutput;
  readonly evidence: FactCheckEvidence;
  readonly statementCount: number;
  /** The unit's statements, for their attestation bases (6.8b); an unattested unit may omit them. */
  readonly statements?: readonly Pick<ArticleCheckStatement, "n" | "attested">[];
  readonly checkedByRunId: string;
  readonly checkedAt: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
}): ArticleCheckUnitResult {
  const { output, evidence } = input;
  const bases: (ArticleAttestationBasis | undefined)[] = [];
  for (const statement of input.statements ?? []) bases[statement.n - 1] = statement.attested;
  const attestedUnit = bases.some((basis) => basis !== undefined);
  const coverage = statementCoverage(output, input.statementCount, bases);
  if (!coverage.complete) {
    const defect: ArticleCheckCoverageDefect = {
      missingStatements: coverage.missing,
      duplicateStatements: coverage.duplicate,
      invalidLines: coverage.invalid.slice(0, MAX_INVALID_LINES_KEPT).map(clip),
      invalidLineCount: coverage.invalid.length,
      observationCount: coverage.observations.length,
    };
    return {
      status: "failed",
      reason: "coverage-incomplete",
      checkedByRunId: input.checkedByRunId,
      recordedBy: input.recordedBy,
      recordedAt: input.recordedAt,
      coverage: defect,
    };
  }

  const lines = coverage.classified;
  const supported: FactCheckItem[] = [];
  const partial: FactCheckItem[] = [];
  const unverifiable: FactCheckItem[] = lines.unverifiable.map((item) => ({ text: item.text, evidence: verified(item, evidence), note: item.note }));
  for (const item of lines.supported) {
    const tag = verified(item, evidence);
    if (tag !== null) supported.push({ text: item.text, evidence: tag, note: item.note });
    else unverifiable.push({ text: item.text, evidence: null, note: item.evidence === null ? NO_TAG : UNKNOWN_TAG });
  }
  for (const item of lines.partial) {
    const tag = verified(item, evidence);
    if (tag !== null) partial.push({ text: item.text, evidence: tag, note: item.note });
    else unverifiable.push({ text: item.text, evidence: null, note: item.evidence === null ? NO_TAG : UNKNOWN_TAG });
  }
  const unsupported: FactCheckItem[] = lines.unsupported.map((item) => ({ text: item.text, evidence: verified(item, evidence), note: item.note }));
  const editorial: FactCheckItem[] = lines.editorial.map((item) => ({ text: item.text, evidence: null, note: item.note }));
  // An observation is never evidence: any tag written on one is not kept.
  const observations: FactCheckItem[] = coverage.observations.map((item) => ({ text: item.text, evidence: null, note: item.note }));
  // An attested line is the operator's word, never evidence: its note is its basis.
  const attested: FactCheckItem[] = lines.attested.map((item) => ({ text: item.text, evidence: null, note: basisOfNote(item.note) }));

  const counts: ArticleCheckCounts = {
    supported: supported.length,
    partial: partial.length,
    unsupported: unsupported.length,
    unverifiable: unverifiable.length,
    editorial: editorial.length,
    ...(attestedUnit ? { attested: attested.length } : {}),
  };
  const verdict: ArticleCheckUnitVerdict = {
    status: deriveUnitStatus({ partial, unsupported, unverifiable, coverageComplete: true }),
    counts,
    statementCount: input.statementCount,
    classifiedCount: supported.length + partial.length + unsupported.length + unverifiable.length + editorial.length + attested.length,
    coverageComplete: true,
    missingStatements: [],
    duplicateStatements: [],
    unnumberedLines: 0,
    summary: output.summary,
    supported,
    partial,
    unsupported,
    unverifiable,
    editorial,
    ...(attestedUnit ? { attested } : {}),
    observations,
    crawlId: evidence.crawlId,
    searchWindow: evidence.searchWindow,
    checkedByRunId: input.checkedByRunId,
    checkedAt: input.checkedAt,
    recordedBy: input.recordedBy,
    recordedAt: input.recordedAt,
  };
  return verdict;
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

const FAILURE_REASONS: readonly ArticleCheckFailureReason[] = ["run-failed", "run-cancelled", "output-malformed", "coverage-incomplete", "fresh-check-requested"];

const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stored carry (fix F8) read back, or null where it is not one: from a
 * carried row's columns, or from a `fresh-check-requested` failure's
 * `carriedFrom`. Field by field; a basis of evidence-unchanged needs its
 * fingerprint and no-supported has none.
 */
export function readCarry(value: {
  readonly unitId: unknown;
  readonly version: unknown;
  readonly basis: unknown;
  readonly instructionsSha256: unknown;
  readonly evidenceSha256: unknown;
}): ArticleCheckCarry | null {
  const { unitId, version, basis, instructionsSha256, evidenceSha256 } = value;
  if (typeof unitId !== "string" || !UUID.test(unitId)) return null;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  if (basis !== "no-supported" && basis !== "evidence-unchanged") return null;
  if (typeof instructionsSha256 !== "string" || !SHA256_HEX.test(instructionsSha256)) return null;
  if (basis === "no-supported" ? evidenceSha256 !== null && evidenceSha256 !== undefined : typeof evidenceSha256 !== "string" || !SHA256_HEX.test(evidenceSha256)) return null;
  return { unitId, version, basis, instructionsSha256, evidenceSha256: basis === "no-supported" ? null : (evidenceSha256 as string) };
}

function numberList(list: unknown): readonly number[] | null {
  return Array.isArray(list) && list.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1) ? (list as number[]) : null;
}

/** A stored `coverage-incomplete` failure's detail, or null where it is not one. */
function readCoverageDefect(value: unknown): ArticleCheckCoverageDefect | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;
  const missingStatements = numberList(d.missingStatements);
  const duplicateStatements = numberList(d.duplicateStatements);
  const invalidLineCount = count(d.invalidLineCount);
  const observationCount = count(d.observationCount);
  if (
    missingStatements === null || duplicateStatements === null || invalidLineCount === null || observationCount === null ||
    !Array.isArray(d.invalidLines) || !d.invalidLines.every((line) => typeof line === "string")
  ) {
    return null;
  }
  return { missingStatements, duplicateStatements, invalidLines: d.invalidLines as string[], invalidLineCount, observationCount };
}

/** The stored object read back as a unit result, or null where it is not one. Field by field; nothing is assumed. */
export function readUnitResult(value: unknown): ArticleCheckUnitResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.checkedByRunId !== "string" || typeof r.recordedBy !== "string" || typeof r.recordedAt !== "string") return null;
  if (r.status === "failed") {
    const reason = FAILURE_REASONS.find((entry) => entry === r.reason);
    if (reason === undefined) return null;
    const failure = { status: "failed" as const, reason, checkedByRunId: r.checkedByRunId, recordedBy: r.recordedBy, recordedAt: r.recordedAt };
    // A fresh check requested on a carried pass keeps the carry it cleared (F8), and carries nothing else.
    if (reason === "fresh-check-requested") {
      if (r.coverage !== undefined || typeof r.carriedFrom !== "object" || r.carriedFrom === null) return null;
      const c = r.carriedFrom as Record<string, unknown>;
      const carriedFrom = readCarry({ unitId: c.unitId, version: c.version, basis: c.basis, instructionsSha256: c.instructionsSha256, evidenceSha256: c.evidenceSha256 });
      return carriedFrom === null ? null : { ...failure, carriedFrom };
    }
    if (r.carriedFrom !== undefined) return null;
    // The detail belongs to a coverage-incomplete failure, and to nothing else.
    if (reason !== "coverage-incomplete") return r.coverage === undefined ? failure : null;
    const coverage = readCoverageDefect(r.coverage);
    return coverage === null ? null : { ...failure, coverage };
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
  const missingStatements = numberList(r.missingStatements);
  const duplicateStatements = numberList(r.duplicateStatements);
  // Results recorded before observations were kept apart carry none; they read back as recorded.
  const observations = r.observations === undefined ? undefined : items(r.observations);
  // Results recorded before 6.8b, or of a unit with no attested statement, carry no attested list.
  const attested = r.attested === undefined ? undefined : items(r.attested);
  if (
    supported === null || partial === null || unsupported === null || unverifiable === null || editorial === null || counts === null ||
    statementCount === null || classifiedCount === null || unnumberedLines === null || missingStatements === null || duplicateStatements === null ||
    observations === null || attested === null || typeof r.coverageComplete !== "boolean" || typeof r.summary !== "string" ||
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
  const attestedCount = counts.attested === undefined ? undefined : count(counts.attested);
  if (c.supported === null || c.partial === null || c.unsupported === null || c.unverifiable === null || c.editorial === null || attestedCount === null) return null;
  return {
    status: r.status,
    counts: {
      supported: c.supported,
      partial: c.partial,
      unsupported: c.unsupported,
      unverifiable: c.unverifiable,
      editorial: c.editorial,
      ...(attestedCount === undefined ? {} : { attested: attestedCount }),
    },
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
    ...(attested === undefined ? {} : { attested }),
    ...(observations === undefined ? {} : { observations }),
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
