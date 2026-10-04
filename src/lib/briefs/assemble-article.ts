import { parsePart, partsFor, type ArticlePart, type ParsedClosing, type ParsedOpening, type ParsedSection, type Tag, type TaggedText } from "@/lib/briefs/article-part";
import type { AdmittedClaim, OpportunityBriefInput, ParsedBrief } from "@/lib/briefs/brief";
import { articleWordCount } from "@/lib/content/articles/website/render";
import { sentencesOf } from "@/lib/content/articles/checks/units";
import { ARTICLE_LIMITS, ATTESTED_BODY_SHARE, ATTESTED_SECTION_SHARE, SEARCH_INTENTS, statesAttestedNumber, validateArticleContent } from "@/lib/content/articles/validate";
import type { ArticleAttestation, ArticleCitedSource, ArticleContent, ArticleInternalLink, ArticleIssue, ArticleSection, ValidatedArticleContent } from "@/types/content-article";
import type { AgentRun } from "@/types/agent-run";
import type { SearchIntent } from "@/types/seo";

/**
 * M6, PR 3 (docs/roadmap/M6-article-writer.md): the Writer's part runs of one brief, assembled into the article editor's
 * import JSON with an evidence map. Pure.
 *
 *   * For each part, the newest completed, model-executed run is used; a simulated, failed or unfinished run never is,
 *     and an answer off the part's format is named, never mixed in.
 *   * Every tagged line is checked against the records the run read: a crawled path the crawl fetched, an admitted unit
 *     the opportunity holds. Anything else — no tag, an unknown path or label — is **unsupported**: kept in the text,
 *     listed first, never dropped silently.
 *   * `[opinion]` paragraphs become attested paragraphs (basis `opinion`); the C1 validator then holds the attestation
 *     rules (no number, the 40% and half-a-section limits) and every issue is listed.
 *
 * Nothing here saves anything: the operator imports the JSON into the editor and presses Create or Save.
 */

export const DEFAULT_CATEGORY = "AI Automation";

/** The assembled article's words (the renderer's count: lead, introduction, sections, FAQ answers) below which it warns. */
export const MIN_ARTICLE_WORDS = 1_000;

/** A title's site-name separator: " | ", " – ", " — " or " - ", the last one in the title. */
const TITLE_SEPARATOR = /\s+[|–—-]\s+(?!.*\s[|–—-]\s)/u;

/**
 * One cited source for the article: the page's recorded title and the publisher it names after a separator
 * ("AI Answering Service for Small Business | Layer3Labs"), or, when the evidence source recorded no title, the page's
 * address and host (flagged by the caller for the operator to replace).
 */
