import type {
  CanonicalState,
  CategoryMeta,
  CrawlState,
  CwvState,
  IndexStatus,
  Indexability,
  IssueCategory,
  IssueStatus,
  IssueType,
  IssueTypeMeta,
  ProvenanceMeta,
  SchemaState,
  SeverityMeta,
  StateMeta,
  TechnicalProvenance,
  TechnicalSeverity,
} from "@/types/technical";
import { SEVERITY_FLOORS, SEVERITY_ORDER } from "@/lib/mock/technical/scoring";

/**
 * Every label, tone, order, and explanation in Technical SEO.
 *
 * Vocabulary lives here rather than in the components, so a crawl state reads
 * the same on the overview, in a table row, on a filter chip, and in the
 * Command Center panel. A component that writes its own label is a component
 * that disagrees with the next one.
 */

/** Stated wherever a modelled technical figure appears. */
export const MODELLED_SOURCE_NOTE =
  "Modelled technical intelligence from the development dataset — no crawl, log file, or search-console connection is behind these figures.";

export const PROVENANCE_META: Readonly<
  Record<TechnicalProvenance, ProvenanceMeta>
> = {
  measured: {
    label: "Measured",
    description:
      "Read directly off a record this product owns — the URL, its format, the internal links already counted against it.",
  },
  derived: {
    label: "Derived",
    description: "Arithmetic over records this product owns.",
  },
  seeded: {
    label: "Modelled",
    description:
      "A deterministic stand-in for something only a crawler or a search engine could report. Stable across renders, and not live data.",
  },
};

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export { SEVERITY_ORDER };

export const SEVERITY_META: Readonly<
  Record<TechnicalSeverity, SeverityMeta>
