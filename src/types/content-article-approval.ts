/**
 * Shapes for the article approval gate (Stage 5, milestone C5): one
 * operator's approval of one exact, immutable article version, given only
 * when every check unit of that version passed. Approval is not
 * publication; nothing here names a destination, a repository or a site.
 */

import type { ArticleCheckState, ArticleCheckPlanRefusal } from "@/types/content-article-check";
import type { ArticleTopicDecision } from "@/types/content-article";
import type { ArticleStatus } from "@/types/content-article-record";

/** One immutable approval record: the exact version, its hashes and unit set, the operator and the time. */
export type ArticleApproval = {
  readonly id: string;
  readonly articleId: string;
  readonly articleVersion: number;
  /** The approved version's immutable row id. */
  readonly articleVersionId: string;
  /** The approved version's canonical-content SHA-256. */
  readonly contentSha256: string;
  /** How many check units the version was approved with. */
  readonly unitCount: number;
  /** The SHA-256 of the ordered unit set (`nexra-article-approval-units/1`). */
  readonly unitsSha256: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  /**
   * Operator-attested paragraphs in the approved version (6.8b), computed by
   * the database from its stored text; 0 for format 1 and for every row
   * recorded before 20261010120000.
   */
  readonly attestedCount: number;
  /** The operator's attestation tick for this approval: true exactly when the count is positive. */
  readonly attestedConfirmed: boolean;
  /**
   * Fix F8: the approved version's check results that were carried from an earlier version, as the database recorded
   * them on the approval (`carried_units`). Absent or empty: every unit was checked on this version by its own run —
   * which holds for every approval recorded before 20261014120000.
   */
  readonly carriedUnits?: readonly ArticleApprovalCarriedUnit[];
};

export type ArticleApprovalCarriedUnit = {
  readonly unitIndex: number;
  readonly unitKey: string;
  readonly fromVersion: number;
  readonly fromUnitId: string;
  readonly runId: string;
  readonly basis: "no-supported" | "evidence-unchanged";
};

/**
 * Why a version cannot be approved. Every applicable reason is reported,
 * in this order; there is no override for any of them.
 */
export type ArticleApprovalBlock =
  /** The article is archived. */
  | "archived"
  /** The version is not the article's current version. */
  | "not-current"
  /** The stored text does not read as C1 content or does not verify against its hash. */
  | "content-unreadable"
  /** The version cannot be cut into check units at all. */
  | "checks-refused"
  /** A stored check row does not match any unit regenerated from the stored text. */
  | "units-mismatch"
  /** At least one unit has no check recorded. */
  | "units-unchecked"
  /** At least one unit's check is still running. */
  | "units-checking"
  /** At least one unit's check failed to produce a verdict. */
  | "units-failed"
  /** At least one unit's check needs a person's review. */
  | "units-needs-review"
  /** The article is not in the `checked` state a complete, all-passed check of its current version leaves it in. */
  | "status-unexpected"
  /** The topic decision is not `update-existing` or `different-angle`. */
  | "topic-decision"
  /** The text still carries a `[NEEDS EVIDENCE` placeholder. */
  | "unresolved-placeholder"
  /** The version attests paragraphs, and its check found fewer than three supported statements (6.8b). */
  | "too-few-supported";

export type ArticleApprovalEligibility =
  /** Every rule holds: the version may be approved. */
  | { readonly status: "eligible" }
  /** This exact version is already approved; nothing more to do. */
  | { readonly status: "approved"; readonly approval: ArticleApproval }
  | { readonly status: "blocked"; readonly blocks: readonly ArticleApprovalBlock[] };

/** The current version's approval state, as the panel shows it. Derived; never stored. */
export type ArticleApprovalState = {
  readonly articleId: string;
  readonly articleStatus: ArticleStatus;
  readonly currentVersion: number;
  readonly versionId: string;
  readonly contentSha256: string;
  readonly topicDecision: ArticleTopicDecision | null;
  /** Operator-attested paragraphs in the current version (6.8b); approving one with any needs the operator's tick. */
  readonly attestedCount: number;
  /** Supported statements the current version's recorded checks found, across its units; null when not every unit is recorded. */
  readonly supportedCount: number | null;
  /** Statements the checks placed under ATTESTED, across the units. */
  readonly attestedStatementCount: number;
  readonly checkState: ArticleCheckState | null;
  readonly checkRefusal: ArticleCheckPlanRefusal | null;
  readonly unitCounts: {
    readonly total: number;
    readonly passed: number;
    readonly needsReview: number;
    readonly failed: number;
    readonly pending: number;
    readonly unchecked: number;
    /** Stored rows of this version that match no regenerated unit. */
    readonly mismatched: number;
  };
  readonly eligibility: ArticleApprovalEligibility;
  /** The pointer on the article: the version it names, whatever the status is now. */
  readonly approvedVersion: number | null;
  /** Every approval of this article, newest first. */
  readonly history: readonly ArticleApproval[];
};
