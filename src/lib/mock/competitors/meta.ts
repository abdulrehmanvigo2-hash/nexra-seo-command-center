import type {
  BattleMeta,
  BattleState,
  CompetitorGapKind,
  CompetitorType,
  DominanceState,
  KindMeta,
  OpportunityKind,
  OverlapType,
  Provenance,
  ThreatKind,
  ThreatLevel,
  ThreatMeta,
  VocabMeta,
} from "@/types/competitor";
import type { Priority } from "@/types/competitor";

/**
 * How the Competitor Intelligence vocabulary reads on screen.
 *
 * Labels, tones, orderings, and one-line explanations, kept in one place so a
 * battle state means the same thing on the overview, in a table row, on a
 * competitor's own page, and in a filter — and so a new state cannot be added
 * without a label and an explanation going with it.
 *
 * Nothing here computes anything. The thresholds that decide which of these
 * labels applies live in `scoring.ts`, which is the only file allowed to hold
 * a formula.
 */

// ---------------------------------------------------------------------------
// Competitor type
// ---------------------------------------------------------------------------

export const COMPETITOR_TYPE_ORDER: readonly CompetitorType[] = [
  "direct",
  "specialist",
  "marketplace",
  "publisher",
  "aggregator",
];

export const COMPETITOR_TYPE_META: Record<CompetitorType, VocabMeta> = {
  direct: {
    label: "Direct",
    short: "Direct",
    tone: "critical",
    description:
      "Sells what the client sells, to the same buyer. Every shared term is a contested one.",
  },
  specialist: {
    label: "Specialist",
    short: "Spec",
    tone: "warning",
    description:
      "Covers a narrower slice in more depth. Hard to beat inside its niche, easy to out-flank outside it.",
  },
  marketplace: {
    label: "Marketplace",
    short: "Market",
    tone: "accent",
    description:
      "Aggregates other people's inventory. Wins transactional terms on breadth rather than authority.",
  },
  publisher: {
    label: "Publisher",
    short: "Pub",
    tone: "neutral",
    description:
      "Editorial site with no product. Owns informational terms and is beatable on commercial ones.",
  },
  aggregator: {
    label: "Comparison",
    short: "Comp",
    tone: "accent",
    description:
      "Comparison and review site. Sits between the searcher and the client on commercial queries.",
  },
};

// ---------------------------------------------------------------------------
// Threat
// ---------------------------------------------------------------------------

export const THREAT_ORDER: readonly ThreatLevel[] = [
  "severe",
  "high",
  "moderate",
  "low",
];

export const THREAT_META: Record<ThreatLevel, ThreatMeta> = {
  severe: {
    label: "Severe",
    short: "Severe",
    tone: "critical",
    meter: "critical",
    floor: 65,
    description:
      "Holds a large share of the set, out-ranks us on the terms that matter, and is still gaining.",
  },
  high: {
    label: "High",
    short: "High",
    tone: "warning",
    meter: "warning",
    floor: 50,
    description: "Out-ranks us across enough of the set to cost real traffic.",
  },
  moderate: {
    label: "Moderate",
    short: "Mod",
    tone: "accent",
    meter: "accent",
    floor: 32,
    description:
      "Overlaps meaningfully but is not winning the terms that decide the market.",
  },
  low: {
    label: "Low",
    short: "Low",
    tone: "neutral",
    meter: "neutral",
    description:
      "Present in the set without contesting much of it. Worth watching, not worth answering.",
    floor: 0,
  },
};

// ---------------------------------------------------------------------------
// Ranking battles
// ---------------------------------------------------------------------------

/** Most urgent first — the order the battles table defaults to. */
export const BATTLE_ORDER: readonly BattleState[] = [
  "absent",
  "losing",
  "attack",
  "easy-win",
  "close-race",
  "defend",
  "dominant",
];

