/**
 * Which article version may be approved (Stage 5, milestone C5), decided
 * from the article, the version's stored text and the version's check
 * units alone.
 *
 * The rule is explicit and fails closed. Only the current version of a
 * live article may be approved, and only when its stored text reads as C1
 * content and verifies against its hash, it yields a check plan, every
 * stored check row matches a unit regenerated from that text, every unit
 * passed, the article is `checked`, the operator chose a topic decision
 * that creates the page (`update-existing` or `different-angle`), and no
 * `[NEEDS EVIDENCE` placeholder is left anywhere in the text. There is no
 * override: an unchecked, running, failed or needs-review unit blocks
 * approval, whatever else holds.
 *
 * Every applicable reason is returned, so the operator sees all of them at
 * once. Shared by the panel, which uses it to say why the button is absent,
 * and by the server, which applies it before the database function checks
 * the same conditions again under the article's row lock.
 *
 * An article with operator-attested paragraphs (6.8b) is also blocked when
 * its checks found fewer than three supported statements
 * (`MIN_SUPPORTED_WITH_ATTESTATION`); the operator's attestation tick is
 * asked for at the moment of approval, not reported as a block.
 *
 * Approval is not publication. Nothing here, and nothing that follows it,
 * sends a word anywhere.
 *
 * Pure: no store, no network; safe to import from either side.
 */

import type { ArticleApproval, ArticleApprovalBlock, ArticleApprovalEligibility } from "@/types/content-article-approval";
import type { ArticleTopicDecision } from "@/types/content-article";
import type { ArticleCheckPlanRefusal, ArticleCheckUnitStatus } from "@/types/content-article-check";
import type { ArticleStatus } from "@/types/content-article-record";

/** The topic decisions under which an approved article is a page to create. */
export const APPROVABLE_TOPIC_DECISIONS: readonly ArticleTopicDecision[] = ["update-existing", "different-angle"];

/** An article that attests paragraphs needs at least this many supported statements across its checks (6.8b). */
export const MIN_SUPPORTED_WITH_ATTESTATION = 3;

/** The placeholder the Writer leaves where evidence is missing, matched case-insensitively. */
export const ARTICLE_PLACEHOLDER_MARKER = "[needs evidence";

/** Whether the stored canonical text still carries a placeholder, anywhere. */
export function hasArticlePlaceholder(canonicalContent: string): boolean {
  return canonicalContent.toLowerCase().includes(ARTICLE_PLACEHOLDER_MARKER);
}

export type ArticleApprovalFacts = {
  readonly articleStatus: ArticleStatus;
  readonly currentVersion: number;
  /** The version asked about. */
  readonly version: number;
  /** The stored text reads as C1 content and verifies against its stored hash. */
  readonly contentReadable: boolean;
  /** Null when the version yields a check plan. */
  readonly planRefusal: ArticleCheckPlanRefusal | null;
  /** Each regenerated unit's matching stored row status, or null when none is recorded. */
  readonly unitStatuses: readonly (ArticleCheckUnitStatus | null)[];
  /** Stored rows of this version that match no regenerated unit. */
  readonly mismatchedRows: number;
  readonly topicDecision: ArticleTopicDecision | null;
  readonly hasPlaceholder: boolean;
  /** Operator-attested paragraphs in the version (6.8b); 0 for format 1. */
  readonly attestedCount?: number;
  /** Supported statements across the version's recorded checks, or null when not every unit has one. */
  readonly supportedCount?: number | null;
  /** The recorded approval of this exact version, if any. */
  readonly approval: ArticleApproval | null;
};

/** The whole rule, with every reason that applies. */
export function articleApprovalEligibility(facts: ArticleApprovalFacts): ArticleApprovalEligibility {
  if (facts.approval !== null && facts.articleStatus === "approved" && facts.version === facts.currentVersion) {
    return { status: "approved", approval: facts.approval };
  }
  const blocks: ArticleApprovalBlock[] = [];
  if (facts.articleStatus === "archived") blocks.push("archived");
  if (facts.version !== facts.currentVersion) blocks.push("not-current");
  if (!facts.contentReadable) {
    blocks.push("content-unreadable");
    return { status: "blocked", blocks };
  }
  if (facts.planRefusal !== null) blocks.push("checks-refused");
  if (facts.mismatchedRows > 0) blocks.push("units-mismatch");
  if (facts.planRefusal === null) {
    const statuses = facts.unitStatuses;
    if (statuses.length === 0 || statuses.some((s) => s === null)) blocks.push("units-unchecked");
    if (statuses.some((s) => s === "pending")) blocks.push("units-checking");
    if (statuses.some((s) => s === "failed")) blocks.push("units-failed");
    if (statuses.some((s) => s === "needs-review")) blocks.push("units-needs-review");
  }
  if (facts.articleStatus !== "checked" && facts.articleStatus !== "archived") blocks.push("status-unexpected");
  if (facts.topicDecision === null || !APPROVABLE_TOPIC_DECISIONS.includes(facts.topicDecision)) blocks.push("topic-decision");
  if (facts.hasPlaceholder) blocks.push("unresolved-placeholder");
  if ((facts.attestedCount ?? 0) > 0 && facts.supportedCount !== null && facts.supportedCount !== undefined && facts.supportedCount < MIN_SUPPORTED_WITH_ATTESTATION) {
    blocks.push("too-few-supported");
  }
  return blocks.length === 0 ? { status: "eligible" } : { status: "blocked", blocks };
}

/** The operator's words for a block. */
export function approvalBlockMessage(block: ArticleApprovalBlock): string {
  switch (block) {
    case "archived":
      return "The article is archived, so nothing in it is approved.";
    case "not-current":
      return "Only the article's current version can be approved.";
    case "content-unreadable":
      return "The stored text of this version does not read as article content or does not verify against its hash.";
    case "checks-refused":
      return "This version cannot be cut into check units, so it cannot be checked or approved. Save a new version.";
    case "units-mismatch":
      return "A stored check result does not match the units regenerated from this version's text.";
    case "units-unchecked":
      return "At least one check unit has no recorded check. Every unit must be checked and pass.";
    case "units-checking":
      return "At least one check unit is still being checked.";
    case "units-failed":
      return "At least one check unit's check failed to produce a verdict. Check that unit again with a new run.";
    case "units-needs-review":
      return "At least one check unit needs review. That result is final for this version: edit the text, save a new version and check it.";
    case "status-unexpected":
      return "The article is not marked Checked. It is marked Checked only when every unit of its current version passed.";
    case "topic-decision":
      return "The topic decision must be Update existing or Different angle. Unset and Do not create are not approvable.";
    case "unresolved-placeholder":
      return "The text still carries a [NEEDS EVIDENCE: …] placeholder. Resolve it in a new version, then check that version.";
    case "too-few-supported":
      return `This version attests paragraphs, so its checks must find at least ${MIN_SUPPORTED_WITH_ATTESTATION} supported statements; they found fewer. Add checkable statements in a new version and check it.`;
  }
}
