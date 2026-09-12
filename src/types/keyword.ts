/**
 * Shapes for the Keyword Intelligence module (CLAUDE.md §14, Phase 5).
 *
 * One keyword vocabulary in this product, not several. `SearchIntent` and
 * `AgentId` come from `src/types/seo.ts`, the project ids come from the
 * dashboard's own union, and anything graded reuses `Level` / `Priority`
 * rather than inventing a parallel scale — so an intent, an owner, or a
 * severity means the same thing on the Command Center, on a project, and here.
 *
 * A few aliases below name an existing shape in this module's language instead
 * of restating it. That is deliberate: `KeywordIntent` is `SearchIntent`, and
 * a keyword's history point is the same date/label pairing the trend chart
 * already uses.
 *
 * Everything typed here is served by `src/lib/mock/keywords` — fixtures, not
 * live data. There is no keyword API, no rank tracker, and no search-console
 * connection in this milestone (CLAUDE.md §4).
 */
import type { IconName } from "@/components/icons";
import type { Priority } from "@/components/ui/badge";
import type { MetricHealth, RangeId } from "@/types/dashboard";
import type { AgentId, Level, MetricTrend, SearchIntent } from "@/types/seo";

export type { AgentId, Level, MetricTrend, Priority, RangeId };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * What the searcher wants. The product-wide union, named in this module's
 * terms — there is no second intent enum.
 */
export type KeywordIntent = SearchIntent;

/** Which position band a keyword currently sits in. */
export type RankingStatus =
  | "top-3"
  | "top-10"
  | "top-20"
  | "top-100"
  | "not-ranking";

/**
 * How a keyword is behaving, as opposed to where it sits.
 *
 * `pending` is reserved for keywords added in this session through the import
 * or discovery flows: they have no measured metrics, and inventing some would
 * be a lie the rest of the page would then repeat.
 */
export type KeywordStatus =
  | "improving"
  | "declining"
  | "stable"
  | "new"
  | "lost"
  | "pending";

/** Bands the opportunity score is read in. */
export type OpportunityBand = "prime" | "strong" | "moderate" | "low";

/** Size band for search volume, used by the volume filter. */
export type VolumeBand = "very-high" | "high" | "medium" | "low";

/** Difficulty band, used by the difficulty filter. */
export type DifficultyBand = "easy" | "moderate" | "hard" | "very-hard";

// ---------------------------------------------------------------------------
// SERP
// ---------------------------------------------------------------------------

export type SerpFeatureId =
  | "featured-snippet"
  | "people-also-ask"
  | "local-pack"
  | "video"
  | "images"
  | "shopping"
  | "knowledge-panel"
  | "sitelinks"
  | "discussions"
  | "ai-overview";

/** Who currently holds a SERP feature on this query. */
export type SerpOwnership = "ours" | "competitor" | "unclaimed";

/** One feature detected on a keyword's result page. */
export type SerpFeaturePresence = {
  readonly feature: SerpFeatureId;
  readonly ownership: SerpOwnership;
  /** Who holds it, where that is someone else. */
  readonly holder: string | null;
  /** How much is on the table if it were taken. */
  readonly opportunity: Level;
  /** What to do about it. */
  readonly action: string;
};

/** The overall shape of the result page. */
export type SerpType =
  | "classic"
  | "answer-led"
  | "local"
  | "commercial"
  | "media"
  | "mixed";

// ---------------------------------------------------------------------------
// AI / answer-engine layer
// ---------------------------------------------------------------------------

/**
 * Where the brand is *projected* to stand in a generated answer.
 *
 * A projection, not an observation. Nothing in this product queries ChatGPT,
 * Gemini, Perplexity, Claude, Google AI Overviews or Bing Copilot, so no
 * member here may be read as a citation that was seen. The projection is
 * arithmetic on our own ranking position and the query's modelled result page,
 * and the vocabulary is named so the stronger claim cannot be made by accident
 * — the same rule the AI Visibility module is built on (CLAUDE.md §4).
 */
export type AiCoverageProjection =
  | "likely-source"
  | "likely-mention"
  | "unlikely"
  | "not-projected";

/**
 * The answer-engine reading of one keyword.
 *
 * Every figure below is modelled from canonical keyword data — position,
 * intent, content strength and the query's own modelled result page. None of
 * it is measured against a live answer engine, and none of it reports that the
 * brand was cited: see `AiCoverageProjection`.
 */
