import { rand, randInt } from "@/lib/mock/dashboard/core";
import { FORMAT_META, SEVERITY_ORDER } from "@/lib/mock/content/meta";
import { getContentRecords } from "@/lib/mock/content/records";
import type {
  AgentId,
  ContentRecord,
  OnPageCheckId,
  OnPageRecommendation,
  Priority,
} from "@/types/content";

/**
 * On-page findings against a page, and the fix for each.
 *
 * Most of these are read from something the record already knows: how long the
 * title actually is, whether a keyword is mapped to the page at all, how much
 * has been written against the format's target, where the page sits in the
 * internal link graph, how long since it was touched, and whether a generated
 * answer is projected on its keywords without the page being positioned for
 * it. Only the four a fixture
 * cannot observe from the data — the meta description, the H1, the heading
 * outline, and image alt text — are decided by a seeded draw, and they are
 * decided the same way on every render.
 *
 * A finding is only produced where there is something wrong, so a strong page
 * returns few and a weak one returns many. Nothing here rewrites a page: the
 * controls in the UI record a decision in session state and say so.
 */

type Finding = {
  readonly check: OnPageCheckId;
  readonly severity: Priority;
  readonly finding: string;
  readonly action: string;
  readonly scoreImpact: number;
  readonly owner: AgentId;
};