> = {
  critical: {
    label: "Critical",
    tone: "critical",
    description:
      "The URL is not working for search at all — it cannot be fetched, or it is ruled out of the index.",
    floor: SEVERITY_FLOORS.critical,
  },
  high: {
    label: "High",
    tone: "critical",
    description: "A defect that is costing this page visibility right now.",
    floor: SEVERITY_FLOORS.high,
  },
  medium: {
    label: "Medium",
    tone: "warning",
    description: "Worth fixing in the next cycle, not today.",
    floor: SEVERITY_FLOORS.medium,
  },
  low: {
    label: "Low",
    tone: "neutral",
    description: "A tidy-up. Real, but nothing is waiting on it.",
    floor: SEVERITY_FLOORS.low,
  },
  healthy: {
    label: "Healthy",
    tone: "positive",
    description: "Nothing outstanding against this page.",
    floor: SEVERITY_FLOORS.healthy,
  },
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const CATEGORY_ORDER: readonly IssueCategory[] = [
  "http",
  "crawl",
  "indexation",
  "canonical",
  "sitemap",
  "robots",
  "metadata",
  "links",
  "performance",
  "schema",
];

export const CATEGORY_META: Readonly<Record<IssueCategory, CategoryMeta>> = {
  crawl: {
    label: "Crawl",
    icon: "refresh",
    description: "Whether a crawler can reach the page and how far in it sits.",
  },
  indexation: {
    label: "Indexation",
    icon: "inbox",
    description: "Whether the page is in the index, and whether it should be.",
  },
  metadata: {
    label: "Metadata",
    icon: "note",
    description: "Titles, meta descriptions, and headings.",
  },
  links: {
    label: "Internal links",
    icon: "link-off",
    description: "How well the site supports this page from its own pages.",
  },
  performance: {
    label: "Performance",
    icon: "gauge",
    description: "Core Web Vitals and how the page loads for a real visitor.",
  },
  schema: {
    label: "Structured data",
    icon: "layers",
    description: "Markup that tells a search engine what the page is.",
  },
  http: {
    label: "HTTP",
    icon: "alert",
    description: "The response the URL actually returns.",
  },
  canonical: {
    label: "Canonical",
    icon: "split",
    description: "Which URL the page nominates as the one to index.",
  },
  sitemap: {
    label: "Sitemap",
    icon: "list",
    description: "What we submit against what we publish.",
  },
  robots: {
    label: "Robots",
    icon: "shield",
    description: "Directives that permit or forbid crawling and indexing.",
  },
};

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------

export const CRAWL_STATE_ORDER: readonly CrawlState[] = [
  "crawlable",
  "blocked",
  "redirected",
  "broken",
  "server-error",
];

export const CRAWL_STATE_META: Readonly<Record<CrawlState, StateMeta>> = {
  crawlable: {
    label: "Crawlable",
    tone: "positive",
    description: "Returns 200 and can be read.",
  },
  blocked: {
    label: "Blocked",
    tone: "warning",
    description: "Disallowed in robots.txt — a crawler never requests it.",
  },
  redirected: {
    label: "Redirected",
    tone: "accent",
    description: "Answers with a redirect rather than content.",
  },
  broken: {
    label: "Broken",
    tone: "critical",
    description: "Answers 404 or 410. Nothing is served.",
  },
  "server-error": {
    label: "Server error",
    tone: "critical",
    description: "Answers 5xx. The page may exist but is not being served.",
  },
};

export const INDEXABILITY_ORDER: readonly Indexability[] = [
  "indexable",
  "noindex",
  "canonicalised",
  "blocked",
  "redirect",
  "error",
];

export const INDEXABILITY_META: Readonly<Record<Indexability, StateMeta>> = {
  indexable: {
    label: "Indexable",
    tone: "positive",
    description: "Allowed in the index and canonical to itself.",
  },
  noindex: {
    label: "Noindex",
    tone: "neutral",
    description: "The page asks not to be indexed.",
  },
  canonicalised: {
    label: "Canonicalised",
    tone: "neutral",
    description: "Points at another URL as the one to index.",
  },
  blocked: {
    label: "Blocked",
    tone: "warning",
    description: "Disallowed in robots.txt, so the directive is never read.",
  },
  redirect: {
    label: "Redirects",
    tone: "accent",
    description: "Sends the crawler somewhere else.",
  },
  error: {
    label: "Error",
    tone: "critical",
    description: "The response rules it out.",
  },
};

export const INDEX_STATUS_ORDER: readonly IndexStatus[] = [
  "indexed",
  "not-indexed",
  "excluded",
  "pending",
];

export const INDEX_STATUS_META: Readonly<Record<IndexStatus, StateMeta>> = {
  indexed: {
    label: "Indexed",
    tone: "positive",
    description: "Modelled as present in the index.",
  },
  "not-indexed": {
    label: "Not indexed",
    tone: "critical",
    description:
      "Eligible for the index and not in it — the finding worth acting on.",
  },
  excluded: {
    label: "Excluded",
    tone: "neutral",
    description:
      "Kept out on purpose, by a directive or a canonical we set ourselves.",
  },
  pending: {
    label: "Pending",
    tone: "accent",
    description: "Discovered but not yet processed.",
  },
};

export const CANONICAL_ORDER: readonly CanonicalState[] = [
  "self",
  "points-elsewhere",
  "conflict",
  "missing",
];

export const CANONICAL_META: Readonly<Record<CanonicalState, StateMeta>> = {
  self: {
    label: "Self",
    tone: "positive",
    description: "Nominates itself, which is what a primary page should do.",
  },
  "points-elsewhere": {
    label: "Elsewhere",
    tone: "neutral",
    description: "Defers to another URL. Deliberate on a duplicate.",
  },
  conflict: {
    label: "Conflict",
    tone: "critical",
    description:
      "The canonical contradicts something else on the page — a directive, the sitemap, or a redirect.",
  },
  missing: {
    label: "Missing",
    tone: "warning",
    description: "No canonical tag at all.",
  },
};

export const CWV_ORDER: readonly CwvState[] = [
  "good",
  "needs-improvement",
  "poor",
  "unmeasured",
];

export const CWV_META: Readonly<Record<CwvState, StateMeta>> = {
  good: {
    label: "Good",
    tone: "positive",
    description: "All three vitals inside the good band.",
  },
  "needs-improvement": {
    label: "Needs work",
    tone: "warning",
    description: "No vital is poor, but at least one is outside the good band.",
  },
  poor: {
    label: "Poor",
    tone: "critical",
    description: "At least one vital is in the poor band.",
  },
  unmeasured: {
    label: "No data",
    tone: "neutral",
    description: "Too little traffic to model a field reading.",
  },
};

export const SCHEMA_ORDER: readonly SchemaState[] = [
  "complete",
  "partial",
  "invalid",
  "missing",
];

export const SCHEMA_META: Readonly<Record<SchemaState, StateMeta>> = {
  complete: {
    label: "Complete",
    tone: "positive",
    description: "Every type this format calls for is present and valid.",
  },
  partial: {
    label: "Partial",
    tone: "warning",
    description: "Some of the expected markup is there.",
  },
  invalid: {
    label: "Invalid",
    tone: "critical",
    description: "Markup is present but fails validation, so none of it counts.",
  },
  missing: {
    label: "Missing",
    tone: "neutral",
    description: "No structured data on the page.",
  },
};

// ---------------------------------------------------------------------------
// Issue triage
// ---------------------------------------------------------------------------

export const ISSUE_STATUS_ORDER: readonly IssueStatus[] = [
  "open",
  "acknowledged",
  "in-progress",
  "resolved",
  "ignored",
];

export const ISSUE_STATUS_META: Readonly<Record<IssueStatus, StateMeta>> = {
  open: { label: "Open", tone: "critical", description: "Not yet triaged." },
  acknowledged: {
    label: "Acknowledged",
    tone: "warning",
    description: "Seen and accepted, not yet scheduled.",
  },
  "in-progress": {
    label: "In progress",
    tone: "accent",
    description: "Work is under way against it.",
  },
  resolved: {
    label: "Resolved",
    tone: "positive",
    description: "Marked fixed in this session.",
  },
  ignored: {
    label: "Ignored",
    tone: "neutral",
    description: "Deliberately not being actioned.",
  },
};

/** The order the triage control cycles through. */
export const ISSUE_STATUS_CYCLE: readonly IssueStatus[] = [
  "open",
  "acknowledged",
  "in-progress",
  "resolved",
  "ignored",
];

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/**
 * Every rule this module runs, with its severity, its owner, and its fix.
 *
 * The severity of a finding is a property of the rule, not of the component
 * rendering it. Ownership uses the canonical `AgentId` set — Technical SEO
 * owns most of this, but a missing meta description is On-Page SEO's job and a
 * thin internal-link profile is the Content Strategist's.
 */
export const ISSUE_TYPE_META: Readonly<Record<IssueType, IssueTypeMeta>> = {
  // -- HTTP ---------------------------------------------------------------
  "broken-page": {
    label: "Broken page",
    category: "http",
    severity: "critical",
    description: "The URL answers 404 or 410.",
    impact:
      "Any ranking, link equity, and traffic the URL held is lost, and internal links pointing at it waste crawl budget.",
    action: "Restore the page or redirect it to the closest live equivalent.",
    owner: "technical-seo",
    provenance: "seeded",
  },
  "server-error": {
    label: "Server error",
    category: "http",
    severity: "critical",
    description: "The URL answers with a 5xx status.",
    impact:
      "Repeated errors get the URL dropped from the index and slow crawling across the whole site.",
    action: "Check the origin, then request re-crawl once it is serving again.",
    owner: "technical-seo",
    provenance: "seeded",
  },
  "redirect-chain": {
    label: "Redirect chain",
    category: "http",
    severity: "medium",
    description: "More than one hop before a final response.",
    impact: "Each hop loses a little signal and delays the page for visitors.",
    action: "Point the first redirect straight at the final URL.",
    owner: "technical-seo",
    provenance: "seeded",
  },
  "temporary-redirect": {
    label: "Temporary redirect",
    category: "http",
    severity: "low",
    description: "A 302 where the move looks permanent.",
    impact:
      "A temporary redirect asks search engines to keep the old URL, which is rarely what is wanted.",
    action: "Change it to a 301 if the move is permanent.",
    owner: "technical-seo",
    provenance: "seeded",
  },

  // -- Crawl --------------------------------------------------------------
  "orphan-page": {
    label: "Orphan page",
    category: "crawl",
    severity: "high",
    description: "No internal link anywhere on the site points at this page.",
    impact:
      "Nothing passes authority to it and a crawler only finds it through the sitemap, so it ranks well below what it could.",
    action: "Link it from its cluster hub and from two related pages.",
    owner: "content-strategist",
    provenance: "derived",
  },
  "deep-page": {
    label: "Buried page",
    category: "crawl",
    severity: "medium",
    description: "More than four clicks from the home page.",
    impact: "Depth reads as low importance and slows how often it is re-crawled.",
    action: "Add a link from a hub or a navigation block closer to the top.",
    owner: "content-strategist",
    provenance: "derived",
  },
  "blocked-by-robots": {
    label: "Blocked by robots.txt",
    category: "robots",
    severity: "high",
    description: "A disallow rule stops the page being requested.",
    impact:
      "The page cannot be read at all, and any directive on it is never seen.",
    action:
      "Confirm the block is deliberate. If it is not, remove the rule and request a crawl.",
    owner: "technical-seo",
    provenance: "seeded",
  },

  // -- Indexation ---------------------------------------------------------
  "indexable-not-indexed": {
    label: "Not indexed",
    category: "indexation",
    severity: "high",
    description: "The page is open to indexing and is not in the index.",
    impact: "It cannot rank for anything while it is absent.",
    action:
      "Check internal links and duplication, strengthen the page, then request indexing.",
    owner: "technical-seo",
    provenance: "seeded",
  },
  "indexed-noindex-conflict": {
    label: "Indexed but noindex",
    category: "indexation",
    severity: "high",
    description: "The page is in the index while asking not to be.",
    impact:
      "One of the two is wrong, and until that is settled the page's status is unpredictable.",
    action: "Decide whether the page belongs in the index, then make both agree.",
    owner: "technical-seo",
    provenance: "derived",
  },
  "excluded-page": {
    label: "Excluded from the index",
    category: "indexation",
    severity: "low",
    description: "Kept out by a directive or a canonical we set ourselves.",
    impact:
      "Intentional in most cases — listed so the exclusions can be reviewed rather than assumed.",
    action: "Confirm the exclusion is still what is wanted.",
    owner: "technical-seo",
    provenance: "derived",
  },

  // -- Canonical ----------------------------------------------------------
  "canonical-conflict": {
    label: "Canonical conflict",
    category: "canonical",
    severity: "high",
    description:
      "The canonical contradicts a directive, the sitemap, or a redirect on the same URL.",
    impact:
      "Contradictory signals are resolved by the search engine, not by us, and rarely in our favour.",
    action: "Settle which URL is primary and make every signal say the same thing.",
    owner: "technical-seo",
    provenance: "derived",
  },
  "missing-canonical": {
    label: "No canonical tag",
    category: "canonical",
    severity: "medium",
    description: "The page nominates no canonical URL.",
    impact:
      "Parameterised and duplicated variants can be indexed instead of the page itself.",
    action: "Add a self-referencing canonical.",
    owner: "technical-seo",
    provenance: "derived",
  },

  // -- Sitemap ------------------------------------------------------------
  "missing-from-sitemap": {
    label: "Missing from the sitemap",
    category: "sitemap",
    severity: "medium",
    description: "An indexable page that is not submitted.",
    impact: "Discovery relies on internal links alone, which slows indexing.",
    action: "Add the URL to the sitemap and resubmit.",
    owner: "technical-seo",
    provenance: "derived",
  },
  "sitemap-index-mismatch": {
    label: "Submitted, not indexed",
    category: "sitemap",
    severity: "high",
    description: "The URL is in the sitemap and not in the index.",
    impact:
      "Submitting a URL that is then not kept usually means a quality or duplication problem, not a discovery one.",
    action:
      "Compare it against the page it may be duplicating, then improve or consolidate.",
    owner: "technical-seo",
    provenance: "derived",
  },
  "non-indexable-in-sitemap": {
    label: "Non-indexable in the sitemap",
    category: "sitemap",
    severity: "medium",
    description:
      "A URL that cannot be indexed is being submitted for indexing.",
    impact:
      "Mixed signals, and a sitemap that is less trusted as a whole because of it.",
    action: "Remove it from the sitemap, or make the page indexable.",
    owner: "technical-seo",
    provenance: "derived",
  },

  // -- Metadata -----------------------------------------------------------
  "title-too-short": {
    label: "Title too short",
    category: "metadata",
    severity: "low",
    description: "Under thirty characters.",
    impact: "Leaves room on the result unused and describes the page thinly.",
    action: "Extend the title with the primary term and a qualifier.",
    owner: "on-page-seo",
    provenance: "measured",
  },
  "title-too-long": {
    label: "Title too long",
    category: "metadata",
    severity: "low",
    description: "Over sixty characters.",
    impact: "The end is truncated in results, often where the qualifier sits.",
    action: "Tighten it, keeping the primary term at the front.",
    owner: "on-page-seo",
    provenance: "measured",
  },
  "missing-meta-description": {
    label: "No meta description",
    category: "metadata",
    severity: "medium",
    description: "The page has no description at all.",
    impact:
      "The snippet is assembled from body text, which usually reads worse than one written for it.",
    action: "Write a description of 70 to 160 characters.",
    owner: "on-page-seo",
    provenance: "measured",
  },
  "meta-description-length": {
    label: "Description length",
    category: "metadata",
    severity: "low",
    description: "Outside the 70 to 160 character range.",
    impact: "Truncated, or too thin to earn the click.",
    action: "Rewrite to fit the range.",
    owner: "on-page-seo",
    provenance: "measured",
  },
  "duplicate-title": {
    label: "Duplicate title",
    category: "metadata",
    severity: "medium",
    description: "Another page in the project uses the same title.",
    impact:
      "Two pages competing for the same result, and neither distinguishable in it.",
    action: "Differentiate the titles, or consolidate the pages.",
    owner: "on-page-seo",
    provenance: "measured",
  },
  "missing-h1": {
    label: "No H1",
    category: "metadata",
    severity: "medium",
    description: "The page has no top-level heading.",
    impact: "The page's subject is left to be inferred from the body.",
    action: "Add a single H1 carrying the primary term.",
    owner: "on-page-seo",
    provenance: "seeded",
  },

  // -- Links --------------------------------------------------------------
  "few-internal-links": {
    label: "Thin internal support",
    category: "links",
    severity: "medium",
    description: "Fewer than three internal links point at the page.",
    impact: "Little authority reaches it, and it is crawled less often.",
    action: "Add links from the cluster hub and related pages.",
    owner: "content-strategist",
    provenance: "measured",
  },
  "broken-internal-link": {
    label: "Links to a broken page",
    category: "links",
    severity: "high",
    description: "The page links to a URL that does not resolve.",
    impact: "Dead ends for visitors and wasted crawl requests.",
    action: "Repoint the link at a live URL.",
    owner: "technical-seo",
    provenance: "derived",
  },
  "no-outbound-internal-links": {
    label: "No internal links out",
    category: "links",
    severity: "low",
    description: "The page links to nothing else on the site.",
    impact:
      "Authority stops here instead of flowing on to the rest of the cluster.",
    action: "Add contextual links to the cluster's other pages.",
    owner: "content-strategist",
    provenance: "measured",
  },

  // -- Performance --------------------------------------------------------
  "poor-lcp": {
    label: "Poor LCP",
    category: "performance",
    severity: "high",
    description: "Largest Contentful Paint is at or beyond four seconds.",
    impact: "Visitors leave before the main content appears.",
    action: "Prioritise the hero asset and cut render-blocking requests.",
    owner: "technical-seo",
    provenance: "seeded",
  },
  "poor-inp": {
    label: "Poor INP",
    category: "performance",
    severity: "medium",
    description: "Interaction to Next Paint is at or beyond half a second.",
    impact: "The page feels unresponsive to the first thing a visitor does.",
    action: "Break up long tasks and defer non-essential scripts.",
    owner: "technical-seo",
    provenance: "seeded",
  },
  "poor-cls": {
    label: "Poor CLS",
    category: "performance",
    severity: "medium",
    description: "Cumulative Layout Shift is at or beyond 0.25.",
    impact: "Content moves under the reader, which costs clicks and trust.",
    action: "Reserve space for images, embeds, and late-loading blocks.",
    owner: "technical-seo",
    provenance: "seeded",
  },
  "slow-page": {
    label: "Outside the good band",
    category: "performance",
    severity: "low",
    description: "No vital is poor, but the page does not pass overall.",
    impact: "A near miss on an assessment that is easier to hold than to regain.",
    action: "Improve whichever vital is furthest from its threshold.",
    owner: "technical-seo",
    provenance: "seeded",
  },

  // -- Schema -------------------------------------------------------------
  "missing-schema": {
    label: "No structured data",
    category: "schema",
    severity: "low",
    description: "No markup for what this page format calls for.",
    impact: "Rich results are unavailable and the page's entities go unstated.",
    action: "Add the schema types expected for this format.",
    owner: "technical-seo",
    provenance: "derived",
  },
  "invalid-schema": {
    label: "Invalid structured data",
    category: "schema",
    severity: "medium",
    description: "Markup is present but fails validation.",
    impact: "None of it is used, so the work is spent for nothing.",
    action: "Fix the invalid properties and re-validate.",
    owner: "technical-seo",
    provenance: "seeded",
  },
  "incomplete-schema": {
    label: "Incomplete structured data",
    category: "schema",
    severity: "low",
    description: "Some of the expected types are present.",
    impact: "Eligibility for the richer result formats is only partial.",
    action: "Complete the remaining types for this format.",
    owner: "technical-seo",
    provenance: "derived",
  },
};

/** Every check, in the order the registry raises them. */
export const ISSUE_TYPE_ORDER: readonly IssueType[] = Object.keys(
  ISSUE_TYPE_META,
) as IssueType[];
