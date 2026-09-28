/**
 * Shapes for article check units (Stage 5, milestone C4): the bounded
 * pieces one immutable article version is fact-checked in, and the result
 * recorded for each piece against that exact version.
 *
 * A unit is derived, never stored as content: its text is regenerated from
 * the version's stored canonical text every time, and only its identity
 * (index, kind, key, part), its hash and its check result are stored.
 * Nothing here is an approval or a publication.
 */

import type { ArticleAttestationBasis } from "@/types/content-article";
import type { FactCheckItem } from "@/types/content-draft";

/** The five block kinds, in the order they appear in an article. */
export type ArticleCheckUnitKind = "metadata" | "lead-introduction" | "section" | "faq" | "cta";

/** One statement under check, numbered from 1 within its unit. */
export type ArticleCheckStatement = {
  /** S1 … Sn within the unit. */
  readonly n: number;
  /** Where in the article it comes from, e.g. `paragraphs[1]` or `faqs[0].answer`. */
  readonly field: string;
  /** The statement's text, verbatim: one sentence, heading, question or field value. */
  readonly text: string;
  /** Present only on a sentence of an operator-attested paragraph (6.8b): its basis. */
  readonly attested?: ArticleAttestationBasis;
};

/** A heading shown for orientation only: checked in an earlier part of the same block, never in this one. */
export type ArticleCheckContext = {
  readonly field: string;
  readonly text: string;
};

/**
 * One check unit of one article version: one part of one block.
 *
 * `index` is the unit's zero-based position across the whole article, in
 * the fixed block order (metadata, lead-introduction, each H2 section in
 * article order, faq when the article has FAQs, cta) and part order within
 * each block. `block` is `metadata`, `lead-introduction`, `section:<id>`,
 * `faq` or `cta`; `key` is `<block>:<part>`. All derived from the content,
 * never from a database id.
 */
export type ArticleCheckUnit = {
  readonly index: number;
  readonly kind: ArticleCheckUnitKind;
  readonly block: string;
  readonly key: string;
  /** 1-based within the block. */
  readonly part: number;
  readonly partCount: number;
  /** What the operator reads: the section heading, or a fixed label. Not part of the text or hash. */
  readonly label: string;
  /** The exact text under check: the unit's canonical `nexra-article-check-unit/1` serialisation. */
  readonly text: string;
  readonly statements: readonly ArticleCheckStatement[];
  readonly context: readonly ArticleCheckContext[];
  /** The number of statements, S1 … Sn. */
  readonly statementCount: number;
  /** The text's size in UTF-8 bytes. */
  readonly bytes: number;
};

/**
 * Why an article version cannot be checked at all. Deterministic, and never
 * worked around by cutting text: every unit of such a version is refused.
 */
export type ArticleCheckPlanRefusal =
  /** One statement, with its context, is larger than one unit may be. */
  | "statement-too-large"
  /** The version yields more units than one article may have. */
  | "too-many-units";

/** A stored unit's check status. `failed` is an execution or system failure, never a content verdict. */
export type ArticleCheckUnitStatus = "pending" | "passed" | "needs-review" | "failed";

export type ArticleCheckCounts = {
  readonly supported: number;
  readonly partial: number;
  readonly unsupported: number;
  readonly unverifiable: number;
  readonly editorial: number;
  /** Statements the check placed under ATTESTED (6.8b). Absent on results recorded before it. */
  readonly attested?: number;
};

/** A completed check's structured result, built by the server from the run's text and evidence summary. */
export type ArticleCheckUnitVerdict = {
  readonly status: "passed" | "needs-review";
  readonly counts: ArticleCheckCounts;
  /** Statements the unit holds, S1 … Sn. */
  readonly statementCount: number;
  /**
   * Statements the check classified: lines that name one of S1 … Sn. Never
   * more than `statementCount`; observations are not counted.
   */
  readonly classifiedCount: number;
  /** True only when every S1 … Sn was placed exactly once and no line was unnumbered or out of range. */
  readonly coverageComplete: boolean;
  /** Statement numbers no line placed. */
  readonly missingStatements: readonly number[];
  /** Statement numbers more than one line placed. */
  readonly duplicateStatements: readonly number[];
  /** Lines that named no statement number, or one outside S1 … Sn. */
  readonly unnumberedLines: number;
  readonly summary: string;
  readonly supported: readonly FactCheckItem[];
  readonly partial: readonly FactCheckItem[];
  readonly unsupported: readonly FactCheckItem[];
  readonly unverifiable: readonly FactCheckItem[];
  readonly editorial: readonly FactCheckItem[];
  /**
   * Operator-attested statements the check placed under ATTESTED with their
   * basis as the note (6.8b): first-hand or opinion, not checked against the
   * records. Absent on results recorded before 6.8b.
   */
  readonly attested?: readonly FactCheckItem[];
  /**
   * Notes the check wrote under EDITORIAL as `Observation: …`, about no
   * statement: never a classification, never evidence, never coverage.
   * Absent on results recorded before observations were kept apart.
   */
  readonly observations?: readonly FactCheckItem[];
  readonly crawlId: string;
  readonly searchWindow: string | null;
  readonly checkedByRunId: string;
  readonly checkedAt: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
};

