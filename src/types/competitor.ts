/**
 * Shapes for the Competitor Intelligence module (CLAUDE.md §14, Phase 7).
 *
 * The module holds one record of its own — the competitor — and every other
 * shape below is a reading of that record against data an earlier phase
 * already owns. Keywords, clusters, intents, projects, content, and agents are
 * imported, never restated: a `KeywordIntent` here is the product's intent
 * union, an `AgentId` is one of the twelve in CLAUDE.md §13, and a keyword is
 * referenced by id rather than copied.
 *
 * Three provenances run through this file, and the UI states which applies to
 * any figure it shows:
 *
 * - **canonical** — owned by an earlier phase and read unchanged (a keyword's
 *   volume, our position, a cluster's coverage, a page's content score).
 * - **derived** — arithmetic over canonical data (overlap counts, rank gaps,
 *   battle states, visibility shares, threat and opportunity scores).
 * - **seeded** — a fact a fixture cannot observe, drawn from a deterministic
 *   seed so it is identical on every render (a rival's authority, the page a
 *   rival ranks with, its estimated depth).
 *
 * Everything typed here is served by `src/lib/mock/competitors`. There is no
 * rank tracker, no SERP API, no crawler, and no third-party data source in
 * this milestone (CLAUDE.md §4) — the module says so wherever it reports a
 * number, and no figure is labelled with a vendor's name.
 */
import type { IconName } from "@/components/icons";
import type { BadgeTone, Priority } from "@/components/ui/badge";
import type { MeterTone } from "@/components/ui/meter";
import type { AgentId, Level, MetricTrend, SearchIntent } from "@/types/seo";

export type { AgentId, Level, MetricTrend, Priority };

/** The product-wide intent union, named in this module's terms. */
export type KeywordIntent = SearchIntent;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * What kind of site the rival is.
 *
 * Seeded from the domain, so a rival is the same kind of business in every
 * project it appears in.
 */
export type CompetitorType =
  | "direct"
  | "specialist"
  | "marketplace"
  | "publisher"
  | "aggregator";

/** How much of a problem a rival, a page, or a finding is. */
export type ThreatLevel = "severe" | "high" | "moderate" | "low";

/**
 * The state of one head-to-head ranking.
 *
 * Ordered by what a strategist does about it rather than by who is winning:
 * the two states worth acting on first — a keyword we have ceded entirely and
 * one we are losing badly — sit at the top, and the two we simply hold sit at
 * the bottom.
 */
export type BattleState =
  | "absent"
  | "losing"
  | "attack"
  | "easy-win"
  | "close-race"
  | "defend"
  | "dominant";

/** Which side of the overlap a keyword falls on. */
export type OverlapType = "shared" | "ours-only" | "theirs-only";

/** Why a keyword or a topic counts as a gap against this rival. */
export type CompetitorGapKind =
  | "no-page"
  | "weak-page"
  | "cluster-depth"
  | "intent-miss"
  | "multi-term-page"
  | "serp-feature"
  | "refresh-needed"
  | "cannibalised";

/** What kind of threat a finding is. */
export type ThreatKind =
  | "new-outrank"
  | "high-value-held"
  | "multi-keyword-page"
  | "weak-cluster"
  | "decaying-page"
  | "unmapped-keyword"
  | "cannibalised-pair"
  | "answer-engine";

/** The work a finding turns into. */
export type OpportunityKind =
  | "create-content"
  | "refresh-page"
  | "consolidate"
  | "on-page"
  | "internal-links"
  | "authority"
  | "ai-readiness"
  | "defend"
  | "attack-page"
  | "expand-cluster";

/** Who holds a topic cluster. */
export type DominanceState =
  | "we-lead"
  | "contested"
  | "they-lead"
  | "uncontested";

/** Where a figure came from. Shown next to anything that is not measured. */
export type Provenance = "canonical" | "derived" | "seeded";

// ---------------------------------------------------------------------------
// Presentation metadata
// ---------------------------------------------------------------------------

/** Label, tone, and explanation for one member of a vocabulary. */
export type VocabMeta = {
  readonly label: string;
  /** Abbreviated label, for dense table rows. */
  readonly short: string;
  readonly tone: BadgeTone;
  readonly description: string;
};

