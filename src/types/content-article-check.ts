/**
 * Shapes for article check units (Stage 5, milestone C4): the bounded
 * pieces one immutable article version is fact-checked in, and the result
 * recorded for each piece against that exact version.
 *
 * A unit is derived, never stored as content: its text is regenerated from
 * the version's stored canonical text every time, and only its identity
 * (index, kind, key), its hash and its check result are stored. Nothing here
 * is an approval or a publication.
 */

import type { FactCheckItem } from "@/types/content-draft";

/** The five unit kinds, in the order they appear in an article. */
export type ArticleCheckUnitKind = "metadata" | "lead-introduction" | "section" | "faq" | "cta";

/**
 * One check unit of one article version.
 *
 * `index` is the unit's zero-based position in the deterministic order
 * (metadata, lead-introduction, each H2 section in article order, faq when
 * the article has FAQs, cta). `key` is `metadata`, `lead-introduction`,
 * `section:<section id>`, `faq` or `cta`: derived from the content, never
 * from a database id.
 */
export type ArticleCheckUnit = {
  readonly index: number;
  readonly kind: ArticleCheckUnitKind;
  readonly key: string;
  /** What the operator reads: the section heading, or a fixed label. */
  readonly label: string;
  /** The exact text under check: the unit's canonical `nexra-article-check-unit/1` serialisation. */
  readonly text: string;
  /** How many statements the unit holds, as the check counts them. */
  readonly statementCount: number;
  /** The text's size in UTF-8 bytes. */
  readonly bytes: number;
  /** Null when the unit fits one bounded check; otherwise why it is refused. Never truncated. */
  readonly oversize: "too-many-statements" | "too-many-bytes" | null;
};

/** A stored unit's check status. `failed` is an execution or system failure, never a content verdict. */
export type ArticleCheckUnitStatus = "pending" | "passed" | "needs-review" | "failed";

export type ArticleCheckCounts = {
  readonly supported: number;
  readonly partial: number;
  readonly unsupported: number;
  readonly unverifiable: number;
  readonly editorial: number;
};

/** A completed check's structured result, built by the server from the run's text and evidence summary. */
export type ArticleCheckUnitVerdict = {
  readonly status: "passed" | "needs-review";
  readonly counts: ArticleCheckCounts;
  /** Statements the unit holds, as counted by the server. */
  readonly statementCount: number;
  /** Lines the check placed under a heading. */
  readonly classifiedCount: number;
  /** Whether every statement was placed: classifiedCount >= statementCount. */
  readonly coverageComplete: boolean;
  readonly summary: string;
  readonly supported: readonly FactCheckItem[];
  readonly partial: readonly FactCheckItem[];
  readonly unsupported: readonly FactCheckItem[];
  readonly unverifiable: readonly FactCheckItem[];
  readonly editorial: readonly FactCheckItem[];
  readonly crawlId: string;
  readonly searchWindow: string | null;
  readonly checkedByRunId: string;
  readonly checkedAt: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
};

/** Why a unit's check did not produce a verdict. */
export type ArticleCheckFailureReason = "run-failed" | "run-cancelled" | "output-malformed";

export type ArticleCheckUnitFailure = {
  readonly status: "failed";
  readonly reason: ArticleCheckFailureReason;
  readonly checkedByRunId: string;
  readonly recordedBy: string;
  readonly recordedAt: string;
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
  readonly key: string;
  readonly label: string;
  readonly sha256: string;
  readonly statementCount: number;
  readonly bytes: number;
  readonly oversize: ArticleCheckUnit["oversize"];
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
  readonly units: readonly ArticleCheckUnitView[];
  readonly state: ArticleCheckState;
  readonly counts: { readonly total: number; readonly passed: number; readonly needsReview: number; readonly failed: number; readonly pending: number; readonly unchecked: number };
};