/**
 * Why a unit's check did not produce a verdict. `coverage-incomplete`: the
 * answer did not classify each numbered statement exactly once, or carried
 * a line that is neither a numbered classification nor an EDITORIAL
 * observation — the check did not do its job, so it is no verdict.
 */
export type ArticleCheckFailureReason = "run-failed" | "run-cancelled" | "output-malformed" | "coverage-incomplete";

/** What a `coverage-incomplete` answer got wrong, kept so an operator can see it. */
export type ArticleCheckCoverageDefect = {
  /** Statement numbers no line placed. */
  readonly missingStatements: readonly number[];
  /** Statement numbers more than one line placed. */
  readonly duplicateStatements: readonly number[];
  /** Lines that were neither a classification of S1 … Sn nor an EDITORIAL observation, as quoted: the first few, shortened. */
  readonly invalidLines: readonly string[];
  /** How many such lines there were in all. */
  readonly invalidLineCount: number;
  /** How many `Observation:` lines the answer carried. */
  readonly observationCount: number;
};

export type ArticleCheckUnitFailure = {
  readonly status: "failed";
  readonly reason: ArticleCheckFailureReason;
  readonly checkedByRunId: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
  /** Present only for `coverage-incomplete`. */
  readonly coverage?: ArticleCheckCoverageDefect;
};

export type ArticleCheckUnitResult = ArticleCheckUnitVerdict | ArticleCheckUnitFailure;

/** One stored row: a unit's identity and hash, bound to one exact article version, and its check. */
export type ArticleCheckUnitRecord = {
  readonly id: string;
  readonly articleId: string;
  readonly articleVersionId: string;
  readonly articleVersion: number;
  readonly unitIndex: number;
  readonly unitKind: ArticleCheckUnitKind;
  readonly unitKey: string;
  readonly part: number;
  readonly partCount: number;
  readonly unitCount: number;
  readonly unitSha256: string;
  readonly status: ArticleCheckUnitStatus;
  /** Null while pending. */
  readonly result: ArticleCheckUnitResult | null;
  readonly checkedByRunId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * The article version's check state, derived from its unit rows and never
 * stored separately.
 *
 * - `unchecked`: no complete set of finished units, and none pending.
 * - `checking`: at least one unit is pending.
 * - `needs-review`: every unit is finished and at least one is not passed.
 * - `passed`: every unit is passed.
 */
export type ArticleCheckState = "unchecked" | "checking" | "needs-review" | "passed";

/** A unit as the panel shows it: its identity and hash, and its stored row, if any. */
export type ArticleCheckUnitView = {
  readonly index: number;
  readonly kind: ArticleCheckUnitKind;
  readonly block: string;
  readonly key: string;
  readonly part: number;
  readonly partCount: number;
  readonly label: string;
  readonly sha256: string;
  readonly statementCount: number;
  /** Its statements from operator-attested paragraphs (6.8b); 0 for a format 1 unit. */
  readonly attestedStatementCount: number;
  readonly bytes: number;
  /** The stored row for this unit of this version, or null when none was recorded. */
  readonly record: ArticleCheckUnitRecord | null;
};

export type ArticleVersionChecks = {
  readonly articleId: string;
  readonly articleStatus: string;
  readonly currentVersion: number;
  readonly version: number;
  readonly versionId: string;
  readonly contentSha256: string;
  /** Non-null when no unit of this version can be checked. */
  readonly refusal: ArticleCheckPlanRefusal | null;
  readonly units: readonly ArticleCheckUnitView[];
  readonly state: ArticleCheckState;
  readonly counts: { readonly total: number; readonly passed: number; readonly needsReview: number; readonly failed: number; readonly pending: number; readonly unchecked: number };
};