export type ThreatMeta = VocabMeta & {
  readonly meter: MeterTone;
  /** Lower bound of the threat score band, 0-100. */
  readonly floor: number;
};

export type BattleMeta = VocabMeta & {
  readonly icon: IconName;
  /** What to do about a keyword in this state. */
  readonly action: string;
};

export type KindMeta = VocabMeta & {
  readonly icon: IconName;
};

// ---------------------------------------------------------------------------
// The competitor record
// ---------------------------------------------------------------------------

/** One rival's footprint across the ranking bands. */
export type RankingFootprint = {
  readonly topThree: number;
  readonly topTen: number;
  readonly topTwenty: number;
  readonly beyond: number;
};

/** One weighted input to a competitor's strength score. */
export type StrengthFactor = {
  readonly id: string;
  readonly label: string;
  /** The factor's own 0-100 reading. */
  readonly value: number;
  /** Share of the total this factor can contribute, 0-1. */
  readonly weight: number;
  /** `value * weight`, rounded — what it actually added. */
  readonly contribution: number;
  readonly provenance: Provenance;
  readonly detail: string;
};

/** A published score, with the arithmetic behind it. */
export type ScoreBreakdown = {
  readonly score: number;
  readonly factors: readonly StrengthFactor[];
  readonly summary: string;
};

/**
 * A competitor, scoped to one project.
 *
 * The scope is deliberate. The same domain competes in more than one of our
 * clients' markets, but its overlap, its rankings, and the threat it poses are
 * different in each — a shared record would average two unrelated fights into
 * one meaningless number, and filtering by project would not narrow anything.
 */
export type CompetitorRecord = {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly type: CompetitorType;

  readonly projectId: string;
  readonly projectName: string;
  /** Our own domain in this fight, from the project roster. */
  readonly ourDomain: string;
  /** The project's market, so a rival is placed rather than abstract. */
  readonly market: string;
  readonly category: string;

  /** Index in the project's rival set — the join key to the keyword layer. */
  readonly rivalIndex: number;

  // --- Footprint (derived from the tracked keyword set) ------------------
  /** Keywords in the project's set that this rival ranks for. */
  readonly keywordFootprint: number;
  readonly rankingFootprint: RankingFootprint;
  /** Keywords both sides rank for. */
  readonly sharedKeywords: number;
  /** Keywords only they rank for. */
  readonly competitorOnly: number;
  /** Keywords only we rank for. */
  readonly ourOnly: number;
  /** Shared keywords where they out-rank us. */
  readonly theirWins: number;
  /** Shared keywords where we out-rank them. */
  readonly ourWins: number;
  /** Shared keywords within two places either way. */
  readonly closeContests: number;
  /** Share of the set's traffic ceiling they hold, 0-100. */
  readonly visibility: number;
  /** Our share of the same ceiling, 0-100. */
  readonly ourVisibility: number;
  readonly visibilityGap: number;
  /** Their mean position minus ours, across shared keywords. */
  readonly rankingGap: number;
  readonly averagePosition: number | null;
  readonly ourAveragePosition: number | null;
  /** Estimated monthly sessions their footprint earns. */
  readonly trafficEstimate: number;
  /** Estimated monthly sessions the gap is worth. */
  readonly trafficGap: number;
  /** Combined monthly searches behind the keywords they rank for. */
  readonly overlapVolume: number;

  // --- Their side of the picture ----------------------------------------
  /** Pages of theirs we have modelled. */
  readonly pageCount: number;
  /** Mean modelled depth of those pages, 0-100. */
  readonly contentDepth: number;
  /** Seeded authority-style score, 0-100. */
  readonly authority: number;
  /** Ids of their strongest pages, strongest first. */
  readonly strongestPageIds: readonly string[];
  /** Clusters they rank in, most keywords first. */
  readonly clusterIds: readonly string[];
  /** Clusters where they are the dominant rival. */
  readonly dominatedClusterIds: readonly string[];
  /** Intents they cover, strongest first. */
  readonly topIntents: readonly KeywordIntent[];
  /** Where they are weak, in plain language. */
  readonly weaknesses: readonly string[];

  // --- Scores -----------------------------------------------------------
  readonly strength: ScoreBreakdown;
  readonly threat: ScoreBreakdown;
  readonly threatLevel: ThreatLevel;
  readonly opportunity: ScoreBreakdown;
  /** Signed visibility movement over the window. */
  readonly momentum: MetricTrend;
  /** True where they are gaining ground fast enough to matter. */
  readonly gaining: boolean;

  /** One line stating what this rival is doing to this project. */
  readonly headline: string;
  /** Agent accountable for the response. */
  readonly owner: AgentId;
  /** Seeds every simulated figure for this record. */
  readonly seed: number;
};

