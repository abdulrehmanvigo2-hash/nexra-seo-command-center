/**
 * Shapes for the Technical SEO module (CLAUDE.md §14, Phase 8).
 *
 * There is one page inventory in this product and it belongs to Content
 * Studio. A technical page is not a second record of a URL — it is the
 * published content record read through a technical lens, referenced by
 * `contentId`, and every project, cluster, format, and URL on it is the one
 * the content layer already holds.
 *
 * Nothing here is crawled. There is no Search Console connection, no
 * PageSpeed call, no log file and no crawler in this milestone (CLAUDE.md §4),
 * so every field carries a provenance and the UI states it wherever a figure
 * appears.
 */
import type { IconName } from "@/components/icons";
import type { BadgeTone } from "@/components/ui/badge";
import type { MetricHealth, MetricTrend } from "@/types/dashboard";
import type { AgentId } from "@/types/keyword";
import type { ContentFormat } from "@/types/content";

export type { AgentId, ContentFormat, MetricHealth, MetricTrend };

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where a technical figure came from.
 *
 * `measured` — read straight off a record this product actually owns: the URL,
 *   the format, the internal links the content layer already counted.
 * `derived` — arithmetic over those readings.
 * `seeded` — a modelled stand-in for something only a crawler or a search
 *   engine could tell us: an HTTP status, a rendered Core Web Vital, whether
 *   Google chose to index the page. Deterministically generated from the
 *   page's seed so it is stable across renders, and never presented as live
 *   vendor data.
 */
export type TechnicalProvenance = "measured" | "derived" | "seeded";

/** Plain statement shown wherever modelled technical figures appear. */
export type ProvenanceMeta = {
  readonly label: string;
  readonly description: string;
};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * How bad a finding is.
 *
 * `healthy` is a real member, not the absence of one: a page with nothing
 * wrong needs a band to sit in, and a table that left it blank would read as
 * missing data rather than a clean result.
 */
export type TechnicalSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "healthy";

/** Whether a crawler can reach and fetch the page at all. */
export type CrawlState =
  | "crawlable"
  | "blocked"
  | "redirected"
  | "broken"
  | "server-error";

/**
 * Whether the page is *allowed* to be indexed.
 *
 * Not the same question as `IndexStatus`, and the two are deliberately kept
 * apart: a page can be perfectly indexable and still not be in the index, and
 * conflating them is the most common way a technical report misleads.
 */
export type Indexability =
  | "indexable"
  | "noindex"
  | "canonicalised"
  | "blocked"
  | "redirect"
  | "error";

/** Whether the page is *in* the index, as far as this dataset models it. */
export type IndexStatus = "indexed" | "not-indexed" | "excluded" | "pending";

/** What the canonical tag says. */
export type CanonicalState =
  | "self"
  | "points-elsewhere"
  | "conflict"
  | "missing";

/** The robots meta directive on the page. */
export type RobotsDirective =
  | "index,follow"
  | "index,nofollow"
  | "noindex,follow"
  | "noindex,nofollow";

/** Core Web Vitals verdict for the page. */
export type CwvState = "good" | "needs-improvement" | "poor" | "unmeasured";

/** Structured data on the page. */
export type SchemaState = "complete" | "partial" | "invalid" | "missing";

/** Which part of the discipline a finding belongs to. */
export type IssueCategory =
  | "crawl"
  | "indexation"
  | "metadata"
  | "links"
  | "performance"
  | "schema"
  | "http"
  | "canonical"
  | "sitemap"
  | "robots";