export const BATTLE_META: Record<BattleState, BattleMeta> = {
  absent: {
    label: "Absent",
    short: "Absent",
    tone: "critical",
    icon: "link-off",
    description: "They rank and we do not appear at all.",
    action: "Decide whether the term is worth a page, then brief one.",
  },
  losing: {
    label: "Losing",
    short: "Losing",
    tone: "critical",
    icon: "trend-down",
    description: "They out-rank us by ten places or more.",
    action:
      "Treat as a rebuild rather than a tune-up — the page is not competing.",
  },
  attack: {
    label: "Attack",
    short: "Attack",
    tone: "warning",
    icon: "target",
    description:
      "They lead by three to nine places from a strong position of their own.",
    action: "Close the gap with depth and internal links before it widens.",
  },
  "easy-win": {
    label: "Easy win",
    short: "Easy",
    tone: "positive",
    icon: "bolt",
    description:
      "They lead, but from page two or beyond — the position is weakly held.",
    action: "On-page work and a few internal links should take this outright.",
  },
  "close-race": {
    label: "Close race",
    short: "Close",
    tone: "accent",
    icon: "split",
    description: "Within two places either way. The next move decides it.",
    action: "Small, fast improvements: title, intro, one strong internal link.",
  },
  defend: {
    label: "Defend",
    short: "Defend",
    tone: "accent",
    icon: "shield",
    description: "We lead, but not by enough to be safe.",
    action: "Keep the page current and watch for their next revision.",
  },
  dominant: {
    label: "Dominant",
    short: "Dom",
    tone: "positive",
    icon: "star",
    description: "We hold the top three and lead them by five places or more.",
    action: "Hold it. Nothing here needs work while the gap stays this wide.",
  },
};

/** Battle states where we are the one losing ground. */
export const LOSING_BATTLES: readonly BattleState[] = [
  "absent",
  "losing",
  "attack",
];

/** Battle states worth attacking rather than defending. */
export const ATTACKABLE_BATTLES: readonly BattleState[] = [
  "easy-win",
  "attack",
  "close-race",
];

/** Battle states where the job is to hold what we have. */
export const DEFENSIVE_BATTLES: readonly BattleState[] = [
  "close-race",
  "defend",
];

// ---------------------------------------------------------------------------
// Overlap
// ---------------------------------------------------------------------------

export const OVERLAP_ORDER: readonly OverlapType[] = [
  "shared",
  "theirs-only",
  "ours-only",
];

export const OVERLAP_META: Record<OverlapType, VocabMeta> = {
  shared: {
    label: "Shared",
    short: "Shared",
    tone: "accent",
    description: "Both sides rank for the term.",
  },
  "theirs-only": {
    label: "Competitor only",
    short: "Theirs",
    tone: "critical",
    description: "They rank for it and we do not appear.",
  },
  "ours-only": {
    label: "Ours only",
    short: "Ours",
    tone: "positive",
    description: "We rank for it and they do not appear.",
  },
};

// ---------------------------------------------------------------------------
// Content gaps
// ---------------------------------------------------------------------------

/** Ordered by what a strategist fixes first. */
export const GAP_KIND_ORDER: readonly CompetitorGapKind[] = [
  "no-page",
  "weak-page",
  "cannibalised",
  "cluster-depth",
  "intent-miss",
  "multi-term-page",
  "refresh-needed",
  "serp-feature",
];