// ---------------------------------------------------------------------------
// Keyword overlap
// ---------------------------------------------------------------------------

/**
 * One keyword, seen from one competitor's side.
 *
 * The keyword itself is referenced by id and read from the keyword registry —
 * nothing here copies a keyword record, so a volume shown in this module is
 * the volume the Keyword Intelligence module shows.
 */
export type OverlapRow = {
  readonly id: string;
  readonly competitorId: string;
  readonly competitorName: string;
  readonly competitorDomain: string;

  readonly keywordId: string;
  readonly keyword: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;
  readonly intent: KeywordIntent;

  readonly volume: number;
  readonly difficulty: number;
  readonly cpc: number;

  /** Our position, or null where we do not rank. */
  readonly ourPosition: number | null;
  /** Their position, or null where they do not rank. */
  readonly theirPosition: number | null;
  /** Their position minus ours. Positive means we are ahead. Null unless shared. */
  readonly rankGap: number | null;

  readonly overlap: OverlapType;
  /**
   * The state of the head-to-head, or null where there is no head-to-head.
   *
   * A term only we rank for is not a battle in any state — not even a won
   * one, since we may hold it at position 60 with nobody else in sight.
   * Nullable rather than given a seventh label, so every consumer has to
   * decide what an uncontested term means for it instead of silently counting
   * it as a win.
   */
  readonly battle: BattleState | null;

  /** The page of ours that targets this keyword, if there is one. */
  readonly ourUrl: string | null;
  readonly ourContentId: string | null;
  /** The page of theirs that ranks, where they rank at all. */
  readonly theirPageId: string | null;
  readonly theirUrl: string | null;

  /** Estimated monthly sessions on the table, at a realistic target. */
  readonly trafficAtStake: number;
  /** 0-100. Higher is a better keyword to fight for. */
  readonly opportunity: number;
  readonly owner: AgentId;
};

// ---------------------------------------------------------------------------
// Competitor pages
// ---------------------------------------------------------------------------

/**
 * A page of theirs, modelled from the keywords it ranks for.
 *
 * Seeded: we do not crawl anybody. The keywords are canonical, the grouping is
 * by cluster and seeded split, and the URL is built from their domain and the
 * cluster's own vocabulary so it reads like a page rather than a hash.
 */
export type CompetitorPage = {
  readonly id: string;
  readonly competitorId: string;
  readonly competitorName: string;
  readonly domain: string;
  readonly url: string;
  readonly title: string;

  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;
  readonly intent: KeywordIntent;

  readonly keywordIds: readonly string[];
  readonly keywordCount: number;
  /** The terms this page wins on, best position first. */
  readonly topKeywords: readonly {
    readonly id: string;
    readonly keyword: string;
    readonly position: number;
    readonly volume: number;
    /** Our position on the same term, or null. */
    readonly ourPosition: number | null;
  }[];

  readonly totalVolume: number;
  readonly bestPosition: number;
  readonly averagePosition: number;
  readonly estimatedTraffic: number;
  /** Seeded word count for the page. */
  readonly wordCount: number;
  /** Modelled depth of coverage, 0-100. */
  readonly contentDepth: number;

  readonly strength: number;
  readonly threatScore: number;
  readonly threatLevel: ThreatLevel;
  readonly opportunity: number;

  /** The page of ours competing with it, where one exists. */
  readonly ourContentId: string | null;
  readonly ourContentTitle: string | null;
  readonly ourUrl: string | null;
  /** Our content score on that page, or null where we have no page. */
  readonly ourScore: number | null;

  /** What to do about this page. */
  readonly response: string;
  readonly owner: AgentId;
};

