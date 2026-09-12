import type { IconName } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";
import type { MeterTone } from "@/components/ui/meter";
import type { MetricHealth } from "@/types/dashboard";
import type {
  AiCoverageProjection,
  AiKeywordFilter,
  CannibalizationRisk,
  CannibalizationState,
  ClusterStatus,
  ContentGapType,
  DifficultyBand,
  KeywordIntent,
  KeywordStatus,
  MovementKind,
  OpportunityBand,
  OpportunityCategory,
  OpportunityState,
  RankingStatus,
  SerpFeatureId,
  SerpOwnership,
  SerpType,
  VolumeBand,
} from "@/types/keyword";

/**
 * Presentation for every vocabulary the Keyword Intelligence module uses.
 *
 * Each state maps onto an existing `BadgeTone`, `MeterTone`, or `MetricHealth`
 * rather than introducing a second colour system, and every entry carries a
 * label and a description — colour never carries the meaning on its own, and a
 * filter option can always say what it selects.
 *
 * The banding functions live here too, so a keyword's difficulty band is
 * decided in one place and the filter, the table, and the score all agree
 * about where the boundaries are.
 */

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export const INTENT_META: Record<
  KeywordIntent,
  {
    readonly label: string;
    readonly short: string;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  informational: {
    label: "Informational",
    short: "Info",
    tone: "neutral",
    description: "The searcher wants to understand something.",
  },
  commercial: {
    label: "Commercial",
    short: "Comm",
    tone: "accent",
    description: "The searcher is comparing options before buying.",
  },
  transactional: {
    label: "Transactional",
    short: "Trans",
    tone: "positive",
    description: "The searcher is ready to act.",
  },
  navigational: {
    label: "Navigational",
    short: "Nav",
    tone: "neutral",
    description: "The searcher is looking for a specific brand or page.",
  },
  local: {
    label: "Local",
    short: "Local",
    tone: "warning",
    description: "The searcher wants somewhere nearby.",
  },
  mixed: {
    label: "Mixed",
    short: "Mixed",
    tone: "accent",
    description: "The result page serves more than one intent at once.",
  },
};

/**
 * What to write for a keyword that has no page behind it.
 *
 * Shared by the cluster view and the content-gap view, so a missing page is
 * described the same way in both.
 */
export const SUGGESTED_CONTENT_TYPE: Record<KeywordIntent, string> = {
  informational: "Guide",
  commercial: "Comparison page",
  transactional: "Landing page",
  local: "Location page",
  navigational: "Brand page",
  mixed: "Topic hub",
};

export const INTENT_ORDER: readonly KeywordIntent[] = [
  "commercial",
  "transactional",
  "informational",
  "local",
  "navigational",
  "mixed",
];

/** How much each intent is worth commercially, 0-100. */
export const INTENT_VALUE: Record<KeywordIntent, number> = {
  transactional: 100,
  commercial: 84,
  local: 72,
  mixed: 58,
  navigational: 40,
  informational: 34,
};

// ---------------------------------------------------------------------------
// Ranking position
// ---------------------------------------------------------------------------

export const RANKING_STATUS_META: Record<
  RankingStatus,
  {
    readonly label: string;
    readonly short: string;
    readonly tone: BadgeTone;
    readonly meter: MeterTone;
    readonly description: string;
  }
> = {
  "top-3": {
    label: "Positions 1-3",
    short: "Top 3",
    tone: "positive",
    meter: "positive",
    description: "Ranking in the three places that take most of the clicks.",
  },
  "top-10": {
    label: "Positions 4-10",
    short: "Top 10",
    tone: "accent",
    meter: "accent",
    description: "On page one, but below the places that earn.",
  },
  "top-20": {
    label: "Positions 11-20",
    short: "Top 20",
    tone: "neutral",
    meter: "neutral",
    description: "Page two — close enough to move with focused work.",
  },
  "top-100": {
    label: "Positions 21-100",
    short: "Top 100",
    tone: "warning",
    meter: "warning",
    description: "Indexed and ranking, but far from traffic.",
  },
  "not-ranking": {
    label: "Not ranking",
    short: "None",
    tone: "critical",
    meter: "critical",
    description: "Outside the top 100 entirely.",
  },
};

