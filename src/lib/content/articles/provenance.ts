/**
 * Source provenance for article content: which immutable draft versions
 * the article was assembled from.
 *
 * A reference names one version exactly — draft id, version number,
 * immutable row id and that version's `nexra-content-draft-version/1`
 * content hash — and nothing else. It carries no fact-check, approval or
 * status field, and any such field is refused: a source section's check or
 * approval is about that section's text, not the assembled article, and is
 * never inherited.
 *
 * Validation of shape only. Nothing here reads a draft or confirms that a
 * referenced version exists or still hashes to the value given.
 *
 * Pure.
 */

import type { ArticleIssue, ArticleSourceReference, SourceReferenceResult } from "@/types/content-article";

export const MAX_SOURCE_REFERENCES = 20;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE_KEYS = ["draftId", "version", "versionId", "contentSha256"] as const;

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function reference(value: unknown, path: string, issues: ArticleIssue[]): ArticleSourceReference {
  if (!isPlainObject(value)) {
    issues.push({ path, code: value === undefined || value === null ? "required" : "type" });
    return { draftId: "", version: 0, versionId: "", contentSha256: "" };
  }
  for (const key of Object.keys(value)) {
    if (!(REFERENCE_KEYS as readonly string[]).includes(key)) issues.push({ path: `${path}.${key}`, code: "unsupported-field" });
  }
  const check = (key: (typeof REFERENCE_KEYS)[number], valid: (v: unknown) => boolean, kind: "string" | "number") => {
    const v = value[key];
    if (v === undefined || v === null || v === "") issues.push({ path: `${path}.${key}`, code: "required" });
    else if (typeof v !== kind) issues.push({ path: `${path}.${key}`, code: "type" });
    else if (!valid(v)) issues.push({ path: `${path}.${key}`, code: "format" });
  };
  check("draftId", (v) => UUID.test(v as string), "string");
  check("version", (v) => Number.isSafeInteger(v) && (v as number) >= 1, "number");
  check("versionId", (v) => UUID.test(v as string), "string");
  check("contentSha256", (v) => SHA256_HEX.test(v as string), "string");
  return {
    draftId: String(value.draftId ?? ""),
    version: typeof value.version === "number" ? value.version : 0,
    versionId: String(value.versionId ?? ""),
    contentSha256: String(value.contentSha256 ?? ""),
  };
}

/**
 * Validates a list of source references: at least one, at most 20, each
 * well formed, no version named twice (by row id, or by draft and number).
 */
export function validateSourceReferences(input: unknown): SourceReferenceResult {
  const issues: ArticleIssue[] = [];
  if (!Array.isArray(input)) return { ok: false, issues: [{ path: "sources", code: input === undefined || input === null ? "required" : "type" }] };
  if (input.length === 0) issues.push({ path: "sources", code: "required" });
  if (input.length > MAX_SOURCE_REFERENCES) issues.push({ path: "sources", code: "too-many" });
  const references = input.map((entry, index) => reference(entry, `sources[${index}]`, issues));
  const rowIds = new Set<string>();
  const numbers = new Set<string>();
  references.forEach((ref, index) => {
    const byNumber = `${ref.draftId}#${ref.version}`;
    if ((ref.versionId !== "" && rowIds.has(ref.versionId)) || (ref.draftId !== "" && numbers.has(byNumber))) issues.push({ path: `sources[${index}]`, code: "duplicate" });
    rowIds.add(ref.versionId);
    numbers.add(byNumber);
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, references };
}
