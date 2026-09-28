/**
 * The full article renderer (Phase 6, checkpoint 6.9b): one approved article
 * version, and its approval, become the three files one nexra-ai pull
 * request would carry (decisions D1–D7 of `docs/website-renderer-6.9.md`):
 *
 * a) `app/blog/<slug>/page.tsx`, a new route file in the shape of the live
 *    article: metadata, a table of contents over the H2 sections (each with
 *    its id), H3s without ids, paragraphs, the FAQ block and FAQPage, inline
 *    links, and each attested paragraph as a `Meta` label over a `P` with
 *    `ATTESTATION_LABELS` exactly (D6);
 * b) `lib/blog.ts` with one record appended — `readingTime` derived as
 *    ceil(words / 200) (D2), `published` the date the approval binds (D3),
 *    no `updated`;
 * c) the live article with one link added in its revive section, at the
 *    first exact match of the anchor text (D7).
 *
 * Deterministic and inert: no clock, no randomness, no environment, no
 * network, no template engine. Every piece of content enters the output as
 * a string literal through `tsString` (quotes, backslashes, newlines, `<`,
 * `>`, `&` and the line separators escaped), so no text can become JSX,
 * code or a comment; the only other values interpolated are validated ids,
 * hashes, the slug and fixed labels. The same input gives the same bytes.
 * The two files it modifies must hash to the template's pinned SHA-256, or
 * it refuses; it never patches a file it has not seen.
 *
 * Anything incomplete or invalid is refused with a typed code, and nothing
 * is returned but the refusal — never a partial file.
 *
 * Writes nothing anywhere. The hash function is passed in so this module
 * stays free of server-only imports.
 */

import { ATTESTATION_LABELS } from "@/lib/content/articles/attestations";
import { ARTICLE_CANONICAL_FORMAT, ARTICLE_CANONICAL_FORMAT_ATTESTED, readCanonicalArticle } from "@/lib/content/articles/canonical";
import { isInternalPathSyntax } from "@/lib/content/articles/internal-links";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { keywordOverlaps, normalisedKeywords } from "@/lib/content/articles/website/overlap";
import { articlePagePath, articleRoute, type ArticleWebsiteTemplate } from "@/lib/content/articles/website/template";
import { tsString } from "@/lib/content/publications/website/tsx-literal";
import type { ArticleAttestationBasis, ValidatedArticleContent } from "@/types/content-article";

export const ARTICLE_RENDER_REFUSALS = [
  "approval-missing",
  "approval-mismatch",
  "content-hash-mismatch",
  "content-unreadable",
  "missing-field",
  "invalid-content",
  "content-not-canonical",
  "topic-decision",
  "slug-live",
  "published-invalid",
  "section-id-reserved",
  "keyword-overlap",
  "link-to-subsection",
  "link-anchor-not-found",
  "link-overlap",
  "registry-changed",
  "live-article-changed",
  "cross-link-anchor-invalid",
  "cross-link-anchor-not-found",
  "unsafe-input",
] as const;
export type ArticleRenderRefusalCode = (typeof ARTICLE_RENDER_REFUSALS)[number];

export type ArticleRenderRefusal = {
  readonly code: ArticleRenderRefusalCode;
  /** The field, link, keyword or file the refusal names, when there is one. */
  readonly detail?: string;
};

export type ArticleRenderInput = {
  readonly template: ArticleWebsiteTemplate;
  /** The approved version as stored. */
  readonly version: {
    readonly articleId: string;
    readonly version: number;
    readonly versionId: string;
    readonly canonicalContent: string;
    readonly contentSha256: string;
  };
  /** The version's C5 approval; null when there is none. */
  readonly approval: {
    readonly id: string;
    readonly articleId: string;
    readonly articleVersion: number;
    readonly articleVersionId: string;
    readonly contentSha256: string;
  } | null;
  /** YYYY-MM-DD, chosen by the operator and bound by the publication approval (D3); never read from a clock. */
  readonly published: string;
  /** The text in the live article's revive section to link to the new article (D7). */
  readonly crossLinkAnchor: string;
  /** The two files the renderer modifies, exactly as read at the template's pinned commit. */
  readonly sources: { readonly registry: string; readonly liveArticle: string };
  readonly sha256: (text: string) => string;
};

export type RenderedFile = {
  readonly path: string;
  readonly kind: "new-file" | "modify";
  readonly content: string;
  readonly sha256: string;
  /** For a modified file: the pinned hash of the file it replaces. */
  readonly baseSha256?: string;
};

