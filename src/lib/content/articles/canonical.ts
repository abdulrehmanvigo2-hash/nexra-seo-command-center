/**
 * The canonical serialisation of article content: format
 * `nexra-article-content/1`.
 *
 * One validated article has exactly one canonical text, and it is the text
 * that is hashed. The rules:
 *
 * - A single JSON object with no whitespace between tokens. Its first member
 *   is `"format":"nexra-article-content/1"`; the rest follow in the fixed
 *   order of `ArticleContent`'s declaration, and nested objects in the fixed
 *   order of theirs. Property order never depends on how the input was built.
 * - Arrays keep the author's order. Order is content (sections, paragraphs,
 *   keywords, FAQs and links are read in sequence), so nothing is sorted and
 *   a reordering is a different article with a different hash.
 * - Every field is always written. Optional lists that were omitted are
 *   written as `[]`, so omission and an empty list are the same content.
 *   There is no `null`, no absent key, no number, no boolean.
 * - Strings are written by `JSON.stringify`, whose output ECMAScript fixes:
 *   `"` and `\` are escaped, and every other character is written as itself.
 *   Validation has already refused control characters and unpaired
 *   surrogates, so no `\u` escape and no lossy character can occur.
 * - The bytes are the text's UTF-8 encoding.
 * - Nothing else goes in: no id, version, status, actor, timestamp,
 *   publication date, provenance, randomness or environment value.
 *
 * The guarantee, precisely: equal validated content gives identical bytes,
 * and any difference in content — one code point — gives different bytes.
 * Because validation requires NFC and refuses invisible and direction-
 * changing format characters, a precomposed/decomposed pair or a hidden
 * character cannot make two visually identical texts differ. Look-alike
 * characters from different scripts are not detected: they are different
 * code points and give different bytes.
 *
 * PostgreSQL can recompute the hash from the stored text alone:
 * `encode(sha256(convert_to(canonical, 'UTF8')), 'hex')`. The text must be
 * stored as `text`, not `jsonb` — `jsonb` reorders keys and changes spacing.
 *
 * FORMAT 2 (Phase 6, checkpoint 6.8b). An article with operator-attested
 * paragraphs is written as `nexra-article-content/2`: the same members in
 * the same order, then one last member, `attestations`, a list of
 * `{"locator":…,"basis":…}` in the author's order. An article with none is
 * written as format 1, exactly as before — no `attestations` member, the same
 * bytes, the same hash — so every stored version, unit, approval and
 * preview made before 6.8b keeps its bytes. Only the format a text's content
 * implies is ever accepted back: a format 2 text with no attestations, or a
 * format 1 text carrying any, is refused.
 *
 * Pure.
 */

import { validateArticleContent } from "@/lib/content/articles/validate";
import type { ArticleAttestation, ArticleContent, ArticleFaq, ArticleInternalLink, ArticleSection, ArticleSubsection, ValidatedArticleContent } from "@/types/content-article";

export const ARTICLE_CANONICAL_FORMAT = "nexra-article-content/1";
/** The format of an article with at least one attested paragraph (6.8b). */
export const ARTICLE_CANONICAL_FORMAT_ATTESTED = "nexra-article-content/2";

/** The format an article's content is written in: 2 only when it attests a paragraph. */
export function articleCanonicalFormat(article: Pick<ArticleContent, "attestations">): string {
  return article.attestations.length > 0 ? ARTICLE_CANONICAL_FORMAT_ATTESTED : ARTICLE_CANONICAL_FORMAT;
}

type Member = readonly [key: string, json: string];

function str(value: string): string {
  return JSON.stringify(value);
}

function array<T>(items: readonly T[], write: (item: T) => string): string {
  return `[${items.map(write).join(",")}]`;
}

function object(members: readonly Member[]): string {
  return `{${members.map(([key, json]) => `${str(key)}:${json}`).join(",")}}`;
}

function subsection(value: ArticleSubsection): string {
  return object([
    ["id", str(value.id)],
    ["heading", str(value.heading)],
    ["paragraphs", array(value.paragraphs, str)],
  ]);
}

function section(value: ArticleSection): string {
  return object([
    ["id", str(value.id)],
    ["heading", str(value.heading)],
    ["paragraphs", array(value.paragraphs, str)],
    ["subsections", array(value.subsections, subsection)],
  ]);
}

function faq(value: ArticleFaq): string {
  return object([
    ["question", str(value.question)],
    ["answer", str(value.answer)],
  ]);
}

function link(value: ArticleInternalLink): string {
  return object([
    ["path", str(value.path)],
    ["anchorText", str(value.anchorText)],
    ["sectionId", str(value.sectionId)],
  ]);
}

function attestation(value: ArticleAttestation): string {
  return object([
    ["locator", str(value.locator)],
    ["basis", str(value.basis)],
  ]);
}

function write(article: ArticleContent): string {
  const attested = article.attestations.length > 0;
  return object([
    ["format", str(articleCanonicalFormat(article))],
    ["topic", str(article.topic)],
    ["searchIntent", str(article.searchIntent)],
    ["slug", str(article.slug)],
    ["title", str(article.title)],
    ["metaTitle", str(article.metaTitle)],
    ["metaDescription", str(article.metaDescription)],
    ["excerpt", str(article.excerpt)],
    ["category", str(article.category)],
    ["keywords", array(article.keywords, str)],
    ["lead", str(article.lead)],
    ["introduction", array(article.introduction, str)],
    ["sections", array(article.sections, section)],
    ["faqs", array(article.faqs, faq)],
    ["internalLinks", array(article.internalLinks, link)],
    ["ctaTitle", str(article.ctaTitle)],
    ["ctaBody", str(article.ctaBody)],
    ["topicDecision", str(article.topicDecision)],
    ...(attested ? ([["attestations", array(article.attestations, attestation)]] as const) : []),
  ]);
}

/**
 * The canonical text of validated content. The content is validated again
 * here, so a value that only claims the brand (a cast) cannot be serialised.
 */
export function canonicalArticleJson(article: ValidatedArticleContent): string {
  const checked = validateArticleContent(article);
  if (!checked.ok) throw new Error("canonicalArticleJson: content is not valid article content");
  return write(checked.article);
}

/**
 * Reads stored canonical text back: the validated content, or null when the
 * text is not exactly the canonical serialisation of valid content in this
 * format. Byte-for-byte: any other spacing, order or escaping is refused.
 */
export function readCanonicalArticle(text: string): ValidatedArticleContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { format, ...content } = parsed as Record<string, unknown>;
  if (format !== ARTICLE_CANONICAL_FORMAT && format !== ARTICLE_CANONICAL_FORMAT_ATTESTED) return null;
  const checked = validateArticleContent(content);
  if (!checked.ok) return null;
  return write(checked.article) === text ? checked.article : null;
}
