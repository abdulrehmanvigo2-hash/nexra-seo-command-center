/**
 * Shapes for the Content Studio module (CLAUDE.md §14, Phase 6).
 *
 * One vocabulary in this product, not several. `SearchIntent`, `AgentId`, and
 * `Priority` come from the shared unions; a content record's keywords, cluster,
 * project, and intent are the ones the Keyword Intelligence module already
 * holds, referenced by id rather than restated. Nothing here re-declares what
 * a keyword or a cluster is.
 *
 * A content record is not authored anywhere. It is what the canonical keyword
 * layer already implies: the pages our keywords point at, plus the pages those
 * keywords say are missing. `src/lib/mock/content/records.ts` performs that
 * derivation and is the single source of truth for a content record; briefs,
 * scores, recommendations, coverage, gaps, links, and the workflow board are
 * readings of it.
 *
 * Everything typed here is a fixture. There is no CMS, no editor backend, no
 * publishing API, and no live page crawl in this milestone (CLAUDE.md §4).
 */
import type { IconName } from "@/components/icons";
import type { BadgeTone, Priority, Status } from "@/components/ui/badge";
import type { MeterTone } from "@/components/ui/meter";
import type { MetricHealth, MetricTrend } from "@/types/dashboard";
import type { AgentId, KeywordIntent } from "@/types/keyword";

export type { AgentId, KeywordIntent, MetricTrend, Priority };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Where a piece sits in the production pipeline.
 *
 * The first six are work in progress; `published` is the only stage a piece
 * with a live URL can be in. A published page's *condition* is a separate
 * reading — see `ContentHealth` — because "published" and "decaying" are
 * answers to different questions.
 */
export type ContentStage =
  | "idea"
  | "brief"
  | "draft"
  | "review"
  | "approved"
  | "scheduled"
  | "published";

/** How a published page is actually doing. */
export type ContentHealth =
  | "performing"
  | "steady"
  | "needs-refresh"
  | "decaying"
  | "not-ranking"
  | "unmeasured";

/** What kind of page it is. Decided by the URL and the intent it serves. */
export type ContentFormat =
  | "guide"
  | "comparison"
  | "landing"
  | "product"
  | "location"
  | "article"
  | "resource"
  | "tool";

/** A piece's place in its cluster. */
export type ContentRole = "pillar" | "supporting";

/** Band a 0-100 content score is read in. */
export type ContentScoreBand = "excellent" | "good" | "fair" | "poor";

/** Whether a page's format matches what its keywords are asking for. */
export type IntentAlignment = "aligned" | "partial" | "mismatched";

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type ContentScoreFactorId =
  | "keyword-coverage"
  | "search-intent"
  | "ranking"
  | "depth"
  | "on-page"
  | "internal-links"
  | "freshness"
  | "answer-readiness";

/** One weighted input to a content score, published with its arithmetic. */
export type ContentScoreFactor = {
  readonly id: ContentScoreFactorId;
  readonly label: string;
  /** The factor's own reading, 0-100. */
  readonly value: number;
  /** Share of the score this factor carries. The weights sum to 1. */
  readonly weight: number;
  /** `value × weight`, rounded to one decimal. */
  readonly contribution: number;
  /** Why the factor reads the way it does. */
  readonly detail: string;
};

/**
 * The Nexra content score.
 *
 * A published, weighted sum over the mock dataset — arithmetic, not a model,
 * and the UI says so wherever the number appears.
 */
export type ContentScore = {
  readonly score: number;
  readonly band: ContentScoreBand;
  readonly factors: readonly ContentScoreFactor[];
  /** One line naming what carries the score and what holds it back. */
  readonly summary: string;
};

// ---------------------------------------------------------------------------
// On-page recommendations
// ---------------------------------------------------------------------------

export type OnPageCheckId =
  | "title-tag"
  | "meta-description"
  | "h1"
  | "heading-structure"
  | "keyword-placement"
  | "intent-match"
  | "word-count"
  | "internal-links-out"
  | "internal-links-in"
  | "image-alt"
  | "schema"
  | "answer-block"
  | "entity-coverage"
  | "freshness"
  | "cta";

/** Frontend-only state for a recommendation acted on in this session. */
export type RecommendationState = "open" | "accepted" | "dismissed" | "done";

