import { clamp } from "@/lib/mock/dashboard/core";
import {
  EXPANSION_PATTERNS,
  getKeywordClusters,
  getKeywordRecord,
} from "@/lib/mock/keywords";
import { getAiPages } from "@/lib/mock/ai-visibility/gaps";
import type {
  AiGapKind,
  AiSeverity,
  BranchCoverage,
  FanOutBranch,
  FanOutFacet,
  TopicFanOut,
} from "@/types/ai-visibility";
import type { AgentId, KeywordIntent, KeywordRecord } from "@/types/keyword";

/**
 * What a topic fans out into, and how much of it we answer.
 *
 * A generative engine does not answer the query it is handed. It decomposes it
 * into the questions a good answer would have to settle, answers those, and
 * assembles the result. A page that ranks for the head term and answers none
 * of the sub-questions is not the page that gets used — which is the gap this
 * reading exists to make visible, and the one nothing else in the product
 * could show.
 *
 * Three rules keep it honest.
 *
 * **The branches are not invented.** They are the expansion shapes Keyword
 * Intelligence already uses for discovery, read here for a different purpose.
 * One list, two readers.
 *
 * **Coverage is matched against canonical keywords, not guessed.** A branch is
 * answered when a keyword already in the registry carries the shape's own
 * vocabulary — "best", "vs", "cost". No keyword record is created to make a
 * fan-out look complete, and a branch nothing matches is reported as missing
 * rather than quietly filled.
 *
 * **Not every branch applies to every topic.** A "near me" branch against a
 * SaaS pricing cluster is a question nobody asks, and scoring it as a gap
 * would invent work. Applicability is read from the cluster's own intent mix,
 * which is also what makes coverage percentages vary between topics rather
 * than landing on the same number.
 */

// ---------------------------------------------------------------------------
// The facet map
// ---------------------------------------------------------------------------

/**
 * What each expansion shape is asking for, and how to tell whether a canonical
 * keyword already answers it.
 *
 * `tokens` is the shape's own vocabulary. Matching on it rather than on the
 * generated string is the whole trick: the generated branch reads "best
 * business banking", and the keyword that answers it is "best business bank
 * account uk" — a literal comparison would miss every real match.
 */
const FACETS: Readonly<
  Record<
    string,
    {
      readonly facet: FanOutFacet;
      readonly tokens: readonly string[];
      readonly gapKind: AiGapKind;
      readonly owner: AgentId;
      readonly action: string;
      /** How much a missing branch of this kind is worth, 0-1. */
      readonly weight: number;
    }
  >
> = {
  best: {
    facet: "comparison",
    tokens: ["best", "top ", "leading"],
    gapKind: "missing-comparison",
    owner: "content-strategist",
    action: "Build the comparison this topic is missing, with a table an engine can lift.",
    weight: 1,
  },
  "vs-alternatives": {
    facet: "comparison",
    tokens: ["vs", "versus", "alternative", "compare", "comparison"],
    gapKind: "missing-comparison",
    owner: "content-strategist",
    action: "Answer the head-to-head directly, naming both sides and the trade-off.",
    weight: 0.95,
  },
  cost: {
    facet: "cost",
    tokens: ["cost", "price", "pricing", "fee", "rate", "charge"],
    gapKind: "shallow-subtopic",
    owner: "content-strategist",
    action: "State the price range in a self-contained passage, with what moves it.",
    weight: 0.9,
  },
  "pricing-year": {
    facet: "cost",
    tokens: ["pricing", "price", "2026", "cost"],
    gapKind: "shallow-subtopic",
    owner: "on-page-seo",
    action: "Date the pricing section and keep it current, so a dated query resolves.",
    weight: 0.6,
  },
  cheap: {
    facet: "cost",
    tokens: ["cheap", "affordable", "budget", "low cost", "free"],
    gapKind: "shallow-subtopic",
    owner: "content-strategist",
    action: "Answer the budget end honestly rather than ceding it.",
    weight: 0.5,
  },
  "how-it-works": {
    facet: "process",
    tokens: ["how ", "process", "steps", "work"],
    gapKind: "unanswered-question",
    owner: "writer",
    action: "Answer the mechanism in 40-60 words under a matching heading.",
    weight: 1,
  },
  guide: {
    facet: "definition",
    tokens: ["guide", "what is", "what are", "explained", "tutorial", "meaning"],
    gapKind: "missing-definition",
    owner: "content-strategist",
    action: "Define the term plainly before qualifying it, so the definition can be lifted.",
    weight: 0.95,
  },
  "for-beginners": {
    facet: "definition",
    tokens: ["beginner", "basics", "introduction", "101", "starter", "for small"],
    gapKind: "missing-definition",
    owner: "writer",
    action: "Add the entry-level framing this topic assumes the reader already has.",
    weight: 0.55,
  },
  "worth-it": {
    facet: "suitability",
    tokens: ["worth", "should i", "do i need", "benefit", "pros and cons", "why"],
    gapKind: "unanswered-question",
    owner: "writer",
    action: "Answer the objection directly, including when the answer is no.",
    weight: 0.8,
  },
  checklist: {
    facet: "utility",
    tokens: ["checklist", "template", "calculator", "tool", "example"],
    gapKind: "missing-example",
    owner: "content-strategist",
    action: "Give the reader something to use, not only something to read.",
    weight: 0.6,
  },
  services: {
    facet: "commercial",
    tokens: ["service", "provider", "company", "agency", "supplier", "consultant"],
    gapKind: "shallow-subtopic",
    owner: "content-strategist",
    action: "Land this intent on a commercial page rather than a guide.",
    weight: 0.75,
  },
  "near-me": {
    facet: "local",
    tokens: ["near me", "near ", " in ", "local", "nearby"],
    gapKind: "shallow-subtopic",
    owner: "content-strategist",
    action: "Answer the location question on a page that names the places.",
    weight: 0.7,
  },
};

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

