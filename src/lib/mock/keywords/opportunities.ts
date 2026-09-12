import { formatCompact } from "@/lib/format";
import { round } from "@/lib/mock/dashboard/core";
import {
  getKeywordRecords,
  targetPositionFor,
} from "@/lib/mock/keywords/builders";
import { ctrAt } from "@/lib/mock/keywords/meta";
import type {
  KeywordOpportunity,
  KeywordRecord,
  Level,
  OpportunityCategory,
  OpportunityCta,
  Priority,
  StrikingDistanceRow,
} from "@/types/keyword";

/**
 * What to do next, read off the keyword set.
 *
 * Nine categories, each a plain rule over the canonical records rather than an
 * authored list: a quick win is a keyword within reach on a page that already
 * exists, a content gap is a keyword with no page at all, a refresh is a page
 * that ranked and has started slipping. A keyword can qualify for more than
 * one category, and that is correct — the same term can be both a striking
 * distance keyword and a competitor gap, and the two views are read by
 * different people.
 *
 * Every figure quoted as impact is the difference between the traffic the
 * keyword earns now and the traffic it would earn at its target position, so
 * the number on an opportunity is the number on the keyword.
 *
 * Acting on an opportunity changes frontend state and nothing else. There is
 * no planner, no brief generator, and no task queue behind these controls in
 * this milestone (CLAUDE.md §4).
 */

/** Extra monthly sessions from reaching the keyword's target position. */
export function upliftOf(record: KeywordRecord): number {
  return Math.max(0, record.trafficPotential - record.currentTraffic);
}

function impactOf(uplift: number): Level {
  if (uplift >= 800) return "high";
  if (uplift >= 180) return "medium";
  return "low";
}

function effortOf(record: KeywordRecord): Level {
  if (record.targetUrl === null) return "high";
  if (record.difficulty >= 65) return "high";
  if (record.difficulty >= 45) return "medium";
  return "low";
}

function urgencyOf(
  record: KeywordRecord,
  category: OpportunityCategory,
): Priority {
  if (category === "refresh" && record.change <= -8) return "critical";
  if (category === "competitor-gap" && record.volume >= 20_000) return "critical";
  if (record.opportunity.score >= 72) return "high";
  if (record.opportunity.score >= 58) return "medium";
  return "low";
}

const CTA: Record<OpportunityCategory, OpportunityCta> = {
  "quick-win": "Review",
  "striking-distance": "Review",
  "high-volume-low-difficulty": "Add to plan",
  "commercial-intent": "Review",
  "content-gap": "Create brief",
  "competitor-gap": "Create brief",
  local: "Add to plan",
  "ai-search": "Add to plan",
  refresh: "Review",
};

/**
 * Whether a keyword belongs in a category, and why.
 *
 * Returning the reason with the test keeps the two together: a row can never
 * appear under a heading it does not have an explanation for.
 */
function qualify(
  record: KeywordRecord,
  category: OpportunityCategory,
): string | null {
  const position = record.position;

  switch (category) {
    case "quick-win":
      return position !== null &&
        position >= 4 &&
        position <= 15 &&
        record.difficulty < 50 &&
        record.targetUrl !== null
        ? `Position ${position} on a page that already exists, against difficulty ${record.difficulty}.`
        : null;

    case "high-volume-low-difficulty":
      return record.volume >= 8_000 && record.difficulty < 45
        ? `${formatCompact(record.volume)} searches a month at difficulty ${record.difficulty} — demand nobody has made hard to reach.`
        : null;

    case "striking-distance":
      return position !== null && position >= 4 && position <= 20
        ? `Position ${position}: ${position <= 10 ? "on page one but below the fold" : "one page short of the traffic"}.`
        : null;

    case "commercial-intent":
      return (record.intent === "transactional" ||
        record.intent === "commercial") &&
        record.commercialValue >= 68 &&
        (position === null || position > 3)
        ? `${record.intent === "transactional" ? "Ready-to-act" : "Comparison-stage"} query worth $${record.cpc.toFixed(2)} a click, and we are not in the top three.`
        : null;

    case "content-gap":
      return record.targetUrl === null
        ? `No page on the site targets this query.`
        : null;

    case "competitor-gap":
      return record.competitor &&
        record.volume >= 2_000 &&
        (position === null || record.competitor.position < position)
        ? `${record.competitor.name} holds position ${record.competitor.position}${position === null ? " and we do not rank at all" : ` against our ${position}`}.`
        : null;

    case "local":
      return record.intent === "local" && (position === null || position > 3)
        ? `A map pack decides this query and we are ${position === null ? "not in the results" : `at position ${position}`}.`
        : null;

    case "ai-search":
      return record.ai.answerProjected &&
        record.ai.coverage !== "likely-source" &&
        record.ai.answerRelevance >= 60
        ? `An AI overview answers this query and cites someone else — answer relevance ${record.ai.answerRelevance} of 100.`
        : null;

    case "refresh":
      return record.change <= -4 && record.targetUrl !== null
        ? `Down ${Math.abs(record.change)} places this window on a page that used to hold ${record.previousPosition}.`
        : null;
  }
}