// ---------------------------------------------------------------------------
// Clusters and intent
// ---------------------------------------------------------------------------

/** One rival's presence inside one cluster. */
export type ClusterRival = {
  readonly competitorId: string;
  readonly name: string;
  readonly domain: string;
  readonly keywords: number;
  readonly topTen: number;
  readonly averagePosition: number | null;
  readonly pages: number;
  /** 0-100 reading of how firmly they hold this cluster. */
  readonly strength: number;
};

/**
 * A cluster as a contested topic.
 *
 * Our side of it is read from the canonical cluster record and the content
 * inventory — coverage, the pillar, the supporting pages — so this view and
 * the cluster workspace never disagree about what we have built.
 */
export type ClusterBattleground = {
  readonly clusterId: string;
  readonly clusterName: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly intent: KeywordIntent;

  readonly keywordCount: number;
  readonly totalVolume: number;

  /** Keywords in the cluster we rank for. */
  readonly ourKeywords: number;
  readonly ourTopTen: number;
  readonly ourAveragePosition: number | null;
  /** Cluster coverage from the keyword layer, 0-100. */
  readonly coverage: number;
  /** Pages we have published into the cluster. */
  readonly ourPages: number;
  readonly hasPillar: boolean;
  readonly supportingPages: number;
  readonly ourStrength: number;

  readonly rivals: readonly ClusterRival[];
  /** The rival holding the cluster, or null where nobody does. */
  readonly dominant: ClusterRival | null;
  readonly sharedKeywords: number;
  readonly state: DominanceState;
  /** Their strength minus ours, -100 to 100. */
  readonly dominanceGap: number;
  readonly opportunity: number;

  readonly action: string;
  readonly owner: AgentId;
};

/** How we and the rivals compare on one search intent. */
export type IntentBattleground = {
  readonly intent: KeywordIntent;
  readonly keywordCount: number;
  readonly totalVolume: number;

  readonly ourRanking: number;
  readonly ourTopTen: number;
  readonly ourAveragePosition: number | null;
  /** Pages of ours whose format actually fits this intent. */
  readonly ourAlignedPages: number;
  readonly ourPages: number;

  readonly rivals: readonly {
    readonly competitorId: string;
    readonly name: string;
    readonly domain: string;
    readonly ranking: number;
    readonly topTen: number;
    readonly averagePosition: number | null;
    readonly share: number;
  }[];
  readonly leader: {
    readonly competitorId: string;
    readonly name: string;
    readonly domain: string;
  } | null;

  /** Our share of the intent's ranking positions, 0-100. */
  readonly ourShare: number;
  /** True where rivals hold the intent and we barely appear. */
  readonly mismatch: boolean;
  readonly note: string;
  readonly owner: AgentId;
};

// ---------------------------------------------------------------------------
// Gaps, threats, opportunities
// ---------------------------------------------------------------------------

/** A place a rival covers something we do not. */
export type CompetitorGap = {
  readonly id: string;
  readonly kind: CompetitorGapKind;
  readonly severity: Priority;

  readonly competitorId: string;
  readonly competitorName: string;
  readonly competitorDomain: string;
  readonly projectId: string;
  readonly projectName: string;

  readonly keywordId: string | null;
  readonly keyword: string | null;
  readonly clusterId: string;
  readonly clusterName: string;
  readonly intent: KeywordIntent;

  readonly volume: number;
  readonly difficulty: number;
  /** Estimated monthly sessions the gap is worth. */
  readonly value: number;

  readonly theirPageId: string | null;
  readonly theirUrl: string | null;
  readonly theirPosition: number | null;
  readonly ourContentId: string | null;
  readonly ourUrl: string | null;
  readonly ourPosition: number | null;

  readonly finding: string;
  readonly action: string;
  readonly owner: AgentId;
  readonly score: number;
};

