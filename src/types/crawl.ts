/**
 * Shapes for the Crawl Foundation (Backend Phase 7, Part 1).
 *
 * A crawl is what this product actually fetched from a project's own website,
 * and nothing else. It is kept apart from the Technical SEO module on purpose:
 * `@/types/technical` describes fixture-modelled figures, and mixing the two
 * vocabularies would make a modelled number indistinguishable from an observed
 * one. The mapping between them is a separate, later feature.
 *
 * Two things a crawler cannot know, and which therefore have no shape here:
 *
 *   * **Google indexation.** Whether a URL is in Google's index is Search
 *     Console's to report. A 200 response says the page exists, not that it is
 *     indexed, and no field in this file may be read as if it did.
 *   * **Core Web Vitals.** Field vitals come from real user measurement. A
 *     server-side fetch measures our own connection to the origin and nothing
 *     about anyone's experience of the page.
 */

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where a crawl figure came from.
 *
 * `observed` — read directly off an HTTP response or the bytes it returned.
 * `derived` — arithmetic or resolution over observed readings, computed by
 *   this product and reproducible from what is stored.
 * `unavailable` — not established. The crawl did not reach it, the signal was
 *   absent, or the source could not be parsed. Never a synonym for zero,
 *   false, or "fine": a null in this module means nobody looked or nobody
 *   could tell, and the presentation layer must say so.
 */
export type CrawlProvenance = "observed" | "derived" | "unavailable";

// ---------------------------------------------------------------------------
// Crawl run
// ---------------------------------------------------------------------------

/**
 * Where a crawl got to.
 *
 * `partial` is a first-class success, not a failure: a crawl that stopped on
 * its page or time budget observed everything it reports, and reporting it as
 * `completed` would imply the site holds no more pages.
 */
export type CrawlStatus = "running" | "completed" | "partial" | "failed" | "cancelled";

/** Why the engine stopped. Always set on a finished crawl. */
export type CrawlStopReason =
  /** The frontier drained: every reachable in-scope URL was visited. */
  | "completed"
  | "page-budget"
  | "time-budget"
  | "error"
  | "cancelled";

/** Whether a supporting document was read. */
export type CrawlDocumentState =
  /** Fetched and parsed. */
  | "fetched"
  /** The origin answered 404: the document does not exist. That is a fact. */
  | "absent"
  /** Could not be read, so nothing about it is known either way. */
  | "unavailable";

/** A crawl that could not start. Fixed codes; never an exception's text. */
export type CrawlFailureReason =
  /** Crawling is not switched on for this server. */
  | "disabled"
  /** The project's domain is not on the server's allow-list. */
  | "host-not-allowed"
  /** No such project. */
  | "unknown-project"
  /** The project has no usable website domain. */
  | "no-domain"
  /** robots.txt forbids this crawler from the start URL. */
  | "blocked-by-robots"
  /** The start URL never answered. */
  | "start-unreachable"
  /** The start URL resolved somewhere this crawler refuses to connect. */
  | "start-unsafe"
  /** Crawls are not persisted on this data source. */
  | "unavailable"
  /** The requested competitor domain is not a plain hostname. */
  | "competitor-invalid"
  /** The requested competitor domain is not one recorded for this project at intake. */
  | "competitor-not-recorded"
  /** The requested competitor domain is the project's own site, which is not a competitor. */
  | "competitor-is-project-site";

/**
 * Whose site a recorded crawl fetched.
 *
 * Derived, never stored: a crawl's `hostScope` is compared with the project's
 * stored domain (`@/lib/crawl/competitor-target`). A crawl of the project's
 * own host, or a subdomain of it, is the project's site; any other host the
 * project was allowed to crawl is a competitor's. The two are never listed
 * together and never reviewed by the same agent tasks.
 */
export type CrawlTarget = "project-site" | "competitor-site";

export type CrawlBudget = {
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly maxDurationMs: number;
};

export type Crawl = {
  readonly id: string;
  readonly projectId: string;
  readonly startUrl: string;
  /** Every fetch was confined to this host or a subdomain of it. */
  readonly hostScope: string;
  readonly status: CrawlStatus;
  readonly stopReason: CrawlStopReason | null;
  readonly budget: CrawlBudget;
  readonly userAgent: string;
  readonly robotsState: CrawlDocumentState;
  readonly sitemapState: CrawlDocumentState;
  readonly pagesDiscovered: number;
  readonly pagesFetched: number;
  readonly pagesFailed: number;
  readonly error: CrawlError | null;
  readonly createdBy: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
};

export type CrawlError = {
  readonly code: string;
  readonly message: string;
};

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * How the fetch of one URL ended.
 *
 * Every terminal state is recorded against the URL that reached it. A URL that
 * was discovered and never tried is `budget-skipped`, not absent from the
 * record: "we did not look" and "there is nothing there" are different
 * findings and the table keeps them apart.
 */