export type ArticleRender = {
  readonly templateId: string;
  readonly pinnedCommit: string;
  readonly slug: string;
  readonly route: string;
  readonly published: string;
  readonly wordCount: number;
  readonly readingTime: string;
  /** The new article's keywords, normalised: its set for the overlap check once it is live (D7, D10). */
  readonly keywordPhrases: readonly string[];
  readonly page: RenderedFile;
  readonly registry: RenderedFile;
  readonly crossLink: RenderedFile;
};

export type ArticleRenderResult = { readonly ok: true; readonly render: ArticleRender } | { readonly ok: false; readonly refusal: ArticleRenderRefusal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A cross-link anchor: plain words and simple punctuation, so it is valid JSX text as it stands. */
const CROSS_LINK_ANCHOR = /^[\p{L}\p{N}][\p{L}\p{N} ,.'’—–-]{0,118}[\p{L}\p{N}]$/u;
/** A live-article line holding only JSX text: no markup, no expression. */
const JSX_TEXT_LINE = /^[^<>{}]*$/;

/** Words per minute for the reading estimate (D2). */
export const WORDS_PER_MINUTE = 200;

class Refused extends Error {
  readonly refusal: ArticleRenderRefusal;
  constructor(refusal: ArticleRenderRefusal) {
    super(refusal.code);
    this.refusal = refusal;
  }
}

function refuse(code: ArticleRenderRefusalCode, detail?: string): never {
  throw new Refused(detail === undefined ? { code } : { code, detail });
}

function validDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function words(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** The words D2 counts: the lead, the introduction, every section's paragraphs, every H3 and its paragraphs, and the FAQ answers. */
export function articleWordCount(article: ValidatedArticleContent): number {
  const texts = [
    article.lead,
    ...article.introduction,
    ...article.sections.flatMap((section) => [...section.paragraphs, ...section.subsections.flatMap((sub) => [sub.heading, ...sub.paragraphs])]),
    ...article.faqs.map((faq) => faq.answer),
  ];
  return texts.reduce((sum, text) => sum + words(text), 0);
}

/** "N min read", the site's own format; at least one minute. */
export function readingTimeFor(wordCount: number): string {
  return `${Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE))} min read`;
}

/* -------------------------------------------------------------------------- */
/* The content: read, bound, checked                                           */
/* -------------------------------------------------------------------------- */

function checkBinding(input: ArticleRenderInput): void {
  const { version, approval, template } = input;
  if (
    !UUID.test(version.articleId) ||
    !UUID.test(version.versionId) ||
    !SHA.test(version.contentSha256) ||
    !(Number.isInteger(version.version) && version.version >= 1) ||
    !COMMIT.test(template.pinnedCommit) ||
    !/^[a-z0-9-]+\/[0-9]+$/.test(template.id)
  ) {
    refuse("unsafe-input");
  }
  if (approval === null) refuse("approval-missing");
  if (!UUID.test(approval.id)) refuse("unsafe-input", "approval id");
  if (
    approval.articleId !== version.articleId ||
    approval.articleVersion !== version.version ||
    approval.articleVersionId !== version.versionId ||
    approval.contentSha256 !== version.contentSha256
  ) {
    refuse("approval-mismatch");
  }
  if (typeof version.canonicalContent !== "string" || input.sha256(version.canonicalContent) !== version.contentSha256) {
    refuse("content-hash-mismatch");
  }
}

/** The stored text as validated content, with every missing field named. */
function readContent(canonical: string): ValidatedArticleContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    refuse("content-unreadable");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) refuse("content-unreadable");
  const { format, ...rest } = parsed as Record<string, unknown>;
  if (format !== ARTICLE_CANONICAL_FORMAT && format !== ARTICLE_CANONICAL_FORMAT_ATTESTED) refuse("content-unreadable", "format");
  const checked = validateArticleContent(rest);
  if (!checked.ok) {
    const missing = checked.issues.find((issue) => issue.code === "required");
    if (missing !== undefined) refuse("missing-field", missing.path);
    refuse("invalid-content", `${checked.issues[0].path} ${checked.issues[0].code}`);
  }
  const article = readCanonicalArticle(canonical);
  if (article === null) refuse("content-not-canonical");
  return article;
}

function checkArticle(template: ArticleWebsiteTemplate, article: ValidatedArticleContent, published: string): void {
  if (!SLUG.test(article.slug)) refuse("unsafe-input", "slug");
  if (article.topicDecision !== "different-angle") refuse("topic-decision", article.topicDecision);
  if (template.liveSlugs.includes(article.slug)) refuse("slug-live", article.slug);
  if (typeof published !== "string" || !validDate(published)) refuse("published-invalid");
  for (const section of article.sections) {
    if (template.reservedSectionIds.includes(section.id)) refuse("section-id-reserved", section.id);
    for (const sub of section.subsections) if (template.reservedSectionIds.includes(sub.id)) refuse("section-id-reserved", sub.id);
  }
  const overlap = keywordOverlaps(article.keywords, template.liveArticle.keywords)[0];
  if (overlap !== undefined) refuse("keyword-overlap", `${overlap.keyword} repeats ${overlap.liveKeyword}`);
}

/* -------------------------------------------------------------------------- */
/* Inline links (D4, D5)                                                       */
/* -------------------------------------------------------------------------- */

type LinkSpan = { readonly start: number; readonly end: number; readonly href: string };

/** Paragraph keys: `<section id>/<n>` for H2 paragraphs and `<subsection id>/<n>` for H3 paragraphs — the attestation locators. */
function placeLinks(article: ValidatedArticleContent): Map<string, LinkSpan[]> {
  const subsectionIds = new Set(article.sections.flatMap((section) => section.subsections.map((sub) => sub.id)));
  const placed = new Map<string, LinkSpan[]>();
  for (const link of article.internalLinks) {
    if (!isInternalPathSyntax(link.path)) refuse("unsafe-input", "link path"); // the validator already refuses these
    const hash = link.path.indexOf("#");
    const fragment = hash >= 0 ? link.path.slice(hash + 1) : "";
    if (fragment !== "" && subsectionIds.has(fragment)) refuse("link-to-subsection", link.path);

    // The paragraphs of the link's section, in order: an H2's own paragraphs, then each of its H3s'.
    const candidates: { key: string; text: string }[] = [];
    for (const section of article.sections) {
      if (section.id === link.sectionId) {
        section.paragraphs.forEach((text, p) => candidates.push({ key: `${section.id}/${p}`, text }));
        for (const sub of section.subsections) sub.paragraphs.forEach((text, p) => candidates.push({ key: `${sub.id}/${p}`, text }));
      }
      for (const sub of section.subsections) {
        if (sub.id === link.sectionId) sub.paragraphs.forEach((text, p) => candidates.push({ key: `${sub.id}/${p}`, text }));
      }
    }
    const hit = candidates.find((candidate) => candidate.text.includes(link.anchorText));
    if (hit === undefined) refuse("link-anchor-not-found", link.anchorText);
    const start = hit.text.indexOf(link.anchorText);
    const span: LinkSpan = { start, end: start + link.anchorText.length, href: link.path };
    const spans = placed.get(hit.key) ?? [];
    if (spans.some((other) => span.start < other.end && other.start < span.end)) refuse("link-overlap", link.anchorText);
    placed.set(hit.key, [...spans, span].sort((a, b) => a.start - b.start));
  }
  return placed;
}

/* -------------------------------------------------------------------------- */
/* a) The route file                                                           */
/* -------------------------------------------------------------------------- */

function paragraphJsx(text: string, spans: readonly LinkSpan[] | undefined, indent: string): string {
  if (spans === undefined || spans.length === 0) return `${indent}<P>{${tsString(text)}}</P>`;
  const parts: string[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start > at) parts.push(`{${tsString(text.slice(at, span.start))}}`);
    parts.push(`<A href={${tsString(span.href)}}>{${tsString(text.slice(span.start, span.end))}}</A>`);
    at = span.end;
  }
  if (at < text.length) parts.push(`{${tsString(text.slice(at))}}`);
  return `${indent}<P>\n${parts.map((part) => `${indent}  ${part}`).join("\n")}\n${indent}</P>`;
}

