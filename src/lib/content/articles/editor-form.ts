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
 * Attested paragraphs (6.8b) are a list of `{locator, basis}` rows, each
 * naming one H2 or H3 body paragraph from `attestableParagraphChoices`;
 * none is ever added on the operator's behalf, and an empty list sends no
 * `attestations` field at all, so the content stays format 1.
 *
 * Pure.
 */

import type { ArticleIssue, ArticleIssueCode, ArticleSourceReference, ValidatedArticleContent } from "@/types/content-article";
import type { ArticleSourceCandidate } from "@/types/content-article-record";

export type SubsectionForm = { id: string; heading: string; body: string };
export type SectionForm = { id: string; heading: string; body: string; subsections: SubsectionForm[] };
export type FaqForm = { question: string; answer: string };
export type LinkForm = { path: string; anchorText: string; sectionId: string };
export type AttestationForm = { locator: string; basis: string };

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
  attestations: AttestationForm[];
  /** M4: the outside pages the article cites (format `/3` when any). */
  citations: CitationForm[];
};

export type CitationForm = { url: string; title: string; publisher: string; retrievedAt: string };

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
    attestations: [],
    citations: [],
  };
}

/** One paragraph an operator may attest: its locator and how the editor names it. */
export type AttestableParagraphChoice = { readonly locator: string; readonly label: string };

function preview(text: string): string {
  const characters = Array.from(text);
  return characters.length > 60 ? `${characters.slice(0, 60).join("")}…` : text;
}

/** Every H2 and H3 body paragraph the form holds, by locator, in article order. Only those can be attested. */
export function attestableParagraphChoices(form: ArticleForm): readonly AttestableParagraphChoice[] {
  const choices: AttestableParagraphChoice[] = [];
  for (const section of form.sections) {
    lines(section.body).forEach((text, p) => choices.push({ locator: `${section.id}/${p}`, label: `${section.heading || section.id} ¶${p + 1}: ${preview(text)}` }));
    for (const sub of section.subsections) {
      lines(sub.body).forEach((text, p) => choices.push({ locator: `${sub.id}/${p}`, label: `${sub.heading || sub.id} ¶${p + 1}: ${preview(text)}` }));
    }
  }
  return choices;
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
    ...(form.attestations.length > 0 ? { attestations: form.attestations.map((a) => ({ locator: a.locator, basis: chosen(a.basis) })) } : {}),
    ...(form.citations.length > 0 ? { citations: form.citations.map((c) => ({ url: c.url.trim(), title: c.title, publisher: c.publisher, retrievedAt: c.retrievedAt.trim() })) } : {}),
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
    attestations: content.attestations.map((a) => ({ locator: a.locator, basis: a.basis })),
    citations: content.citations.map((c) => ({ url: c.url, title: c.title, publisher: c.publisher, retrievedAt: c.retrievedAt })),
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
  attestations: "Attested paragraphs",
  citations: "Cited sources",
  url: "URL",
  publisher: "publisher",
  retrievedAt: "retrieved date",
  locator: "paragraph",
  basis: "basis",
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
  "attestation-target": "names no H2 or H3 body paragraph of this article",
  "attestation-number": "states a number (a digit, %, a currency symbol or a count word other than \"one\" or \"first\"); an attested paragraph may not",
  "attestation-limit": "attests too much: at most 40% of the body's sentences and half of any one section's",
};

export function issueMessage(issue: ArticleIssue): string {
  return `${issuePathLabel(issue.path)} ${ISSUE_TEXT[issue.code]}.`;
}