/** One on-page finding against a page, with the fix and who owns it. */
export type OnPageRecommendation = {
  readonly id: string;
  readonly contentId: string;
  readonly contentTitle: string;
  readonly check: OnPageCheckId;
  readonly severity: Priority;
  /** What was found. */
  readonly finding: string;
  /** What to do about it. */
  readonly action: string;
  /** Points this would add to the content score if fixed. */
  readonly scoreImpact: number;
  readonly owner: AgentId;
};

// ---------------------------------------------------------------------------
// Answer engines
// ---------------------------------------------------------------------------

/**
 * How ready a page is to be quoted by a generative answer engine.
 *
 * Every reading is derived from the answer-engine signals the keyword layer
 * already holds for the keywords this page targets — there is no second AEO
 * dataset, and no live generative-engine check in this milestone.
 */
export type ContentAeoSignal = {
  /** Whether the page answers its questions in a quotable way, 0-100. */
  readonly answerReadiness: number;
  /** How likely a generated answer is to cite it, 0-100. */
  readonly citationLikelihood: number;
  /** Entity coverage held against what the topic needs, 0-100. */
  readonly entityCoverage: number;
  /** Share of the page's question keywords it answers directly, 0-100. */
  readonly questionCoverage: number;
  /** Structured-data completeness for the format, 0-100. */
  readonly structuredData: number;
  /** Keywords on this page where a generated answer runs. */
  readonly aiKeywords: number;
  /** Of those, how many cite the brand today. */
  readonly citedKeywords: number;
  /** Overall band. */
  readonly health: MetricHealth;
  readonly summary: string;
};

// ---------------------------------------------------------------------------
// Internal linking
// ---------------------------------------------------------------------------

export type InternalLinkKind =
  | "pillar-uplift"
  | "cluster-support"
  | "authority-flow"
  | "orphan-rescue"
  | "cannibalisation-fix";

/** Frontend-only state for a link opportunity acted on in this session. */
export type LinkState = "open" | "planned" | "dismissed";

/** A suggested link from one page to another, with the reason for it. */
export type InternalLinkOpportunity = {
  readonly id: string;
  readonly kind: InternalLinkKind;
  readonly fromId: string;
  readonly fromTitle: string;
  readonly fromUrl: string;
  readonly toId: string;
  readonly toTitle: string;
  readonly toUrl: string | null;
  /** Anchor text drawn from the target's own keyword. */
  readonly anchor: string;
  /** Why this link is worth adding. */
  readonly reason: string;
  /** How much it would help, 0-100. */
  readonly strength: number;
  readonly projectId: string;
  readonly projectName: string;
  readonly owner: AgentId;
};

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

/** One heading in a brief's outline. */
export type BriefSection = {
  readonly id: string;
  readonly heading: string;
  readonly level: 2 | 3;
  /** What the section has to do. */
  readonly purpose: string;
  /** Keywords the section is meant to carry. */
  readonly keywords: readonly string[];
  readonly wordTarget: number;
};

/** A source the Research & Evidence agent attached to a brief. */
export type BriefSource = {
  readonly id: string;
  readonly label: string;
  readonly kind: "study" | "standard" | "market-data" | "internal" | "guidance";
  readonly note: string;
};

/**
 * The instruction a writer works from.
 *
 * Derived from the piece's keywords, its cluster, and the rivals already
 * ranking for them; the outline follows the format and the questions the
 * keyword set is asking.
 */