let cache: readonly KeywordOpportunity[] | null = null;

/** Every opportunity across every category, strongest first. */
export function getKeywordOpportunities(): readonly KeywordOpportunity[] {
  cache ??= build();
  return cache;
}

const CATEGORIES: readonly OpportunityCategory[] = [
  "quick-win",
  "striking-distance",
  "high-volume-low-difficulty",
  "commercial-intent",
  "content-gap",
  "competitor-gap",
  "ai-search",
  "local",
  "refresh",
];

function build(): readonly KeywordOpportunity[] {
  const opportunities: KeywordOpportunity[] = [];

  for (const record of getKeywordRecords()) {
    const uplift = upliftOf(record);

    for (const category of CATEGORIES) {
      const reason = qualify(record, category);
      if (reason === null) continue;

      opportunities.push({
        id: `${category}--${record.id}`,
        category,
        keywordId: record.id,
        keyword: record.keyword,
        projectId: record.projectId,
        projectName: record.projectName,
        intent: record.intent,
        volume: record.volume,
        difficulty: record.difficulty,
        position: record.position,
        reason,
        expectedImpact:
          uplift >= 1
            ? `+${formatCompact(uplift)} sessions / mo`
            : "Defensive — protects what the page already earns",
        impact: impactOf(uplift),
        effort: effortOf(record),
        urgency: urgencyOf(record, category),
        targetUrl: record.targetUrl,
        owner: record.owner,
        cta: CTA[category],
        score: record.opportunity.score,
      });
    }
  }

  return opportunities.sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
}

/** Opportunities in one category. */
export function opportunitiesInCategory(
  category: OpportunityCategory,
): readonly KeywordOpportunity[] {
  return getKeywordOpportunities().filter(
    (entry) => entry.category === category,
  );
}

/** Opportunities attached to one keyword. */
export function opportunitiesForKeyword(
  keywordId: string,
): readonly KeywordOpportunity[] {
  return getKeywordOpportunities().filter(
    (entry) => entry.keywordId === keywordId,
  );
}

// ---------------------------------------------------------------------------
// Striking distance
// ---------------------------------------------------------------------------

/**
 * What to do about a keyword sitting between positions four and twenty.
 *
 * The recommendation is chosen from the weakest thing about the keyword, so
 * two rows at the same position do not get the same advice: a page with thin
 * content is told to deepen it, a page losing a snippet is told to answer the
 * question, a page facing a much stronger rival is told to build authority.
 */
function recommendationFor(record: KeywordRecord): string {
  const snippet = record.serpFeatures.find(
    (feature) =>
      feature.feature === "featured-snippet" && feature.ownership !== "ours",
  );

  if (record.contentStrength < 45) {
    return "Deepen the page: it is thinner than the results above it.";
  }
  if (snippet) {
    return "Answer the query directly under a matching heading to take the snippet.";
  }
  if (record.competingUrls.length > 0) {
    return "Resolve the two pages competing for this term before optimising either.";
  }
  if (record.difficulty >= 60) {
    return "Add internal links from the strongest related pages, then revisit.";
  }
  if (record.ai.answerProjected && record.ai.coverage !== "likely-source") {
    return "Add a citable passage with sourced figures — a projected answer block is taking the clicks.";
  }
  return "Refresh the title and intro to match the query more exactly.";
}

let strikingCache: readonly StrikingDistanceRow[] | null = null;

/** Keywords ranking 4-20, worst-served first by potential gain. */
export function getStrikingDistance(): readonly StrikingDistanceRow[] {
  strikingCache ??= getKeywordRecords()
    .filter(
      (record) =>
        record.position !== null &&
        record.position >= 4 &&
        record.position <= 20,
    )
    .map((record) => {
      const position = record.position as number;
      const targetPosition = targetPositionFor(position);

      return {
        keywordId: record.id,
        keyword: record.keyword,
        projectId: record.projectId,
        projectName: record.projectName,
        position,
        volume: record.volume,
        difficulty: record.difficulty,
        intent: record.intent,
        targetUrl: record.targetUrl,
        ctrUpside: upliftOf(record),
        currentCtr: round(ctrAt(position), 2),
        targetCtr: round(ctrAt(targetPosition), 2),
        targetPosition,
        recommendation: recommendationFor(record),
        owner: record.owner,
        score: record.opportunity.score,
      };
    })
    .sort((a, b) => b.ctrUpside - a.ctrUpside);

  return strikingCache;
}