export const GAP_KIND_META: Record<CompetitorGapKind, KindMeta> = {
  "no-page": {
    label: "No page of ours",
    short: "No page",
    tone: "critical",
    icon: "pages",
    description: "They rank for the term and nothing of ours targets it.",
  },
  "weak-page": {
    label: "Ours is weaker",
    short: "Weak",
    tone: "warning",
    icon: "gauge",
    description:
      "Both sides have a page. Theirs is deeper and it is out-ranking ours.",
  },
  cannibalised: {
    label: "Split against ourselves",
    short: "Split",
    tone: "critical",
    icon: "split",
    description:
      "Two pages of ours target the term while theirs targets it once, clearly.",
  },
  "cluster-depth": {
    label: "Deeper cluster coverage",
    short: "Depth",
    tone: "warning",
    icon: "layers",
    description:
      "They rank across more of the topic's terms than we do, whatever the page count says.",
  },
  "intent-miss": {
    label: "Intent we miss",
    short: "Intent",
    tone: "warning",
    icon: "target",
    description:
      "They answer the query in the format it asks for and our page does not.",
  },
  "multi-term-page": {
    label: "One page, many terms",
    short: "Multi",
    tone: "accent",
    icon: "grid",
    description:
      "A single page of theirs is taking several valuable terms at once.",
  },
  "refresh-needed": {
    label: "Ours has aged",
    short: "Stale",
    tone: "warning",
    icon: "clock",
    description:
      "Our page exists and is decaying while theirs holds the position.",
  },
  "serp-feature": {
    label: "Result-page feature",
    short: "Feature",
    tone: "accent",
    icon: "sparkles",
    description:
      "They hold a feature on the result page — a snippet, a panel, or a generated answer.",
  },
};

// ---------------------------------------------------------------------------
// Threats
// ---------------------------------------------------------------------------

export const THREAT_KIND_ORDER: readonly ThreatKind[] = [
  "new-outrank",
  "high-value-held",
  "decaying-page",
  "multi-keyword-page",
  "weak-cluster",
  "cannibalised-pair",
  "unmapped-keyword",
  "answer-engine",
];

export const THREAT_KIND_META: Record<ThreatKind, KindMeta> = {
  "new-outrank": {
    label: "Newly out-ranked",
    short: "Overtaken",
    tone: "critical",
    icon: "trend-down",
    description:
      "We have lost places on a term this window and they are now above us.",
  },
  "high-value-held": {
    label: "High-value term held",
    short: "High value",
    tone: "critical",
    icon: "value",
    description:
      "They hold the top three on a term with real volume and commercial value.",
  },
  "decaying-page": {
    label: "Winning against a decaying page",
    short: "Decay",
    tone: "critical",
    icon: "alert",
    description:
      "The page of ours on this term is losing ground, and they are taking it.",
  },
  "multi-keyword-page": {
    label: "One page taking many terms",
    short: "Multi-term",
    tone: "warning",
    icon: "grid",
    description:
      "A single page of theirs is out-ranking us across several terms at once.",
  },
  "weak-cluster": {
    label: "Weakly defended cluster",
    short: "Cluster",
    tone: "warning",
    icon: "layers",
    description:
      "They are consolidating a topic where our coverage is incomplete.",
  },
  "cannibalised-pair": {
    label: "Out-ranking a split pair",
    short: "Split",
    tone: "warning",
    icon: "split",
    description:
      "Two pages of ours are splitting the term while they target it once.",
  },
  "unmapped-keyword": {
    label: "Term nothing of ours targets",
    short: "Unmapped",
    tone: "warning",
    icon: "link-off",
    description:
      "They rank for a term no page of ours is built to win.",
  },
  "answer-engine": {
    label: "Answer-engine exposure",
    short: "AI answer",
    tone: "warning",
    icon: "sparkles",
    description:
      "A generated answer runs on the term, they are eligible for it, and we are not cited.",
  },
};

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export const OPPORTUNITY_KIND_ORDER: readonly OpportunityKind[] = [
  "create-content",
  "attack-page",
  "refresh-page",
  "consolidate",
  "on-page",
  "expand-cluster",
  "internal-links",
  "ai-readiness",
  "defend",
  "authority",
];

