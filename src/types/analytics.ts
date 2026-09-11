/**
 * Shapes for the Analytics module (CLAUDE.md §14, Phase 11).
 *
 * Analytics measures what the other modules did. It owns no inventory of its
 * own: the time series is the Command Center's `TrendSeries`, the pages are
 * Content Studio's, the keywords are Keyword Intelligence's, and the work that
 * gets attributed is the opportunity queues Technical SEO, AI Visibility and
 * Backlinks already publish. Everything here is a reading over those.
 *
 * There is no analytics provider connected in this milestone (CLAUDE.md §4):
 * no GA4, no Search Console, no tag manager, no conversion feed. The series is
 * a deterministic fixture, and the UI says so.
 *
 * The claim this module is most at risk of overstating is **attribution**. An
 * agent completing a piece of work and a metric moving in the same window is an
 * association, not a cause, and nothing in this dataset can separate the two.
 * Every attribution record therefore carries its own confidence and states the
 * limit explicitly rather than implying a causal chain.
 */
import type { IconName } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";
import type {
  DateRange,
  MetricHealth,
  MetricTrend,
  RangeId,
  SeriesMetricId,
  TrendPoint,
} from "@/types/dashboard";
import type { AgentId } from "@/types/keyword";

export type {
  AgentId,
  DateRange,
  MetricHealth,
  MetricTrend,
  RangeId,
  SeriesMetricId,
  TrendPoint,
};

// ---------------------------------------------------------------------------
// Provenance and confidence
// ---------------------------------------------------------------------------

/**
 * Where an analytics figure came from.
 *
 * `series` — read from the canonical trend series the Command Center already
 *   publishes. A fixture, but a shared one: this module and that dashboard
 *   quote the same numbers.
 * `derived` — arithmetic over canonical records: pages, keywords, clusters.
 * `modelled` — a stand-in for something no source here can supply.
 *
 * There is no `measured` member. Nothing in this module is measured against a
 * real analytics property.
 */
export type AnalyticsProvenance = "series" | "derived" | "modelled";

/**
 * How much weight a reading can carry.
 *
 * Used most on attribution, where the honest answer is usually low: work
 * happening in the same window as a movement is not evidence that it caused it.
 */
export type Confidence = "high" | "medium" | "low" | "none";

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Which way a metric went, and whether the move is worth reading into. */
export type MovementDirection = "up" | "down" | "flat";

/**
 * How much a change matters.
 *
 * `noise` is a real member and the most common one: most week-to-week movement
 * in a small dataset says nothing, and a module that called every wobble a
 * trend would be unusable.
 */
export type MovementSignificance = "material" | "notable" | "slight" | "noise";

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/**
 * The dimensions performance can be cut by.
 *
 * All four are canonical groupings this product already owns. There is no
 * channel, device, or geography dimension, because nothing here measures them
 * and inventing the split would be inventing the data.
 */
export type SegmentDimension = "project" | "cluster" | "intent" | "format";

export type SegmentRow = {
  readonly id: string;
  readonly dimension: SegmentDimension;
  readonly label: string;
  readonly projectId: string;
  readonly projectName: string;

  /** Estimated monthly sessions across the segment. */
  readonly traffic: number;
  /** What the segment could carry at realistic target positions. */
  readonly potential: number;
  readonly keywords: number;
  readonly pages: number;
  /** Mean position across the segment's ranking keywords, or null. */
  readonly averagePosition: number | null;
  /** Share of the selection's traffic, 0-100. */
  readonly share: number;
  /** The gap between today and potential, as a share of potential, 0-100. */
  readonly headroom: number;
  /** Mean content score across the segment's pages, 0-100. */
  readonly quality: number;
  readonly provenance: AnalyticsProvenance;
};

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** How a page is performing against what it could carry. */
export type PagePerformanceState =
  | "compounding"
  | "steady"
  | "underperforming"
  | "decaying"
  | "dormant";

export type PagePerformance = {
  readonly contentId: string;
  readonly title: string;
  readonly path: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;

  readonly traffic: number;
  readonly potential: number;
  /** Sessions a month left on the table. */
  readonly headroom: number;
  /** Value of that headroom at the keywords' listed cost per click. */
  readonly opportunityValue: number;
  readonly keywords: number;
  readonly keywordsInTopTen: number;
  readonly averagePosition: number | null;
  /** Mean places gained across the page's keywords this window. */
  readonly positionChange: number;
  readonly contentScore: number;
  readonly state: PagePerformanceState;
  /** Why the state reads the way it does. */
  readonly reason: string;
};

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * What kind of work is being associated with an outcome.
 *
 * Each maps to a queue another module already publishes, so the work here is
 * the work there — not a second record of it.
 */
export type WorkKind =
  | "content"
  | "technical"
  | "ai-visibility"
  | "authority"
  | "keyword";

/**
 * One piece of work set beside a movement in the same window.
 *
 * Deliberately named for what it is. The record carries the outcome, the work,
 * and an explicit statement of what cannot be concluded from the pairing —
 * because with one snapshot and no holdout there is no way to establish that
 * the work caused the movement.
 */
export type AttributionRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly kind: WorkKind;
  /** The canonical queue item this reads. Always resolvable in its module. */
  readonly sourceId: string;
  readonly sourceModule: string;
  /** Route into the module that owns the work. */
  readonly sourceHref: string;

  readonly workTitle: string;
  readonly owner: AgentId;

  /** The cluster or page the work and the movement share. */
  readonly outcomeLabel: string;
  readonly outcomeHref: string;
  /** Sessions a month associated with the outcome. */
  readonly traffic: number;
  readonly positionChange: number;

  /** How strongly the two move together, 0-100. Association only. */
  readonly association: number;
  readonly confidence: Confidence;
  /** The limit of what this record supports, stated in full. */
  readonly caveat: string;
  readonly provenance: AnalyticsProvenance;
};

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