/** The specific finding. One type per rule the module checks. */
export type IssueType =
  // crawl
  | "orphan-page"
  | "deep-page"
  | "blocked-by-robots"
  // http
  | "broken-page"
  | "server-error"
  | "redirect-chain"
  | "temporary-redirect"
  // indexation
  | "indexable-not-indexed"
  | "indexed-noindex-conflict"
  | "excluded-page"
  // canonical
  | "canonical-conflict"
  | "missing-canonical"
  // sitemap
  | "missing-from-sitemap"
  | "sitemap-index-mismatch"
  | "non-indexable-in-sitemap"
  // metadata
  | "title-too-short"
  | "title-too-long"
  | "missing-meta-description"
  | "meta-description-length"
  | "duplicate-title"
  | "missing-h1"
  // links
  | "few-internal-links"
  | "broken-internal-link"
  | "no-outbound-internal-links"
  // performance
  | "poor-lcp"
  | "poor-inp"
  | "poor-cls"
  | "slow-page"
  // schema
  | "missing-schema"
  | "invalid-schema"
  | "incomplete-schema";

/** How much work a fix takes. */
export type EffortLevel = "low" | "medium" | "high";

/**
 * What kind of job an opportunity is.
 *
 * A coarser grouping than `IssueCategory`: a 404, a robots block, and a buried
 * page are three findings but one conversation about whether the site can be
 * crawled, and an opportunity queue is read by whoever decides what to
 * schedule rather than by whoever runs the checks.
 */
export type OpportunityCategory =
  | "crawlability"
  | "indexation"
  | "performance"
  | "schema"
  | "internal-links"
  | "metadata"
  | "canonical"
  | "sitemap";

/** Frontend-only state for an issue triaged in this session. */
export type IssueStatus =
  | "open"
  | "acknowledged"
  | "in-progress"
  | "resolved"
  | "ignored";

// ---------------------------------------------------------------------------
// Metadata for the vocabulary
// ---------------------------------------------------------------------------

export type SeverityMeta = {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly description: string;
  /** Lowest score that still reads as this band. */
  readonly floor: number;
};

export type CategoryMeta = {
  readonly label: string;
  readonly icon: IconName;
  readonly description: string;
};

export type IssueTypeMeta = {
  readonly label: string;
  readonly category: IssueCategory;
  readonly severity: TechnicalSeverity;
  /** What the check found. */
  readonly description: string;
  /** Why it matters. */
  readonly impact: string;
  /** What to do about it. */
  readonly action: string;
  readonly owner: AgentId;
  readonly provenance: TechnicalProvenance;
  /** How much work the fix is. A property of the rule, not of one page. */
  readonly effort: EffortLevel;
};

