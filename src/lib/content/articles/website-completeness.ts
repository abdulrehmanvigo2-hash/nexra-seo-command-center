/**
 * How validated article content covers the pinned website contract
 * (`nexra-ai-blog-tsx/1`).
 *
 * The contract's own field lists (`website/article-contract.ts`) are the
 * reference; this module only says, for each field, where validated
 * content supplies it — verbatim, by a fixed rule, from the template, at
 * publication time, or not at all. Nothing is invented: a field the
 * content model does not hold is reported missing, never estimated.
 *
 * Structural completeness is only that. It says nothing about whether the
 * article's claims were checked or whether anyone approved it: those belong
 * to the article's own later fact-check and approval, of its own exact
 * version, and are reported here as not established.
 *
 * Nothing is rendered: C1 produces no TSX and changes nothing about the
 * Milestone B dry-run.
 *
 * Pure.
 */

import { checkInternalLinks } from "@/lib/content/articles/internal-links";
import { validateArticleContent } from "@/lib/content/articles/validate";
import { OPTIONAL_FIELDS, REQUIRED_FIELDS } from "@/lib/content/publications/website/article-contract";
import { NEXRA_AI_BLOG_TEMPLATE, routeFor } from "@/lib/content/publications/website/template";
import type { ValidatedArticleContent, WebsiteCompletenessReport, WebsiteFieldCoverage, WebsiteOptionalCoverage } from "@/types/content-article";
import type { WebsiteTemplate } from "@/types/website-artifact";

type RequiredMapping =
  | { readonly kind: "present"; readonly source: string }
  | { readonly kind: "derived"; readonly source: string }
  | { readonly kind: "publication-time"; readonly source: string }
  | { readonly kind: "missing"; readonly source: string };

/** Where each required field of the pinned contract comes from. A key not listed here is missing. */
const REQUIRED_MAPPING: Readonly<Record<string, RequiredMapping>> = {
  slug: { kind: "present", source: "slug" },
  title: { kind: "present", source: "title" },
  metaTitle: { kind: "present", source: "metaTitle" },
  description: { kind: "present", source: "metaDescription" },
  excerpt: { kind: "present", source: "excerpt" },
  category: { kind: "present", source: "category" },
  published: { kind: "publication-time", source: "Set when the article is published; never part of content" },
  readingTime: { kind: "missing", source: "Not part of the article content model; never estimated" },
  keywords: { kind: "present", source: "keywords" },
  lead: { kind: "present", source: "lead" },
  sections: { kind: "present", source: "sections" },
  canonical: { kind: "derived", source: "The template's route, from the slug" },
  jsonLd: { kind: "derived", source: "The website's ArticleJsonLd component, from the registry record" },
  ctaTitle: { kind: "present", source: "ctaTitle" },
  ctaBody: { kind: "present", source: "ctaBody" },
};

function optionalCoverage(article: ValidatedArticleContent, key: string, label: string): WebsiteOptionalCoverage {
  const state = (present: boolean, source: string): WebsiteOptionalCoverage => ({ key, label, state: present ? "present" : "absent", source: present ? source : "Not provided" });
  switch (key) {
    case "intro":
      return state(article.introduction.length > 0, "introduction");
    case "toc":
      return { key, label, state: "derived", source: "The section headings, in order" };
    case "h3":
      return state(
        article.sections.some((s) => s.subsections.length > 0),
        "sections[].subsections",
      );
    case "faq":
      return state(article.faqs.length > 0, "faqs");
    case "internalLinks":
      return state(article.internalLinks.length > 0, "internalLinks (syntax checked; destinations unverified)");
    default:
      return { key, label, state: "absent", source: "Not part of the article content model" };
  }
}

/** The coverage report for validated content against a pinned website template. */
export function websiteCompleteness(article: ValidatedArticleContent, template: WebsiteTemplate = NEXRA_AI_BLOG_TEMPLATE): WebsiteCompletenessReport {
  const checked = validateArticleContent(article);
  if (!checked.ok) throw new Error("websiteCompleteness: content is not valid article content");
  const content = checked.article;

  const presentRequired: WebsiteFieldCoverage[] = [];
  const missingRequired: WebsiteFieldCoverage[] = [];
  const derived: WebsiteFieldCoverage[] = [];
  const publicationTime: WebsiteFieldCoverage[] = [];
  for (const field of REQUIRED_FIELDS) {
    const mapping = REQUIRED_MAPPING[field.key] ?? { kind: "missing", source: "No mapping from the article content model" };
    const source = field.key === "canonical" ? `${mapping.source}: ${routeFor(template, content.slug)}` : mapping.source;
    const coverage: WebsiteFieldCoverage = { key: field.key, label: field.label, source };
    if (mapping.kind === "present") presentRequired.push(coverage);
    else if (mapping.kind === "derived") derived.push(coverage);
    else if (mapping.kind === "publication-time") publicationTime.push(coverage);
    else missingRequired.push(coverage);
  }

  return {
    templateId: template.id,
    presentRequired,
    missingRequired,
    derived,
    publicationTime,
    optional: OPTIONAL_FIELDS.map((field) => optionalCoverage(content, field.key, field.label)),
    structurallyComplete: missingRequired.length === 0,
    factCheck: "not-established",
    approval: "not-established",
    topicDecision: content.topicDecision,
    internalLinks: checkInternalLinks(content.internalLinks),
  };
}
