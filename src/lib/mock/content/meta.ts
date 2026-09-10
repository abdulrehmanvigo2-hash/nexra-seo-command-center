import type { IconName } from "@/components/icons";
import type { BadgeTone, Priority, Status } from "@/components/ui/badge";
import type { MeterTone } from "@/components/ui/meter";
import type { MetricHealth } from "@/types/dashboard";
import type {
  ContentFormat,
  ContentGapKind,
  ContentHealth,
  ContentRole,
  ContentScoreBand,
  ContentStage,
  IntentAlignment,
  InternalLinkKind,
  MappingQuality,
  OnPageCheckId,
  RecommendationState,
  ScoreBandMeta,
} from "@/types/content";
import type { KeywordIntent } from "@/types/keyword";

/**
 * Presentation for every vocabulary the Content Studio uses.
 *
 * Each state maps onto an existing `Status`, `BadgeTone`, `MeterTone`, or
 * `MetricHealth` rather than introducing a second colour system, and every
 * entry carries a label and a description — colour never carries the meaning
 * on its own, and a filter option can always say what it selects.
 *
 * The banding functions live here too, so a content score is banded in one
 * place and the filter, the table, and the detail page all agree about where
 * the boundaries sit.
 */

// ---------------------------------------------------------------------------
// Pipeline stage
// ---------------------------------------------------------------------------

export const STAGE_META: Record<
  ContentStage,
  {
    readonly label: string;
    readonly short: string;
    readonly tone: BadgeTone;
    readonly status: Status;
    readonly icon: IconName;
    readonly description: string;
  }
> = {
  idea: {
    label: "Idea",
    short: "Idea",
    tone: "neutral",
    status: "draft",
    icon: "sparkles",
    description: "Identified as worth writing, with nothing committed yet.",
  },
  brief: {
    label: "Briefed",
    short: "Brief",
    tone: "accent",
    status: "queued",
    icon: "brief",
    description: "A brief exists and is waiting for a writer to pick it up.",
  },
  draft: {
    label: "Drafting",
    short: "Draft",
    tone: "accent",
    status: "running",
    icon: "edit",
    description: "The Writer is producing the first version.",
  },
  review: {
    label: "In review",
    short: "Review",
    tone: "warning",
    status: "review",
    icon: "shield",
    description: "Written and waiting on editorial and on-page sign-off.",
  },
  approved: {
    label: "Approved",
    short: "Approved",
    tone: "positive",
    status: "complete",
    icon: "check",
    description: "Signed off and ready to schedule.",
  },
  scheduled: {
    label: "Scheduled",
    short: "Sched.",
    tone: "accent",
    status: "queued",
    icon: "calendar",
    description: "Publication date set; not live yet.",
  },
  published: {
    label: "Published",
    short: "Live",
    tone: "positive",
    status: "active",
    icon: "globe",
    description: "Live on the site and measurable.",
  },
};

/** Stages in pipeline order — the order the workflow board renders in. */
export const STAGE_ORDER: readonly ContentStage[] = [
  "idea",
  "brief",
  "draft",
  "review",
  "approved",
  "scheduled",
  "published",
];

/** The stages that represent work in flight, board left to right. */
export const PIPELINE_STAGES: readonly ContentStage[] = STAGE_ORDER.filter(
  (stage) => stage !== "published",
);

/** True where the piece is not live yet. */
export function isInProgress(stage: ContentStage): boolean {
  return stage !== "published";
}

// ---------------------------------------------------------------------------
// Health of a published page
// ---------------------------------------------------------------------------

export const HEALTH_META: Record<
  ContentHealth,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly health: MetricHealth;
    readonly icon: IconName;
    readonly description: string;
  }
> = {
  performing: {
    label: "Performing",
    tone: "positive",
    health: "positive",
    icon: "trend-up",
    description: "Ranking well and holding or gaining places.",
  },
  steady: {
    label: "Steady",
    tone: "neutral",
    health: "neutral",
    icon: "trend-flat",
    description: "Ranking without much movement either way.",
  },
  "needs-refresh": {
    label: "Needs refresh",
    tone: "warning",
    health: "warning",
    icon: "refresh",
    description: "Thin, dated, or slipping far enough to be worth reworking.",
  },
  decaying: {
    label: "Decaying",
    tone: "critical",
    health: "negative",
    icon: "trend-down",
    description: "Losing places across its keywords, window on window.",
  },
  "not-ranking": {
    label: "Not ranking",
    tone: "critical",
    health: "negative",
    icon: "link-off",
    description: "Live, but none of its keywords reach the top 100.",
  },
  unmeasured: {
    label: "Unmeasured",
    tone: "warning",
    health: "warning",
    icon: "inbox",
    description:
      "Live with no keyword mapped to it, so nothing measures how it performs.",
  },
};