export type StateMeta = {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly description: string;
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** One weighted input to a technical score, published with its arithmetic. */
export type TechnicalFactor = {
  readonly id: string;
  readonly label: string;
  /** The factor's own reading, 0-100. */
  readonly value: number;
  /** Share of the score this factor carries. The weights sum to 1. */
  readonly weight: number;
  /** `value × weight`, rounded to one decimal. */
  readonly contribution: number;
  readonly provenance: TechnicalProvenance;
  readonly detail: string;
};

/** A published 0-100 technical score, taken apart. */
export type TechnicalScore = {
  readonly score: number;
  readonly severity: TechnicalSeverity;
  readonly factors: readonly TechnicalFactor[];
  readonly summary: string;
};

// ---------------------------------------------------------------------------
// Core Web Vitals
// ---------------------------------------------------------------------------

/**
 * A page's field vitals.
 *
 * Modelled from what the content layer knows about the page — its format, its
 * weight, how much of it is above the fold — not fetched from any measurement
 * service. Milliseconds for LCP and INP, unitless for CLS.
 */
export type PageVitals = {
  readonly lcp: number;
  readonly inp: number;
  readonly cls: number;
  readonly state: CwvState;
  /** 0-100 reading combining the three. */
  readonly score: number;
};

// ---------------------------------------------------------------------------
// The page record
// ---------------------------------------------------------------------------

/**
 * One published URL, read technically.
 *
 * Keyed by its own id but anchored to `contentId`: the title, URL, format,
 * project, cluster, and internal link counts are the content record's, not
 * copies of them.
 */
export type TechnicalPage = {
  readonly id: string;
  /** The content record this page is. Always resolvable. */
  readonly contentId: string;
  readonly url: string;
  /** The path alone, for dense tables. */
  readonly path: string;
  readonly title: string;
  readonly format: ContentFormat;

  readonly projectId: string;
  readonly projectName: string;
  readonly clusterId: string;
  readonly clusterName: string;

  readonly httpStatus: number;
  /** Where a redirecting page points, or null. */
  readonly redirectTarget: string | null;
  /** Hops before a final response. 0 for a direct 200. */
  readonly redirectHops: number;

  readonly crawlState: CrawlState;
  readonly robots: RobotsDirective;
  readonly indexability: Indexability;
  readonly indexStatus: IndexStatus;
  /** Why the page is or is not in the index, in one line. */
  readonly indexNote: string;

  readonly canonicalState: CanonicalState;
  /** The URL the canonical points at, or null where there is none. */
  readonly canonicalTarget: string | null;

  readonly inSitemap: boolean;
  /** Clicks from the home page. 0 is the home page itself. */
  readonly crawlDepth: number;
  readonly orphan: boolean;

  readonly internalLinksIn: number;
  readonly internalLinksOut: number;

  readonly titleLength: number;
  /** Null where the page has no meta description at all. */
  readonly metaLength: number | null;
  readonly hasH1: boolean;

  readonly vitals: PageVitals;

  readonly schemaState: SchemaState;
  readonly schemaTypes: readonly string[];

  /** Ids of every issue raised against this page. */
  readonly issueIds: readonly string[];
  readonly issueCount: number;
  /** The worst severity among this page's issues, or `healthy`. */
  readonly severity: TechnicalSeverity;
  readonly score: TechnicalScore;

  /** Seeds every modelled figure on this page. */
  readonly seed: number;
};

// ---------------------------------------------------------------------------
// The issue registry
// ---------------------------------------------------------------------------

/**
 * One finding, against one or more pages.
 *
 * An issue is a rule plus the pages that failed it, within one project.
 * Grouping by rule rather than by page is deliberate: "42 pages are missing a
 * meta description" is one job for one agent, and 42 separate rows would be a
 * queue nobody works through.
 */
export type TechnicalIssue = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly category: IssueCategory;
  readonly type: IssueType;
  readonly label: string;
  readonly severity: TechnicalSeverity;

  readonly pageIds: readonly string[];
  readonly affectedPages: number;
  /** Share of the project's pages this hits, 0-100. */
  readonly affectedShare: number;

  readonly description: string;
  readonly impact: string;
  readonly action: string;
  readonly owner: AgentId;

  /** Where the finding comes from. */
  readonly provenance: TechnicalProvenance;
  /** 0-100 ranking of what to do first. */
  readonly priority: number;
  /** The state a fresh finding starts in. Triage is session-only. */
  readonly status: IssueStatus;
};

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/** A summary tile above the workspace. */
export type TechnicalMetric = {
  readonly id: string;
  readonly label: string;
  /** Pre-formatted for display. */
  readonly value: string;
  readonly unit?: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly health?: MetricHealth;
  readonly trend?: MetricTrend;
};

/** One row of a distribution bar. */
export type DistributionRow = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly share: number;
  readonly tone: BadgeTone;
  readonly description: string;
};

/** The crawlability reading for a selection of pages. */
export type CrawlSummary = {
  readonly total: number;
  readonly crawlable: number;
  readonly blocked: number;
  readonly noindex: number;
  readonly redirects: number;
  readonly broken: number;
  readonly orphans: number;
  readonly averageDepth: number;
  readonly deepPages: number;
  readonly inSitemap: number;
  readonly missingFromSitemap: number;
  readonly canonicalConflicts: number;
  /** Pages held back on purpose rather than by a defect. */
  readonly intentional: number;
  readonly problems: number;
  readonly score: TechnicalScore;
  readonly depth: readonly DistributionRow[];
};