export function citedSourceOf(unit: AdmittedClaim): ArticleCitedSource & { readonly fromAddress: boolean } {
  const url = new URL(unit.url);
  const retrievedAt = unit.retrievedAt.slice(0, 10);
  const recorded = (unit.pageTitle ?? "").replace(/\s+/g, " ").trim();
  if (recorded === "") {
    return { url: unit.url, title: `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.slice(0, ARTICLE_LIMITS.sourceTitle), publisher: url.hostname.slice(0, ARTICLE_LIMITS.sourcePublisher), retrievedAt, fromAddress: true };
  }
  const match = TITLE_SEPARATOR.exec(recorded);
  const title = (match === null ? recorded : recorded.slice(0, match.index)).trim() || recorded;
  const publisher = (match === null ? url.hostname.replace(/^www\./, "") : recorded.slice(match.index + match[0].length)).trim() || url.hostname;
  return { url: unit.url, title: title.slice(0, ARTICLE_LIMITS.sourceTitle), publisher: publisher.slice(0, ARTICLE_LIMITS.sourcePublisher), retrievedAt, fromAddress: false };
}

export type PartState =
  | { readonly part: ArticlePart; readonly state: "missing" }
  | { readonly part: ArticlePart; readonly state: "pending"; readonly runId: string; readonly status: string }
  | { readonly part: ArticlePart; readonly state: "unparsed"; readonly runId: string }
  | { readonly part: ArticlePart; readonly state: "used"; readonly runId: string };

export type EvidenceStatus = "record" | "opinion" | "connective" | "unsupported";

export type EvidenceEntry = {
  /** `lead`, `introduction/0`, `<section id>/<n>` or `faq/<n>`. */
  readonly locator: string;
  readonly text: string;
  readonly tag: string;
  readonly status: EvidenceStatus;
  /** Why a line is unsupported, or that an opinion states a number. */
  readonly note: string | null;
};

export type AssembledDraft = {
  readonly briefRunId: string;
  readonly parts: readonly PartState[];
  /** Null until every part has a usable run. */
  readonly content: ArticleContent | null;
  /** Unsupported entries first, then in article order. */
  readonly evidenceMap: readonly EvidenceEntry[];
  /** The C1 validator's issues on `content`; empty when it validates. */
  readonly issues: readonly ArticleIssue[];
  /** Fields set by a default, and links left out, each for the operator to check. */
  readonly notes: readonly string[];
  /** What the drafted parts already show would fail the attestation rules, part by part, before the whole is assembled. */
  readonly warnings: readonly PartWarning[];
};

/** One drafted part's breach of an attestation rule; `part` is null for the share across every drafted section. */
export type PartWarning = { readonly part: ArticlePart | null; readonly text: string };

function tagText(tag: Tag): string {
  switch (tag.kind) {
    case "crawl":
      return `[crawl ${tag.path}]`;
    case "evidence":
      return `[evidence ${tag.label}]`;
    case "opinion":
      return "[opinion]";
    case "connective":
      return "[connective]";
    default:
      return "none";
  }
}

/** A section id from its heading: lowercase letters, digits and single hyphens, unique in the article. */
export function sectionId(heading: string, taken: Set<string>): string {
  const base = heading.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "section";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** The newest usable run of each part, in article order. */
export function partStates(brief: ParsedBrief, runs: readonly AgentRun[], briefRunId: string): readonly { state: PartState; parsed: ReturnType<typeof parsePart> }[] {
  const id = briefRunId.toLowerCase();
  const ofBrief = runs
    .filter((run) => run.taskType === "article-part-draft" && String(run.input.briefRunId ?? "").toLowerCase() === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return partsFor(brief).map((part) => {
    const mine = ofBrief.filter((run) => run.input.part === part);
    const done = mine.find((run) => run.status === "completed" && run.executor === "ai" && run.resultSummary !== null);
    if (done === undefined) {
      const open = mine.find((run) => run.status === "queued" || run.status === "running");
      return { state: open ? { part, state: "pending", runId: open.id, status: open.status } : { part, state: "missing" }, parsed: null };
    }
    const parsed = parsePart(done.resultSummary!, part);
    return { state: parsed === null ? { part, state: "unparsed", runId: done.id } : { part, state: "used", runId: done.id }, parsed };
  });
}

/**
 * The attestation rules (C1, 6.8b) checked on each drafted section as soon as it is drafted: an [opinion] line states
 * no number, opinion holds at most half of a section's sentences, and — across the sections drafted so far — at most
 * 40% of the body. A warning names the part to re-queue or edit; nothing is changed or dropped.
 */
export function partWarnings(states: readonly { state: PartState; parsed: ReturnType<typeof parsePart> }[]): readonly PartWarning[] {
  const warnings: PartWarning[] = [];
  let opinionAll = 0;
  let sentencesAll = 0;
  for (const entry of states) {
    if (entry.state.state !== "used" || entry.parsed === null || !("paragraphs" in entry.parsed)) continue;
    const { part } = entry.state;
    const label = `Section ${(entry.parsed as ParsedSection).section}`;
    const paragraphs = (entry.parsed as ParsedSection).paragraphs;
    let opinion = 0;
    let total = 0;
    paragraphs.forEach((paragraph, n) => {
      const count = sentencesOf(paragraph.text).length;
      total += count;
      if (paragraph.tag.kind !== "opinion") return;
      opinion += count;
      if (statesAttestedNumber(paragraph.text)) warnings.push({ part, text: `${label}: opinion paragraph ${n + 1} states a number, which an attested paragraph may not; remove it or queue the part again.` });
    });
    if (opinion > ATTESTED_SECTION_SHARE * total) warnings.push({ part, text: `${label}: opinion is ${opinion} of ${total} sentences, over half the section; rewrite some as advice or queue the part again.` });
    opinionAll += opinion;
    sentencesAll += total;
  }
  if (sentencesAll > 0 && opinionAll > ATTESTED_BODY_SHARE * sentencesAll) {
    warnings.push({ part: null, text: `Opinion is ${opinionAll} of ${sentencesAll} sentences in the drafted sections, over 40% of the body; the assembled draft will fail until some becomes advice.` });
  }
  return warnings;
}

export function assembleArticle(input: { readonly briefRunId: string; readonly brief: ParsedBrief; readonly records: OpportunityBriefInput | null; readonly runs: readonly AgentRun[] }): AssembledDraft {
  const { brief, records } = input;
  const states = partStates(brief, input.runs, input.briefRunId);
  const parts = states.map((entry) => entry.state);
  const warnings = partWarnings(states);
  if (states.some((entry) => entry.state.state !== "used")) {
    return { briefRunId: input.briefRunId, parts, content: null, evidenceMap: [], issues: [], notes: [], warnings };
  }

  const opening = states[0]!.parsed as ParsedOpening;
  const closing = states[states.length - 1]!.parsed as ParsedClosing;
  const sectionParts = states.slice(1, -1).map((entry) => entry.parsed as ParsedSection);
  const sitePaths = new Set(records?.site?.paths ?? []);
  const admitted = new Map((records?.admitted ?? []).map((unit) => [unit.label, unit]));
  const notes: string[] = [];
  const map: EvidenceEntry[] = [];
  const cited: string[] = [];

  const record = (locator: string, line: TaggedText) => {
    const { tag } = line;
    let status: EvidenceStatus;
    let note: string | null = null;
    if (tag.kind === "crawl") {
      status = sitePaths.has(tag.path) ? "record" : "unsupported";
      if (status === "unsupported") note = `The newest crawl did not fetch ${tag.path}.`;
    } else if (tag.kind === "evidence") {
      status = admitted.has(tag.label) ? "record" : "unsupported";
      if (status === "record" && !cited.includes(tag.label)) cited.push(tag.label);
      if (status === "unsupported") note = `No admitted unit ${tag.label} for this opportunity.`;
    } else if (tag.kind === "opinion") {
      status = "opinion";
      if (statesAttestedNumber(line.text)) note = "States a number: an attested paragraph may not.";
    } else if (tag.kind === "connective") {
      status = "connective";
    } else {
      status = "unsupported";
      note = "No tag: what it rests on is not named.";
    }
    map.push({ locator, text: line.text, tag: tagText(tag), status, note });
  };

  record("lead", opening.lead);
  record("introduction/0", opening.introduction);

  const taken = new Set<string>();
  const attestations: ArticleAttestation[] = [];
  const internalLinks: ArticleInternalLink[] = [];
  const sections: ArticleSection[] = sectionParts.map((part) => {
    const h2 = brief.outline[part.section - 1]!;
    const id = sectionId(h2.heading, taken);
    part.paragraphs.forEach((paragraph, n) => {
      record(`${id}/${n}`, paragraph);
      if (paragraph.tag.kind === "opinion") attestations.push({ locator: `${id}/${n}`, basis: "opinion" });
    });
    if (part.link !== null) {
      const placed = brief.links.some((link) => link.path === part.link!.path && link.under === h2.heading);
      const found = part.paragraphs.some((paragraph) => paragraph.text.includes(part.link!.anchorText));
      if (placed && found && sitePaths.has(part.link.path)) internalLinks.push({ path: part.link.path, anchorText: part.link.anchorText, sectionId: id });
      else notes.push(`Link ${part.link.path} under "${h2.heading}" left out: ${!placed ? "the brief did not place it there" : !found ? "its anchor text is not in the section" : "the newest crawl did not fetch it"}.`);
    }
    return { id, heading: h2.heading, paragraphs: part.paragraphs.map((paragraph) => paragraph.text), subsections: [] };
  });

  const faqs = brief.faqs.flatMap((question, i) => {
    const answer = closing.answers.find((entry) => entry.number === i + 1);
    if (answer === undefined) {
      notes.push(`FAQ ${i + 1} ("${question}") has no answer and is left out.`);
      return [];
    }
    record(`faq/${i}`, answer.answer);
    return [{ question, answer: answer.answer.text }];
  });

  const cluster = records?.cluster ?? null;
  const intent = cluster?.intent ?? null;
  const searchIntent: SearchIntent = intent !== null && (SEARCH_INTENTS as readonly string[]).includes(intent) ? (intent as SearchIntent) : "informational";
  if (intent === null) notes.push("Search intent set to informational: the cluster records none.");
  const keywords: string[] = [];
  for (const k of cluster?.keywords ?? []) {
    if (k.role === "excluded" || keywords.some((seen) => seen.toLowerCase() === k.keyword.toLowerCase())) continue;
    if (k.role === "primary") keywords.unshift(k.keyword);
    else keywords.push(k.keyword);
  }
  if (cluster === null) notes.push("No cluster was readable: topic and keywords are empty; fill them in before saving.");
  notes.push(`Category set to "${DEFAULT_CATEGORY}"; check it.`);

  const sources = cited.map((label) => citedSourceOf(admitted.get(label)!));
  const citations: ArticleCitedSource[] = sources.map((source) => ({ url: source.url, title: source.title, publisher: source.publisher, retrievedAt: source.retrievedAt }));
  if (sources.some((source) => source.fromAddress)) notes.push("A cited source whose page recorded no title is titled by its address; give it the page's real title.");
  if (sources.some((source) => !source.fromAddress)) notes.push("Cited sources are titled from each page's recorded title, the publisher from its site name; check them.");

  const content: ArticleContent = {
    topic: cluster?.topic ?? "",
    searchIntent,
    slug: opening.slug,
    title: opening.title,
    metaTitle: opening.metaTitle,
    metaDescription: opening.metaDescription,
    excerpt: opening.excerpt,
    category: DEFAULT_CATEGORY,
    keywords: keywords.slice(0, ARTICLE_LIMITS.keywords),
    lead: opening.lead.text,
    introduction: [opening.introduction.text],
    sections,
    faqs,
    internalLinks,
    ctaTitle: closing.ctaTitle,
    ctaBody: closing.ctaBody,
    topicDecision: "unset",
    attestations,
    citations,
  };
  const validation = validateArticleContent(content);
  // Counted on the assembled content whether or not it validates: a short draft is worth knowing about either way.
  const words = articleWordCount(content as unknown as ValidatedArticleContent);
  const allWarnings = words < MIN_ARTICLE_WORDS
    ? [...warnings, { part: null, text: `The assembled article has ${words} words, under ${MIN_ARTICLE_WORDS.toLocaleString("en-GB")}; queue thin sections again or add sections before saving.` }]
    : warnings;
  const evidenceMap = map.map((entry, index) => ({ entry, index })).sort((a, b) => Number(a.entry.status !== "unsupported") - Number(b.entry.status !== "unsupported") || a.index - b.index).map(({ entry }) => entry);
  return { briefRunId: input.briefRunId, parts, content, evidenceMap, issues: validation.ok ? [] : validation.issues, notes, warnings: allWarnings };
}

/** The import box's text: the content object as the editor's Import reads it. */
export function importText(draft: AssembledDraft): string | null {
  return draft.content === null ? null : JSON.stringify(draft.content, null, 2);
}