export type AiKeywordSignal = {
  /** How well the query suits a generated answer, 0-100. */
  readonly answerRelevance: number;
  /** How much is on the table by becoming a cited source. */
  readonly citationOpportunity: Level;
  /** Entity authority the topic demands before citation is realistic, 0-100. */
  readonly entityStrengthNeeded: number;
  /** Entity authority the project currently holds on the topic, 0-100. */
  readonly entityStrengthHeld: number;
  /** True where the query is phrased as, or resolves to, a question. */
  readonly questionFormat: boolean;
  /** How cleanly the query can be answered in a short passage, 0-100. */
  readonly answerability: number;
  /** Modelled likelihood the brand is named in an answer, 0-100. */
  readonly brandMentionPotential: number;
  readonly coverage: AiCoverageProjection;
  /**
   * True where this query's modelled result page carries a generated-answer
   * feature. A property of the fixture's SERP feature set, not an observation
   * of any live result page.
   */
  readonly answerProjected: boolean;
};

/** The narrower cuts the AI layer can be filtered to. */
export type AiKeywordFilter =
  | "all"
  | "high-opportunity"
  | "citation-gap"
  | "question-based"
  | "entity-weakness"
  | "answer-ready";

// ---------------------------------------------------------------------------
// Prioritisation
// ---------------------------------------------------------------------------

export type PriorityFactorId =
  | "volume"
  | "difficulty"
  | "position"
  | "intent"
  | "traffic"
  | "commercial"
  | "competitor"
  | "ai"
  | "content";

/** One weighted input to the opportunity score. */
export type PriorityFactor = {
  readonly id: PriorityFactorId;
  readonly label: string;
  /** The factor's own 0-100 reading. */
  readonly value: number;
  /** Share of the total score this factor can contribute, 0-1. */
  readonly weight: number;
  /** `value * weight`, rounded — what it actually added. */
  readonly contribution: number;
  /** Why the factor reads the way it does. */
  readonly detail: string;
};

/**
 * The Nexra opportunity score.
 *
 * A weighted sum of nine readings of the mock dataset, published with its
 * components so the number can be argued with. It is arithmetic over fixtures,
 * not a model, and the module says so wherever it is shown.
 */
export type KeywordPriorityScore = {
  readonly score: number;
  readonly band: OpportunityBand;
  readonly factors: readonly PriorityFactor[];
  /** One line summarising what is driving the score. */
  readonly summary: string;
};

// ---------------------------------------------------------------------------
// The keyword record
// ---------------------------------------------------------------------------

/**
 * One keyword, with everything the product knows about it.
 *
 * The canonical record. Clusters, opportunities, movement, cannibalisation,
 * gaps, and the dashboard's keyword snapshot are all derived from these — no
 * module holds a second copy of a keyword.
 */
export type KeywordRecord = {
  readonly id: string;
  readonly keyword: string;
  readonly intent: KeywordIntent;
  readonly projectId: string;
  readonly projectName: string;
  /** Cluster id this keyword belongs to. */
  readonly clusterId: string;
  readonly clusterName: string;

  /** Current SERP position, or null where the keyword does not rank. */
  readonly position: number | null;
  /** Position one window earlier, or null where it did not rank then. */
  readonly previousPosition: number | null;
  /** Places gained. Positive is an improvement; 0 where either side is null. */
  readonly change: number;
  readonly rankingStatus: RankingStatus;
  readonly status: KeywordStatus;

  /** Monthly searches. */
  readonly volume: number;
  readonly volumeBand: VolumeBand;
  /** Ranking difficulty, 0-100. */
  readonly difficulty: number;
  readonly difficultyBand: DifficultyBand;
  /** Cost per click in USD — the commercial-value proxy. */
  readonly cpc: number;
  /** Commercial value index, 0-100: CPC and intent together. */
  readonly commercialValue: number;

  /** Estimated monthly sessions at the current position. */
  readonly currentTraffic: number;
  /** Estimated monthly sessions at a realistic target position. */
  readonly trafficPotential: number;

  readonly serpType: SerpType;
  readonly serpFeatures: readonly SerpFeaturePresence[];
  readonly ai: AiKeywordSignal;
  readonly opportunity: KeywordPriorityScore;

  /** The page this keyword is meant to rank, or null where none exists. */
  readonly targetUrl: string | null;
  /** Other pages of ours ranking for it. Non-empty means cannibalisation. */
  readonly competingUrls: readonly string[];
  /** How strong our page is on this topic, 0-100. 0 where there is no page. */
  readonly contentStrength: number;
  /** The best-placed rival on this query. */
  readonly competitor: {
    readonly name: string;
    readonly domain: string;
    readonly position: number;
  } | null;

  /** Agent accountable for the next move on this keyword. */
  readonly owner: AgentId;
  /** ISO 8601 timestamp of the last measurement. */
  readonly updatedAt: string;
  /** Seeds every derived number for this keyword. */
  readonly seed: number;
  /** True for keywords added in this session. Always `pending` status. */
  readonly draft: boolean;
};

