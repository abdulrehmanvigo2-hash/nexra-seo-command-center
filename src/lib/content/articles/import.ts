/**
 * Article import (fix F9, audit A5-03): one pasted JSON fills the article
 * editor's form, instead of about 35 typed fields.
 *
 * It accepts the article content object — the C1 contract the editor saves
 * (topic, searchIntent, slug, title, … sections with their H3 subsections,
 * faqs, internalLinks, the CTA, topicDecision and, when there are any,
 * attestations) — or the stored canonical text of a version
 * (`nexra-article-content/1` or `/2`), which is the same object with its
 * format member.
 *
 * The C1 validator decides everything: an unknown field, a missing one, a
 * wrong type, a bad slug, an attestation naming no paragraph — each is
 * listed against its field, and nothing is filled. A valid paste fills
 * every field through `formFromContent`, exactly as an "Edit" of a stored
 * version does. Importing writes nothing: the operator reviews the filled
 * form (and, when something is attested, the F4 preview of its labels) and
 * saves with Create or Save as before; the server validates again.
 *
 * Pure: no store, no network; safe in the browser.
 */

import { readCanonicalArticle } from "@/lib/content/articles/canonical";
import { formFromContent, issueMessage, type ArticleForm } from "@/lib/content/articles/editor-form";
import { validateArticleContent } from "@/lib/content/articles/validate";
import type { ArticleIssue } from "@/types/content-article";

/** A paste larger than this is refused before parsing (the largest valid article is far below it). */
export const MAX_IMPORT_CHARACTERS = 400_000;

export type ArticleImportResult =
  | { readonly ok: true; readonly form: ArticleForm; readonly source: "content" | "canonical"; readonly summary: string }
  | { readonly ok: false; readonly errors: readonly string[]; readonly issues: readonly ArticleIssue[] };

function summaryOf(form: ArticleForm): string {
  const h3 = form.sections.reduce((sum, section) => sum + section.subsections.length, 0);
  const parts = [
    `${form.sections.length} ${form.sections.length === 1 ? "section" : "sections"}`,
    `${h3} H3`,
    `${form.faqs.length} ${form.faqs.length === 1 ? "FAQ" : "FAQs"}`,
    `${form.internalLinks.length} ${form.internalLinks.length === 1 ? "link" : "links"}`,
    `${form.attestations.length} attested ${form.attestations.length === 1 ? "paragraph" : "paragraphs"}`,
  ];
  return `Filled from the pasted JSON: ${parts.join(", ")}. Nothing is saved until you review the form and save.`;
}

/** The pasted text as a filled form, or every reason it cannot be one. */
export function importArticleJson(text: string): ArticleImportResult {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, errors: ["Paste the article JSON first."], issues: [] };
  if (text.length > MAX_IMPORT_CHARACTERS) {
    return { ok: false, errors: [`The pasted text is longer than ${MAX_IMPORT_CHARACTERS.toLocaleString("en-GB")} characters; nothing was read.`], issues: [] };
  }

  // A version's stored canonical text, byte for byte, is accepted as it is.
  const canonical = readCanonicalArticle(text);
  if (canonical !== null) {
    const form = formFromContent(canonical);
    return { ok: true, form, source: "canonical", summary: summaryOf(form) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "it could not be parsed";
    return { ok: false, errors: [`The pasted text is not valid JSON: ${detail}`], issues: [] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ["The pasted JSON must be one article object, { … }, not a list or a single value."], issues: [] };
  }

  // The canonical text's own format member is not part of the content contract; anything else unknown is refused.
  const { format, ...rest } = parsed as Record<string, unknown>;
  const content = format === "nexra-article-content/1" || format === "nexra-article-content/2" ? rest : parsed;

  const checked = validateArticleContent(content);
  if (!checked.ok) return { ok: false, errors: checked.issues.map(issueMessage), issues: checked.issues };
  const form = formFromContent(checked.article);
  return { ok: true, form, source: "content", summary: summaryOf(form) };
}
