import type {
  AnalyticsKindMeta,
  AnalyticsProvenance,
  AnalyticsStateMeta,
  AnomalyKind,
  Confidence,
  LearningVerdict,
  MovementDirection,
  MovementSignificance,
  PagePerformanceState,
  SegmentDimension,
  SeriesMetricId,
  WorkKind,
} from "@/types/analytics";
import { SIGNIFICANCE_ORDER } from "@/lib/mock/analytics/scoring";

/**
 * Every label, tone, order and explanation in Analytics.
 *
 * Vocabulary lives here rather than in the components, so a significance band
 * reads the same on the overview, in a table row, on a filter chip and on a
 * project page.
 *
 * The wording carries weight in this module. Nothing below says a piece of
 * work *caused* a movement, because nothing in this product can establish
 * that — the vocabulary is built so the claim cannot be made by accident.
 */

/** Stated wherever an analytics figure appears. */
export const ANALYTICS_SOURCE_NOTE =
  "Modelled performance data from the development dataset. No analytics property, Search Console, tag manager, or conversion feed is connected — the trend series is the same fixture the Command Center reads.";

export const ANALYTICS_SOURCE_SHORT =
  "Modelled performance data — no analytics property is connected.";

/** Stated wherever attribution appears. */
export const ATTRIBUTION_NOTE =
  "Association, not cause. These records pair work with movement in the same window; establishing that one produced the other would need a holdout or a controlled before-and-after, which this dataset does not have.";

export const PROVENANCE_META: Readonly<
  Record<AnalyticsProvenance, { label: string; description: string }>
> = {
  series: {
    label: "Series",
    description:
      "Read from the canonical trend series the Command Center publishes. A fixture, but a shared one — both quote the same numbers.",
  },
  derived: {
    label: "Derived",
    description:
      "Arithmetic over canonical records this product owns — pages, keywords, clusters, and the module queues.",
  },
  modelled: {
    label: "Modelled",
    description:
      "A deterministic stand-in for something no source here can supply. Stable across renders, and not observed data.",
  },
};

export const CONFIDENCE_META: Readonly<Record<Confidence, AnalyticsStateMeta>> = {
  high: {
    label: "High confidence",
    tone: "positive",
    description:
      "A canonical finding from another module directly accounts for this.",
  },
  medium: {
    label: "Medium confidence",
    tone: "accent",
    description: "Strongly consistent with the records, without being provable.",
  },
  low: {
    label: "Low confidence",
    tone: "warning",
    description:
      "Circumstantial. Treat as a prompt to look, not as a finding.",
  },
  none: {
    label: "No confidence",
    tone: "neutral",
    description:
      "Nothing here supports the reading. Stated rather than dressed up.",
  },
};

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

export { SIGNIFICANCE_ORDER };

export const SIGNIFICANCE_META: Readonly<
  Record<MovementSignificance, AnalyticsStateMeta>
> = {
  material: {
    label: "Material",
    tone: "accent",
    description: "Large enough to act on.",
  },
  notable: {
    label: "Notable",
    tone: "accent",
    description: "Worth understanding before the next cycle.",
  },
  slight: {
    label: "Slight",
    tone: "neutral",
    description: "A real move, but a small one.",
  },
  noise: {
    label: "Noise",
    tone: "neutral",
    description:
      "Inside the range this dataset moves in anyway. Reading a trend into it would be a mistake.",
  },
};

export const DIRECTION_META: Readonly<
  Record<MovementDirection, AnalyticsStateMeta>
> = {
  up: { label: "Up", tone: "positive", description: "Higher than the previous window." },
  down: { label: "Down", tone: "critical", description: "Lower than the previous window." },
  flat: {
    label: "Flat",
    tone: "neutral",
    description: "Inside the noise band — no direction the data supports.",
  },
};

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const METRIC_ORDER: readonly SeriesMetricId[] = [
  "organicTraffic",
  "organicKeywords",
  "searchVisibility",
  "conversions",
];

export const METRIC_META: Readonly<
  Record<SeriesMetricId, AnalyticsKindMeta & { unit: string }>
> = {
  organicTraffic: {
    label: "Organic sessions",
    icon: "analytics",
    unit: "",
    description: "Visits arriving from unpaid search across the selection.",
  },
  organicKeywords: {
    label: "Ranking keywords",
    icon: "keywords",
    unit: "",
    description: "Terms placing anywhere in the top 100.",
  },
  searchVisibility: {
    label: "Search visibility",
    icon: "gauge",
    unit: "/ 100",
    description:
      "Share-of-voice index across the tracked keyword set, weighted by position and volume.",
  },
  conversions: {
    label: "Conversions",
    icon: "value",
    unit: "",
    description:
      "Modelled goal completions attributed to organic sessions. No conversion feed is connected.",
  },
};

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export const SEGMENT_ORDER: readonly SegmentDimension[] = [
  "project",
  "cluster",
  "intent",
  "format",
];