// ---------------------------------------------------------------------------
// Ranking history
// ---------------------------------------------------------------------------

export type RankingHistoryPoint = {
  /** ISO 8601 date of the sample. */
  readonly date: string;
  /** Pre-formatted axis label. */
  readonly label: string;
  /** Position on that date, or null where the keyword did not rank. */
  readonly position: number | null;
};

/** A keyword's rank over one window, with the readings that window supports. */
export type KeywordRankingHistory = {
  readonly keywordId: string;
  readonly range: RangeId;
  readonly points: readonly RankingHistoryPoint[];
  /** Best (lowest) position reached in the window. */
  readonly best: number | null;
  /** Worst (highest) position reached in the window. */
  readonly worst: number | null;
  /** Places gained across the window. Positive is an improvement. */
  readonly net: number;
  /** Mean absolute change between samples — how jumpy the ranking is. */
  readonly volatility: number;
  readonly startPosition: number | null;
  readonly endPosition: number | null;
};

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------

/** How well a cluster is covered by pages that exist today. */
export type ClusterStatus =
  | "covered"
  | "partial"
  | "gap"
  | "planned"
  | "at-risk";

/** A page a cluster needs, whether or not it exists yet. */
export type ClusterPage = {
  readonly id: string;
  readonly title: string;
  readonly role: "pillar" | "supporting";
  readonly url: string | null;
  /** Keywords in the cluster this page is meant to carry. */
  readonly keywordCount: number;
  readonly exists: boolean;
  /** Suggested format where the page does not exist yet. */
  readonly contentType: string;
};

export type KeywordCluster = {
  readonly id: string;
  readonly name: string;
  readonly parentTopic: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly keywordIds: readonly string[];
  readonly keywordCount: number;
  readonly totalVolume: number;
  /** Mean difficulty across the cluster, 0-100. */
  readonly averageDifficulty: number;
  /** Mean opportunity score across the cluster, 0-100. */
  readonly opportunityScore: number;
  /** Share of the cluster with a page targeting it, 0-100. */
  readonly coverage: number;
  /** Share of the cluster ranking in the top 20, 0-100. */
  readonly rankingCoverage: number;
  /** Keywords in the cluster with no page behind them. */
  readonly contentGaps: number;
  readonly primaryIntent: KeywordIntent;
  /** Keyword count per intent, for the intent mix bar. */
  readonly intentMix: ReadonlyMap<KeywordIntent, number>;
  readonly targetUrl: string | null;
  readonly owner: AgentId;
  readonly status: ClusterStatus;
  readonly pages: readonly ClusterPage[];
  /** Ranking distribution across the cluster's keywords. */
  readonly distribution: ReadonlyMap<RankingStatus, number>;
  /** The single next thing to do with this cluster. */
  readonly nextAction: string;
  /** Estimated monthly sessions the whole cluster could carry. */
  readonly trafficPotential: number;
};

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export type OpportunityCategory =
  | "quick-win"
  | "high-volume-low-difficulty"
  | "striking-distance"
  | "commercial-intent"
  | "content-gap"
  | "competitor-gap"
  | "local"
  | "ai-search"
  | "refresh";

/** What the primary control on an opportunity does. */
export type OpportunityCta = "Review" | "Add to plan" | "Create brief";

/** Frontend-only state for an opportunity acted on in this session. */
export type OpportunityState = "open" | "reviewed" | "planned" | "briefed";

export type KeywordOpportunity = {
  readonly id: string;
  readonly category: OpportunityCategory;
  readonly keywordId: string;
  readonly keyword: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly intent: KeywordIntent;
  readonly volume: number;
  readonly difficulty: number;
  readonly position: number | null;
  /** Why this keyword is in this category. */
  readonly reason: string;
  /** Pre-formatted expected gain, e.g. "+1.4k sessions / mo". */
  readonly expectedImpact: string;
  readonly impact: Level;
  readonly effort: Level;
  readonly urgency: Priority;
  readonly targetUrl: string | null;
  readonly owner: AgentId;
  readonly cta: OpportunityCta;
  readonly score: number;
};

