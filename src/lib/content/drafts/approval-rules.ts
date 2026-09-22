/**
 * Which draft version may be approved, decided from the parent, the version
 * and the version's recorded fact-check alone.
 *
 * The policy is explicit and has no override: only a version whose recorded
 * fact-check passed is eligible. `needs-review` is not a pass and is not
 * treated as one; `failed` is not; an unchecked version is not. Beyond the
 * check, the version must be the draft's current one and the draft must be
 * live and in the state the fact-check milestone leaves it in
 * (`fact-checked`), so approval is always of the exact text a passed check
 * was recorded for. Shared by the panel, which uses it to say why the
 * button is absent, and by the server, which applies it again and then
 * relies on one conditional statement for the write.
 *
 * Approval is not publication. Nothing here, and nothing that follows it,
 * sends a word anywhere.
 *
 * Pure: no store, no network, safe to import from either side.
 */

import { readFactCheck } from "@/lib/content/drafts/parse-fact-check-output";
import type { ContentDraft, ContentDraftVersion } from "@/types/content-draft";

export type ApprovalRefusal =
  /** The draft is archived. */
  | "draft-archived"
  /** The draft is already published; approval is behind it. */
  | "draft-published"
  /** The version is not the draft's current one; only the current text is approved. */
  | "not-current"
  /** This exact version is already the approved one. */
  | "already-approved"
  /** No fact-check has been recorded for this version. */
  | "not-fact-checked"
  /** The recorded fact-check needs a person's review; that is not a pass. */
  | "fact-check-needs-review"
  /** The recorded fact-check failed. */
  | "fact-check-failed"
  /** The parent is not in the state a passed check of its current version leaves it in. */
  | "status-unexpected";

export type ApprovalEligibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ApprovalRefusal };

/** The whole rule, in order, with the reason the first failing check gives. */
export function approvalEligibility(draft: ContentDraft, version: ContentDraftVersion): ApprovalEligibility {
  if (draft.status === "archived") return { ok: false, reason: "draft-archived" };
  if (draft.status === "published") return { ok: false, reason: "draft-published" };
  if (version.version !== draft.currentVersion) return { ok: false, reason: "not-current" };
  if (draft.status === "approved" && draft.approvedVersion === version.version) return { ok: false, reason: "already-approved" };
  const check = readFactCheck(version.factCheck);
  if (check === null) return { ok: false, reason: "not-fact-checked" };
  if (check.status === "needs-review") return { ok: false, reason: "fact-check-needs-review" };
  if (check.status === "failed") return { ok: false, reason: "fact-check-failed" };
  if (draft.status !== "fact-checked") return { ok: false, reason: "status-unexpected" };
  return { ok: true };
}

/** Whether this version is the one the parent records as approved, whatever the parent's status is now. */
export function isApprovedVersion(draft: ContentDraft, version: ContentDraftVersion): boolean {
  return draft.approvedVersion === version.version;
}

/** The operator's words for a refusal. */
export function approvalRefusalMessage(reason: ApprovalRefusal): string {
  switch (reason) {
    case "draft-archived":
      return "This draft is archived, so nothing in it is approved.";
    case "draft-published":
      return "This draft is recorded as published; approval is behind it.";
    case "not-current":
      return "Only the current version can be approved.";
    case "already-approved":
      return "This version is already the approved one.";
    case "not-fact-checked":
      return "No fact-check has been recorded for this version. Run and record a fact-check first.";
    case "fact-check-needs-review":
      return "The recorded fact-check needs review: at least one statement is partly supported, unverifiable, or no statement rests on a record. That is not a pass, so this version is not eligible. Edit the text and check the new version.";
    case "fact-check-failed":
      return "The recorded fact-check failed: at least one statement is held by no record. This version is not eligible. Edit the text and check the new version.";
    case "status-unexpected":
      return "This draft is not in the fact-checked state, so its current version cannot be approved.";
  }
}