function bodyParagraph(key: string, text: string, links: Map<string, LinkSpan[]>, bases: Map<string, ArticleAttestationBasis>, indent: string): string[] {
  const basis = bases.get(key);
  const paragraph = paragraphJsx(text, links.get(key), basis === undefined ? indent : `${indent}  `);
  if (basis === undefined) return [paragraph];
  return [
    `${indent}<div className="flex flex-col gap-2">`,
    `${indent}  <Meta className="text-accent-300">{${tsString(ATTESTATION_LABELS[basis])}}</Meta>`,
    paragraph,
    `${indent}</div>`,
  ];
}

function renderPage(input: ArticleRenderInput, article: ValidatedArticleContent, links: Map<string, LinkSpan[]>): string {
  const { template, version, approval } = input;
  const bases = new Map(article.attestations.map((a) => [a.locator, a.basis] as const));
  const hasLinks = links.size > 0;
  const hasH3 = article.sections.some((section) => section.subsections.length > 0);
  const hasFaqs = article.faqs.length > 0;
  const hasAttested = bases.size > 0;

  const componentNames = [
    ...(hasLinks ? ["A"] : []),
    "ArticleBody",
    "ArticleCta",
    ...(hasFaqs ? ["ArticleFaq"] : []),
    "ArticleHeader",
    "ArticleJsonLd",
    "ArticleToc",
    ...(hasH3 ? ["H3"] : []),
    "P",
    "Section",
    "type ArticleSection",
  ];

  // One named constant per section, not an indexed array: the site compiles with
  // `noUncheckedIndexedAccess`, under which `sections[0]` may be undefined.
  const sectionsConst = [
    ...article.sections.map((section, index) => `const section${index + 1}: ArticleSection = { id: ${tsString(section.id)}, title: ${tsString(section.heading)} };`),
    ...(hasFaqs ? ['const faqSection: ArticleSection = { id: "faq", title: "Frequently Asked Questions" };'] : []),
    "",
    `const sections: ArticleSection[] = [${[...article.sections.map((_, index) => `section${index + 1}`), ...(hasFaqs ? ["faqSection"] : [])].join(", ")}];`,
  ];
  const faqConst = hasFaqs
    ? [
        "",
        "const faqs: FaqItem[] = [",
        ...article.faqs.flatMap((faq) => ["  {", `    q: ${tsString(faq.question)},`, `    a: ${tsString(faq.answer)},`, "  },"]),
        "];",
      ]
    : [];

  const intro =
    article.introduction.length > 0
      ? ['        <div className="flex flex-col gap-6">', ...article.introduction.map((text) => paragraphJsx(text, undefined, "          ")), "        </div>", ""]
      : [];

  const sectionJsx = article.sections.flatMap((section, index) => [
    "",
    `        <Section section={section${index + 1}}>`,
    ...section.paragraphs.flatMap((text, p) => bodyParagraph(`${section.id}/${p}`, text, links, bases, "          ")),
    ...section.subsections.flatMap((sub) => [
      `          <H3>{${tsString(sub.heading)}}</H3>`,
      ...sub.paragraphs.flatMap((text, p) => bodyParagraph(`${sub.id}/${p}`, text, links, bases, "          ")),
    ]),
    "        </Section>",
  ]);

  const lines = [
    "// Rendered by the Nexra SEO Command Center (full article renderer, checkpoint 6.9b).",
    `// Template ${template.id} at ${template.repository}@${template.pinnedCommit}.`,
    `// Article ${version.articleId} version ${version.version} (row ${version.versionId}); content SHA-256 ${version.contentSha256}; approval ${approval?.id}.`,
    "// Every text below is the approved version's, verbatim, as a string literal.",
    "",
    'import type { Metadata } from "next";',
    "",
    "import {",
    ...componentNames.map((name) => `  ${name},`),
    '} from "@/components/site/article";',
    ...(hasAttested ? ['import { Meta } from "@/components/ui/primitives";'] : []),
    'import { articleUrl, getArticle } from "@/lib/blog";',
    'import { site } from "@/lib/site";',
    ...(hasFaqs ? ['import type { FaqItem } from "@/lib/types";'] : []),
    "",
    `const article = getArticle(${tsString(article.slug)});`,
    "",
    "export const metadata: Metadata = {",
    "  title: article.metaTitle,",
    "  description: article.description,",
    "  keywords: article.keywords,",
    "  alternates: { canonical: `/blog/${article.slug}` },",
    "  openGraph: {",
    '    type: "article",',
    "    title: article.metaTitle,",
    "    description: article.description,",
    "    url: articleUrl(article.slug),",
    "    publishedTime: article.published,",
    "    authors: [site.name],",
    '    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: article.title }],',
    "  },",
    "  twitter: {",
    '    card: "summary_large_image",',
    "    title: article.metaTitle,",
    "    description: article.description,",
    '    images: ["/opengraph-image"],',
    "  },",
    "};",
    "",
    ...sectionsConst,
    ...faqConst,
    "",
    "export default function ArticlePage() {",
    "  return (",
    "    <>",
    `      <ArticleJsonLd article={article}${hasFaqs ? " faqs={faqs}" : ""} />`,
    "",
    `      <ArticleHeader article={article} lead={${tsString(article.lead)}} />`,
    "",
    "      <ArticleBody>",
    ...intro,
    "        <ArticleToc sections={sections} />",
    ...sectionJsx,
    ...(hasFaqs ? ["", "        <ArticleFaq section={faqSection} items={faqs} />"] : []),
    "      </ArticleBody>",
    "",
    `      <ArticleCta title={${tsString(article.ctaTitle)}} body={${tsString(article.ctaBody)}} />`,
    "    </>",
    "  );",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/* -------------------------------------------------------------------------- */
/* b) The registry                                                             */
/* -------------------------------------------------------------------------- */

function renderRegistry(input: ArticleRenderInput, article: ValidatedArticleContent, readingTime: string): string {
  const { template, sources } = input;
  if (typeof sources.registry !== "string" || input.sha256(sources.registry) !== template.registry.sha256) refuse("registry-changed", template.registry.path);
  const lines = sources.registry.split("\n");
  const open = lines.indexOf(template.registry.arrayOpen);
  const close = open < 0 ? -1 : lines.indexOf(template.registry.arrayClose, open + 1);
  if (open < 0 || close < 0) refuse("registry-changed", template.registry.path);
  const record = [
    "  {",
    `    slug: ${tsString(article.slug)},`,
    `    title: ${tsString(article.title)},`,
    `    metaTitle: ${tsString(article.metaTitle)},`,
    `    description: ${tsString(article.metaDescription)},`,
    `    excerpt: ${tsString(article.excerpt)},`,
    `    category: ${tsString(article.category)},`,
    `    published: ${tsString(input.published)},`,
    `    readingTime: ${tsString(readingTime)},`,
    "    keywords: [",
    ...article.keywords.map((keyword) => `      ${tsString(keyword)},`),
    "    ],",
    "  },",
  ];
  return [...lines.slice(0, close), ...record, ...lines.slice(close)].join("\n");
}

/* -------------------------------------------------------------------------- */
/* c) The cross-link in the live article's revive section (D7)                 */
/* -------------------------------------------------------------------------- */

function renderCrossLink(input: ArticleRenderInput, route: string): string {
  const { template, sources, crossLinkAnchor } = input;
  const live = template.liveArticle;
  if (typeof crossLinkAnchor !== "string" || !CROSS_LINK_ANCHOR.test(crossLinkAnchor) || crossLinkAnchor.includes("  ")) {
    refuse("cross-link-anchor-invalid");
  }
  if (typeof sources.liveArticle !== "string" || input.sha256(sources.liveArticle) !== live.sha256) refuse("live-article-changed", live.path);
  const lines = sources.liveArticle.split("\n");
  const open = lines.indexOf(live.reviveOpen);
  const close = open < 0 ? -1 : lines.indexOf(live.sectionClose, open + 1);
  if (open < 0 || close < 0) refuse("live-article-changed", live.path);

  // Only lines of plain JSX text inside a <P>…</P> in the revive section are candidates.
  let inParagraph = false;
  for (let i = open + 1; i < close; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "<P>") inParagraph = true;
    else if (trimmed === "</P>") inParagraph = false;
    else if (inParagraph && JSX_TEXT_LINE.test(lines[i])) {
      const at = lines[i].indexOf(crossLinkAnchor);
      if (at >= 0) {
        const edited = `${lines[i].slice(0, at)}<A href="${route}">${crossLinkAnchor}</A>${lines[i].slice(at + crossLinkAnchor.length)}`;
        return [...lines.slice(0, i), edited, ...lines.slice(i + 1)].join("\n");
      }
    }
  }
  refuse("cross-link-anchor-not-found", crossLinkAnchor);
}

/* -------------------------------------------------------------------------- */

export function renderArticleWebsite(input: ArticleRenderInput): ArticleRenderResult {
  try {
    checkBinding(input);
    const article = readContent(input.version.canonicalContent);
    checkArticle(input.template, article, input.published);
    const links = placeLinks(article);
    const route = articleRoute(input.template, article.slug);
    const wordCount = articleWordCount(article);
    const readingTime = readingTimeFor(wordCount);

    const page = renderPage(input, article, links);
    const registry = renderRegistry(input, article, readingTime);
    const crossLink = renderCrossLink(input, route);
    const { template, sha256 } = input;
    return {
      ok: true,
      render: {
        templateId: template.id,
        pinnedCommit: template.pinnedCommit,
        slug: article.slug,
        route,
        published: input.published,
        wordCount,
        readingTime,
        keywordPhrases: normalisedKeywords(article.keywords),
        page: { path: articlePagePath(template, article.slug), kind: "new-file", content: page, sha256: sha256(page) },
        registry: { path: template.registry.path, kind: "modify", content: registry, sha256: sha256(registry), baseSha256: template.registry.sha256 },
        crossLink: { path: template.liveArticle.path, kind: "modify", content: crossLink, sha256: sha256(crossLink), baseSha256: template.liveArticle.sha256 },
      },
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, refusal: error.refusal };
    throw error;
  }
}
