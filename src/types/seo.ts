/**
 * Shape definitions for every mock SEO dataset in the product.
 *
 * One file owns the vocabulary, so no module re-declares a metric, status,
 * level, or trend shape. The fixtures in `src/lib/mock/seo` are the only
 * values typed against these; there is no API, database, or fetching layer in
 * this milestone (CLAUDE.md §4).
 *
 * Three type-only imports point at modules that already own their unions
 * rather than restating them here:
 *  - `Priority` / `Status` from the badge primitive, so a fixture drops
 *    straight into `<PriorityBadge>` / `<StatusBadge>` with no mapping layer.
 *  - `IconName`, so a metric can name the glyph it displays with.
 *  - `NavHref`, so anything referring to a module refers to a real route.
 */
import type { IconName } from "@/components/icons";
import type { Priority, Status } from "@/components/ui/badge";
import type { NavHref } from "@/config/navigation";

export type { Priority, Status };

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/**
 * Signed change on a metric, structurally matching the `TrendIndicator` and
 * `StatCard` props so it can be handed to either without translation.
 */
export type MetricTrend = {
  /** Signed delta. Percent by default, absolute when `unit` is `absolute`. */
  readonly value: number;
  readonly unit?: "percent" | "absolute";
  /** Set where a decrease is the improvement — rank position, open issues. */
  readonly invert?: boolean;
};

/** Three-step rating, used wherever impact, effort, or relevance is graded. */
export type Level = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// 1. Project overview metrics
// ---------------------------------------------------------------------------

export type OverviewMetricId =
  | "seo-health"
  | "organic-traffic"
  | "keywords-tracked"
  | "ranking-growth"
  | "critical-issues"
  | "ai-visibility"
  | "backlink-growth"
  | "content-performance";

/** One headline number on the Command Center. Ready to render in a `StatCard`. */
export type OverviewMetric = {
  readonly id: OverviewMetricId;
  readonly label: string;
  /** Pre-formatted for display — formatting decisions stay with the metric. */
  readonly value: string;
  /** Short qualifier after the value, e.g. "sessions", "/ 100". */
  readonly unit?: string;
  readonly trend: MetricTrend;
  /** Comparison window the trend is measured against. */
  readonly comparison: string;
  readonly icon: IconName;
  /** One line of supporting context. */
  readonly detail: string;
};

// ---------------------------------------------------------------------------
// 2. Agent activity
// ---------------------------------------------------------------------------

/** The twelve specialist agents defined in CLAUDE.md §13. */
export type AgentId =
  | "seo-director"
  | "project-manager"
  | "market-intelligence"
  | "keyword-intent"
  | "content-strategist"
  | "research-evidence"
  | "writer"
  | "on-page-seo"
  | "technical-seo"
  | "ai-visibility"
  | "authority-backlink"
  | "analytics-learning";

/** A single unit of work carried out by an agent for a project. */
export type AgentTask = {
  readonly id: string;
  readonly agent: AgentId;
  readonly project: string;
  readonly task: string;
  readonly status: Status;
  /** Completion percentage, 0–100. */
  readonly progress: number;
  readonly priority: Priority;
  /** ISO 8601 timestamp, or null while the task is still queued. */
  readonly startedAt: string | null;
  /** ISO 8601 timestamp, or null until the task leaves the board. */
  readonly completedAt: string | null;
};

// ---------------------------------------------------------------------------
// 3. SEO opportunities
// ---------------------------------------------------------------------------

export type OpportunityType =
  | "content"
  | "technical"
  | "keyword"
  | "on-page"
  | "authority"
  | "ai-visibility";

/** A recommended action, ranked by what it returns against what it costs. */
export type SeoOpportunity = {
  readonly id: string;
  readonly title: string;
  readonly type: OpportunityType;
  readonly impact: Level;
  readonly effort: Level;
  readonly priority: Priority;
  /** Pre-formatted projected gain, e.g. "+8.4k sessions / mo". */
  readonly estimatedUpside: string;
  readonly project: string;
};

// ---------------------------------------------------------------------------
// 4. Technical issues
// ---------------------------------------------------------------------------

export type IssueCategory =
  | "crawlability"
  | "indexation"
  | "performance"
  | "structured-data"
  | "content"
  | "mobile"
  | "security";

export type IssueStatus =
  | "open"
  | "investigating"
  | "in-progress"
  | "monitoring"
  | "resolved";

/**
 * A site-health defect. `severity` reuses `Priority`: the two vocabularies are
 * the same four ranks, so they are not defined twice.
 */