export const RANKING_STATUS_ORDER: readonly RankingStatus[] = [
  "top-3",
  "top-10",
  "top-20",
  "top-100",
  "not-ranking",
];

/** Which band a position falls in. `null` means the keyword does not rank. */
export function rankingStatusOf(position: number | null): RankingStatus {
  if (position === null) return "not-ranking";
  if (position <= 3) return "top-3";
  if (position <= 10) return "top-10";
  if (position <= 20) return "top-20";
  if (position <= 100) return "top-100";
  return "not-ranking";
}

/**
 * Estimated click-through rate at a SERP position, as a percentage.
 *
 * A published-style curve, not a measurement: it drops steeply through the
 * first three places, flattens across the rest of page one, and is close to
 * nothing past the top twenty. Every traffic estimate in this module runs
 * through it, so the numbers on the keyword table, the striking-distance view,
 * and the opportunity score are consistent with one another.
 */
const CTR_CURVE: readonly number[] = [
  27.6, 15.8, 11, 8.4, 6.3, 4.8, 3.6, 2.8, 2.3, 1.9, 1.5, 1.3, 1.1, 0.95, 0.85,
  0.75, 0.68, 0.62, 0.55, 0.5,
];

export function ctrAt(position: number | null): number {
  if (position === null || position < 1) return 0;
  if (position <= CTR_CURVE.length) return CTR_CURVE[position - 1];
  if (position <= 50) return 0.28;
  if (position <= 100) return 0.09;
  return 0;
}

// ---------------------------------------------------------------------------
// Keyword status
// ---------------------------------------------------------------------------

export const KEYWORD_STATUS_META: Record<
  KeywordStatus,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  improving: {
    label: "Improving",
    tone: "positive",
    description: "Gained places against the previous window.",
  },
  declining: {
    label: "Declining",
    tone: "critical",
    description: "Lost places against the previous window.",
  },
  stable: {
    label: "Stable",
    tone: "neutral",
    description: "Holding the same position.",
  },
  new: {
    label: "New ranking",
    tone: "accent",
    description: "Entered the top 100 during this window.",
  },
  lost: {
    label: "Lost ranking",
    tone: "critical",
    description: "Dropped out of the top 100 during this window.",
  },
  pending: {
    label: "Pending metrics",
    tone: "warning",
    description: "Added in this session. No metrics have been researched yet.",
  },
};

// ---------------------------------------------------------------------------
// Volume and difficulty bands
// ---------------------------------------------------------------------------

export const VOLUME_BAND_META: Record<
  VolumeBand,
  { readonly label: string; readonly range: string }
> = {
  "very-high": { label: "Very high", range: "20k+ / mo" },
  high: { label: "High", range: "5k-20k / mo" },
  medium: { label: "Medium", range: "1k-5k / mo" },
  low: { label: "Low", range: "Under 1k / mo" },
};

export const VOLUME_BAND_ORDER: readonly VolumeBand[] = [
  "very-high",
  "high",
  "medium",
  "low",
];

export function volumeBandOf(volume: number): VolumeBand {
  if (volume >= 20_000) return "very-high";
  if (volume >= 5_000) return "high";
  if (volume >= 1_000) return "medium";
  return "low";
}

export const DIFFICULTY_BAND_META: Record<
  DifficultyBand,
  {
    readonly label: string;
    readonly range: string;
    readonly tone: MeterTone;
    readonly badge: BadgeTone;
  }
> = {
  easy: { label: "Easy", range: "0-29", tone: "positive", badge: "positive" },
  moderate: {
    label: "Moderate",
    range: "30-49",
    tone: "accent",
    badge: "accent",
  },
  hard: { label: "Hard", range: "50-69", tone: "warning", badge: "warning" },
  "very-hard": {
    label: "Very hard",
    range: "70-100",
    tone: "critical",
    badge: "critical",
  },
};

export const DIFFICULTY_BAND_ORDER: readonly DifficultyBand[] = [
  "easy",
  "moderate",
  "hard",
  "very-hard",
];

export function difficultyBandOf(difficulty: number): DifficultyBand {
  if (difficulty < 30) return "easy";
  if (difficulty < 50) return "moderate";
  if (difficulty < 70) return "hard";
  return "very-hard";
}

