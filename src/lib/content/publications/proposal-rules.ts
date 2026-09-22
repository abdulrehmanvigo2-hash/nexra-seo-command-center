/**
 * Which draft version may be proposed for publication, decided from the
 * parent, the version and its recorded fact-check alone.
 *
 * The policy is explicit and has no override. A version is eligible only
 * when it is the draft's current version, the draft is live and approved,
 * the approved version is that same version, its recorded fact-check passed
 * and was recorded for it, it carries no unresolved `[NEEDS EVIDENCE: …]`
 * placeholder, and no proposal for the draft is already active. Shared by
 * the panel, which uses it to say why no control is offered, and by the
 * server, which applies it again and then relies on one database function
 * that re-checks every condition under a lock on the draft.
 *
 * A proposal is not a publication, and nothing here sends anything.
 *
 * Pure: no store, no network, safe to import from either side.
 */

import { readFactCheck } from "@/lib/content/drafts/parse-fact-check-output";
import type { ContentDraft, ContentDraftVersion } from "@/types/content-draft";
import type { PublicationProposal } from "@/types/content-publication";

export type ProposalRefusal =
  /** The draft is archived. */
  | "draft-archived"
  /** The draft is recorded as published. */
  | "draft-published"
  /** The version is not the draft's current one. */
  | "not-current"
  /** No fact-check is recorded for this version, or the recorded one is not for it. */
  | "not-fact-checked"
  /** The recorded fact-check needs review; that is not a pass. */
  | "fact-check-needs-review"
  /** The recorded fact-check failed. */
  | "fact-check-failed"
  /** The version still carries a `[NEEDS EVIDENCE: …]` placeholder. */
  | "unresolved-placeholders"
  /** The draft is not in the approved state. */
  | "not-approved"
  /** The draft's approved version is not this version. */
  | "approval-not-current"
  /** A proposal for this draft is already active. */
  | "proposal-exists"
  /** No destination is registered for this project. */
  | "no-destination";

export type ProposalEligibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ProposalRefusal };

/** The marker the Writer uses for a statement that still needs evidence. Matched without regard to case. */
export const PLACEHOLDER_MARKER = "[needs evidence";

/** Whether the version still carries a placeholder, listed or left in its text. */
export function hasUnresolvedPlaceholders(version: Pick<ContentDraftVersion, "title" | "body" | "placeholders">): boolean {
  return (
    version.placeholders.length > 0 ||
    version.title.toLowerCase().includes(PLACEHOLDER_MARKER) ||
    version.body.toLowerCase().includes(PLACEHOLDER_MARKER)
  );
}

/** The whole rule, in order, with the reason the first failing check gives. */
export function proposalEligibility(
  draft: ContentDraft,
  version: ContentDraftVersion,
  active: PublicationProposal | null,
): ProposalEligibility {
  if (draft.status === "archived") return { ok: false, reason: "draft-archived" };
  if (draft.status === "published") return { ok: false, reason: "draft-published" };
  if (version.draftId !== draft.id || version.version !== draft.currentVersion) return { ok: false, reason: "not-current" };
  const check = readFactCheck(version.factCheck);
  if (check === null || check.version !== version.version || check.draftId !== draft.id) {
    return { ok: false, reason: "not-fact-checked" };
  }
  if (check.status === "needs-review") return { ok: false, reason: "fact-check-needs-review" };
  if (check.status === "failed") return { ok: false, reason: "fact-check-failed" };
  if (hasUnresolvedPlaceholders(version)) return { ok: false, reason: "unresolved-placeholders" };
  if (draft.status !== "approved") return { ok: false, reason: "not-approved" };
  if (draft.approvedVersion !== version.version || draft.approvedBy === null || draft.approvedAt === null) {
    return { ok: false, reason: "approval-not-current" };
  }
  if (active !== null) return { ok: false, reason: "proposal-exists" };
  return { ok: true };
}

/**
 * Whether a proposal still describes the draft as it stands: the same
 * version, still current, still the approved one, approved at the same
 * moment. A proposal that no longer does stays on record, marked stale;
 * it is withdrawn by the operator, never silently moved.
 */
export function isProposalCurrent(draft: ContentDraft, proposal: PublicationProposal): boolean {
  return (
    proposal.status === "proposed" &&
    proposal.draftId === draft.id &&
    draft.status === "approved" &&
    draft.currentVersion === proposal.version &&
    draft.approvedVersion === proposal.version &&
    draft.approvedBy === proposal.approvedBy &&
    draft.approvedAt === proposal.approvedAt
  );
}

export const MIN_SLUG_LENGTH = 3;
export const MAX_SLUG_LENGTH = 80;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SlugRefusal = "empty" | "too-short" | "too-long" | "format";

export type SlugResult = { readonly ok: true; readonly slug: string } | { readonly ok: false; readonly refusal: SlugRefusal };

/** A target identifier: lowercase letters, digits and single hyphens, 3 to 80 characters. Nothing is trimmed or corrected. */
export function validateSlug(value: unknown): SlugResult {
  if (typeof value !== "string" || value.length === 0) return { ok: false, refusal: "empty" };
  if (value.length < MIN_SLUG_LENGTH) return { ok: false, refusal: "too-short" };
  if (value.length > MAX_SLUG_LENGTH) return { ok: false, refusal: "too-long" };
  if (!SLUG.test(value)) return { ok: false, refusal: "format" };
  return { ok: true, slug: value };
}

/** A starting suggestion from the title, for the operator to accept or change. Never applied without them. */
export function suggestSlug(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (words.length <= MAX_SLUG_LENGTH) return words;
  const cut = words.slice(0, MAX_SLUG_LENGTH);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen >= MIN_SLUG_LENGTH ? cut.slice(0, lastHyphen) : cut).replace(/-+$/g, "");
}

export function slugRefusalMessage(refusal: SlugRefusal): string {
  switch (refusal) {
    case "empty":
      return "Enter a slug.";
    case "too-short":
      return `A slug is at least ${MIN_SLUG_LENGTH} characters.`;
    case "too-long":
      return `A slug is at most ${MAX_SLUG_LENGTH} characters.`;
    case "format":
      return "Use lowercase letters, digits and single hyphens only, with no hyphen at either end.";
  }
}

/** The operator's words for a refusal. */
export function proposalRefusalMessage(reason: ProposalRefusal): string {
  switch (reason) {
    case "draft-archived":
      return "This draft is archived, so nothing in it can be proposed for publication.";
    case "draft-published":
      return "This draft is already recorded as published.";
    case "not-current":
      return "Only the current version can be proposed for publication.";
    case "not-fact-checked":
      return "No fact-check is recorded for this version. A version is proposed only after its recorded check passed and it was approved.";
    case "fact-check-needs-review":
      return "The recorded fact-check of this version needs review. That is not a pass, so this version cannot be proposed for publication.";
    case "fact-check-failed":
      return "The recorded fact-check of this version failed, so it cannot be proposed for publication.";
    case "unresolved-placeholders":
      return "This version still carries a [NEEDS EVIDENCE: …] placeholder. Resolve it in a new version, check and approve that version first.";
    case "not-approved":
      return "This version is not approved. Only the approved current version can be proposed for publication.";
    case "approval-not-current":
      return "The draft's approval does not name this version, so it cannot be proposed.";
    case "proposal-exists":
      return "A publication proposal for this draft is already active. Withdraw it before preparing another.";
    case "no-destination":
      return "No publication destination is registered for this project.";
  }
}