/** What kind of deviation was found. */
/**
 * What kind of deviation was found.
 *
 * There is no series-level drop member. The canonical trend series compounds
 * upward by construction, so a falling total is not something this dataset can
 * produce, and offering the category would mean offering a filter that can
 * never return anything. Declines are real at page and cluster level, where
 * they are measured from the keyword records, and that is where they are
 * reported.
 */
export type AnomalyKind =
  | "traffic-spike"
  | "ranking-collapse"
  | "page-decay"
  | "cluster-stall"
  | "traffic-concentration";

export type Anomaly = {
  readonly id: string;
  readonly kind: AnomalyKind;
  readonly projectId: string;
  readonly projectName: string;
  readonly label: string;
  /** What moved, and by how much. */
  readonly finding: string;
  readonly direction: MovementDirection;
  readonly significance: MovementSignificance;
  /** Percentage change behind the finding. */
  readonly change: number;

  /**
   * A canonical finding that would explain it, where one exists.
   *
   * Never invented. Where nothing in the other modules accounts for the
   * movement, the record says so rather than reaching for a story.
   */
  readonly explanation: string | null;
  readonly explanationHref: string | null;
  readonly confidence: Confidence;
  readonly owner: AgentId;
  readonly provenance: AnalyticsProvenance;
};

// ---------------------------------------------------------------------------
// Learnings
// ---------------------------------------------------------------------------

/** Whether the evidence supports doing more of something, or less. */
export type LearningVerdict = "repeat" | "investigate" | "stop" | "watch";

/**
 * One thing the data suggests, routed to the agent that would act on it.
 *
 * This is the loop CLAUDE.md §13 describes closing: Analytics feeds the SEO
 * Director, which re-prioritises. Each learning names its evidence so the
 * recommendation can be argued with rather than taken on trust.
 */
export type Learning = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly verdict: LearningVerdict;
  readonly headline: string;
  /** What was observed. */
  readonly observation: string;
  /** The records behind it, named. */
  readonly evidence: readonly string[];
  /** What to do about it. */
  readonly recommendation: string;
  /** The agent the recommendation is routed to. */
  readonly owner: AgentId;
  /** Where to go to act on it. */
  readonly href: string;
  readonly confidence: Confidence;
  readonly provenance: AnalyticsProvenance;
};

// ---------------------------------------------------------------------------
// Vocabulary metadata
// ---------------------------------------------------------------------------

export type AnalyticsStateMeta = {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly description: string;
};

export type AnalyticsKindMeta = {
  readonly label: string;
  readonly icon: IconName;
  readonly description: string;
};

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/** One headline metric, with its own movement against the previous window. */
export type MetricReading = {
  readonly id: SeriesMetricId;
  readonly label: string;
  /** Pre-formatted for display. */
  readonly value: string;
  readonly raw: number;
  /** Percentage change against the previous window. */
  readonly delta: number;
  readonly direction: MovementDirection;
  readonly significance: MovementSignificance;
  /** True where a fall is the good outcome. Currently none, kept explicit. */
  readonly invert: boolean;
  readonly detail: string;
  readonly icon: IconName;
  readonly health: MetricHealth;
  readonly provenance: AnalyticsProvenance;
};

export type AnalyticsMetric = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly health?: MetricHealth;
  readonly trend?: MetricTrend;
};

export type AnalyticsDistributionRow = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly share: number;
  readonly tone: BadgeTone;
  readonly description: string;
};

/** The series for a selection, with the comparison window beside it. */
export type AnalyticsSeries = {
  readonly range: DateRange;
  readonly current: readonly TrendPoint[];
  readonly previous: readonly TrendPoint[];
  readonly totals: Readonly<Record<SeriesMetricId, number>>;
  readonly deltas: Readonly<Record<SeriesMetricId, number>>;
  /** Which projects were summed to produce it. */
  readonly projectIds: readonly string[];
  readonly provenance: AnalyticsProvenance;
};

export type AnalyticsOverview = {
  readonly series: AnalyticsSeries;
  readonly readings: readonly MetricReading[];
  readonly metrics: readonly AnalyticsMetric[];
  /** Biggest contributors to the traffic change, gains first. */
  readonly contributors: readonly SegmentRow[];
  readonly pageStates: readonly AnalyticsDistributionRow[];
  readonly topPages: readonly PagePerformance[];
  readonly decayingPages: readonly PagePerformance[];
  readonly anomalies: readonly Anomaly[];
  readonly learnings: readonly Learning[];
  readonly attribution: readonly AttributionRecord[];
  /** Total sessions a month left on the table across the selection. */
  readonly headroom: number;
  readonly opportunityValue: number;
};

/** Counts and an integrity pass, for the development inspector. */
export type AnalyticsDatasetCounts = {
  readonly projects: number;
  readonly pages: number;
  readonly segments: number;
  readonly attribution: number;
  readonly anomalies: number;
  readonly learnings: number;
  readonly seriesPoints: number;
  readonly byPageState: Readonly<Record<string, number>>;
  readonly bySegmentDimension: Readonly<Record<string, number>>;
  readonly byWorkKind: Readonly<Record<string, number>>;
  readonly byAnomalyKind: Readonly<Record<string, number>>;
  readonly byVerdict: Readonly<Record<string, number>>;
  readonly byConfidence: Readonly<Record<string, number>>;
  readonly bySignificance: Readonly<Record<string, number>>;
  /** Distinct page traffic figures, as a check against a flat dataset. */
  readonly distinctTrafficValues: number;
  /** Findings the integrity pass raised. Empty is the passing result. */
  readonly integrity: readonly string[];
};