// ---------------------------------------------------------------------------
// Opportunity score
// ---------------------------------------------------------------------------

export const OPPORTUNITY_BAND_META: Record<
  OpportunityBand,
  {
    readonly label: string;
    readonly range: string;
    readonly tone: BadgeTone;
    readonly meter: MeterTone;
    readonly health: MetricHealth;
  }
> = {
  prime: {
    label: "Prime",
    range: "75-100",
    tone: "positive",
    meter: "positive",
    health: "positive",
  },
  strong: {
    label: "Strong",
    range: "60-74",
    tone: "accent",
    meter: "accent",
    health: "neutral",
  },
  moderate: {
    label: "Moderate",
    range: "45-59",
    tone: "warning",
    meter: "warning",
    health: "warning",
  },
  low: {
    label: "Low",
    range: "Under 45",
    tone: "neutral",
    meter: "neutral",
    health: "negative",
  },
};

export const OPPORTUNITY_BAND_ORDER: readonly OpportunityBand[] = [
  "prime",
  "strong",
  "moderate",
  "low",
];

export function opportunityBandOf(score: number): OpportunityBand {
  if (score >= 75) return "prime";
  if (score >= 60) return "strong";
  if (score >= 45) return "moderate";
  return "low";
}

// ---------------------------------------------------------------------------
// SERP
// ---------------------------------------------------------------------------

export const SERP_FEATURE_META: Record<
  SerpFeatureId,
  {
    readonly label: string;
    readonly icon: IconName;
    readonly description: string;
  }
> = {
  "featured-snippet": {
    label: "Featured snippet",
    icon: "brief",
    description: "A single answer lifted above the results.",
  },
  "people-also-ask": {
    label: "People also ask",
    icon: "info",
    description: "An expandable block of related questions.",
  },
  "local-pack": {
    label: "Local pack",
    icon: "map-pin",
    description: "A map with three local listings.",
  },
  video: {
    label: "Video results",
    icon: "pages",
    description: "A carousel of video results.",
  },
  images: {
    label: "Image pack",
    icon: "layers",
    description: "A row of image results inside the page.",
  },
  shopping: {
    label: "Shopping results",
    icon: "value",
    description: "Paid product listings with prices.",
  },
  "knowledge-panel": {
    label: "Knowledge panel",
    icon: "shield",
    description: "An entity card drawn from the knowledge graph.",
  },
  sitelinks: {
    label: "Sitelinks",
    icon: "list",
    description: "Extra links beneath the top-ranked result.",
  },
  discussions: {
    label: "Discussions and forums",
    icon: "note",
    description: "Threads from forums and communities.",
  },
  "ai-overview": {
    label: "AI overview",
    icon: "sparkles",
    description: "A generated answer above the organic results.",
  },
};

export const SERP_FEATURE_ORDER: readonly SerpFeatureId[] = [
  "ai-overview",
  "featured-snippet",
  "people-also-ask",
  "local-pack",
  "shopping",
  "video",
  "images",
  "knowledge-panel",
  "sitelinks",
  "discussions",
];

export const SERP_OWNERSHIP_META: Record<
  SerpOwnership,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  ours: { label: "Held by us", tone: "positive" },
  competitor: { label: "Held by a rival", tone: "warning" },
  unclaimed: { label: "Unclaimed", tone: "neutral" },
};

export const SERP_TYPE_META: Record<
  SerpType,
  { readonly label: string; readonly description: string }
> = {
  classic: {
    label: "Classic",
    description: "Ten organic results with little else on the page.",
  },
  "answer-led": {
    label: "Answer-led",
    description: "A generated answer or snippet takes the top of the page.",
  },
  local: {
    label: "Local",
    description: "A map pack sits above the organic results.",
  },
  commercial: {
    label: "Commercial",
    description: "Ads and product listings dominate above the fold.",
  },
  media: {
    label: "Media",
    description: "Video or image blocks push the organic results down.",
  },
  mixed: {
    label: "Mixed",
    description: "Several feature types share the page.",
  },
};

// ---------------------------------------------------------------------------
// AI / answer engines
// ---------------------------------------------------------------------------