/** A keyword sitting just outside the places that earn clicks. */
export type StrikingDistanceRow = {
  readonly keywordId: string;
  readonly keyword: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly position: number;
  readonly volume: number;
  readonly difficulty: number;
  readonly intent: KeywordIntent;
  readonly targetUrl: string | null;
  /** Estimated extra monthly sessions from reaching the target position. */
  readonly ctrUpside: number;
  /** Click-through rate now, 0-100. */
  readonly currentCtr: number;
  /** Click-through rate at the target position, 0-100. */
  readonly targetCtr: number;
  readonly targetPosition: number;
  readonly recommendation: string;
  readonly owner: AgentId;
  readonly score: number;
};

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * Which movement list a keyword belongs to.
 *
 * Distinct from the dashboard's `KeywordMovement`, which is the aggregate
 * counter block. This is one keyword that moved.
 */
export type MovementKind = "winner" | "loser" | "new" | "lost";

export type KeywordMovementRow = {
  readonly keywordId: string;
  readonly keyword: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly kind: MovementKind;
  readonly position: number | null;
  readonly previousPosition: number | null;
  /** Places gained. Positive is an improvement. */
  readonly change: number;
  readonly volume: number;
  readonly intent: KeywordIntent;
  readonly targetUrl: string | null;
  /** Estimated monthly sessions gained or lost by the move. */
  readonly trafficChange: number;
  /** Whether the move is worth acting on, and why. */
  readonly significance: Level;
  readonly note: string;
};

/** The counters above the movement lists, for one window. */
export type KeywordMovementSummary = {
  readonly winners: number;
  readonly losers: number;
  readonly newRankings: number;
  readonly lostRankings: number;
  readonly netPositions: number;
  readonly trafficChange: number;
  /** Mean position across every ranking keyword. */
  readonly averagePosition: number;
  readonly averagePositionTrend: MetricTrend;
};

// ---------------------------------------------------------------------------
// Cannibalisation
// ---------------------------------------------------------------------------

export type CannibalizationRisk = "low" | "medium" | "high" | "critical";

/** Frontend-only state for a record acted on in this session. */
export type CannibalizationState =
  | "open"
  | "primary-assigned"
  | "task-created"
  | "reviewed";

export type CannibalizationUrl = {
  readonly url: string;
  readonly position: number;
  /** Share of the keyword's clicks this URL takes, 0-100. */
  readonly trafficShare: number;
  readonly role: "primary" | "competing";
  /** What the page is, e.g. "Category page". */
  readonly pageType: string;
};

export type CannibalizationRecord = {
  readonly id: string;
  readonly keywordId: string;
  readonly keyword: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly intent: KeywordIntent;
  readonly volume: number;
  readonly urls: readonly CannibalizationUrl[];
  readonly risk: CannibalizationRisk;
  /** Estimated monthly sessions lost to the split, in sessions. */
  readonly lostTraffic: number;
  readonly resolution: string;
  readonly owner: AgentId;
  /** ISO 8601 date the split was first detected. */
  readonly detectedAt: string;
};

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

export type ContentGapType =
  | "no-page"
  | "weak-content"
  | "competitor-only"
  | "thin-coverage"
  | "outdated";

export type ContentGapRecord = {
  readonly id: string;
  readonly keywordId: string;
  readonly keyword: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly gapType: ContentGapType;
  readonly competitorName: string;
  readonly competitorDomain: string;
  readonly competitorRank: number;
  /** Our position, or null where we do not rank at all. */
  readonly ourRank: number | null;
  readonly volume: number;
  readonly difficulty: number;
  readonly intent: KeywordIntent;
  readonly opportunityScore: number;
  readonly suggestedContentType: string;
  readonly owner: AgentId;
};

/** One rival's keyword position against ours. */
export type KeywordCompetitorGap = {
  readonly competitorId: string;
  readonly name: string;
  readonly domain: string;
  readonly projectId: string;
  readonly projectName: string;
  /** Keywords both sides rank for. */
  readonly sharedKeywords: number;
  /** Keywords only they rank for. */
  readonly competitorOnly: number;
  /** Keywords only we rank for. */
  readonly ourOnly: number;
  /** Their visibility share minus ours, in points. */
  readonly visibilityGap: number;
  /** Their mean position minus ours, in places. */
  readonly rankingGap: number;
  /** Shared keywords where they out-rank us. */
  readonly contentGap: number;
  /** Estimated monthly sessions the gap is worth. */
  readonly trafficGap: number;
  /** Their visibility share, 0-100. */
  readonly visibility: number;
  /** Our visibility share on the same set, 0-100. */
  readonly ourVisibility: number;
  /** The keywords driving the gap, worst first. */
  readonly keywords: readonly ContentGapRecord[];
};