export const HEALTH_ORDER: readonly ContentHealth[] = [
  "performing",
  "steady",
  "needs-refresh",
  "decaying",
  "not-ranking",
  "unmeasured",
];

/** Health states that mean somebody has to do something. */
export const ATTENTION_HEALTH: readonly ContentHealth[] = [
  "decaying",
  "needs-refresh",
  "not-ranking",
  "unmeasured",
];

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export const FORMAT_META: Record<
  ContentFormat,
  {
    readonly label: string;
    readonly icon: IconName;
    readonly description: string;
    /** Words a piece of this format is expected to run to. */
    readonly wordTarget: number;
    /** Structured-data type the format should carry. */
    readonly schema: string;
  }
> = {
  guide: {
    label: "Guide",
    icon: "brief",
    description: "Explains a topic end to end for somebody learning it.",
    wordTarget: 2_200,
    schema: "Article + FAQPage",
  },
  comparison: {
    label: "Comparison",
    icon: "competitors",
    description: "Sets options side by side for somebody choosing between them.",
    wordTarget: 1_800,
    schema: "Article + Table",
  },
  landing: {
    label: "Landing page",
    icon: "target",
    description: "Converts a searcher who already knows what they want.",
    wordTarget: 900,
    schema: "WebPage + Organization",
  },
  product: {
    label: "Product page",
    icon: "value",
    description: "Sells a specific product or range.",
    wordTarget: 700,
    schema: "Product + Offer",
  },
  location: {
    label: "Location page",
    icon: "map-pin",
    description: "Serves a place-specific query.",
    wordTarget: 800,
    schema: "LocalBusiness",
  },
  article: {
    label: "Article",
    icon: "note",
    description: "Editorial piece, usually time-sensitive.",
    wordTarget: 1_200,
    schema: "Article",
  },
  resource: {
    label: "Resource",
    icon: "pages",
    description: "Reference material people return to rather than read once.",
    wordTarget: 1_500,
    schema: "Article + Dataset",
  },
  tool: {
    label: "Tool",
    icon: "sliders",
    description: "An interactive calculator or checker.",
    wordTarget: 600,
    schema: "WebApplication",
  },
};

export const FORMAT_ORDER: readonly ContentFormat[] = [
  "guide",
  "comparison",
  "landing",
  "product",
  "location",
  "resource",
  "article",
  "tool",
];

/**
 * The format each intent calls for.
 *
 * The Keyword Intelligence module already answers this question for a keyword
 * with no page (`SUGGESTED_CONTENT_TYPE`). This is the same judgement in this
 * module's own vocabulary, so an intent recommends one format in both places.
 */
export const FORMAT_FOR_INTENT: Record<KeywordIntent, ContentFormat> = {
  informational: "guide",
  commercial: "comparison",
  transactional: "landing",
  local: "location",
  navigational: "landing",
  mixed: "resource",
};

/**
 * Formats that still serve an intent acceptably.
 *
 * A commercial query is best served by a comparison, but a guide that reaches
 * a recommendation is a partial answer rather than a wrong one. Anything
 * outside both lists is a mismatch.
 */
export const ACCEPTABLE_FORMATS: Record<KeywordIntent, readonly ContentFormat[]> = {
  informational: ["guide", "resource", "article", "tool"],
  commercial: ["comparison", "guide", "resource", "product", "landing"],
  transactional: ["landing", "product", "tool"],
  local: ["location", "landing"],
  navigational: ["landing", "article"],
  mixed: ["resource", "guide", "comparison", "landing"],
};

export const ROLE_META: Record<
  ContentRole,
  { readonly label: string; readonly tone: BadgeTone; readonly description: string }