export const SEGMENT_META: Readonly<
  Record<SegmentDimension, AnalyticsKindMeta>
> = {
  project: {
    label: "Project",
    icon: "projects",
    description: "Performance by client.",
  },
  cluster: {
    label: "Topic cluster",
    icon: "layers",
    description: "Performance by the canonical keyword cluster.",
  },
  intent: {
    label: "Search intent",
    icon: "flag",
    description: "Performance by what the searcher is trying to do.",
  },
  format: {
    label: "Page format",
    icon: "content",
    description: "Performance by the kind of page carrying the terms.",
  },
};

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export const PAGE_STATE_ORDER: readonly PagePerformanceState[] = [
  "compounding",
  "steady",
  "underperforming",
  "decaying",
  "dormant",
];

export const PAGE_STATE_META: Readonly<
  Record<PagePerformanceState, AnalyticsStateMeta>
> = {
  compounding: {
    label: "Compounding",
    tone: "positive",
    description: "Carrying most of its potential and still climbing.",
  },
  steady: {
    label: "Steady",
    tone: "positive",
    description: "Doing its job, without much movement either way.",
  },
  underperforming: {
    label: "Underperforming",
    tone: "warning",
    description:
      "Well below what its own keywords could carry. The gap is the opportunity.",
  },
  decaying: {
    label: "Decaying",
    tone: "critical",
    description:
      "Losing ground. Worth catching before the traffic has gone rather than after.",
  },
  dormant: {
    label: "Dormant",
    tone: "neutral",
    description:
      "Too little traffic to read. Often a young page rather than a failing one.",
  },
};

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export const WORK_KIND_ORDER: readonly WorkKind[] = [
  "content",
  "technical",
  "ai-visibility",
  "authority",
  "keyword",
];

export const WORK_KIND_META: Readonly<Record<WorkKind, AnalyticsKindMeta>> = {
  content: {
    label: "Content",
    icon: "content",
    description: "Work from the Content Studio queue.",
  },
  technical: {
    label: "Technical",
    icon: "technical",
    description: "Work from the Technical SEO queue.",
  },
  "ai-visibility": {
    label: "AI visibility",
    icon: "ai-visibility",
    description: "Work from the AI Visibility queue.",
  },
  authority: {
    label: "Authority",
    icon: "backlinks",
    description: "Work from the Backlinks & Authority queue.",
  },
  keyword: {
    label: "Keyword",
    icon: "keywords",
    description: "Work from the Keyword Intelligence queue.",
  },
};

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

export const ANOMALY_KIND_ORDER: readonly AnomalyKind[] = [
  "ranking-collapse",
  "page-decay",
  "cluster-stall",
  "traffic-concentration",
  "traffic-spike",
];

export const ANOMALY_KIND_META: Readonly<
  Record<AnomalyKind, AnalyticsKindMeta & { tone: AnalyticsStateMeta["tone"] }>
> = {
  "traffic-spike": {
    label: "Traffic spike",
    icon: "trend-up",
    tone: "positive",
    description:
      "Organic sessions rose sharply. Worth understanding so it can be repeated.",
  },
  "ranking-collapse": {
    label: "Ranking collapse",
    icon: "trend-down",
    tone: "critical",
    description: "A cluster lost several positions at once.",
  },
  "traffic-concentration": {
    label: "Concentration risk",
    icon: "target",
    tone: "warning",
    description:
      "A large share of a project's traffic depends on very few pages.",
  },
  "page-decay": {
    label: "Page decay",
    icon: "pages",
    tone: "warning",
    description: "A page that was carrying traffic is losing it.",
  },
  "cluster-stall": {
    label: "Cluster stall",
    icon: "layers",
    tone: "warning",
    description:
      "A cluster with real potential is not converting any of it into traffic.",
  },
};

// ---------------------------------------------------------------------------
// Learnings
// ---------------------------------------------------------------------------

export const VERDICT_ORDER: readonly LearningVerdict[] = [
  "repeat",
  "investigate",
  "stop",
  "watch",
];

export const VERDICT_META: Readonly<
  Record<LearningVerdict, AnalyticsStateMeta>
> = {
  repeat: {
    label: "Do more of this",
    tone: "positive",
    description: "The evidence supports putting more effort here.",
  },
  investigate: {
    label: "Investigate",
    tone: "accent",
    description:
      "Something is happening that the records do not fully explain.",
  },
  stop: {
    label: "Stop or change",
    tone: "critical",
    description: "The effort here is not returning anything.",
  },
  watch: {
    label: "Watch",
    tone: "neutral",
    description: "Not yet actionable. Worth a second reading next cycle.",
  },
};