// ---------------------------------------------------------------------------
// Saved lists
// ---------------------------------------------------------------------------

/**
 * A saved keyword list.
 *
 * Session state. Lists seeded with members are marked `seeded`; anything the
 * user creates in this session is not, and neither survives a reload — there
 * is nowhere to save them to in this milestone (CLAUDE.md §4).
 */
export type KeywordList = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: IconName;
  readonly keywordIds: readonly string[];
  readonly seeded: boolean;
};

// ---------------------------------------------------------------------------
// Import and discovery
// ---------------------------------------------------------------------------

/** Why an imported line was accepted or rejected. */
export type ImportStatus =
  | "pending-metrics"
  | "awaiting-research"
  | "duplicate"
  | "invalid";

export type ImportedKeyword = {
  readonly id: string;
  readonly keyword: string;
  readonly projectId: string;
  readonly projectName: string;
  /** Intent supplied with the paste, where the line carried one. */
  readonly intent: KeywordIntent | null;
  readonly status: ImportStatus;
  /** Why the line has the status it has. */
  readonly note: string;
  /** ISO 8601 timestamp the line was added in this session. */
  readonly addedAt: string;
};

/** What the discovery form collects. */
export type KeywordDiscoveryInput = {
  readonly seedTopic: string;
  readonly projectId: string;
  readonly market: string;
  readonly language: string;
  readonly intentFocus: KeywordIntent | "all";
};

/** One suggestion from a simulated discovery run. */
export type DiscoveredKeyword = {
  readonly id: string;
  readonly keyword: string;
  readonly intent: KeywordIntent;
  /** Simulated monthly searches. Not a measurement. */
  readonly estimatedVolume: number;
  /** Simulated difficulty, 0-100. Not a measurement. */
  readonly estimatedDifficulty: number;
  readonly clusterName: string;
  /** Why the run surfaced this term. */
  readonly rationale: string;
  /** True where the term is already in the tracked set. */
  readonly alreadyTracked: boolean;
};

export type KeywordDiscoveryResult = {
  readonly id: string;
  readonly input: KeywordDiscoveryInput;
  readonly keywords: readonly DiscoveredKeyword[];
  /** Sum of the simulated volumes. */
  readonly totalVolume: number;
  /** Clusters the suggestions fell into. */
  readonly clusters: readonly string[];
};

// ---------------------------------------------------------------------------
// Assembled views
// ---------------------------------------------------------------------------

/** One summary number above the keyword table. */
export type KeywordMetric = {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted for display. */
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly trend?: MetricTrend;
  readonly health?: MetricHealth;
};

/** Count of keywords in one band, for the distribution strip. */
export type RankingBandCount = {
  readonly id: RankingStatus;
  readonly label: string;
  readonly count: number;
  /** Share of the analysed set, 0-100. */
  readonly share: number;
};

/** Count of keywords per intent, for the intent breakdown. */
export type IntentBreakdownRow = {
  readonly intent: KeywordIntent;
  readonly count: number;
  readonly share: number;
  readonly volume: number;
  readonly averagePosition: number | null;
  readonly opportunityScore: number;
};

/** Everything one keyword's detail workspace renders. */
export type KeywordDetail = {
  readonly keyword: KeywordRecord;
  readonly cluster: KeywordCluster | null;
  readonly history: KeywordRankingHistory;
  readonly cannibalization: CannibalizationRecord | null;
  readonly gap: ContentGapRecord | null;
  readonly opportunities: readonly KeywordOpportunity[];
  /** Sibling keywords in the same cluster, best opportunity first. */
  readonly related: readonly KeywordRecord[];
  /** The single recommended next action. */
  readonly recommendedAction: {
    readonly title: string;
    readonly detail: string;
    readonly owner: AgentId;
    readonly urgency: Priority;
  };
  /** ISO 8601 instant the fixtures represent. */
  readonly generatedAt: string;
};

/** Everything one cluster's workspace renders. */
export type ClusterDetail = {
  readonly cluster: KeywordCluster;
  readonly keywords: readonly KeywordRecord[];
  readonly intentBreakdown: readonly IntentBreakdownRow[];
  readonly distribution: readonly RankingBandCount[];
  readonly gaps: readonly ContentGapRecord[];
  readonly opportunities: readonly KeywordOpportunity[];
  readonly metrics: readonly KeywordMetric[];
  /** Sibling clusters on the same project. */
  readonly siblings: readonly KeywordCluster[];
  readonly generatedAt: string;
};