/**
 * Stated wherever an answer-engine figure appears in this module.
 *
 * Every reading in the AI layer is a projection off canonical keyword data.
 * The note says so in the one place a reader would otherwise assume a feed.
 */
export const KEYWORDS_AI_SOURCE_NOTE =
  "Projected, not observed. No answer engine is queried anywhere in this product — these readings are modelled from each keyword's own position, intent, content strength and modelled result page. Nothing here reports that ChatGPT, Gemini, Perplexity, Claude, Google AI Overviews or Bing Copilot cited the brand.";

export const KEYWORDS_AI_SOURCE_SHORT =
  "Projected from keyword data — no answer engine is queried.";

export const AI_COVERAGE_META: Record<
  AiCoverageProjection,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  "likely-source": {
    label: "Likely source",
    tone: "positive",
    description:
      "Ranked highly enough that a generated answer would plausibly draw from this page. A projection from position — not an observed citation.",
  },
  "likely-mention": {
    label: "Likely mention",
    tone: "accent",
    description:
      "Ranked well enough to be named in passing, but not the page an answer would be built from. Projected, not observed.",
  },
  unlikely: {
    label: "Unlikely",
    tone: "warning",
    description:
      "An answer is projected for this query and nothing of ours ranks well enough to be drawn from it.",
  },
  "not-projected": {
    label: "No answer projected",
    tone: "neutral",
    description:
      "This query's result page carries no generated-answer feature in this dataset.",
  },
};

export const AI_FILTER_META: Record<
  AiKeywordFilter,
  { readonly label: string; readonly description: string }
> = {
  all: {
    label: "All keywords",
    description: "Every keyword in the current selection.",
  },
  "high-opportunity": {
    label: "High AI opportunity",
    description: "Strong answer relevance with real projected upside.",
  },
  "citation-gap": {
    label: "Citation gap",
    description:
      "An answer is projected for the query and nothing of ours is positioned to be drawn from it.",
  },
  "question-based": {
    label: "Question-based",
    description: "Queries phrased as questions.",
  },
  "entity-weakness": {
    label: "Entity weakness",
    description:
      "Topic authority sits below what being drawn from an answer would demand.",
  },
  "answer-ready": {
    label: "Answer engine ready",
    description: "Answerable in a passage, with the authority to back it.",
  },
};

export const AI_FILTER_ORDER: readonly AiKeywordFilter[] = [
  "all",
  "high-opportunity",
  "citation-gap",
  "question-based",
  "entity-weakness",
  "answer-ready",
];

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export const OPPORTUNITY_CATEGORY_META: Record<
  OpportunityCategory,
  {
    readonly label: string;
    readonly icon: IconName;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  "quick-win": {
    label: "Quick wins",
    icon: "bolt",
    tone: "positive",
    description: "Small moves on keywords that are already close.",
  },
  "high-volume-low-difficulty": {
    label: "High volume, low difficulty",
    icon: "trend-up",
    tone: "accent",
    description: "Demand that nobody has made hard to reach.",
  },
  "striking-distance": {
    label: "Striking distance",
    icon: "target",
    tone: "accent",
    description: "Ranking 4-20, where a few places change the traffic.",
  },
  "commercial-intent": {
    label: "Commercial intent",
    icon: "value",
    tone: "positive",
    description: "Queries from people close to a decision.",
  },
  "content-gap": {
    label: "Content gap",
    icon: "pages",
    tone: "warning",
    description: "Demand with no page of ours behind it.",
  },
  "competitor-gap": {
    label: "Competitor gap",
    icon: "competitors",
    tone: "warning",
    description: "Terms a rival ranks for and we do not.",
  },
  local: {
    label: "Local opportunity",
    icon: "map-pin",
    tone: "accent",
    description: "Queries served by a map pack we could hold.",
  },
  "ai-search": {
    label: "AI search",
    icon: "sparkles",
    tone: "accent",
    description: "Answer-engine visibility we are not taking.",
  },
  refresh: {
    label: "Refresh",
    icon: "refresh",
    tone: "warning",
    description: "Pages that ranked well and have started slipping.",
  },
};