export type TechnicalIssue = {
  readonly id: string;
  readonly issue: string;
  readonly severity: Priority;
  readonly affectedPages: number;
  readonly category: IssueCategory;
  readonly status: IssueStatus;
  readonly project: string;
};

// ---------------------------------------------------------------------------
// 5. Recent wins
// ---------------------------------------------------------------------------

/** A delivered result, with the module that produced it. */
export type RecentWin = {
  readonly id: string;
  readonly result: string;
  /** What moved, e.g. "Organic sessions". */
  readonly metric: string;
  /** By how much it moved. */
  readonly change: MetricTrend;
  /** ISO 8601 date. */
  readonly date: string;
  /** Route of the module this came from — always a real destination. */
  readonly module: NavHref;
  readonly project: string;
};

// ---------------------------------------------------------------------------
// 6. Keyword intelligence
// ---------------------------------------------------------------------------

export type SearchIntent =
  | "informational"
  | "commercial"
  | "transactional"
  | "navigational";

export type KeywordRow = {
  readonly id: string;
  readonly keyword: string;
  readonly intent: SearchIntent;
  /** Current average SERP position. */
  readonly position: number;
  /** Monthly search volume. */
  readonly volume: number;
  /** Ranking difficulty, 0–100. */
  readonly difficulty: number;
  /** Position movement. A decrease is an improvement, hence `invert`. */
  readonly trend: MetricTrend;
  /** Topic cluster this keyword belongs to. */
  readonly cluster: string;
  /** Composite prioritisation score, 0–100. */
  readonly opportunityScore: number;
};

// ---------------------------------------------------------------------------
// 7. Competitor snapshot
// ---------------------------------------------------------------------------

export type Competitor = {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  /** Share of visibility across the tracked keyword set, 0–100. */
  readonly visibility: number;
  /** Estimated monthly organic sessions. */
  readonly organicTraffic: number;
  /** Percentage of the tracked keyword set also ranked for, 0–100. */
  readonly keywordOverlap: number;
  /** Domain authority indicator, 0–100. */
  readonly authority: number;
  readonly trend: MetricTrend;
};

// ---------------------------------------------------------------------------
// 8. AI visibility
// ---------------------------------------------------------------------------

export type AiPlatformId =
  | "chatgpt"
  | "claude"
  | "perplexity"
  | "google-ai-overviews"
  | "gemini"
  | "copilot";

export type AiVisibilityStatus = "strong" | "growing" | "emerging" | "at-risk";

export type AiPlatformVisibility = {
  readonly id: AiPlatformId;
  readonly platform: string;
  /** Answer-presence score, 0–100. */
  readonly visibilityScore: number;
  /** Times the brand was named in an answer. */
  readonly mentions: number;
  /** Times the brand was cited as a source. */
  readonly citations: number;
  readonly trend: MetricTrend;
  readonly status: AiVisibilityStatus;
};

// ---------------------------------------------------------------------------
// 9. Backlinks and authority
// ---------------------------------------------------------------------------

export type BacklinkSummary = {
  readonly referringDomains: number;
  readonly newLinks: number;
  readonly lostLinks: number;
  /** Authority indicator, 0–100. */
  readonly authorityScore: number;
  readonly authorityTrend: MetricTrend;
  /** Window the counts cover, e.g. "Last 28 days". */
  readonly window: string;
};

export type LinkOpportunityType =
  | "digital-pr"
  | "guest-post"
  | "resource-page"
  | "unlinked-mention"
  | "broken-link";

export type OutreachStatus =
  | "prospect"
  | "contacted"
  | "negotiating"
  | "secured"
  | "declined";

export type LinkOpportunity = {
  readonly id: string;
  readonly domain: string;
  /** Domain authority indicator, 0–100. */
  readonly authority: number;
  readonly type: LinkOpportunityType;
  readonly relevance: Level;
  readonly priority: Priority;
  readonly status: OutreachStatus;
};

// ---------------------------------------------------------------------------
// 10. Analytics trend series
// ---------------------------------------------------------------------------

/** One day in the analytics series. No chart library yet — plain values. */
export type AnalyticsPoint = {
  /** ISO 8601 date. */
  readonly date: string;
  readonly organicTraffic: number;
  /** Keyword visibility index, 0–100. */
  readonly keywordVisibility: number;
  readonly conversions: number;
  /** AI answer visibility score, 0–100. */
  readonly aiVisibility: number;
};
