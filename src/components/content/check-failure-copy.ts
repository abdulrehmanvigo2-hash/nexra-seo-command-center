/**
 * The wording for a refused carry or record (fix F8, milestone C4), shared by
 * the per-unit controls (`article-check-section.tsx`) and the "Check all
 * units" loop (`use-check-all.ts`), so both say the same thing for the same
 * server answer. Text only.
 */

import type { CarryArticleCheckUnitActionResult, RecordArticleCheckUnitActionResult } from "@/app/(app)/projects/article-check-actions";

export const CARRY_FAILURE: Readonly<Record<Exclude<CarryArticleCheckUnitActionResult, { ok: true }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  invalid: "This unit cannot be carried: its identifiers are not what the server expects.",
  unavailable: "Article checks are not persisted on this deployment, so nothing can be carried.",
  "not-current": "Only an unapproved article's current version can carry a result.",
  "already-recorded": "This unit already has a recorded check on this version, so nothing was carried.",
  unit: "This unit could not be resolved on the server from the stored version, so nothing was carried.",
  "not-carryable": "No earlier pass of this exact unit can be carried now.",
  "evidence-unread": "The evidence could not be re-read to compare it, so nothing was carried. Check the unit with a new run instead.",
  refused: "The database refused the carry on one of its own checks. Nothing was written.",
  failed: "The carry could not be completed. Nothing is known to have been written.",
};

export const RECORD_FAILURE: Readonly<Record<Exclude<RecordArticleCheckUnitActionResult, { ok: true }>["reason"], string>> = {
  unauthorized: "Your session has ended. Reload the page to sign in again.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  invalid: "This outcome cannot be recorded: its identifiers are not what the server expects.",
  unavailable: "Article checks are not persisted on this deployment, so nothing can be recorded.",
  "run-not-found": "This run no longer exists on the server.",
  unit: "This unit could not be resolved on the server from the stored version, so nothing was recorded.",
  ineligible: "This run is not this unit's check, or it is simulated or ungrounded, so nothing was recorded.",
  "already-recorded": "This unit already carries a final result, or a pending one from another run, so nothing was recorded.",
  refused: "The database refused the record on one of its own checks. Nothing was written.",
  failed: "The outcome could not be recorded. Nothing is known to have been written.",
};