export const OPPORTUNITY_CATEGORY_ORDER: readonly OpportunityCategory[] = [
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

export const OPPORTUNITY_STATE_META: Record<
  OpportunityState,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  open: { label: "Open", tone: "neutral" },
  reviewed: { label: "Reviewed", tone: "accent" },
  planned: { label: "In content plan", tone: "positive" },
  briefed: { label: "Brief created", tone: "positive" },
};

// ---------------------------------------------------------------------------
// Cannibalisation
// ---------------------------------------------------------------------------

export const CANNIBALIZATION_RISK_META: Record<
  CannibalizationRisk,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  critical: {
    label: "Critical",
    tone: "critical",
    description: "Pages are trading places on a high-value term.",
  },
  high: {
    label: "High",
    tone: "critical",
    description: "Clicks are split and the better page is losing.",
  },
  medium: {
    label: "Medium",
    tone: "warning",
    description: "Two pages compete, one clearly leads.",
  },
  low: {
    label: "Low",
    tone: "neutral",
    description: "Overlap exists but costs little today.",
  },
};

export const CANNIBALIZATION_RISK_ORDER: readonly CannibalizationRisk[] = [
  "critical",
  "high",
  "medium",
  "low",
];

export const CANNIBALIZATION_STATE_META: Record<
  CannibalizationState,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  open: { label: "Unresolved", tone: "warning" },
  "primary-assigned": { label: "Primary URL set", tone: "accent" },
  "task-created": { label: "Consolidation queued", tone: "accent" },
  reviewed: { label: "Reviewed", tone: "positive" },
};

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

export const CONTENT_GAP_META: Record<
  ContentGapType,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  "no-page": {
    label: "No page",
    tone: "critical",
    description: "Nothing on the site targets this query.",
  },
  "competitor-only": {
    label: "Competitor only",
    tone: "critical",
    description: "A rival ranks and we are absent from the results.",
  },
  "weak-content": {
    label: "Weak content",
    tone: "warning",
    description: "A page exists but is not competitive.",
  },
  "thin-coverage": {
    label: "Thin coverage",
    tone: "warning",
    description: "The topic is covered in passing on another page.",
  },
  outdated: {
    label: "Outdated",
    tone: "warning",
    description: "The page ranked once and has not been updated since.",
  },
};

export const CONTENT_GAP_ORDER: readonly ContentGapType[] = [
  "competitor-only",
  "no-page",
  "weak-content",
  "thin-coverage",
  "outdated",
];

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------

export const CLUSTER_STATUS_META: Record<
  ClusterStatus,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  covered: {
    label: "Covered",
    tone: "positive",
    description: "Every keyword has a page, and the pages rank.",
  },
  partial: {
    label: "Partial",
    tone: "accent",
    description: "Most of the cluster is covered; some keywords are not.",
  },
  gap: {
    label: "Gap",
    tone: "warning",
    description: "A material share of the cluster has no page behind it.",
  },
  planned: {
    label: "Planned",
    tone: "neutral",
    description: "Pages are scoped but not written.",
  },
  "at-risk": {
    label: "At risk",
    tone: "critical",
    description: "Coverage exists but rankings are slipping across it.",
  },
};

export const CLUSTER_STATUS_ORDER: readonly ClusterStatus[] = [
  "covered",
  "partial",
  "gap",
  "planned",
  "at-risk",
];

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

export const MOVEMENT_KIND_META: Record<
  MovementKind,
  {
    readonly label: string;
    readonly plural: string;
    readonly tone: BadgeTone;
    readonly icon: IconName;
    readonly description: string;
  }
> = {
  winner: {
    label: "Winner",
    plural: "Biggest winners",
    tone: "positive",
    icon: "trend-up",
    description: "Keywords that gained the most places.",
  },
  loser: {
    label: "Loser",
    plural: "Biggest losers",
    tone: "critical",
    icon: "trend-down",
    description: "Keywords that lost the most places.",
  },
  new: {
    label: "New",
    plural: "New rankings",
    tone: "accent",
    icon: "plus",
    description: "Keywords that entered the top 100 this window.",
  },
  lost: {
    label: "Lost",
    plural: "Lost rankings",
    tone: "critical",
    icon: "link-off",
    description: "Keywords that dropped out of the top 100.",
  },
};

export const MOVEMENT_KIND_ORDER: readonly MovementKind[] = [
  "winner",
  "loser",
  "new",
  "lost",
];
