/**
 * Shapes for the Command Center dashboard (CLAUDE.md §14, Phase 2).
 *
 * `src/types/seo.ts` owns the portfolio-wide vocabulary every module shares.
 * This file owns the shapes only the dashboard produces, and re-uses that
 * vocabulary rather than restating it: `MetricTrend` for deltas, `Priority` /
 * `Status` so a fixture drops straight into a badge, `AgentId` for the twelve
 * agents, and `NavHref` so anything pointing at a module points at a real
 * route.
 *
 * Everything typed here is served by `src/lib/mock/dashboard` — fixtures, not
 * live data (CLAUDE.md §4).
 */
import type { IconName } from "@/components/icons";
import type { Priority, Status } from "@/components/ui/badge";
import type { NavHref } from "@/config/navigation";
import type { AgentId, Level, MetricTrend, SearchIntent } from "@/types/seo";

export type { AgentId, Level, MetricTrend, Priority, SearchIntent, Status };

// ---------------------------------------------------------------------------
// Selection: which project, over which window
// ---------------------------------------------------------------------------

/**
 * Ids of the selectable projects.
 *
 * The records themselves live in `src/lib/mock/projects/roster.ts`, which both
 * this module and the Projects module read — there is one project roster in
 * the product, not one per module.
 */
export type ProjectId =
  | "portfolio"
  | "halcyon-fintech"
  | "verdant-home"
  | "fieldnote-media"
  | "orbit-logistics"
  | "meridian-clinics"
  | "skyline-outdoors"
  | "northgate-legal"
  | "atlas-industrial"
  | "cobalt-ridge";

export type DashboardProject = {
  readonly id: ProjectId;
  readonly name: string;
  readonly domain: string;
  readonly industry: string;
  /** Two-letter monogram for the selector chip. */
  readonly initials: string;
  /** True for the roll-up across every project. */
  readonly portfolio: boolean;
  /** Relative size. Every derived volume metric is multiplied by this. */
  readonly scale: number;
  /** Signed shift applied to every 0-100 score for this project. */
  readonly healthOffset: number;
  /** Seeds the deterministic generator, so a project's numbers are its own. */
  readonly seed: number;
};

export type RangeId = "7d" | "30d" | "3m" | "6m" | "12m";

export type DateRange = {
  readonly id: RangeId;
  /** Control label, e.g. "30D". */
  readonly label: string;
  /** Long form, e.g. "Last 30 days". */
  readonly caption: string;
  readonly days: number;
  /** Number of plotted buckets. */
  readonly points: number;
  readonly bucket: "day" | "week" | "month";
  /** Wording for the comparison window, e.g. "vs previous 30 days". */
  readonly comparison: string;
};

// ---------------------------------------------------------------------------
// Headline metrics
// ---------------------------------------------------------------------------

/** How a metric is doing, independent of which way its number moved. */
export type MetricHealth = "positive" | "neutral" | "warning" | "negative";

export type ScoreId =
  | "seo-health"
  | "organic-visibility"
  | "technical-health"
  | "content-performance"
  | "authority"
  | "ai-visibility";

/** One 0-100 index in the health strip. */
export type ScoreCardData = {
  readonly id: ScoreId;
  readonly label: string;
  readonly score: number;
  readonly trend: MetricTrend;
  readonly health: MetricHealth;
  readonly icon: IconName;
  /** Shown in the card tooltip — what the score is built from. */
  readonly explanation: string;
};

export type KpiId =
  | "organic-traffic"
  | "traffic-value"
  | "conversions"
  | "ranking-keywords"
  | "top-3"
  | "top-10"
  | "top-100"
  | "indexed-pages";

/** One headline number, with the sparkline behind it. */
export type KpiCardData = {
  readonly id: KpiId;
  readonly label: string;
  /** Pre-formatted for display. */
  readonly value: string;
  readonly unit?: string;
  readonly trend: MetricTrend;
  readonly comparison: string;
  readonly health: MetricHealth;
  readonly icon: IconName;
  readonly explanation: string;
  /** Raw values behind the mini trend line, oldest first. */
  readonly spark: readonly number[];
  /** One line of supporting detail under the value. */
  readonly footnote?: string;
};