> = {
  pillar: {
    label: "Pillar",
    tone: "accent",
    description: "Anchors its cluster; the supporting pages point at it.",
  },
  supporting: {
    label: "Supporting",
    tone: "neutral",
    description: "Serves one slice of the cluster and links up to the pillar.",
  },
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const SCORE_BAND_META: Record<ContentScoreBand, ScoreBandMeta> = {
  excellent: {
    label: "Excellent",
    range: "80-100",
    tone: "positive",
    meter: "positive",
    description: "Nothing material is holding this page back.",
  },
  good: {
    label: "Good",
    range: "65-79",
    tone: "accent",
    meter: "accent",
    description: "Sound, with a couple of specific improvements available.",
  },
  fair: {
    label: "Fair",
    range: "45-64",
    tone: "warning",
    meter: "warning",
    description: "Working, but under-serving what its keywords are worth.",
  },
  poor: {
    label: "Poor",
    range: "0-44",
    tone: "critical",
    meter: "critical",
    description: "Needs rebuilding rather than tuning.",
  },
};

export const SCORE_BAND_ORDER: readonly ContentScoreBand[] = [
  "excellent",
  "good",
  "fair",
  "poor",
];

export function scoreBandOf(score: number): ContentScoreBand {
  if (score >= 80) return "excellent";
  if (score >= 65) return "good";
  if (score >= 45) return "fair";
  return "poor";
}

/** Meter tone for a bare 0-100 content reading. */
export function scoreTone(score: number): MeterTone {
  return SCORE_BAND_META[scoreBandOf(score)].meter;
}

// ---------------------------------------------------------------------------
// Intent alignment
// ---------------------------------------------------------------------------

export const ALIGNMENT_META: Record<
  IntentAlignment,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly health: MetricHealth;
    readonly description: string;
  }
> = {
  aligned: {
    label: "Aligned",
    tone: "positive",
    health: "positive",
    description: "The format is the one this intent asks for.",
  },
  partial: {
    label: "Partial",
    tone: "warning",
    health: "warning",
    description: "The format serves the intent, but is not the best answer to it.",
  },
  mismatched: {
    label: "Mismatched",
    tone: "critical",
    health: "negative",
    description: "The page answers a different question from the one being asked.",
  },
};

export const ALIGNMENT_ORDER: readonly IntentAlignment[] = [
  "aligned",
  "partial",
  "mismatched",
];

// ---------------------------------------------------------------------------
// On-page checks
// ---------------------------------------------------------------------------

export const CHECK_META: Record<
  OnPageCheckId,
  {
    readonly label: string;
    readonly icon: IconName;
    readonly description: string;
  }
> = {
  "title-tag": {
    label: "Title tag",
    icon: "edit",
    description: "Length, keyword placement, and whether it earns the click.",
  },
  "meta-description": {
    label: "Meta description",
    icon: "note",
    description: "Whether the snippet sells the page or is left to the engine.",
  },
  h1: {
    label: "H1",
    icon: "pages",
    description: "One H1, matching what the page is actually about.",
  },
  "heading-structure": {
    label: "Heading structure",
    icon: "layers",
    description: "A logical outline a reader and a parser can both follow.",
  },
  "keyword-placement": {
    label: "Keyword placement",
    icon: "keywords",
    description: "The target query present where it counts, not stuffed.",
  },
  "intent-match": {
    label: "Intent match",
    icon: "target",
    description: "Whether the format answers the question the query is asking.",
  },
  "word-count": {
    label: "Depth",
    icon: "rows",
    description: "Enough coverage for the format and what already ranks.",
  },
  "internal-links-out": {
    label: "Outbound internal links",
    icon: "handoff",
    description: "Links to the rest of the cluster, so the topic reads as one.",
  },
  "internal-links-in": {
    label: "Inbound internal links",
    icon: "backlinks",
    description: "Links from elsewhere on the site pointing at this page.",
  },
  "image-alt": {
    label: "Images and alt text",
    icon: "grid",
    description: "Original imagery, described for anyone who cannot see it.",
  },
  schema: {
    label: "Structured data",
    icon: "technical",
    description: "The schema type this format should carry.",
  },
  "answer-block": {
    label: "Answer block",
    icon: "sparkles",
    description: "A short, self-contained answer a generated result can quote.",
  },
  "entity-coverage": {
    label: "Entity coverage",
    icon: "globe",
    description: "The named things the topic requires to read as authoritative.",
  },
  freshness: {
    label: "Freshness",
    icon: "clock",
    description: "How long since the page was last reviewed or updated.",
  },
  cta: {
    label: "Call to action",
    icon: "flag",
    description: "A next step matching the intent the page serves.",
  },
};

