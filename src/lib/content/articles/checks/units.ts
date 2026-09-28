/**
 * Article check units (Stage 5, milestone C4): one immutable article
 * version cut into the bounded pieces it is fact-checked in.
 *
 * An article is never checked as one prompt. Its content is read as five
 * kinds of block, in a fixed order:
 *
 *   metadata           topic, search intent, title, meta title, meta
 *                      description, excerpt, category, keywords
 *   lead-introduction  the lead and the introduction paragraphs
 *   section:<id>       one per H2, in article order: its heading, its
 *                      paragraphs, and each H3 with its paragraphs
 *   faq                every FAQ, only when there are any
 *   cta                the CTA title and body
 *
 * The slug, the topic decision and the internal links are not checked by a
 * model: they are structure, and C1 validates their syntax in code.
 *
 * STATEMENTS. Each block is one ordered sequence of statements: a field
 * value, a heading, a FAQ question, or one sentence of a longer text (a
 * sentence ends at `.`, `!`, `?` or `…` followed by whitespace). Every
 * statement occurs in exactly one block, once.
 *
 * PARTS. A block's sequence is cut, in order and without overlap, into
 * parts of at most `MAX_UNIT_STATEMENTS` statements and `MAX_UNIT_BYTES`
 * bytes of unit text. Paragraphs, H3 blocks (heading with its first
 * paragraph) and FAQ question-answer pairs are kept whole when they fit;
 * otherwise they are split, only between sentences, and a heading or
 * question that must be split from its text opens a fresh part rather than
 * ending one. A statement is never cut: a version with one statement that
 * cannot fit a unit on its own is refused whole (`statement-too-large`), and
 * a version yielding more than `MAX_ARTICLE_UNITS` units is refused whole
 * (`too-many-units`).
 *
 * CONTEXT. A part whose statements sit under a heading checked in an
 * earlier part of the same block carries that heading as context, for
 * orientation only. A heading is a statement exactly once, and never
 * context in the part that checks it.
 *
 * IDENTITY. A unit's key is `<block>:<part>`; its index is its position
 * across the article. Its text is its canonical `nexra-article-check-unit/1`
 * serialisation — one JSON object, no whitespace between tokens, members in
 * a fixed order: format, kind, block, key, part, partCount, context, and the
 * statements numbered S1 … Sn — derived from its own block only, so an edit
 * changes the units of that block and no other block's text. The hash
 * (server-only, `./unit-hash`) is SHA-256 over the text's UTF-8 bytes.
 *
 * ATTESTED STATEMENTS (Phase 6, checkpoint 6.8b). Each sentence of an
 * operator-attested H2 or H3 paragraph carries one more member after its
 * text, `"attested":"experience"` or `"attested":"opinion"`, and a unit
 * holding at least one such statement is written as
 * `nexra-article-check-unit/2`. A unit with none is format 1, byte for
 * byte as before, so every unit of an article without attestations keeps
 * its text and hash.
 *
 * Pure: no store, no network, no hash; safe to import from either side.
 */

import type {
  ArticleCheckContext,
  ArticleCheckPlanRefusal,
  ArticleCheckStatement,
  ArticleCheckUnit,
  ArticleCheckUnitKind,
} from "@/types/content-article-check";
import type { ArticleAttestationBasis, ArticleContent, ValidatedArticleContent } from "@/types/content-article";

export const ARTICLE_CHECK_UNIT_FORMAT = "nexra-article-check-unit/1";
/** The format of a unit holding at least one attested statement (6.8b). */
export const ARTICLE_CHECK_UNIT_FORMAT_ATTESTED = "nexra-article-check-unit/2";

/** The most statements one unit may hold: what one bounded answer places, each once. */
export const MAX_UNIT_STATEMENTS = 10;
/** The most UTF-8 bytes of unit text one check quotes, context included. */
export const MAX_UNIT_BYTES = 6_000;
/** The most units one article version may yield. */
export const MAX_ARTICLE_UNITS = 150;
/** Sizing uses this part count, so the final text is never larger than the size that was checked. */
const SIZING_PART_COUNT = 999;

const encoder = new TextEncoder();

const SENTENCE_BREAK = /(?<=[.!?…])\s+/u;

/** One text's statements: its sentences, in order, verbatim; at least one for any non-empty text. */
export function sentencesOf(text: string): readonly string[] {
  return text.split(SENTENCE_BREAK).filter((part) => part.trim().length > 0);
}

/** How many statements a passage holds. */
export function statementsIn(text: string): number {
  return sentencesOf(text).length;
}