/** A competitive movement worth reacting to. */
export type SerpThreat = {
  readonly id: string;
  readonly kind: ThreatKind;
  readonly severity: Priority;
  readonly score: number;

  readonly competitorId: string;
  readonly competitorName: string;
  readonly competitorDomain: string;
  readonly projectId: string;
  readonly projectName: string;

  readonly keywordId: string | null;
  readonly keyword: string | null;
  readonly clusterId: string | null;
  readonly clusterName: string | null;
  readonly theirPageId: string | null;
  readonly theirUrl: string | null;
  readonly ourContentId: string | null;
  readonly ourUrl: string | null;

  readonly volume: number;
  /** Estimated monthly sessions at risk. */
  readonly valueAtRisk: number;

  readonly headline: string;
  /** Why this is a threat, in one sentence, with the evidence in it. */
  readonly rationale: string;
  readonly response: string;
  readonly owner: AgentId;
};

/** Prioritised work, with the competitive reason it exists. */
export type CompetitorOpportunity = {
  readonly id: string;
  readonly kind: OpportunityKind;
  readonly score: number;
  readonly priority: Priority;

  readonly competitorId: string;
  readonly competitorName: string;
  readonly competitorDomain: string;
  readonly projectId: string;
  readonly projectName: string;

  readonly keywordId: string | null;
  readonly keyword: string | null;
  readonly clusterId: string | null;
  readonly clusterName: string | null;
  readonly intent: KeywordIntent;

  /** The page of ours the work lands on, where one exists. */
  readonly contentId: string | null;
  readonly url: string | null;
  /** The page of theirs the work is aimed at. */
  readonly theirPageId: string | null;
  readonly theirUrl: string | null;

  readonly volume: number;
  /** Estimated monthly sessions the work would earn. */
  readonly value: number;
  readonly difficulty: Level;
  /** How confident the reading is, 0-100. */
  readonly confidence: number;

  readonly action: string;
  readonly rationale: string;
  readonly owner: AgentId;
};

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

/** One row of the comparison table. */
export type CompareDimension = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** How the value should be rendered. */
  readonly format: "number" | "compact" | "percent" | "position" | "score";
  /** Set where a lower value is the better one. */
  readonly lowerIsBetter?: boolean;
  readonly provenance: Provenance;
  /** Our reading, or null where the dimension does not apply to us. */
  readonly ours: number | null;
  /** Each selected competitor's reading, keyed by competitor id. */
  readonly values: Readonly<Record<string, number | null>>;
};

/** The comparison as the workspace shows it. */
export type CompareResult = {
  readonly projectId: string;
  readonly projectName: string;
  readonly ourName: string;
  readonly ourDomain: string;
  readonly competitors: readonly CompetitorRecord[];
  readonly dimensions: readonly CompareDimension[];
};

// ---------------------------------------------------------------------------
// Readings of the set
// ---------------------------------------------------------------------------

/** A summary tile above the workspace. */
export type CompetitorMetric = {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted for display. */
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly trend?: MetricTrend;
};

/** A prioritised card on the overview — a finding with a next step. */
export type CompetitorHighlight = {
  readonly id: string;
  readonly kind: "threat" | "opportunity" | "gap" | "cluster";
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly competitorId: string | null;
  readonly competitorName: string | null;
  readonly value: string;
  readonly severity: Priority;
  readonly owner: AgentId;
  /** Where the card leads, inside this module. */
  readonly tab: string;
};

/** Everything the detail workspace needs for one competitor. */
export type CompetitorDetail = {
  readonly record: CompetitorRecord;
  readonly overlap: readonly OverlapRow[];
  readonly pages: readonly CompetitorPage[];
  readonly clusters: readonly ClusterBattleground[];
  readonly gaps: readonly CompetitorGap[];
  readonly threats: readonly SerpThreat[];
  readonly opportunities: readonly CompetitorOpportunity[];
  readonly metrics: readonly CompetitorMetric[];
  /** The same rival in our other projects, where it competes there too. */
  readonly alsoIn: readonly CompetitorRecord[];
  /** The other rivals in this project, strongest first. */
  readonly siblings: readonly CompetitorRecord[];
  readonly generatedAt: string;
};
