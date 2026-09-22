/**
 * What an operator's edit must be before it can become a version.
 *
 * Shared by the control and the server: the control uses it to say why a
 * save is refused before asking, and the server applies it again to the
 * request it receives, because the browser's word is not the rule. Pure.
 */

import { MAX_DRAFT_BODY_LENGTH, MAX_DRAFT_TITLE_LENGTH } from "@/lib/content/drafts/parse-writer-output";

export { MAX_DRAFT_BODY_LENGTH, MAX_DRAFT_TITLE_LENGTH };

export type VersionText = {
  readonly title: string;
  readonly body: string;
};

export type VersionTextRefusal = {
  readonly reason: "empty" | "too-long";
  readonly field: "title" | "body";
};

export type VersionTextResult =
  | { readonly ok: true; readonly value: VersionText }
  | { readonly ok: false; readonly refusal: VersionTextRefusal };

/** Line endings folded to LF and surrounding whitespace removed: what is stored and what is compared. */
export function normaliseText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

/** The edit as it would be stored, or why it cannot be. Anything that is not a string is empty. */
export function normaliseVersionText(title: unknown, body: unknown): VersionTextResult {
  const cleanTitle = typeof title === "string" ? normaliseText(title) : "";
  const cleanBody = typeof body === "string" ? normaliseText(body) : "";
  if (cleanTitle.length === 0) return { ok: false, refusal: { reason: "empty", field: "title" } };
  if (cleanTitle.length > MAX_DRAFT_TITLE_LENGTH) return { ok: false, refusal: { reason: "too-long", field: "title" } };
  if (cleanBody.length === 0) return { ok: false, refusal: { reason: "empty", field: "body" } };
  if (cleanBody.length > MAX_DRAFT_BODY_LENGTH) return { ok: false, refusal: { reason: "too-long", field: "body" } };
  return { ok: true, value: { title: cleanTitle, body: cleanBody } };
}

/** Whether the edit is the saved text again: such a save creates no version. */
export function isUnchanged(edit: VersionText, saved: VersionText): boolean {
  return normaliseText(edit.title) === normaliseText(saved.title) && normaliseText(edit.body) === normaliseText(saved.body);
}

/** The operator's words for a refusal, for the field it names. */
export function refusalMessage(refusal: VersionTextRefusal): string {
  const field = refusal.field === "title" ? "The section title" : "The body";
  if (refusal.reason === "empty") return `${field} cannot be empty.`;
  const limit = refusal.field === "title" ? MAX_DRAFT_TITLE_LENGTH : MAX_DRAFT_BODY_LENGTH;
  return `${field} is over ${limit.toLocaleString("en-GB")} characters.`;
}