/** A statement before numbering, with the headings it sits under. */
type Leaf = {
  readonly type: "leaf";
  readonly field: string;
  readonly text: string;
  /** Headings above this statement, outermost first, identified by their field. */
  readonly under: readonly ArticleCheckContext[];
  /** The paragraph's attestation basis, when the operator attested it. */
  readonly attested?: ArticleAttestationBasis;
};

/** Statements kept together when they fit. */
type Group = { readonly type: "group"; readonly children: readonly Node[] };

type Node = Leaf | Group;

type Block = { readonly kind: ArticleCheckUnitKind; readonly block: string; readonly label: string; readonly nodes: readonly Node[] };

function leaf(field: string, text: string, under: readonly ArticleCheckContext[] = [], attested?: ArticleAttestationBasis): Leaf {
  return attested === undefined ? { type: "leaf", field, text, under } : { type: "leaf", field, text, under, attested };
}

function group(children: readonly Node[]): Group {
  return { type: "group", children };
}

/** A paragraph or field value: its sentences, kept together when they fit. */
function passage(field: string, text: string, under: readonly ArticleCheckContext[] = [], attested?: ArticleAttestationBasis): Group {
  return group(sentencesOf(text).map((sentence) => leaf(field, sentence, under, attested)));
}

/** A heading with the first paragraph under it, kept together when they fit, then the rest. */
function headed(heading: Leaf, paragraphs: readonly Group[]): readonly Node[] {
  return paragraphs.length === 0 ? [heading] : [group([heading, paragraphs[0]]), ...paragraphs.slice(1)];
}

function blocksOf(article: ArticleContent): readonly Block[] {
  const bases = new Map(article.attestations.map((a) => [a.locator, a.basis] as const));
  const basis = (id: string, p: number) => bases.get(`${id}/${p}`);
  const blocks: Block[] = [
    {
      kind: "metadata",
      block: "metadata",
      label: "Metadata",
      nodes: [
        passage("topic", article.topic),
        leaf("searchIntent", article.searchIntent),
        passage("title", article.title),
        passage("metaTitle", article.metaTitle),
        passage("metaDescription", article.metaDescription),
        passage("excerpt", article.excerpt),
        passage("category", article.category),
        leaf("keywords", article.keywords.join(", ")),
      ],
    },
    {
      kind: "lead-introduction",
      block: "lead-introduction",
      label: "Lead and introduction",
      nodes: [passage("lead", article.lead), ...article.introduction.map((paragraph, i) => passage(`introduction[${i}]`, paragraph))],
    },
    ...article.sections.map((section): Block => {
      const h2: ArticleCheckContext = { field: "heading", text: section.heading };
      const nodes: Node[] = [...headed(leaf(h2.field, h2.text), section.paragraphs.map((p, i) => passage(`paragraphs[${i}]`, p, [h2], basis(section.id, i))))];
      section.subsections.forEach((sub, s) => {
        const h3: ArticleCheckContext = { field: `subsections[${s}].heading`, text: sub.heading };
        nodes.push(group(headed(leaf(h3.field, h3.text, [h2]), sub.paragraphs.map((p, i) => passage(`subsections[${s}].paragraphs[${i}]`, p, [h2, h3], basis(sub.id, i))))));
      });
      return { kind: "section", block: `section:${section.id}`, label: section.heading, nodes };
    }),
  ];
  if (article.faqs.length > 0) {
    blocks.push({
      kind: "faq",
      block: "faq",
      label: "FAQ",
      nodes: article.faqs.map((faq, i) => {
        const question: ArticleCheckContext = { field: `faqs[${i}].question`, text: faq.question };
        return group([leaf(question.field, question.text), ...passage(`faqs[${i}].answer`, faq.answer, [question]).children]);
      }),
    });
  }
  blocks.push({
    kind: "cta",
    block: "cta",
    label: "Call to action",
    nodes: [passage("ctaTitle", article.ctaTitle), passage("ctaBody", article.ctaBody)],
  });
  return blocks;
}

function flatten(node: Node): readonly Leaf[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(flatten);
}

/** The headings the part's statements sit under that the part does not itself check, in order, once each. */
function contextOf(leaves: readonly Leaf[]): readonly ArticleCheckContext[] {
  const checked = new Set(leaves.map((l) => l.field));
  const context: ArticleCheckContext[] = [];
  for (const l of leaves) {
    for (const heading of l.under) {
      if (!checked.has(heading.field) && !context.some((c) => c.field === heading.field)) context.push(heading);
    }
  }
  return context;
}

function numbered(leaves: readonly Leaf[]): readonly ArticleCheckStatement[] {
  return leaves.map((l, i) => (l.attested === undefined ? { n: i + 1, field: l.field, text: l.text } : { n: i + 1, field: l.field, text: l.text, attested: l.attested }));
}