/** The indexation reading for a selection of pages. */
export type IndexationSummary = {
  readonly total: number;
  readonly indexed: number;
  readonly notIndexed: number;
  readonly excluded: number;
  readonly pending: number;
  readonly indexable: number;
  readonly noindex: number;
  readonly canonicalised: number;
  readonly blocked: number;
  readonly redirects: number;
  readonly errors: number;
  /** Indexable, in the sitemap, and still not indexed. */
  readonly sitemapMismatches: number;
  /** Indexed while the page says it should not be. */
  readonly conflicts: number;
  readonly coverage: number;
  readonly score: TechnicalScore;
  readonly reasons: readonly DistributionRow[];
};

/** The headline reading for a selection of pages. */
export type TechnicalOverview = {
  readonly health: TechnicalScore;
  readonly crawl: CrawlSummary;
  readonly indexation: IndexationSummary;
  readonly metrics: readonly TechnicalMetric[];
  readonly severity: readonly DistributionRow[];
  readonly categories: readonly DistributionRow[];
  /** Highest-priority issues first. */
  readonly topIssues: readonly TechnicalIssue[];
  /** Worst-scoring pages first. */
  readonly worstPages: readonly TechnicalPage[];
};

/** Counts for the development data inspector. */
export type TechnicalDatasetCounts = {
  readonly pages: number;
  readonly issues: number;
  readonly projects: number;
  readonly clusters: number;
  readonly bySeverity: Readonly<Record<string, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
  readonly byCrawlState: Readonly<Record<string, number>>;
  readonly byIndexStatus: Readonly<Record<string, number>>;
  readonly byIndexability: Readonly<Record<string, number>>;
  readonly byCanonical: Readonly<Record<string, number>>;
  readonly byCwv: Readonly<Record<string, number>>;
  readonly bySchema: Readonly<Record<string, number>>;
  readonly byIssueType: Readonly<Record<string, number>>;
  /** Findings the integrity pass raised. Empty is the passing result. */
  readonly integrity: readonly string[];
};

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

/**
 * One finding, expressed as a job somebody could schedule.
 *
 * Not a second dataset: every opportunity reads an issue from the registry, so
 * the pages behind it, its severity and its owner are the ones the registry
 * already decided. What the opportunity adds is what the registry deliberately
 * does not carry — how much effort the fix is, what it is worth, and where it
 * therefore belongs in a queue.
 */
export type TechnicalOpportunity = {
  readonly id: string;
  /** The registry finding this reads. Always resolvable. */
  readonly issueId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly category: OpportunityCategory;
  readonly issueCategory: IssueCategory;
  readonly type: IssueType;
  readonly title: string;
  /** What is happening, in one line. */
  readonly explanation: string;
  readonly impact: string;
  readonly action: string;

  readonly pageIds: readonly string[];
  readonly affectedPages: number;
  /** Share of the project's pages this reaches, 0-100. */
  readonly affectedShare: number;

  readonly severity: TechnicalSeverity;
  readonly effort: EffortLevel;
  /** What fixing it is worth, 0-100. */
  readonly impactScore: number;
  /** Where it belongs in the queue, 0-100. */
  readonly priority: number;
  readonly owner: AgentId;
  readonly provenance: TechnicalProvenance;
};

// ---------------------------------------------------------------------------
// Core Web Vitals
// ---------------------------------------------------------------------------

/** One vital, read across a selection of pages. */
export type VitalBreakdown = {
  readonly id: "lcp" | "inp" | "cls";
  readonly label: string;
  readonly unit: string;
  /** Median across the pages that have a reading. */
  readonly median: number;
  readonly good: number;
  readonly needsWork: number;
  readonly poor: number;
  /** Pages inside the good band, as a share of those measured, 0-100. */
  readonly passRate: number;
  readonly goodThreshold: number;
  readonly poorThreshold: number;
  readonly description: string;
};

