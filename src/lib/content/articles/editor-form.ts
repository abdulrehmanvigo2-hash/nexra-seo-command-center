/**
 * The article editor's form state, and its translation to and from C1
 * article content.
 *
 * The form is a convenience for typing structured content, not a second
 * contract: `contentFromForm` produces a plain object and the C1 validator
 * judges it on the server (and, for early feedback, in the browser). The
 * one form convention is that a multi-paragraph field holds one paragraph
 * per line; empty lines are skipped, and nothing else is trimmed, joined or
 * corrected — a line with stray spaces is sent as it is and refused by the
 * validator, with a message that says so. Select fields start empty: the
 * search intent and the topic decision are always the operator's choice.
 *
 * Pure.
 */

import type { ArticleIssue, ArticleIssueCode, ArticleSourceReference, ValidatedArticleContent } from "@/types/content-article";
import type { ArticleSourceCandidate } from "@/types/content-article-record";

export type SubsectionForm = { id: string; heading: string; body: string };
export type SectionForm = { id: string; heading: string; body: string; subsections: SubsectionForm[] };
export type FaqForm = { question: string; answer: string };
export type LinkForm = { path: string; anchorText: string; sectionId: string };

export type ArticleForm = {
  topic: string;
  searchIntent: string;
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  category: string;
  keywords: string;
  lead: string;
  introduction: string;
  sections: SectionForm[];
  faqs: FaqForm[];
  internalLinks: LinkForm[];
  ctaTitle: string;
  ctaBody: string;
  topicDecision: string;
};

export function emptySection(): SectionForm {
  return { id: "", heading: "", body: "", subsections: [] };
}

export function emptyForm(): ArticleForm {
  return {
    topic: "",
    searchIntent: "",
    slug: "",
    title: "",
    metaTitle: "",
    metaDescription: "",
    excerpt: "",
    category: "",
    keywords: "",
    lead: "",
    introduction: "",
    sections: [emptySection()],
    faqs: [],
    internalLinks: [],
    ctaTitle: "",
    ctaBody: "",
    topicDecision: "",
  };
}

/** One entry per non-empty line, each exactly as typed. */
export function lines(value: string): string[] {
  return value.split("\n").filter((line) => line !== "");
}

/** A select left at "Choose…" is omitted, so the validator reports it as required. */
function chosen(value: string): string | undefined {
  return value === "" ? undefined : value;
}

export function contentFromForm(form: ArticleForm): Record<string, unknown> {
  return {
    topic: form.topic,
    searchIntent: chosen(form.searchIntent),
    slug: form.slug,
    title: form.title,
    metaTitle: form.metaTitle,
    metaDescription: form.metaDescription,
    excerpt: form.excerpt,
    category: form.category,
    keywords: lines(form.keywords),
    lead: form.lead,
    introduction: lines(form.introduction),
    sections: form.sections.map((section) => ({
      id: section.id,
      heading: section.heading,
      paragraphs: lines(section.body),
      subsections: section.subsections.map((sub) => ({ id: sub.id, heading: sub.heading, paragraphs: lines(sub.body) })),
    })),
    faqs: form.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
    internalLinks: form.internalLinks.map((link) => ({ path: link.path, anchorText: link.anchorText, sectionId: link.sectionId })),
    ctaTitle: form.ctaTitle,
    ctaBody: form.ctaBody,
    topicDecision: chosen(form.topicDecision),
  };
}

export function formFromContent(content: ValidatedArticleContent): ArticleForm {
  return {
    topic: content.topic,
    searchIntent: content.searchIntent,
    slug: content.slug,
    title: content.title,
    metaTitle: content.metaTitle,
    metaDescription: content.metaDescription,
    excerpt: content.excerpt,
    category: content.category,
    keywords: content.keywords.join("\n"),
    lead: content.lead,
    introduction: content.introduction.join("\n"),
    sections: content.sections.map((section) => ({
      id: section.id,
      heading: section.heading,
      body: section.paragraphs.join("\n"),
      subsections: section.subsections.map((sub) => ({ id: sub.id, heading: sub.heading, body: sub.paragraphs.join("\n") })),
    })),
    faqs: content.faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
    internalLinks: content.internalLinks.map((link) => ({ path: link.path, anchorText: link.anchorText, sectionId: link.sectionId })),
    ctaTitle: content.ctaTitle,
    ctaBody: content.ctaBody,
    topicDecision: content.topicDecision,
  };
}

/** The reference a candidate stands for, with the hash the server computed for it. */
export function referenceFor(candidate: ArticleSourceCandidate): ArticleSourceReference {
  return { draftId: candidate.draftId, version: candidate.version, versionId: candidate.versionId, contentSha256: candidate.contentSha256 };
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  topic: "Topic",
  searchIntent: "Search intent",
  slug: "Slug",
  title: "Title",
  metaTitle: "Meta title",
  metaDescription: "Meta description",
  excerpt: "Excerpt",
  category: "Category",
  keywords: "Keywords",
  lead: "Lead paragraph",
  introduction: "Introduction",
  sections: "Sections",
  faqs: "FAQs",
  internalLinks: "Internal links",
  ctaTitle: "CTA title",
  ctaBody: "CTA body",
  topicDecision: "Topic decision",
  sources: "Sources",
  id: "id",
  heading: "heading",
  paragraphs: "paragraphs",
  subsections: "subsections",
  question: "question",
  answer: "answer",
  path: "path",
  anchorText: "anchor text",
  sectionId: "section id",
  draftId: "draft id",
  version: "version",
  versionId: "version row id",
  contentSha256: "content hash",
};

/** `sections[1].subsections[0].heading` → `Sections 2 › subsections 1 › heading`. */
export function issuePathLabel(path: string): string {
  if (path === "") return "Article";
  return path
    .split(".")
    .map((part) => {
      const match = /^([A-Za-z0-9]+)(?:\[(\d+)\])?$/.exec(part);
      if (match === null) return part;
      const label = FIELD_LABELS[match[1]] ?? match[1];
      return match[2] === undefined ? label : `${label} ${Number(match[2]) + 1}`;
    })
    .join(" › ");
}

const ISSUE_TEXT: Readonly<Record<ArticleIssueCode, string>> = {
  required: "is required",
  type: "has the wrong type",
  "too-long": "is too long",
  "too-many": "has too many entries",
  "surrounding-whitespace": "starts or ends with a space; it is refused, not trimmed",
  "control-character": "contains a control character or line break",
  "invalid-unicode": "contains an invalid character",
  "invisible-character": "contains an invisible or direction-changing character",
  "not-nfc": "is not in Unicode normal form C",
  format: "is not in the required format",
  heading: "starts with markup (#)",
  duplicate: "repeats an earlier entry",
  "unknown-section": "names a section id the article does not have",
  "unsupported-field": "is not part of the article contract",
  "unsupported-value": "is not one of the allowed values",
};

export function issueMessage(issue: ArticleIssue): string {
  return `${issuePathLabel(issue.path)} ${ISSUE_TEXT[issue.code]}.`;
}