export const CHECK_ORDER: readonly OnPageCheckId[] = [
  "title-tag",
  "meta-description",
  "h1",
  "heading-structure",
  "keyword-placement",
  "intent-match",
  "word-count",
  "answer-block",
  "entity-coverage",
  "schema",
  "internal-links-out",
  "internal-links-in",
  "image-alt",
  "freshness",
  "cta",
];

export const RECOMMENDATION_STATE_META: Record<
  RecommendationState,
  { readonly label: string; readonly tone: BadgeTone }
> = {
  open: { label: "Open", tone: "neutral" },
  accepted: { label: "Added to plan", tone: "accent" },
  done: { label: "Marked fixed", tone: "positive" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

/** Severity order, worst first — used wherever findings are ranked. */
export const SEVERITY_ORDER: readonly Priority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

// ---------------------------------------------------------------------------
// Internal linking
// ---------------------------------------------------------------------------

export const LINK_KIND_META: Record<
  InternalLinkKind,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly icon: IconName;
    readonly description: string;
  }
> = {
  "pillar-uplift": {
    label: "Pillar uplift",
    tone: "accent",
    icon: "layers",
    description: "A supporting page should point at its cluster pillar.",
  },
  "cluster-support": {
    label: "Cluster support",
    tone: "neutral",
    icon: "handoff",
    description: "Two pages on the same topic that do not reference each other.",
  },
  "authority-flow": {
    label: "Authority flow",
    tone: "positive",
    icon: "trend-up",
    description: "A strong page can lend authority to one that needs it.",
  },
  "orphan-rescue": {
    label: "Orphan rescue",
    tone: "warning",
    icon: "link-off",
    description: "A page nothing links to, so nothing passes into it.",
  },
  "cannibalisation-fix": {
    label: "Cannibalisation fix",
    tone: "critical",
    icon: "split",
    description: "Point the competing page at the one that should own the term.",
  },
};

export const LINK_KIND_ORDER: readonly InternalLinkKind[] = [
  "cannibalisation-fix",
  "orphan-rescue",
  "pillar-uplift",
  "authority-flow",
  "cluster-support",
];

// ---------------------------------------------------------------------------
// Keyword mapping
// ---------------------------------------------------------------------------

export const MAPPING_META: Record<
  MappingQuality,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly description: string;
  }
> = {
  primary: {
    label: "Primary target",
    tone: "positive",
    description: "The keyword this page was built to win.",
  },
  secondary: {
    label: "Secondary",
    tone: "accent",
    description: "Served by a page whose main target is a different keyword.",
  },
  split: {
    label: "Split across pages",
    tone: "critical",
    description: "More than one page of ours ranks, dividing the clicks.",
  },
  planned: {
    label: "Planned",
    tone: "warning",
    description:
      "Nothing is live for this query yet; a piece is moving through the pipeline.",
  },
};

export const MAPPING_ORDER: readonly MappingQuality[] = [
  "primary",
  "secondary",
  "split",
  "planned",
];

// ---------------------------------------------------------------------------
// Content gaps
// ---------------------------------------------------------------------------

export const GAP_KIND_META: Record<
  ContentGapKind,
  {
    readonly label: string;
    readonly tone: BadgeTone;
    readonly icon: IconName;
    readonly description: string;
  }
> = {
  "no-page": {
    label: "No page",
    tone: "critical",
    icon: "inbox",
    description: "Nothing on the site targets the query.",
  },
  "no-pillar": {
    label: "No pillar",
    tone: "warning",
    icon: "layers",
    description: "The cluster has supporting pages but nothing anchoring them.",
  },
  thin: {
    label: "Thin coverage",
    tone: "warning",
    icon: "rows",
    description: "A page exists but is too slight to compete on the query.",
  },
  outdated: {
    label: "Outdated",
    tone: "warning",
    icon: "clock",
    description: "The page has aged out of what now ranks above it.",
  },
  "competitor-only": {
    label: "Competitor only",
    tone: "critical",
    icon: "competitors",
    description: "A rival ranks and we do not appear at all.",
  },
};

export const GAP_KIND_ORDER: readonly ContentGapKind[] = [
  "no-page",
  "competitor-only",
  "thin",
  "outdated",
  "no-pillar",
];