export type ContentBrief = {
  readonly id: string;
  readonly contentId: string;
  readonly title: string;
  readonly format: ContentFormat;
  readonly primaryKeyword: string;
  readonly primaryKeywordId: string;
  readonly intent: KeywordIntent;
  readonly secondaryKeywords: readonly {
    readonly id: string;
    readonly keyword: string;
    readonly volume: number;
  }[];
  readonly searchIntentNote: string;
  readonly audience: string;
  readonly angle: string;
  readonly wordTarget: number;
  readonly outline: readonly BriefSection[];
  /** Entities the page has to cover to read as authoritative. */
  readonly entities: readonly string[];
  /** Questions the result page is asking that the piece must answer. */
  readonly questions: readonly string[];
  /** Pages to beat, from the project's own competitor set. */
  readonly competitors: readonly {
    readonly name: string;
    readonly domain: string;
    readonly position: number;
  }[];
  readonly sources: readonly BriefSource[];
  /** Internal links the brief requires. */
  readonly internalLinks: readonly {
    readonly toId: string;
    readonly toTitle: string;
    readonly anchor: string;
  }[];
  readonly callToAction: string;
  readonly owner: AgentId;
  readonly writer: AgentId;
  readonly stage: ContentStage;
  /** ISO 8601. */
  readonly dueAt: string;
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// The content record
// ---------------------------------------------------------------------------

/**
 * One piece of content: a page that exists, or one the keyword set says
 * should.
 *
 * Its keywords, cluster, project, and intent are the canonical records'; the
 * ids are held here and resolved from the keyword layer, so a position or a
 * volume can never disagree between the two modules.
 */
export type ContentRecord = {
  readonly id: string;
  readonly title: string;
  /** The live page, or null where the piece has not been published. */
  readonly url: string | null;
  readonly format: ContentFormat;
  readonly role: ContentRole;
  readonly stage: ContentStage;
  readonly health: ContentHealth;
  /** Lifecycle state, in the product's shared vocabulary. */
  readonly status: Status;

  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;

  /** Keywords this page is meant to rank for, best opportunity first. */
  readonly keywordIds: readonly string[];
  readonly keywordCount: number;
  /**
   * The keyword the piece is built to win, or null.
   *
   * Null is a real state, not a missing value: a hub page that exists with no
   * keyword mapped to it is one of the findings this module is for.
   */
  readonly primaryKeywordId: string | null;
  readonly primaryKeyword: string | null;
  /** Falls back to the cluster's own leading intent where nothing is mapped. */
  readonly primaryIntent: KeywordIntent;
  /** Intents present across the page's keywords. */
  readonly intents: readonly KeywordIntent[];
  readonly intentAlignment: IntentAlignment;
  /** Why the alignment reads the way it does. */
  readonly intentNote: string;

  /** Combined monthly searches across the page's keywords. */
  readonly totalVolume: number;
  /** Best position the page holds, or null where none of its keywords rank. */
  readonly bestPosition: number | null;
  /** Mean position across the keywords that rank, or null. */
  readonly averagePosition: number | null;
  /** Mean places gained across the page's keywords this window. */
  readonly positionChange: number;
  readonly keywordsInTopTen: number;
  /** Estimated monthly sessions at today's positions. */
  readonly traffic: number;
  /** Estimated monthly sessions at realistic target positions. */
  readonly trafficPotential: number;
  /** The traffic gap priced at the keywords' listed cost per click. */
  readonly opportunityValue: number;

  readonly score: ContentScore;
  readonly aeo: ContentAeoSignal;

  readonly wordCount: number;
  /** Minutes, at 230 words a minute. */
  readonly readingTime: number;
  /** Ids of the pages this one currently links to. */
  readonly linksTo: readonly string[];
  /** Links out of this page to other pages of ours. */
  readonly internalLinksOut: number;
  /** Links into this page from other pages of ours. */
  readonly internalLinksIn: number;

  /** Whether another page of ours competes with this one. */
  readonly cannibalised: boolean;
  /** Keywords this page ranks for that it was never built to serve. */
  readonly unintendedKeywordIds: readonly string[];

  /**
   * Rework in flight against a live page, or null where none is needed.
   *
   * A refresh is not a second record — it is this page, with work queued
   * against it, which is what most of an editorial pipeline actually holds.
   */
  readonly refresh: {
    readonly stage: Exclude<ContentStage, "published">;
    readonly reason: string;
    readonly owner: AgentId;
    /** ISO 8601. */
    readonly dueAt: string;
  } | null;

  readonly owner: AgentId;
  readonly writer: AgentId;
  /** ISO 8601, or null where the piece is not published. */
  readonly publishedAt: string | null;
  readonly updatedAt: string;
  /** Days since the page was last touched, or null where unpublished. */
  readonly ageDays: number | null;
  /** Seeds every derived figure for this piece. */
  readonly seed: number;
};

// ---------------------------------------------------------------------------
// Readings of the inventory
// ---------------------------------------------------------------------------

/** A summary tile above the inventory. */
export type ContentMetric = {
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

/**
 * One thing on the workflow board.
 *
 * Either a piece being written for the first time, or rework queued against a
 * page that is already live. Both are jobs somebody has to do, and a board
 * that showed only the first would misrepresent the work.
 */
export type WorkflowItem = {
  readonly id: string;
  readonly kind: "new" | "refresh";
  readonly stage: ContentStage;
  readonly record: ContentRecord;
  readonly owner: AgentId;
  /** ISO 8601. */
  readonly dueAt: string;
  /** Why this item is on the board. */
  readonly note: string;
};

/** One column of the workflow board. */
export type WorkflowColumn = {
  readonly stage: ContentStage;
  readonly label: string;
  readonly description: string;
  readonly tone: BadgeTone;
  readonly items: readonly WorkflowItem[];
  /** Combined monthly searches waiting in this stage. */
  readonly volume: number;
};

/** How well one keyword maps onto the content serving it. */
export type MappingQuality = "primary" | "secondary" | "planned" | "split";

/** How one keyword maps onto the content that serves it. */
export type KeywordMappingRow = {
  readonly keywordId: string;
  readonly keyword: string;
  readonly intent: KeywordIntent;
  readonly volume: number;
  readonly position: number | null;
  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;
  /** The content serving it, or null where nothing does. */
  readonly contentId: string | null;
  readonly contentTitle: string | null;
  readonly contentUrl: string | null;
  readonly stage: ContentStage | null;
  readonly quality: MappingQuality;
  readonly note: string;
};

/** Content coverage of one topic cluster. */
export type ClusterCoverageRow = {
  readonly clusterId: string;
  readonly clusterName: string;
  readonly parentTopic: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly keywordCount: number;
  readonly totalVolume: number;
  /** Pieces serving the cluster, published or not. */
  readonly pieces: number;
  readonly published: number;
  readonly inProgress: number;
  /** Share of the cluster's keywords with a piece behind them, 0-100. */
  readonly coverage: number;
  /** Mean content score across the cluster's published pieces, 0-100. */
  readonly averageScore: number;
  /** Keywords with nothing serving them. */
  readonly gaps: number;
  readonly hasPillar: boolean;
  readonly pillarId: string | null;
  readonly owner: AgentId;
  readonly nextAction: string;
};

/** How one intent is served across the inventory. */
export type IntentAlignmentRow = {
  readonly intent: KeywordIntent;
  readonly keywordCount: number;
  readonly pieces: number;
  readonly aligned: number;
  readonly partial: number;
  readonly mismatched: number;
  readonly volume: number;
  /** Share of pieces on this intent that are aligned, 0-100. */
  readonly alignmentRate: number;
  /** The format this intent calls for. */
  readonly expectedFormat: ContentFormat;
};

export type ContentGapKind =
  | "no-page"
  | "thin"
  | "outdated"
  | "competitor-only"
  | "no-pillar";

/** A missing or under-served piece worth commissioning. */
export type ContentGapOpportunity = {
  readonly id: string;
  readonly kind: ContentGapKind;
  readonly title: string;
  readonly clusterId: string;
  readonly clusterName: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly keywordId: string;
  readonly keyword: string;
  readonly intent: KeywordIntent;
  readonly volume: number;
  readonly difficulty: number;
  readonly opportunityScore: number;
  readonly suggestedFormat: ContentFormat;
  readonly trafficPotential: number;
  /** The rival already serving the query, where there is one. */
  readonly competitor: string | null;
  readonly reason: string;
  readonly owner: AgentId;
  /** The content record for the planned piece, where one exists. */
  readonly contentId: string | null;
};

/** Everything one piece's workspace renders. */
export type ContentDetail = {
  readonly record: ContentRecord;
  /** Null where no keyword is mapped, so there is nothing to brief against. */
  readonly brief: ContentBrief | null;
  readonly recommendations: readonly OnPageRecommendation[];
  readonly linksOut: readonly InternalLinkOpportunity[];
  readonly linksIn: readonly InternalLinkOpportunity[];
  /** Other pieces in the same cluster. */
  readonly siblings: readonly ContentRecord[];
  /** The pillar of this piece's cluster, where it is not the pillar. */
  readonly pillar: ContentRecord | null;
  /** Pages of ours competing with this one for its own keywords. */
  readonly competing: readonly ContentRecord[];
  readonly metrics: readonly ContentMetric[];
  readonly generatedAt: string;
};

/** Presentation for a score band. */
export type ScoreBandMeta = {
  readonly label: string;
  readonly range: string;
  readonly tone: BadgeTone;
  readonly meter: MeterTone;
  readonly description: string;
};