export const OPPORTUNITY_KIND_META: Record<OpportunityKind, KindMeta> = {
  "create-content": {
    label: "Create content",
    short: "Create",
    tone: "accent",
    icon: "plus",
    description: "Write the page that does not exist yet.",
  },
  "attack-page": {
    label: "Attack a page",
    short: "Attack",
    tone: "warning",
    icon: "target",
    description: "Out-build one specific page of theirs on its own terms.",
  },
  "refresh-page": {
    label: "Refresh a page",
    short: "Refresh",
    tone: "warning",
    icon: "refresh",
    description: "Bring an ageing page of ours back up to standard.",
  },
  consolidate: {
    label: "Consolidate",
    short: "Merge",
    tone: "critical",
    icon: "split",
    description: "Stop two pages of ours competing for the same term.",
  },
  "on-page": {
    label: "On-page work",
    short: "On-page",
    tone: "accent",
    icon: "sliders",
    description: "Titles, headings, entities, and internal targeting.",
  },
  "expand-cluster": {
    label: "Expand a cluster",
    short: "Expand",
    tone: "accent",
    icon: "layers",
    description: "Add the supporting pages a topic needs to read as ours.",
  },
  "internal-links": {
    label: "Internal links",
    short: "Links",
    tone: "accent",
    icon: "handoff",
    description: "Point authority we already hold at the page that needs it.",
  },
  "ai-readiness": {
    label: "Answer readiness",
    short: "AEO",
    tone: "accent",
    icon: "sparkles",
    description: "Make the page quotable by a generative answer.",
  },
  defend: {
    label: "Defend a ranking",
    short: "Defend",
    tone: "positive",
    icon: "shield",
    description: "Hold a position a rival is closing on.",
  },
  authority: {
    label: "Build authority",
    short: "Authority",
    tone: "neutral",
    icon: "backlinks",
    description:
      "Close an authority gap that on-page work alone will not close.",
  },
};

// ---------------------------------------------------------------------------
// Cluster dominance
// ---------------------------------------------------------------------------

export const DOMINANCE_ORDER: readonly DominanceState[] = [
  "they-lead",
  "contested",
  "we-lead",
  "uncontested",
];

export const DOMINANCE_META: Record<DominanceState, VocabMeta> = {
  "they-lead": {
    label: "They lead",
    short: "Theirs",
    tone: "critical",
    description: "A rival holds the topic on both coverage and position.",
  },
  contested: {
    label: "Contested",
    short: "Contested",
    tone: "warning",
    description: "Neither side holds it. The next few pages decide the topic.",
  },
  "we-lead": {
    label: "We lead",
    short: "Ours",
    tone: "positive",
    description: "We are ahead on coverage and position, with rivals present.",
  },
  uncontested: {
    label: "Uncontested",
    short: "Open",
    tone: "accent",
    description: "No rival has meaningful presence in this topic yet.",
  },
};

// ---------------------------------------------------------------------------
// Shared scales
// ---------------------------------------------------------------------------

/** Most severe first — the order every findings list sorts by. */
export const SEVERITY_ORDER: readonly Priority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

export const PROVENANCE_META: Record<Provenance, VocabMeta> = {
  canonical: {
    label: "Measured",
    short: "Measured",
    tone: "positive",
    description:
      "Read unchanged from the keyword, cluster, or content record that owns it.",
  },
  derived: {
    label: "Derived",
    short: "Derived",
    tone: "accent",
    description: "Arithmetic over data an earlier module owns.",
  },
  seeded: {
    label: "Modelled",
    short: "Modelled",
    tone: "neutral",
    description:
      "A fact no fixture can observe, drawn from a fixed seed so it never changes between renders.",
  },
};

/**
 * The line shown wherever the module reports a competitor's own numbers.
 *
 * Nothing in this product talks to a rank tracker, a SERP API, or any
 * third-party dataset (CLAUDE.md §4), and no figure here is presented as
 * though it came from one.
 */
export const MODELLED_SOURCE_NOTE =
  "Modelled intelligence from the development dataset — not a live rank tracker or a third-party data source.";
