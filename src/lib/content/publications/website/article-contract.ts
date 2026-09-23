/**
 * What one article on the destination website must carry, and what this
 * product can actually supply for it.
 *
 * The required list is the pinned template's own: the nine fields of an
 * `Article` record in `lib/blog.ts`, the header's lead paragraph, at least
 * one H2 section with a body, the canonical route, the `ArticleJsonLd`
 * component, and the closing CTA's title and body. The optional list is the
 * pattern the one existing article follows.
 *
 * Nothing is invented. A publication proposal binds one approved draft
 * version, which is one section: a title and a body. That section, the
 * proposal's slug, and what follows from the slug by a fixed rule are all
 * this product holds. Every other field is `missing` — reported as such,
 * rendered as an undeclared identifier so the artifact cannot build, and
 * never filled with a guess, a derivation from the text, or a default.
 *
 * Pure.
 */

import type { ArticleFieldStatus } from "@/types/website-artifact";

export type ArticleSectionInput = {
  /** The H2, verbatim. */
  readonly title: string;
  /** The body's non-empty lines, verbatim, one paragraph each. */
  readonly paragraphs: readonly string[];
};

/**
 * Everything an article could be rendered from. Null means "not available
 * in this product", never "empty on purpose".
 */
export type ArticleEnvelope = {
  readonly slug: string;
  readonly title: string | null;
  readonly metaTitle: string | null;
  readonly description: string | null;
  readonly excerpt: string | null;
  readonly category: string | null;
  /** YYYY-MM-DD. */
  readonly published: string | null;
  readonly readingTime: string | null;
  readonly keywords: readonly string[] | null;
  readonly lead: string | null;
  readonly sections: readonly ArticleSectionInput[];
  readonly ctaTitle: string | null;
  readonly ctaBody: string | null;
};

/** The registry fields, in the order `lib/blog.ts` declares them. */
export const REGISTRY_TEXT_FIELDS = ["title", "metaTitle", "description", "excerpt", "category", "published", "readingTime"] as const;

type RequiredField = {
  readonly key: string;
  readonly label: string;
};

export const REQUIRED_FIELDS: readonly RequiredField[] = [
  { key: "slug", label: "Slug" },
  { key: "title", label: "Title (the page's H1)" },
  { key: "metaTitle", label: "Meta title" },
  { key: "description", label: "Meta description" },
  { key: "excerpt", label: "Excerpt (blog index card)" },
  { key: "category", label: "Category" },
  { key: "published", label: "Published date" },
  { key: "readingTime", label: "Reading time" },
  { key: "keywords", label: "Keywords" },
  { key: "lead", label: "Lead paragraph" },
  { key: "sections", label: "At least one H2 section with a body" },
  { key: "canonical", label: "Canonical route" },
  { key: "jsonLd", label: "ArticleJsonLd structured data" },
  { key: "ctaTitle", label: "CTA title" },
  { key: "ctaBody", label: "CTA body" },
];

export const OPTIONAL_FIELDS: readonly RequiredField[] = [
  { key: "intro", label: "Intro paragraphs" },
  { key: "toc", label: "Table of contents" },
  { key: "h3", label: "H3 subsections" },
  { key: "faq", label: "FAQ" },
  { key: "furtherReading", label: "Further reading" },
  { key: "internalLinks", label: "Internal links" },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function textPresent(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

/** Whether a required field has a usable value. Blank text and malformed dates count as missing. */
export function fieldPresent(envelope: ArticleEnvelope, key: string): boolean {
  switch (key) {
    case "slug":
      return envelope.slug.length > 0;
    case "published":
      return textPresent(envelope.published) && ISO_DATE.test(envelope.published);
    case "keywords":
      return envelope.keywords !== null && envelope.keywords.length > 0 && envelope.keywords.every((k) => k.trim().length > 0);
    case "sections":
      return envelope.sections.length > 0 && envelope.sections.every((s) => s.title.trim().length > 0 && s.paragraphs.length > 0);
    case "canonical":
    case "jsonLd":
      // Follow from the slug and the template; see `articleFields`.
      return envelope.slug.length > 0;
    case "title":
    case "metaTitle":
    case "description":
    case "excerpt":
    case "category":
    case "readingTime":
    case "lead":
    case "ctaTitle":
    case "ctaBody":
      return textPresent(envelope[key]);
    default:
      return false;
  }
}

/** Every required and optional field with its state and source. */
export function articleFields(envelope: ArticleEnvelope, sources: { readonly slug: string; readonly sections: string }): ArticleFieldStatus[] {
  const required = REQUIRED_FIELDS.map((field): ArticleFieldStatus => {
    const present = fieldPresent(envelope, field.key);
    if (field.key === "canonical") {
      return { ...field, required: true, state: present ? "derived" : "missing", source: present ? "The template's route, from the slug" : null };
    }
    if (field.key === "jsonLd") {
      return { ...field, required: true, state: present ? "template" : "missing", source: present ? "The website's ArticleJsonLd component, from the registry record" : null };
    }
    if (!present) return { ...field, required: true, state: "missing", source: null };
    const source = field.key === "slug" ? sources.slug : field.key === "sections" ? sources.sections : "Supplied with the article";
    return { ...field, required: true, state: "present", source };
  });
  const optional = OPTIONAL_FIELDS.map((field): ArticleFieldStatus => {
    if (field.key === "toc" && envelope.sections.length > 0) {
      return { ...field, required: false, state: "derived", source: "The section headings, in order" };
    }
    return { ...field, required: false, state: "absent", source: null };
  });
  return [...required, ...optional];
}

/**
 * The envelope a proposal can supply: its slug, and the bound version's
 * title and body as the one section. Everything else is null.
 */
export function envelopeFromProposal(input: { readonly slug: string; readonly title: string; readonly body: string }): ArticleEnvelope {
  return {
    slug: input.slug,
    title: null,
    metaTitle: null,
    description: null,
    excerpt: null,
    category: null,
    published: null,
    readingTime: null,
    keywords: null,
    lead: null,
    sections: [{ title: input.title, paragraphs: input.body.split("\n").filter((line) => line.trim().length > 0) }],
    ctaTitle: null,
    ctaBody: null,
  };
}