// ---------------------------------------------------------------------------
// Performance trend
// ---------------------------------------------------------------------------

export type SeriesMetricId =
  | "organicTraffic"
  | "organicKeywords"
  | "searchVisibility"
  | "conversions";

export type TrendPoint = {
  /** ISO 8601 date of the bucket start. */
  readonly date: string;
  /** Pre-formatted axis label for the bucket. */
  readonly label: string;
  readonly organicTraffic: number;
  readonly organicKeywords: number;
  /** Search visibility index, 0-100. */
  readonly searchVisibility: number;
  readonly conversions: number;
};

export type TrendSeries = {
  readonly range: DateRange;
  readonly current: readonly TrendPoint[];
  /** Same bucket count, one window earlier — the comparison line. */
  readonly previous: readonly TrendPoint[];
  /** Sum for count metrics, mean for index metrics. */
  readonly totals: Readonly<Record<SeriesMetricId, number>>;
  /** Percentage change of each total against the previous window. */
  readonly deltas: Readonly<Record<SeriesMetricId, number>>;
};

// ---------------------------------------------------------------------------
// Agent operations
// ---------------------------------------------------------------------------

/**
 * Operational state of an agent. Distinct from the lifecycle `Status` used by
 * a task: this describes the agent, not a single run. Each value maps onto a
 * `Status` for rendering, so the badge vocabulary is not duplicated.
 */
export type AgentOpsStatus =
  | "active"
  | "working"
  | "waiting"
  | "completed"
  | "needs-review"
  | "blocked";

export type AgentOperation = {
  readonly agent: AgentId;
  readonly name: string;
  /** Short description of what the agent owns. */
  readonly discipline: string;
  readonly status: AgentOpsStatus;
  readonly currentTask: string;
  /** Completion of the current task, 0-100. */
  readonly progress: number;
  /** ISO 8601 timestamp of the last recorded action. */
  readonly lastActivity: string;
  /** Artifacts produced in the selected window. */
  readonly outputs: number;
  /** What those artifacts are, e.g. "briefs". */
  readonly outputLabel: string;
  /** Tasks queued behind the current one. */
  readonly queue: number;
  /** True where a human decision is needed before the agent can continue. */
  readonly attention: boolean;
  /** Position in the orchestration loop (CLAUDE.md §13), 1-12. */
  readonly stage: number;
  readonly project: string;
};

// ---------------------------------------------------------------------------
// Priority actions
// ---------------------------------------------------------------------------

export type ActionArea =
  | "technical"
  | "content"
  | "keywords"
  | "on-page"
  | "authority"
  | "ai-visibility"
  | "competitors";

/** Local workflow state. Changing it is frontend-only in this milestone. */
export type ActionState = "open" | "in-review" | "scheduled";

export type PriorityAction = {
  readonly id: string;
  readonly priority: Priority;
  readonly title: string;
  readonly area: ActionArea;
  /** What the issue touches, e.g. "412 product pages". */
  readonly affected: string;
  /** Pre-formatted expected gain. */
  readonly impact: string;
  readonly impactLevel: Level;
  readonly effort: Level;
  readonly recommendation: string;
  readonly owner: AgentId;
  readonly state: ActionState;
  /** Verb on the primary control. */
  readonly cta: "Fix" | "Review" | "Open" | "View";
  /** Module that owns the follow-up — always a real route. */
  readonly module: NavHref;
};

// ---------------------------------------------------------------------------
// Alerts and risks
// ---------------------------------------------------------------------------

export type AlertSeverity = Priority;

export type DashboardAlert = {
  readonly id: string;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly detail: string;
  /** Metric that moved. */
  readonly metric: string;
  readonly change: MetricTrend;
  /** ISO 8601 timestamp. */
  readonly detectedAt: string;
  readonly module: NavHref;
  readonly project: string;
};

