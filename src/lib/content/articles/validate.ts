/**
 * Strict validation of article content (Stage 5, milestone C1).
 *
 * Input is `unknown` — a parsed JSON value, never trusted. The validator
 * reports every problem it finds, each with a path and a fixed code, and
 * returns content only when there are none. It never trims, normalises,
 * reorders, corrects or fills anything in: editorial text is accepted
 * exactly as written or refused.
 *
 * Text rules, for every text field:
 * - required text is a non-empty string;
 * - no leading or trailing whitespace (refused, not trimmed);
 * - no control characters, line breaks included (U+0000–U+001F, U+007F–U+009F,
 *   U+2028, U+2029): paragraphs are separate list entries, never embedded lines;
 * - well-formed Unicode (no unpaired surrogate) in Normalisation Form C, so the
 *   same visible text always has the same bytes;
 * - lengths are counted in Unicode code points, as PostgreSQL's
 *   `char_length` counts them.
 *
 * Optional lists (`introduction`, `faqs`, `internalLinks`, a section's
 * `subsections`) may be omitted, which means empty; `null` is refused. Any
 * field the contract does not define is refused, which is also what keeps
 * ids, versions, statuses, actors, timestamps and provenance out of content.
 *
 * Pure.
 */

import { isInternalPathSyntax } from "@/lib/content/articles/internal-links";
import { validateSlug } from "@/lib/content/publications/proposal-rules";
import type {
  ArticleContent,
  ArticleFaq,
  ArticleInternalLink,
  ArticleIssue,
  ArticleIssueCode,
  ArticleSection,
  ArticleSubsection,
  ArticleTopicDecision,
  ArticleValidationResult,
  ValidatedArticleContent,
} from "@/types/content-article";
import type { SearchIntent } from "@/types/seo";

/** Upper bounds, in code points for text and entries for lists. */
export const ARTICLE_LIMITS = {
  topic: 200,
  title: 200,
  metaTitle: 120,
  metaDescription: 320,
  excerpt: 500,
  category: 60,
  keyword: 100,
  keywords: 20,
  lead: 1500,
  paragraph: 5000,
  introduction: 10,
  sections: 30,
  heading: 200,
  paragraphsPerSection: 50,
  subsectionsPerSection: 20,
  sectionId: 80,
  faqs: 30,
  faqQuestion: 300,
  faqAnswer: 3000,
  internalLinks: 50,
  anchorText: 200,
  ctaTitle: 200,
  ctaBody: 1000,
} as const;

export const SEARCH_INTENTS: readonly SearchIntent[] = ["informational", "commercial", "transactional", "navigational", "local", "mixed"];

export const TOPIC_DECISIONS: readonly ArticleTopicDecision[] = ["update-existing", "different-angle", "do-not-create", "unset"];

const ARTICLE_KEYS = [
  "topic",
  "searchIntent",
  "slug",
  "title",
  "metaTitle",
  "metaDescription",
  "excerpt",
  "category",
  "keywords",
  "lead",
  "introduction",
  "sections",
  "faqs",
  "internalLinks",
  "ctaTitle",
  "ctaBody",
  "topicDecision",
] as const;
const SECTION_KEYS = ["id", "heading", "paragraphs", "subsections"] as const;
const SUBSECTION_KEYS = ["id", "heading", "paragraphs"] as const;
const FAQ_KEYS = ["question", "answer"] as const;
const LINK_KEYS = ["path", "anchorText", "sectionId"] as const;

const SECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const SURROUNDING_WHITESPACE = /^\s|\s$/;

type Record_ = Readonly<Record<string, unknown>>;

function isPlainObject(value: unknown): value is Record_ {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function codePoints(value: string): number {
  return Array.from(value).length;
}

/** The first rule a text value breaks, or null. */
export function textIssue(value: unknown, max: number): ArticleIssueCode | null {
  if (value === undefined || value === null || value === "") return "required";
  if (typeof value !== "string") return "type";
  if (LONE_SURROGATE.test(value)) return "invalid-unicode";
  if (CONTROL.test(value)) return "control-character";
  if (SURROUNDING_WHITESPACE.test(value)) return "surrounding-whitespace";
  if (value.normalize("NFC") !== value) return "not-nfc";
  if (codePoints(value) > max) return "too-long";
  return null;
}

class Collector {
  readonly issues: ArticleIssue[] = [];

  add(path: string, code: ArticleIssueCode): void {
    this.issues.push({ path, code });
  }

  /** Refuses every key not in `allowed`. */
  onlyKeys(value: Record_, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.add(join(path, key), "unsupported-field");
    }
  }

  text(value: unknown, max: number, path: string): string {
    const code = textIssue(value, max);
    if (code !== null) this.add(path, code);
    return typeof value === "string" ? value : "";
  }

  /** A list: required lists refuse omission and emptiness; optional ones read omission as empty. */
  list(value: unknown, max: number, path: string, required: boolean): readonly unknown[] {
    if (value === undefined && !required) return [];
    if (value === undefined || value === null) {
      this.add(path, value === null && !required ? "type" : "required");
      return [];
    }
    if (!Array.isArray(value)) {
      this.add(path, "type");
      return [];
    }
    if (required && value.length === 0) this.add(path, "required");
    if (value.length > max) this.add(path, "too-many");
    return value;
  }

  object(value: unknown, path: string): Record_ | null {
    if (value === undefined || value === null) {
      this.add(path, "required");
      return null;
    }
    if (!isPlainObject(value)) {
      this.add(path, "type");
      return null;
    }
    return value;
  }

  oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
    if (value === undefined || value === null || value === "") this.add(path, "required");
    else if (typeof value !== "string") this.add(path, "type");
    else if (!(allowed as readonly string[]).includes(value)) this.add(path, "unsupported-value");
    return value as T;
  }
}