/** Words worth matching between a title and its target query. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "to",
  "of",
  "in",
  "on",
  "and",
  "or",
  "vs",
  "with",
  "best",
  "how",
  "what",
  "is",
  "are",
  "do",
  "does",
  "can",
  "should",
  "near",
  "me",
]);

function coversQuery(title: string, keyword: string): boolean {
  const haystack = title.toLowerCase();
  const terms = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  if (terms.length === 0) return true;
  const hits = terms.filter((word) => haystack.includes(word)).length;
  return hits / terms.length >= 0.5;
}

function build(record: ContentRecord): readonly Finding[] {
  const findings: Finding[] = [];
  const draw = (index: number) => rand(record.seed, index);
  const published = record.url !== null;
  const target = FORMAT_META[record.format].wordTarget;

  // --- What the record can actually observe ------------------------------

  if (record.primaryKeyword === null) {
    findings.push({
      check: "keyword-placement",
      severity: "critical",
      finding: "No keyword is mapped to this page.",
      action:
        "Decide which query this page is meant to win and map it, or fold the page into one that already has a target.",
      scoreImpact: 18,
      owner: "keyword-intent",
    });
  } else if (!coversQuery(record.title, record.primaryKeyword)) {
    findings.push({
      check: "title-tag",
      severity: "high",
      finding: `The title does not carry the target query, “${record.primaryKeyword}”.`,
      action:
        "Rewrite the title so the query reads naturally in the first half of it.",
      scoreImpact: 7,
      owner: "on-page-seo",
    });
  }

  if (record.title.length > 60) {
    findings.push({
      check: "title-tag",
      severity: "low",
      finding: `The title runs to ${record.title.length} characters and will be truncated in results.`,
      action: "Trim it to about 55 characters without losing the query.",
      scoreImpact: 2,
      owner: "on-page-seo",
    });
  }

  if (published && record.wordCount < target * 0.7) {
    const short = Math.round(target - record.wordCount);
    findings.push({
      check: "word-count",
      severity: record.wordCount < target * 0.45 ? "high" : "medium",
      finding: `${record.wordCount.toLocaleString("en-US")} words against a ${target.toLocaleString("en-US")}-word target for a ${FORMAT_META[record.format].label.toLowerCase()}.`,
      action: `Add roughly ${short.toLocaleString("en-US")} words covering what the pages above it answer and this one does not.`,
      scoreImpact: 9,
      owner: "writer",
    });
  }

  // The site root is excluded: navigation links to it from every page, so it
  // is the one page that cannot be orphaned.
  if (published && record.internalLinksIn === 0 && record.url !== "/") {
    findings.push({
      check: "internal-links-in",
      severity: "critical",
      finding: "Nothing on the site links to this page.",
      action:
        "Link to it from the cluster pillar and from the two strongest related pages.",
      scoreImpact: 11,
      owner: "content-strategist",
    });
  }

  if (published && record.internalLinksOut < 2) {
    findings.push({
      check: "internal-links-out",
      severity: record.internalLinksOut === 0 ? "high" : "low",
      finding:
        record.internalLinksOut === 0
          ? "The page links to nothing else on the site."
          : "The page carries a single internal link.",
      action:
        "Add links to the cluster pillar and to the supporting pages that answer the follow-up questions.",
      scoreImpact: 5,
      owner: "on-page-seo",
    });
  }

  if (published && record.aeo.structuredData < 60) {
    findings.push({
      check: "schema",
      severity: record.aeo.structuredData < 35 ? "high" : "medium",
      finding: `Structured data is ${record.aeo.structuredData}% complete for this format.`,
      action: `Add ${FORMAT_META[record.format].schema} markup and validate it.`,
      scoreImpact: 6,
      owner: "technical-seo",
    });
  }

  if (record.aeo.aiKeywords > 0 && record.aeo.likelySourceKeywords === 0) {
    findings.push({
      check: "answer-block",
      severity: "high",
      finding: `An answer is projected on ${record.aeo.aiKeywords} of this page's keywords and this page is not positioned for any of them.`,
      action:
        "Add a 40-60 word self-contained answer under a matching heading, with a sourced figure in it.",
      scoreImpact: 8,
      owner: "ai-visibility",
    });
  }

  if (published && record.aeo.entityCoverage < 70) {
    findings.push({
      check: "entity-coverage",
      severity: record.aeo.entityCoverage < 45 ? "high" : "medium",
      finding: `Entity coverage sits at ${record.aeo.entityCoverage}% of what this topic demands.`,
      action:
        "Name the standards, products, and organisations the topic assumes, and link them to their definitions.",
      scoreImpact: 6,
      owner: "research-evidence",
    });
  }

  if (record.ageDays !== null && record.ageDays > 365) {
    findings.push({
      check: "freshness",
      severity: record.ageDays > 540 ? "high" : "medium",
      finding: `Last touched ${Math.round(record.ageDays / 30)} months ago.`,
      action:
        "Re-check the figures, refresh the examples, and re-date the page once it is genuinely revised.",
      scoreImpact: 7,
      owner: "writer",
    });
  }

  if (record.primaryKeyword !== null && record.intentAlignment !== "aligned") {
    findings.push({
      check: "intent-match",
      severity: record.intentAlignment === "mismatched" ? "high" : "low",
      finding: record.intentNote,
      action:
        record.intentAlignment === "mismatched"
          ? "Either re-cut the page into the format the query asks for, or move the query to a page that already is one."
          : "Add the section the better format would lead with, so the page answers the query on its own terms.",
      scoreImpact: record.intentAlignment === "mismatched" ? 10 : 4,
      owner: "content-strategist",
    });
  }

  if (
    published &&
    (record.primaryIntent === "transactional" ||
      record.primaryIntent === "commercial" ||
      record.primaryIntent === "local") &&
    draw(116) > 0.66
  ) {
    findings.push({
      check: "cta",
      severity: "medium",
      finding: `A ${record.primaryIntent} query lands here with no next step above the fold.`,
      action:
        "Put the primary action where the reader reaches their decision, not only at the end of the page.",
      scoreImpact: 5,
      owner: "on-page-seo",
    });
  }

  if (record.cannibalised) {
    findings.push({
      check: "keyword-placement",
      severity: "high",
      finding: "Another page of ours ranks for a query this page targets.",
      action:
        "Decide which page owns the term, then consolidate or de-optimise the other and re-point the internal links.",
      scoreImpact: 9,
      owner: "on-page-seo",
    });
  }

  // --- What a fixture cannot observe, drawn deterministically ------------

  if (published && draw(111) > 0.62) {
    findings.push({
      check: "meta-description",
      severity: "low",
      finding: "No meta description is set, so the engine writes its own snippet.",
      action: "Write a 150-character description that states the benefit and the format.",
      scoreImpact: 2,
      owner: "on-page-seo",
    });
  }

  if (published && draw(112) > 0.78) {
    findings.push({
      check: "h1",
      severity: "medium",
      finding: "The H1 and the title tag say different things.",
      action: "Bring them into line so the page makes one promise, not two.",
      scoreImpact: 4,
      owner: "on-page-seo",
    });
  }

  if (published && record.wordCount > 900 && draw(113) > 0.6) {
    findings.push({
      check: "heading-structure",
      severity: "medium",
      finding: "The heading outline skips levels, so the structure does not parse cleanly.",
      action: "Rebuild the outline as H2 sections with H3 sub-points beneath them.",
      scoreImpact: 4,
      owner: "on-page-seo",
    });
  }

  if (published && draw(114) > 0.68) {
    const missing = randInt(record.seed, 115, 2, 9);
    findings.push({
      check: "image-alt",
      severity: "low",
      finding: `${missing} images on the page have no alt text.`,
      action: "Describe each image in terms of what it shows, not what it is called.",
      scoreImpact: 2,
      owner: "on-page-seo",
    });
  }

  return findings;
}

let cache: readonly OnPageRecommendation[] | null = null;

/** Every on-page finding across the inventory, most severe first. */
export function getRecommendations(): readonly OnPageRecommendation[] {
  cache ??= getContentRecords()
    .flatMap((record) =>
      build(record).map((finding, index) => ({
        id: `${record.id}--${finding.check}-${index}`,
        contentId: record.id,
        contentTitle: record.title,
        check: finding.check,
        severity: finding.severity,
        finding: finding.finding,
        action: finding.action,
        scoreImpact: finding.scoreImpact,
        owner: finding.owner,
      })),
    )
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        b.scoreImpact - a.scoreImpact ||
        a.contentTitle.localeCompare(b.contentTitle),
    );

  return cache;
}

/** The findings against one page. */
export function recommendationsForContent(
  contentId: string,
): readonly OnPageRecommendation[] {
  return getRecommendations().filter(
    (entry) => entry.contentId === contentId,
  );
}

/** How many points a page would gain if every finding against it were fixed. */
export function recoverableScore(contentId: string): number {
  return recommendationsForContent(contentId).reduce(
    (carry, entry) => carry + entry.scoreImpact,
    0,
  );
}