// ---------------------------------------------------------------------------
// Technical snapshot
// ---------------------------------------------------------------------------

export type CheckStatus = "healthy" | "warning" | "critical";

export type TechnicalCheck = {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted headline value, e.g. "18", "Valid", "94%". */
  readonly value: string;
  readonly status: CheckStatus;
  readonly detail: string;
};

export type CoreWebVital = {
  readonly id: "lcp" | "inp" | "cls";
  readonly label: string;
  readonly value: string;
  readonly target: string;
  readonly status: CheckStatus;
  /** Share of URLs passing this metric, 0-100. */
  readonly passRate: number;
};

export type TechnicalSnapshot = {
  /** Site health index, 0-100. */
  readonly score: number;
  readonly trend: MetricTrend;
  readonly crawledPages: number;
  /** ISO 8601 timestamp of the last completed crawl. */
  readonly lastCrawl: string;
  readonly checks: readonly TechnicalCheck[];
  readonly vitals: readonly CoreWebVital[];
};

// ---------------------------------------------------------------------------
// Keyword snapshot
// ---------------------------------------------------------------------------

export type RankBucketId = "top-3" | "4-10" | "11-20" | "21-50" | "51-100";

export type RankBucket = {
  readonly id: RankBucketId;
  readonly label: string;
  readonly count: number;
  /** Share of the tracked set, 0-100. */
  readonly share: number;
  /** Change in count against the previous window. */
  readonly change: number;
};

export type KeywordMovement = {
  readonly winners: number;
  readonly losers: number;
  readonly newRankings: number;
  readonly lostRankings: number;
  readonly averagePosition: number;
  readonly averagePositionTrend: MetricTrend;
  readonly opportunities: number;
};

export type KeywordSnapshotRow = {
  readonly id: string;
  readonly keyword: string;
  readonly intent: SearchIntent;
  readonly position: number;
  readonly previousPosition: number;
  readonly volume: number;
  /** Ranking difficulty, 0-100. */
  readonly difficulty: number;
  readonly url: string;
  readonly project: string;
};

export type KeywordSnapshot = {
  readonly tracked: number;
  readonly distribution: readonly RankBucket[];
  readonly movement: KeywordMovement;
  readonly rows: readonly KeywordSnapshotRow[];
};

// ---------------------------------------------------------------------------
// Content snapshot
// ---------------------------------------------------------------------------

export type ContentBucketId = "top" | "declining" | "opportunity" | "recent";

export type ContentPageState =
  | "published"
  | "decaying"
  | "needs-refresh"
  | "planned";

export type ContentPage = {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly bucket: ContentBucketId;
  readonly clicks: number;
  readonly impressions: number;
  /** Click-through rate, 0-100. */
  readonly ctr: number;
  readonly position: number;
  readonly conversions: number;
  readonly trend: MetricTrend;
  readonly state: ContentPageState;
  /** One line explaining why the page sits in this bucket. */
  readonly note: string;
};

export type ContentSnapshot = {
  readonly pages: readonly ContentPage[];
  readonly decayAlerts: number;
  readonly needsRefresh: number;
  readonly publishedInWindow: number;
  readonly opportunities: number;
};

// ---------------------------------------------------------------------------
// Competitor snapshot
// ---------------------------------------------------------------------------

export type CompetitorRow = {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  /** Share of visibility across the tracked keyword set, 0-100. */
  readonly visibility: number;
  /** Percentage of the tracked set they also rank for, 0-100. */
  readonly keywordOverlap: number;
  readonly estimatedTraffic: number;
  /** Keywords they rank for and this project does not. */
  readonly contentGaps: number;
  readonly trend: MetricTrend;
  /** True where they are taking share this window. */
  readonly gaining: boolean;
};