function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function heading(collector: Collector, value: unknown, path: string): string {
  const text = collector.text(value, ARTICLE_LIMITS.heading, path);
  if (textIssue(value, ARTICLE_LIMITS.heading) === null && text.startsWith("#")) collector.add(path, "heading");
  return text;
}

function paragraphs(collector: Collector, value: unknown, path: string): string[] {
  return collector
    .list(value, ARTICLE_LIMITS.paragraphsPerSection, path, true)
    .map((paragraph, index) => collector.text(paragraph, ARTICLE_LIMITS.paragraph, `${path}[${index}]`));
}

function sectionId(collector: Collector, value: unknown, path: string, seen: Set<string>): string {
  if (value === undefined || value === null || value === "") {
    collector.add(path, "required");
    return "";
  }
  if (typeof value !== "string") {
    collector.add(path, "type");
    return "";
  }
  if (value.length > ARTICLE_LIMITS.sectionId) collector.add(path, "too-long");
  else if (!SECTION_ID.test(value)) collector.add(path, "format");
  else if (seen.has(value)) collector.add(path, "duplicate");
  seen.add(value);
  return value;
}

/** Flags every entry whose key (after `key`) repeats an earlier one. */
function duplicates<T>(collector: Collector, items: readonly T[], key: (item: T) => string, path: (index: number) => string): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const k = key(item);
    if (k === "") return;
    if (seen.has(k)) collector.add(path(index), "duplicate");
    seen.add(k);
  });
}

function subsection(collector: Collector, value: unknown, path: string, ids: Set<string>): ArticleSubsection {
  const raw = collector.object(value, path);
  if (raw === null) return { id: "", heading: "", paragraphs: [] };
  collector.onlyKeys(raw, SUBSECTION_KEYS, path);
  return {
    id: sectionId(collector, raw.id, join(path, "id"), ids),
    heading: heading(collector, raw.heading, join(path, "heading")),
    paragraphs: paragraphs(collector, raw.paragraphs, join(path, "paragraphs")),
  };
}

function section(collector: Collector, value: unknown, path: string, ids: Set<string>): ArticleSection {
  const raw = collector.object(value, path);
  if (raw === null) return { id: "", heading: "", paragraphs: [], subsections: [] };
  collector.onlyKeys(raw, SECTION_KEYS, path);
  const id = sectionId(collector, raw.id, join(path, "id"), ids);
  const h2 = heading(collector, raw.heading, join(path, "heading"));
  const body = paragraphs(collector, raw.paragraphs, join(path, "paragraphs"));
  const subsectionsPath = join(path, "subsections");
  const subsections = collector
    .list(raw.subsections, ARTICLE_LIMITS.subsectionsPerSection, subsectionsPath, false)
    .map((entry, index) => subsection(collector, entry, `${subsectionsPath}[${index}]`, ids));
  duplicates(collector, subsections, (s) => s.heading, (index) => `${subsectionsPath}[${index}].heading`);
  return { id, heading: h2, paragraphs: body, subsections };
}

function faq(collector: Collector, value: unknown, path: string): ArticleFaq {
  const raw = collector.object(value, path);
  if (raw === null) return { question: "", answer: "" };
  collector.onlyKeys(raw, FAQ_KEYS, path);
  return {
    question: collector.text(raw.question, ARTICLE_LIMITS.faqQuestion, join(path, "question")),
    answer: collector.text(raw.answer, ARTICLE_LIMITS.faqAnswer, join(path, "answer")),
  };
}