/**
 * Whether a topic would plausibly be asked this.
 *
 * Informational shapes apply everywhere — somebody always asks what a thing is
 * and how it works. Everything else has to be earned from the cluster's own
 * intent mix, because a commercial branch against a cluster with no commercial
 * demand is a gap nobody would ever close.
 */
function applies(
  facet: FanOutFacet,
  intent: KeywordIntent,
  primaryIntent: KeywordIntent,
  mix: ReadonlyMap<KeywordIntent, number>,
): boolean {
  if (facet === "definition" || facet === "process") return true;
  if (facet === "local") return (mix.get("local") ?? 0) > 0;
  if (intent === primaryIntent) return true;
  return (mix.get(intent) ?? 0) >= 2;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The canonical keyword that answers a branch, or null.
 *
 * Highest volume wins where several match: that is the term the topic is
 * actually contested on, and the one a page would be built against.
 */
function matchFor(
  tokens: readonly string[],
  keywords: readonly KeywordRecord[],
): KeywordRecord | null {
  const matches = keywords.filter((record) => {
    const text = ` ${record.keyword.toLowerCase()} `;
    return tokens.some((token) => text.includes(token.toLowerCase()));
  });

  if (matches.length === 0) return null;

  return [...matches].sort(
    (a, b) => b.volume - a.volume || a.id.localeCompare(b.id),
  )[0];
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

const SEVERITY_FLOOR = { critical: 78, high: 58, medium: 34 } as const;

function severityFor(priority: number): AiSeverity {
  if (priority >= SEVERITY_FLOOR.critical) return "critical";
  if (priority >= SEVERITY_FLOOR.high) return "high";
  if (priority >= SEVERITY_FLOOR.medium) return "medium";
  return "low";
}

/**
 * What building this branch is worth.
 *
 * Demand comes from the canonical cluster, not from the branch: an uncovered
 * branch has no keyword and therefore no volume of its own, and inventing one
 * would be inventing the number the whole priority rests on. What varies per
 * branch is the shape's weight and how far short the topic already falls.
 */
function priorityFor(
  weight: number,
  clusterVolume: number,
  coverage: BranchCoverage,
  contentGaps: number,
): number {
  if (coverage === "covered") return 0;

  // A log-ish curve: a 40,000-search cluster is worth more than a 4,000 one,
  // but not ten times more, and the priority list should not be one cluster.
  const demand = clamp(Math.log10(Math.max(clusterVolume, 10)) * 22 - 22, 0, 70);
  const unbuilt = clamp(contentGaps * 2.5, 0, 18);
  const tracked = coverage === "keyword-only" ? 14 : 0;

  return Math.round(clamp((demand + unbuilt + tracked) * weight, 0, 100));
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

let cache: readonly TopicFanOut[] | null = null;

function build(): readonly TopicFanOut[] {
  const pages = getAiPages();

  return getKeywordClusters().map((cluster) => {
    const keywords = cluster.keywordIds
      .map((id) => getKeywordRecord(id))
      .filter((entry): entry is KeywordRecord => entry !== undefined);

    // The query a person would actually type for this cluster. The cluster's
    // own name, lowercased — not a new label.
    const topic = cluster.name.toLowerCase();

    const branches: FanOutBranch[] = [];

    for (const pattern of EXPANSION_PATTERNS) {
      const facet = FACETS[pattern.id];
      if (facet === undefined) continue;
      if (
        !applies(
          facet.facet,
          pattern.intent,
          cluster.primaryIntent,
          cluster.intentMix,
        )
      ) {
        continue;
      }

      const match = matchFor(facet.tokens, keywords);
      const page =
        match === null
          ? null
          : (pages.find(
              (entry) =>
                entry.projectId === cluster.projectId &&
                entry.keywordIds.includes(match.id),
            ) ?? null);

      const coverage: BranchCoverage =
        match === null ? "uncovered" : page === null ? "keyword-only" : "covered";

      const strength = page?.answer.score.score ?? 0;

      const gapReason =
        coverage === "covered"
          ? null
          : coverage === "keyword-only"
            ? `"${match?.keyword}" is tracked for this branch and no page of ours targets it.`
            : `Nothing in this cluster's ${keywords.length} keywords carries this question.`;

      const priority = priorityFor(
        facet.weight,
        cluster.totalVolume,
        coverage,
        cluster.contentGaps,
      );

      branches.push({
        id: `fan-${cluster.id}-${pattern.id}`,
        patternId: pattern.id,
        facet: facet.facet,
        question: pattern.build(topic),
        intent: pattern.intent,
        rationale: pattern.rationale,
        projectId: cluster.projectId,
        projectName: cluster.projectName,
        clusterId: cluster.id,
        clusterName: cluster.name,
        coverage,
        keywordId: match?.id ?? null,
        keyword: match?.keyword ?? null,
        volume: match?.volume ?? 0,
        pageId: page?.id ?? null,
        pageTitle: page?.title ?? null,
        pageHref: page === null ? null : `/content/${page.contentId}?tab=ai`,
        strength,
        gapReason,
        gapKind: coverage === "covered" ? null : facet.gapKind,
        priority,
        severity: coverage === "covered" ? "low" : severityFor(priority),
        action:
          coverage === "covered"
            ? "Answered. Keep the passage current."
            : facet.action,
        owner: facet.owner,
        // Derived throughout: the shapes are canonical, the matches are
        // canonical keywords, and the strength is the answering page's own
        // published score.
        provenance: "derived",
      });
    }

    const covered = branches.filter(
      (entry) => entry.coverage === "covered",
    ).length;
    const keywordOnly = branches.filter(
      (entry) => entry.coverage === "keyword-only",
    ).length;
    const uncovered = branches.filter(
      (entry) => entry.coverage === "uncovered",
    ).length;

    const missing = branches
      .filter((entry) => entry.coverage !== "covered")
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    return {
      clusterId: cluster.id,
      clusterName: cluster.name,
      projectId: cluster.projectId,
      projectName: cluster.projectName,
      sourceQuery: topic,
      primaryIntent: cluster.primaryIntent,
      branches,
      covered,
      keywordOnly,
      uncovered,
      coverageShare:
        branches.length === 0
          ? 0
          : Math.round((covered / branches.length) * 100),
      topGap: missing[0] ?? null,
    };
  });
}

export function getFanOut(): readonly TopicFanOut[] {
  cache ??= build();
  return cache;
}

export function fanOutForProject(projectId: string): readonly TopicFanOut[] {
  return projectId === "portfolio"
    ? getFanOut()
    : getFanOut().filter((entry) => entry.projectId === projectId);
}

export function fanOutForCluster(clusterId: string): TopicFanOut | null {
  return getFanOut().find((entry) => entry.clusterId === clusterId) ?? null;
}

/** Every branch, flattened — what the table renders. */
export function getFanOutBranches(): readonly FanOutBranch[] {
  return getFanOut().flatMap((entry) => entry.branches);
}