/** The canonical text of one unit. */
function unitText(kind: ArticleCheckUnitKind, block: string, part: number, partCount: number, leaves: readonly Leaf[]): string {
  const str = JSON.stringify;
  const context = contextOf(leaves)
    .map((c) => `{"field":${str(c.field)},"text":${str(c.text)}}`)
    .join(",");
  const statements = numbered(leaves)
    .map((s) => `{"n":${s.n},"field":${str(s.field)},"text":${str(s.text)}${s.attested === undefined ? "" : `,"attested":${str(s.attested)}`}}`)
    .join(",");
  const format = leaves.some((l) => l.attested !== undefined) ? ARTICLE_CHECK_UNIT_FORMAT_ATTESTED : ARTICLE_CHECK_UNIT_FORMAT;
  return `{"format":${str(format)},"kind":${str(kind)},"block":${str(block)},"key":${str(`${block}:${part}`)},"part":${part},"partCount":${partCount},"context":[${context}],"statements":[${statements}]}`;
}

class StatementTooLarge extends Error {}

/** Whether the first statement is a heading the later statements sit under. */
function opensWithHeading(leaves: readonly Leaf[]): boolean {
  const first = leaves[0];
  return first !== undefined && leaves.slice(1).some((l) => l.under.some((h) => h.field === first.field));
}

/** One block's parts, in order: every statement once, none cut. */
function pack(block: Block): readonly (readonly Leaf[])[] {
  const parts: Leaf[][] = [];
  let current: Leaf[] = [];
  const fits = (leaves: readonly Leaf[]) =>
    leaves.length <= MAX_UNIT_STATEMENTS && encoder.encode(unitText(block.kind, block.block, parts.length + 1, SIZING_PART_COUNT, leaves)).length <= MAX_UNIT_BYTES;
  const close = () => {
    parts.push(current);
    current = [];
  };
  const place = (node: Node): void => {
    const leaves = flatten(node);
    if (leaves.length === 0) return;
    if (fits([...current, ...leaves])) {
      current.push(...leaves);
      return;
    }
    if (current.length > 0 && fits(leaves)) {
      close();
      current.push(...leaves);
      return;
    }
    if (node.type === "group") {
      // A group opening with a heading (or FAQ question) that must be split
      // starts a fresh part, so the heading is never left alone at the end
      // of a part with the text under it in the next one.
      if (current.length > 0 && opensWithHeading(leaves)) close();
      for (const child of node.children) place(child);
      return;
    }
    // One statement that fits neither beside the others nor alone.
    throw new StatementTooLarge();
  };
  for (const node of block.nodes) place(node);
  if (current.length > 0) close();
  return parts;
}

export type ArticleCheckPlan = {
  /** Every unit, in order. Empty when the version is refused. */
  readonly units: readonly ArticleCheckUnit[];
  readonly refusal: ArticleCheckPlanRefusal | null;
  /** The units the version would yield, when it is refused for too many; otherwise the length of `units`. */
  readonly unitCount: number;
};

/**
 * The check units of one validated article, in the fixed order, or the
 * reason there are none. The same content always gives the same units,
 * keys, parts and texts.
 */
export function articleCheckPlan(article: ValidatedArticleContent): ArticleCheckPlan {
  const units: ArticleCheckUnit[] = [];
  for (const block of blocksOf(article)) {
    let parts: readonly (readonly Leaf[])[];
    try {
      parts = pack(block);
    } catch (error) {
      if (error instanceof StatementTooLarge) return { units: [], refusal: "statement-too-large", unitCount: 0 };
      throw error;
    }
    parts.forEach((leaves, i) => {
      const part = i + 1;
      const text = unitText(block.kind, block.block, part, parts.length, leaves);
      units.push({
        index: units.length,
        kind: block.kind,
        block: block.block,
        key: `${block.block}:${part}`,
        part,
        partCount: parts.length,
        label: block.label,
        text,
        statements: numbered(leaves),
        context: contextOf(leaves),
        statementCount: leaves.length,
        bytes: encoder.encode(text).length,
      });
    });
  }
  if (units.length > MAX_ARTICLE_UNITS) return { units: [], refusal: "too-many-units", unitCount: units.length };
  return { units, refusal: null, unitCount: units.length };
}

/** Every statement of every block, in order, before packing — what the parts must cover exactly once. */
export function articleStatements(article: ValidatedArticleContent): readonly { readonly block: string; readonly field: string; readonly text: string }[] {
  return blocksOf(article).flatMap((block) => block.nodes.flatMap(flatten).map((l) => ({ block: block.block, field: l.field, text: l.text })));
}
