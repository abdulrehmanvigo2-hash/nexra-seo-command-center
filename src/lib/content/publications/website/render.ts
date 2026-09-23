/**
 * The website artifact dry-run renderer: from one article envelope and the
 * pinned template, the exact two artifacts the destination repository would
 * need — the new route file and the one registry record to append.
 *
 * Pure and deterministic: no clock, no randomness, no environment, no
 * network, no eval and no template engine. The output is assembled line by
 * line from fixed code; content enters only through `tsString`, as escaped
 * string literals, so draft text can never become JSX, an identifier, a
 * comment or code. The only other values interpolated are ones validated
 * here against strict patterns (uuids, hashes, the slug, the version
 * number, contract field names). The same inputs give byte-identical
 * output. The hash function is passed in so this module stays free of
 * server-only imports.
 *
 * A missing required field is rendered as an undeclared identifier
 * (`MISSING_REQUIRED_FIELD_<name>`), and the file is headed "INCOMPLETE —
 * NOT PUBLISHABLE": the skeleton shows where every value belongs and cannot
 * typecheck, build or be mistaken for a finished article.
 */

import {
  articleFields,
  fieldPresent,
  REGISTRY_TEXT_FIELDS,
  REQUIRED_FIELDS,
  type ArticleEnvelope,
} from "@/lib/content/publications/website/article-contract";
import { pagePathFor, routeFor } from "@/lib/content/publications/website/template";
import { topicWarnings } from "@/lib/content/publications/website/topic-overlap";
import { missingIdentifier, tsString, tsStringArray } from "@/lib/content/publications/website/tsx-literal";
import type { WebsiteDryRun, WebsiteTemplate } from "@/types/website-artifact";

export const NO_EXTERNAL_ACTION_NOTICE =
  "No GitHub branch, commit, pull request, deployment, or publication has been created.";

export const INCOMPLETE_LABEL = "INCOMPLETE — NOT PUBLISHABLE";
export const COMPLETE_LABEL = "COMPLETE DRY-RUN — STILL NOT PUBLISHED";