export type CrawlFetchState =
  /** An HTML response arrived and was parsed. */
  | "fetched"
  /** A response arrived with a 4xx or 5xx status. */
  | "http-error"
  /** The redirect chain returned to a URL it had already visited. */
  | "redirect-loop"
  | "too-many-redirects"
  | "timeout"
  | "dns-error"
  | "connection-error"
  /** The body exceeded the size cap and was abandoned. */
  | "too-large"
  /** A response arrived, but it was not HTML, so nothing was extracted. */
  | "non-html"
  /** robots.txt disallows this crawler here. Not fetched. */
  | "blocked-by-robots"
  /** The host or one of its addresses is one this crawler refuses. */
  | "refused-unsafe"
  /** Outside the crawl's host scope. Recorded as a link, never fetched. */
  | "off-site"
  /** Discovered, in scope, and never reached before a budget ran out. */
  | "budget-skipped";

/**
 * One URL as this crawl found it.
 *
 * Read the provenance comments as a contract. An `observed` field is what the
 * response said; a `derived` field is this product's arithmetic over observed
 * fields; `null` on either is `unavailable` and never a default value.
 */
export type CrawlPage = {
  readonly id: string;
  readonly crawlId: string;

  /** observed — normalised, and unique within the crawl. */
  readonly url: string;
  /** observed — where the chain ended. Null when never fetched. */
  readonly finalUrl: string | null;
  /** observed */
  readonly fetchState: CrawlFetchState;
  /** observed — null unless a response arrived. */
  readonly httpStatus: number | null;
  /** observed */
  readonly redirectHops: number;
  /** observed — every intermediate URL, in order. */
  readonly redirectChain: readonly string[];
  /** observed */
  readonly contentType: string | null;
  /** observed */
  readonly contentBytes: number | null;

  /** observed — the raw robots meta directive, as written on the page. */
  readonly robotsMeta: string | null;
  /** derived — this crawler's reading of robots.txt for this URL. */
  readonly robotsTxtAllowed: boolean | null;

  /** observed — the canonical href exactly as written. */
  readonly canonicalHref: string | null;
  /** derived — absolutised against the page's base URL. */
  readonly canonicalResolved: string | null;
  /** derived — null when the page declares no canonical at all. */
  readonly canonicalIsSelf: boolean | null;

  /** observed */
  readonly title: string | null;
  /** derived */
  readonly titleLength: number | null;
  /** observed */
  readonly metaDescription: string | null;
  /** derived */
  readonly metaDescriptionLength: number | null;
  /** observed */
  readonly h1Count: number | null;
  /** observed */
  readonly firstH1: string | null;
  /** observed — how many h2 elements the page carries. Null on a page recorded before T5, or never read. */
  readonly h2Count: number | null;
  /** observed — how many h3 elements the page carries. Null as above. */
  readonly h3Count: number | null;
  /** observed — how many img elements the page carries. Null as above. */
  readonly imageCount: number | null;
  /**
   * observed — img elements with no alt attribute at all. An empty alt is a
   * deliberate marker for a decorative image and counts as present. Null as above.
   */
  readonly imagesWithoutAlt: number | null;
  /** observed — the X-Robots-Tag response header as sent, or null when none was sent, no response arrived, or the page was recorded before T5. */
  readonly xRobotsTag: string | null;
  /**
   * derived — this crawler's reading of the robots meta and the X-Robots-Tag
   * header together: true when either says noindex or none. Null when no
   * response arrived or the page was recorded before T5; never a default.
   */
  readonly robotsNoindex: boolean | null;
  /** derived — as `robotsNoindex`, for nofollow or none. */
  readonly robotsNofollow: boolean | null;

  /** observed — JSON-LD `@type` values found on the page. */
  readonly schemaTypes: readonly string[];
  /** observed — how many `application/ld+json` blocks the page carries. */
  readonly schemaBlocks: number;
  /** observed — a block was present but would not parse. Recorded, not hidden. */
  readonly schemaParseFailed: boolean;

  /**
   * observed — null means unknown, which is what it is whenever the sitemap
   * could not be read. It is never collapsed to `false`.
   */
  readonly inSitemap: boolean | null;

  /** derived — link distance from the start URL. Null if never reached. */
  readonly depth: number | null;
  /** derived — counted within this crawl only, never site-wide. */
  readonly internalLinksIn: number;
  /** derived — counted within this crawl only, never site-wide. */
  readonly internalLinksOut: number;

  /** observed */
  readonly fetchedAt: string | null;
  /** observed — a fixed slug for a failure, never an exception's text. */
  readonly errorCode: string | null;
};

/** One edge of the link graph this crawl saw. */
export type CrawlLink = {
  readonly crawlId: string;
  readonly fromUrl: string;
  readonly toUrl: string;
  /** The `rel` attribute as written, or null. */
  readonly rel: string | null;
  readonly isInternal: boolean;
  /**
   * observed — the anchor's text, whitespace-collapsed and bounded; an image
   * link's alt text stands in when the anchor has no text of its own, as a
   * search engine reads it. Empty when the anchor carries neither; null on an
   * edge recorded before T5.
   */
  readonly anchorText: string | null;
};