export type VitalsSummary = {
  readonly total: number;
  /** Pages with enough traffic to model a field reading. */
  readonly measured: number;
  readonly unmeasured: number;
  readonly passing: number;
  readonly needsWork: number;
  readonly poor: number;
  /** Passing as a share of measured pages, 0-100. */
  readonly passRate: number;
  readonly score: TechnicalScore;
  readonly vitals: readonly VitalBreakdown[];
  readonly states: readonly DistributionRow[];
  /** Worst-scoring measured pages first. */
  readonly worst: readonly TechnicalPage[];
};

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

/** One schema type, counted across a selection. */
export type SchemaTypeRow = {
  readonly type: string;
  /** Pages carrying it. */
  readonly present: number;
  /** Pages whose format calls for it that do not have it. */
  readonly missing: number;
  /** Pages carrying it where the markup fails validation. */
  readonly invalid: number;
  /** Present as a share of the pages that should have it, 0-100. */
  readonly coverage: number;
  readonly description: string;
};

export type SchemaSummary = {
  readonly total: number;
  readonly withSchema: number;
  readonly missing: number;
  readonly complete: number;
  readonly partial: number;
  readonly invalid: number;
  /** Complete markup as a share of all pages, 0-100. */
  readonly coverage: number;
  readonly score: TechnicalScore;
  readonly states: readonly DistributionRow[];
  /** Most common first. */
  readonly types: readonly SchemaTypeRow[];
};

// ---------------------------------------------------------------------------
// Internal links
// ---------------------------------------------------------------------------

/** One page's linking position, with what is wrong with it. */
export type LinkRow = {
  readonly pageId: string;
  readonly contentId: string;
  readonly title: string;
  readonly path: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly clusterName: string;
  readonly linksIn: number;
  readonly linksOut: number;
  readonly crawlDepth: number;
  readonly orphan: boolean;
  /** Links out of this page that do not resolve. */
  readonly brokenOut: number;
  /** Links out of this page that land on a redirect. */
  readonly redirectOut: number;
  /** Links out of this page that land on a URL excluded from the index. */
  readonly nonCanonicalOut: number;
  readonly severity: TechnicalSeverity;
  /** Why this row is listed, in one line. */
  readonly finding: string;
  /** 0-100 reading of how well the site supports this page. */
  readonly support: number;
};

export type LinkSummary = {
  readonly total: number;
  readonly orphans: number;
  readonly weak: number;
  readonly deep: number;
  readonly brokenLinks: number;
  readonly redirectLinks: number;
  readonly nonCanonicalLinks: number;
  readonly deadEnds: number;
  readonly averageLinksIn: number;
  readonly score: TechnicalScore;
  readonly rows: readonly LinkRow[];
};

// ---------------------------------------------------------------------------
// Page detail
// ---------------------------------------------------------------------------

/** One labelled fact on the detail page, with where it came from. */
export type DetailFact = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly tone?: "positive" | "warning" | "critical" | "neutral";
  readonly provenance: TechnicalProvenance;
};

/**
 * Everything known about one URL, technically.
 *
 * Assembled from the canonical page record and the registry — neither is
 * copied. Business and editorial analysis stays in Content Studio, and this
 * route links there rather than restating it.
 */
export type TechnicalPageDetail = {
  readonly page: TechnicalPage;
  readonly issues: readonly TechnicalIssue[];
  readonly opportunities: readonly TechnicalOpportunity[];
  readonly response: readonly DetailFact[];
  readonly indexing: readonly DetailFact[];
  readonly onPage: readonly DetailFact[];
  readonly linking: readonly DetailFact[];
  /** Pages of ours that link to this one. */
  readonly inboundPages: readonly TechnicalPage[];
  /** Pages of ours this one links to. */
  readonly outboundPages: readonly TechnicalPage[];
  /** Sibling pages in the same cluster, for context. */
  readonly clusterPages: readonly TechnicalPage[];
};