function internalLink(collector: Collector, value: unknown, path: string, ids: ReadonlySet<string>): ArticleInternalLink {
  const raw = collector.object(value, path);
  if (raw === null) return { path: "", anchorText: "", sectionId: "" };
  collector.onlyKeys(raw, LINK_KEYS, path);
  const target = raw.path;
  if (target === undefined || target === null || target === "") collector.add(join(path, "path"), "required");
  else if (typeof target !== "string") collector.add(join(path, "path"), "type");
  else if (!isInternalPathSyntax(target)) collector.add(join(path, "path"), "format");
  const anchorText = collector.text(raw.anchorText, ARTICLE_LIMITS.anchorText, join(path, "anchorText"));
  const placement = raw.sectionId;
  if (placement === undefined || placement === null || placement === "") collector.add(join(path, "sectionId"), "required");
  else if (typeof placement !== "string") collector.add(join(path, "sectionId"), "type");
  else if (!ids.has(placement)) collector.add(join(path, "sectionId"), "unknown-section");
  return { path: typeof target === "string" ? target : "", anchorText, sectionId: typeof placement === "string" ? placement : "" };
}

function slug(collector: Collector, value: unknown): string {
  const result = validateSlug(value);
  if (!result.ok) {
    const code: ArticleIssueCode =
      value === undefined || value === null || value === "" ? "required" : typeof value !== "string" ? "type" : result.refusal === "too-long" ? "too-long" : "format";
    collector.add("slug", code);
    return typeof value === "string" ? value : "";
  }
  return result.slug;
}

/**
 * Validates article content. Returns a fresh, validated copy — never the
 * caller's object — with every key in contract order and every optional
 * list present, or every issue found.
 */
export function validateArticleContent(input: unknown): ArticleValidationResult {
  const collector = new Collector();
  if (!isPlainObject(input)) {
    return { ok: false, issues: [{ path: "", code: input === undefined || input === null ? "required" : "type" }] };
  }
  collector.onlyKeys(input, ARTICLE_KEYS, "");

  const keywords = collector.list(input.keywords, ARTICLE_LIMITS.keywords, "keywords", true).map((keyword, index) => collector.text(keyword, ARTICLE_LIMITS.keyword, `keywords[${index}]`));
  duplicates(collector, keywords, (k) => k.toLowerCase(), (index) => `keywords[${index}]`);

  const introduction = collector
    .list(input.introduction, ARTICLE_LIMITS.introduction, "introduction", false)
    .map((paragraph, index) => collector.text(paragraph, ARTICLE_LIMITS.paragraph, `introduction[${index}]`));

  const ids = new Set<string>();
  const sections = collector.list(input.sections, ARTICLE_LIMITS.sections, "sections", true).map((entry, index) => section(collector, entry, `sections[${index}]`, ids));
  duplicates(collector, sections, (s) => s.heading, (index) => `sections[${index}].heading`);

  const faqs = collector.list(input.faqs, ARTICLE_LIMITS.faqs, "faqs", false).map((entry, index) => faq(collector, entry, `faqs[${index}]`));
  duplicates(collector, faqs, (f) => f.question, (index) => `faqs[${index}].question`);

  const internalLinks = collector.list(input.internalLinks, ARTICLE_LIMITS.internalLinks, "internalLinks", false).map((entry, index) => internalLink(collector, entry, `internalLinks[${index}]`, ids));
  duplicates(collector, internalLinks, (l) => (l.path === "" ? "" : `${l.sectionId}\u0000${l.path}`), (index) => `internalLinks[${index}]`);

  const article: ArticleContent = {
    topic: collector.text(input.topic, ARTICLE_LIMITS.topic, "topic"),
    searchIntent: collector.oneOf(input.searchIntent, SEARCH_INTENTS, "searchIntent"),
    slug: slug(collector, input.slug),
    title: collector.text(input.title, ARTICLE_LIMITS.title, "title"),
    metaTitle: collector.text(input.metaTitle, ARTICLE_LIMITS.metaTitle, "metaTitle"),
    metaDescription: collector.text(input.metaDescription, ARTICLE_LIMITS.metaDescription, "metaDescription"),
    excerpt: collector.text(input.excerpt, ARTICLE_LIMITS.excerpt, "excerpt"),
    category: collector.text(input.category, ARTICLE_LIMITS.category, "category"),
    keywords,
    lead: collector.text(input.lead, ARTICLE_LIMITS.lead, "lead"),
    introduction,
    sections,
    faqs,
    internalLinks,
    ctaTitle: collector.text(input.ctaTitle, ARTICLE_LIMITS.ctaTitle, "ctaTitle"),
    ctaBody: collector.text(input.ctaBody, ARTICLE_LIMITS.ctaBody, "ctaBody"),
    topicDecision: collector.oneOf(input.topicDecision, TOPIC_DECISIONS, "topicDecision"),
  };

  if (collector.issues.length > 0) return { ok: false, issues: collector.issues };
  return { ok: true, article: article as ValidatedArticleContent };
}