export type CompetitorSnapshot = {
  /** The tracked project itself, plotted alongside its rivals. */
  readonly self: {
    readonly name: string;
    readonly domain: string;
    readonly visibility: number;
    readonly estimatedTraffic: number;
    readonly trend: MetricTrend;
  };
  readonly rivals: readonly CompetitorRow[];
  readonly gapOpportunities: number;
  readonly sharedKeywords: number;
};

// ---------------------------------------------------------------------------
// Authority snapshot
// ---------------------------------------------------------------------------

export type LinkProspect = {
  readonly id: string;
  readonly domain: string;
  /** Domain authority indicator, 0-100. */
  readonly authority: number;
  readonly type: string;
  readonly relevance: Level;
  /** Pre-formatted value estimate, e.g. "$4.2k / mo". */
  readonly estimatedValue: string;
  readonly status: Status;
};

export type AuthoritySnapshot = {
  /** Authority score, 0-100. */
  readonly authorityScore: number;
  readonly authorityTrend: MetricTrend;
  readonly referringDomains: number;
  readonly referringDomainsTrend: MetricTrend;
  readonly totalBacklinks: number;
  readonly newLinks: number;
  readonly lostLinks: number;
  readonly toxicLinks: number;
  /** Share of links that are followed, 0-100. */
  readonly dofollowShare: number;
  readonly prospects: readonly LinkProspect[];
};

// ---------------------------------------------------------------------------
// AI search / GEO snapshot
// ---------------------------------------------------------------------------

export type AiEngineStatus = "strong" | "growing" | "emerging" | "at-risk";

export type AiEngineRow = {
  readonly id: string;
  readonly engine: string;
  /** Answer coverage across tracked prompts, 0-100. */
  readonly coverage: number;
  readonly citations: number;
  readonly mentions: number;
  readonly trend: MetricTrend;
  readonly status: AiEngineStatus;
};

export type AiVisibilitySnapshot = {
  /** Composite AI visibility score, 0-100. */
  readonly score: number;
  readonly trend: MetricTrend;
  /** Share of tracked prompts citing the brand as a source, 0-100. */
  readonly citationPresence: number;
  readonly brandMentions: number;
  readonly brandMentionsTrend: MetricTrend;
  /** Share of tracked prompts where the brand appears at all, 0-100. */
  readonly answerCoverage: number;
  /** Knowledge-graph entity strength, 0-100. */
  readonly entityStrength: number;
  readonly eligiblePages: number;
  readonly totalPages: number;
  readonly opportunities: number;
  readonly engines: readonly AiEngineRow[];
};

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export type ActivityCategory =
  | "agent"
  | "technical"
  | "content"
  | "ranking"
  | "competitor"
  | "authority"
  | "ai-visibility";

export type ActivityState = "success" | "info" | "warning" | "critical";

export type ActivityEvent = {
  readonly id: string;
  readonly category: ActivityCategory;
  readonly title: string;
  readonly detail: string;
  /** Agent responsible, where the event came from one. */
  readonly agent: AgentId | null;
  /** ISO 8601 timestamp. */
  readonly at: string;
  readonly state: ActivityState;
  readonly project: string;
};

// ---------------------------------------------------------------------------
// The assembled dashboard
// ---------------------------------------------------------------------------

/** Everything the Command Center renders for one project over one window. */
export type DashboardSnapshot = {
  readonly project: DashboardProject;
  readonly range: DateRange;
  /** ISO 8601 instant the fixtures represent. */
  readonly generatedAt: string;
  readonly scores: readonly ScoreCardData[];
  readonly kpis: readonly KpiCardData[];
  readonly trend: TrendSeries;
  readonly agents: readonly AgentOperation[];
  readonly actions: readonly PriorityAction[];
  readonly alerts: readonly DashboardAlert[];
  readonly technical: TechnicalSnapshot;
  readonly keywords: KeywordSnapshot;
  readonly content: ContentSnapshot;
  readonly competitors: CompetitorSnapshot;
  readonly authority: AuthoritySnapshot;
  readonly aiVisibility: AiVisibilitySnapshot;
  readonly activity: readonly ActivityEvent[];
};