export type DryRunProvenance = {
  readonly proposalId: string;
  readonly draftId: string;
  readonly version: number;
  readonly versionId: string;
  readonly contentSha256: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Refuses anything that could carry text into a comment, a path or an identifier. */
function assertSafe(template: WebsiteTemplate, envelope: ArticleEnvelope, provenance: DryRunProvenance): void {
  const problems = [
    !SLUG.test(envelope.slug) && "slug",
    !UUID.test(provenance.proposalId) && "proposal id",
    !UUID.test(provenance.draftId) && "draft id",
    !UUID.test(provenance.versionId) && "version row id",
    !SHA.test(provenance.contentSha256) && "content hash",
    !(Number.isInteger(provenance.version) && provenance.version >= 1) && "version",
    !/^[0-9a-f]{40}$/.test(template.pinnedCommit) && "pinned commit",
    !/^[a-z0-9-]+\/[0-9]+$/.test(template.id) && "template id",
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`Website dry-run refused unsafe input: ${problems.join(", ")}`);
}

/** Section anchors: kebab-case of the heading, ASCII only, unique, never empty. */
export function sectionIds(titles: readonly string[]): string[] {
  const used = new Set<string>();
  return titles.map((title, index) => {
    const base =
      title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
        .replace(/-+$/g, "") || `section-${index + 1}`;
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

function missingKeys(envelope: ArticleEnvelope): string[] {
  return REQUIRED_FIELDS.filter((field) => !fieldPresent(envelope, field.key)).map((field) => field.key);
}

function headerLines(kind: "page" | "record", template: WebsiteTemplate, provenance: DryRunProvenance, missing: readonly string[], indent: string): string[] {
  const lines = [
    `// Nexra SEO Command Center: website artifact dry-run. NOT PUBLISHED.`,
    kind === "page"
      ? `// Proposed new file for ${template.repository} (template ${template.id} at ${template.pinnedCommit}).`
      : `// Proposed record to append to the \`articles\` array in ${template.registryPath} of ${template.repository} (template ${template.id} at ${template.pinnedCommit}).`,
    `// Proposal ${provenance.proposalId}; draft ${provenance.draftId} version ${provenance.version} (row ${provenance.versionId}); content SHA-256 ${provenance.contentSha256}.`,
    missing.length > 0
      ? `// ${INCOMPLETE_LABEL}. Missing required fields: ${missing.join(", ")}.`
      : `// ${COMPLETE_LABEL}.`,
  ];
  if (missing.length > 0) {
    lines.push("// Every MISSING_REQUIRED_FIELD_* identifier is declared nowhere, so this cannot typecheck or build.");
  }
  return lines.map((line) => `${indent}${line}`);
}

function valueOrMissing(envelope: ArticleEnvelope, key: "lead" | "ctaTitle" | "ctaBody" | (typeof REGISTRY_TEXT_FIELDS)[number]): string {
  return fieldPresent(envelope, key) ? tsString(envelope[key] as string) : missingIdentifier(key);
}

/** The new route file, `app/blog/<slug>/page.tsx`, following the one article the template pins. */
export function renderPage(template: WebsiteTemplate, envelope: ArticleEnvelope, provenance: DryRunProvenance): string {
  assertSafe(template, envelope, provenance);
  const missing = missingKeys(envelope);
  const ids = sectionIds(envelope.sections.map((section) => section.title));

  const sectionsConst = [
    "const sections = [",
    ...envelope.sections.map((section, index) => `  { id: ${tsString(ids[index])}, title: ${tsString(section.title)} },`),
    "];",
  ];

  const sectionJsx = envelope.sections.flatMap((section, index) => [
    "",
    `        <Section section={sections[${index}]}>`,
    ...section.paragraphs.map((paragraph) => `          <P>{${tsString(paragraph)}}</P>`),
    "        </Section>",
  ]);

  const lines = [
    ...headerLines("page", template, provenance, missing, ""),
    "",
    'import type { Metadata } from "next";',
    "",
    "import {",
    "  ArticleBody,",
    "  ArticleCta,",
    "  ArticleHeader,",
    "  ArticleJsonLd,",
    "  ArticleToc,",
    "  P,",
    "  Section,",
    '} from "@/components/site/article";',
    'import { articleUrl, getArticle } from "@/lib/blog";',
    'import { site } from "@/lib/site";',
    "",
    `const article = getArticle(${tsString(envelope.slug)});`,
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
    "",
    `const lead = ${valueOrMissing(envelope, "lead")};`,
    `const ctaTitle = ${valueOrMissing(envelope, "ctaTitle")};`,
    `const ctaBody = ${valueOrMissing(envelope, "ctaBody")};`,
    "",
    "export default function ProposedArticlePage() {",
    "  return (",
    "    <>",
    "      <ArticleJsonLd article={article} />",
    "",
    "      <ArticleHeader article={article} lead={lead} />",
    "",
    "      <ArticleBody>",
    "        <ArticleToc sections={sections} />",
    ...sectionJsx,
    "      </ArticleBody>",
    "",
    "      <ArticleCta title={ctaTitle} body={ctaBody} />",
    "    </>",
    "  );",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/** The one `Article` record to append to `articles` in `lib/blog.ts`, indented as that file's records are. */
export function renderRegistryRecord(template: WebsiteTemplate, envelope: ArticleEnvelope, provenance: DryRunProvenance): string {
  assertSafe(template, envelope, provenance);
  const missing = missingKeys(envelope);
  const lines = [
    ...headerLines("record", template, provenance, missing, "  "),
    "  {",
    `    slug: ${tsString(envelope.slug)},`,
    ...REGISTRY_TEXT_FIELDS.map((key) => `    ${key}: ${valueOrMissing(envelope, key)},`),
    `    keywords: ${fieldPresent(envelope, "keywords") ? tsStringArray(envelope.keywords ?? [], "    ") : missingIdentifier("keywords")},`,
    "  },",
  ];
  return `${lines.join("\n")}\n`;
}

/** The whole dry-run: both artifacts with their hashes, the field checklist, and the warnings. */
export function buildWebsiteDryRun(input: {
  readonly template: WebsiteTemplate;
  readonly envelope: ArticleEnvelope;
  readonly provenance: DryRunProvenance;
  readonly sha256: (text: string) => string;
}): WebsiteDryRun {
  const { template, envelope, provenance, sha256 } = input;
  const page = renderPage(template, envelope, provenance);
  const record = renderRegistryRecord(template, envelope, provenance);
  const fields = articleFields(envelope, {
    slug: "The publication proposal's validated slug",
    sections: "The approved version's title and body, verbatim",
  });
  const missingRequired = fields.filter((field) => field.required && field.state === "missing").map((field) => field.label);
  const warnings = topicWarnings(template, envelope);
  const collision = warnings.some((warning) => warning.kind === "slug-collision");
  const complete = missingRequired.length === 0 && !collision;
  return {
    status: complete ? "complete" : "incomplete",
    statusLabel: complete ? COMPLETE_LABEL : INCOMPLETE_LABEL,
    notice: NO_EXTERNAL_ACTION_NOTICE,
    template,
    route: routeFor(template, envelope.slug),
    proposal: {
      id: provenance.proposalId,
      draftId: provenance.draftId,
      version: provenance.version,
      versionId: provenance.versionId,
      contentSha256: provenance.contentSha256,
      slug: envelope.slug,
    },
    fields,
    missingRequired,
    warnings,
    noOverlapDetected: !warnings.some((warning) => warning.kind === "topic-overlap"),
    page: { path: pagePathFor(template, envelope.slug), kind: "new-file", content: page, sha256: sha256(page) },
    registry: { path: template.registryPath, kind: "append-record", content: record, sha256: sha256(record) },
  };
}
