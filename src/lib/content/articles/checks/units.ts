/**
 * Article check units (Stage 5, milestone C4): one immutable article
 * version cut into the bounded pieces it is fact-checked in.
 *
 * An article is never checked as one prompt. It is cut, deterministically,
 * into units in this order:
 *
 *   0  metadata           topic, search intent, title, meta title, meta
 *                         description, excerpt, category, keywords
 *   1  lead-introduction  the lead and the introduction paragraphs
 *   2… section            one per H2, in article order: its id, heading,
 *                         paragraphs, and the H3 subsections under it
 *      faq                one unit holding every FAQ, only when there are any
 *      cta                the CTA title and body
 *
 * The slug, the topic decision and the internal links are not checked by a
 * model: they are structure, and C1 validates their syntax in code.
 *
 * A unit's key is `metadata`, `lead-introduction`, `section:<section id>`,
 * `faq` or `cta` — derived from the content, never from a database id, so
 * the same content always gives the same keys. Its text is the unit's own
 * canonical serialisation, format `nexra-article-check-unit/1`: one JSON
 * object with no whitespace between tokens, members in a fixed order, the
 * format tag first, then the kind, the key and the unit's content. Only the
 * unit's own content goes in — not its index, the article id, the version,
 * or anything about the rest of the article — so editing one section
 * changes that section's text and hash and no other unit's. The hash
 * (server-only, `./unit-hash`) is SHA-256 over the text's UTF-8 bytes.
 *
 * Every unit is bounded before it is checked: at most
 * `MAX_UNIT_STATEMENTS` statements and `MAX_UNIT_BYTES` bytes of text, so
 * the Research & Evidence answer stays under the runtime's output ceiling
 * and every statement is placed. A unit over either bound is marked
 * `oversize` and refused by the check, deterministically; it is never cut.
 *
 * Pure: no store, no network, no hash; safe to import from either side.
 */

import { MAX_CHECKED_STATEMENTS } from "@/lib/content/drafts/fact-check-grounding";
import type { ArticleCheckUnit, ArticleCheckUnitKind } from "@/types/content-article-check";
import type { ArticleContent, ArticleSection, ValidatedArticleContent } from "@/types/content-article";

export const ARTICLE_CHECK_UNIT_FORMAT = "nexra-article-check-unit/1";

/** The most statements one unit may hold: what one check answers for, every statement placed. */
export const MAX_UNIT_STATEMENTS = MAX_CHECKED_STATEMENTS;
/** The most UTF-8 bytes of unit text one check quotes. */
export const MAX_UNIT_BYTES = 6_000;

const encoder = new TextEncoder();

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

/**
 * How many statements a passage holds: one per sentence, a sentence ending
 * at `.`, `!`, `?` or `…` followed by whitespace, and at least one for any
 * non-empty text. Fixed and simple on purpose: the count bounds a check and
 * decides whether every statement was placed; it is never shown as a finding.
 */
export function statementsIn(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/(?<=[.!?…])\s+/u).filter((part) => part.trim().length > 0).length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sectionText(section: ArticleSection): string {
  return object([
    ["id", str(section.id)],
    ["heading", str(section.heading)],
    ["paragraphs", array(section.paragraphs, str)],
    [
      "subsections",
      array(section.subsections, (sub) =>
        object([
          ["id", str(sub.id)],
          ["heading", str(sub.heading)],
          ["paragraphs", array(sub.paragraphs, str)],
        ]),
      ),
    ],
  ]);
}

function sectionStatements(section: ArticleSection): number {
  return (
    1 +
    sum(section.paragraphs.map(statementsIn)) +
    sum(section.subsections.map((sub) => 1 + sum(sub.paragraphs.map(statementsIn))))
  );
}

function unitText(kind: ArticleCheckUnitKind, key: string, content: string): string {
  return object([
    ["format", str(ARTICLE_CHECK_UNIT_FORMAT)],
    ["kind", str(kind)],
    ["key", str(key)],
    ["content", content],
  ]);
}

type Draft = Omit<ArticleCheckUnit, "index" | "text" | "bytes" | "oversize"> & { readonly content: string };

function drafts(article: ArticleContent): readonly Draft[] {
  const units: Draft[] = [
    {
      kind: "metadata",
      key: "metadata",
      label: "Metadata",
      content: object([
        ["topic", str(article.topic)],
        ["searchIntent", str(article.searchIntent)],
        ["title", str(article.title)],
        ["metaTitle", str(article.metaTitle)],
        ["metaDescription", str(article.metaDescription)],
        ["excerpt", str(article.excerpt)],
        ["category", str(article.category)],
        ["keywords", array(article.keywords, str)],
      ]),
      // Each field one statement or more; the search intent and the keyword list one each.
      statementCount:
        2 +
        sum([article.topic, article.title, article.metaTitle, article.metaDescription, article.excerpt, article.category].map(statementsIn)),
    },
    {
      kind: "lead-introduction",
      key: "lead-introduction",
      label: "Lead and introduction",
      content: object([
        ["lead", str(article.lead)],
        ["introduction", array(article.introduction, str)],
      ]),
      statementCount: statementsIn(article.lead) + sum(article.introduction.map(statementsIn)),
    },
    ...article.sections.map(
      (section): Draft => ({
        kind: "section",
        key: `section:${section.id}`,
        label: section.heading,
        content: sectionText(section),
        statementCount: sectionStatements(section),
      }),
    ),
  ];
  if (article.faqs.length > 0) {
    units.push({
      kind: "faq",
      key: "faq",
      label: `FAQ (${article.faqs.length})`,
      content: object([
        [
          "faqs",
          array(article.faqs, (faq) =>
            object([
              ["question", str(faq.question)],
              ["answer", str(faq.answer)],
            ]),
          ),
        ],
      ]),
      statementCount: sum(article.faqs.map((faq) => 1 + statementsIn(faq.answer))),
    });
  }
  units.push({
    kind: "cta",
    key: "cta",
    label: "Call to action",
    content: object([
      ["ctaTitle", str(article.ctaTitle)],
      ["ctaBody", str(article.ctaBody)],
    ]),
    statementCount: statementsIn(article.ctaTitle) + statementsIn(article.ctaBody),
  });
  return units;
}

/**
 * The check units of one validated article, in the fixed order. The same
 * content always gives the same units, keys and texts.
 */
export function articleCheckUnits(article: ValidatedArticleContent): readonly ArticleCheckUnit[] {
  return drafts(article).map((draft, index) => {
    const text = unitText(draft.kind, draft.key, draft.content);
    const bytes = encoder.encode(text).length;
    const oversize = draft.statementCount > MAX_UNIT_STATEMENTS ? "too-many-statements" : bytes > MAX_UNIT_BYTES ? "too-many-bytes" : null;
    return { index, kind: draft.kind, key: draft.key, label: draft.label, text, statementCount: draft.statementCount, bytes, oversize };
  });
}
