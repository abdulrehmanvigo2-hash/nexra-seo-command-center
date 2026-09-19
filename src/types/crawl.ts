/**
 * Shapes for crawling a real website.
 *
 * The first part of the product that reaches a site the agency does not
 * control. Everything here describes one HTTP exchange with one URL: what was
 * asked for, what came back, or why nothing did. Nothing in this file models a
 * page, an issue, or a score — a crawl result is evidence, and reading meaning
 * out of it belongs to the layers above.
 *
 * Every failure is a value, not an exception. A crawl walks thousands of URLs
 * and most of the interesting ones fail; a refusal has to be as storable and as
 * countable as a success.
 */

/** Why a URL may not be fetched at all. Checked before any request is made. */
export type UrlRefusal =
  /** Not http or https. */
  | "scheme"
  /** Userinfo in the URL (`https://user:pass@host`). */
  | "credentials"
  /** A port other than the scheme's default. */
  | "port"
  /** An IP address rather than a hostname. */
  | "ip-literal"
  /** Not a resolvable public hostname shape. */
  | "hostname"
  /** Longer than the crawler will store. */
  | "too-long"
  /** Resolves to a loopback, private, link-local or otherwise internal address. */
  | "private-address"
  /** The hostname does not resolve. */
  | "dns"
  /** Outside the site being crawled. */
  | "off-site";

export type UrlCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly refusal: UrlRefusal };

/** Why a fetch produced no usable body. */
export type FetchFailure =
  /** The URL policy refused it; no request was made. See `refusal`. */
  | "refused"
  /** No answer within the timeout. */
  | "timeout"
  /** Connection refused, reset, TLS failure, DNS failure at connect time. */
  | "network"
  /** More redirects than the crawler will follow. */
  | "too-many-redirects"
  /** A redirect pointed somewhere the policy refuses. */
  | "redirect-refused"
  /** The body exceeded the byte cap. */
  | "too-large"
  /** Not a content type the crawler reads. */
  | "unsupported-type"
  /** robots.txt disallows this URL for our user agent. */
  | "robots-disallowed";

/** One hop in a redirect chain. */
export type RedirectHop = {
  readonly url: string;
  readonly status: number;
  readonly location: string;
};

/**
 * The outcome of asking for one URL.
 *
 * `fetched` means the server answered and the body was read — including a 404
 * or a 500, which are findings, not failures. `failed` means there is no body
 * to reason about, and says why.
 */
export type FetchOutcome =
  | {
      readonly state: "fetched";
      /** The URL actually fetched, after redirects. */
      readonly url: string;
      readonly status: number;
      readonly contentType: string | null;
      readonly body: string;
      readonly bytes: number;
      /** Whole-exchange duration in milliseconds, redirects included. */
      readonly elapsedMs: number;
      readonly redirects: readonly RedirectHop[];
    }
  | {
      readonly state: "failed";
      readonly url: string;
      readonly failure: FetchFailure;
      /**
       * Which rule refused the URL, for `refused` and `redirect-refused`.
       * Null for every other failure — "the site did not answer" and "we
       * declined to ask" are different findings and must not read alike.
       */
      readonly refusal: UrlRefusal | null;
      readonly elapsedMs: number;
      readonly redirects: readonly RedirectHop[];
    };

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/** One `allow` or `disallow` line, kept with its precedence length. */
export type RobotsRule = {
  readonly allow: boolean;
  /** The path pattern, which may contain `*` and a trailing `$`. */
  readonly pattern: string;
};

/** The directives that apply to one set of user agents. */
export type RobotsGroup = {
  /** Lower-cased agent tokens this group names; `*` is the catch-all. */
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
  /** Seconds the file asks callers to wait between requests, if stated. */
  readonly crawlDelaySeconds: number | null;
};

/**
 * A parsed robots.txt, or the reason it could not be read.
 *
 * `missing` (404) means everything is allowed — the file is optional.
 * `unavailable` (5xx, timeout, refused) means nothing is allowed: a site that
 * cannot tell us its rules has not consented to being crawled, and guessing in
 * our own favour is how a crawler gets banned.
 */
export type RobotsPolicy =
  | {
      readonly state: "parsed";
      readonly groups: readonly RobotsGroup[];
      /** Absolute sitemap URLs the file advertises. */
      readonly sitemaps: readonly string[];
    }
  | { readonly state: "missing" }
  | { readonly state: "unavailable" };

// ---------------------------------------------------------------------------
// Sitemaps
// ---------------------------------------------------------------------------

/** Where a sitemap document came from. */
export type SitemapSource =
  /** A `Sitemap:` line in robots.txt. */
  | "robots"
  /** The conventional `/sitemap.xml`, tried when robots.txt named none. */
  | "well-known"
  /** Listed inside a sitemap index. */
  | "index";

/** What one sitemap document turned out to be. */
export type SitemapKind = "urlset" | "sitemapindex" | "unknown";

/** One sitemap the discovery pass tried to read. */
export type SitemapDocument = {
  readonly url: string;
  readonly source: SitemapSource;
  readonly kind: SitemapKind;
  /** `<loc>` entries found, before deduplication or policy filtering. */
  readonly locations: number;
  /** Null when the document was read; otherwise why it was not. */
  readonly failure: FetchFailure | "malformed" | null;
};

/** One page URL a crawl found, and where it was listed. */
export type DiscoveredUrl = {
  readonly url: string;
  readonly source: SitemapSource | "homepage";
};

/** Why a discovery pass stopped before it had read everything. */
export type DiscoveryLimit = "sitemaps" | "urls" | "depth";

/**
 * Everything one discovery pass found.
 *
 * Always a result, never an exception: a site with no sitemap, a malformed one,
 * or one that could not be served is an ordinary finding, and the crawl that
 * follows needs to know which of those happened.
 */
export type SitemapDiscovery = {
  readonly urls: readonly DiscoveredUrl[];
  readonly documents: readonly SitemapDocument[];
  readonly robots: RobotsPolicy["state"];
  /** Limits that were reached; empty when the site was read in full. */
  readonly limits: readonly DiscoveryLimit[];
};

// ---------------------------------------------------------------------------
// The stored record
// ---------------------------------------------------------------------------

/** Where a crawl is in its lifecycle. Mirrors the table's own check. */
export type CrawlStatus =
  | "queued"
  | "discovering"
  /** Discovery handed over; the queued pages are being fetched. */
  | "fetching"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Every bound a crawl can hit, discovery's and the fetch stage's.
 *
 * Recorded on the crawl so nothing downstream can read a partial pass as a
 * complete one.
 */
export type CrawlLimit = DiscoveryLimit | "pages";

/**
 * A discovery result as the crawl records it.
 *
 * Same shape, but its limits may include one discovery cannot produce: the
 * page cap is applied after the sitemaps are read, and it belongs on the same
 * list so nothing has to look in two places to learn a crawl is a sample.
 */
export type RecordedDiscovery = Omit<SitemapDiscovery, "limits"> & {
  readonly limits: readonly CrawlLimit[];
};

/**
 * Why a crawl stopped early. A fixed code, never exception text: the row
 * outlives the request that wrote it, and an error message can quote a URL.
 */
export type CrawlFailureCode =
  /** The site would not serve robots.txt, so it has not consented to a crawl. */
  | "robots-unavailable"
  /** The project's own domain failed the URL policy. */
  | "site-refused"
  /** Nothing to read: no sitemap, and none could be found. */
  | "no-sitemap"
  | "store-error"
  | "timeout";

/** What asked for a crawl. */
export type CrawlSource = "operator" | "schedule";

/** One discovery pass over one project's website, as it is stored. */
export type Crawl = {
  readonly id: string;
  readonly projectId: string;
  /** The host visited, as resolved when the crawl was created. */
  readonly site: string;
  readonly status: CrawlStatus;
  /** Null until the pass has read robots.txt. */
  readonly robotsState: RobotsPolicy["state"] | null;
  readonly sitemapCount: number;
  readonly discoveredCount: number;
  /** Non-empty means the crawl is a sample, never a complete list. */
  readonly limits: readonly CrawlLimit[];
  /** Pages queued for fetching. Zero until discovery hands over. */
  readonly pagesTotal: number;
  /** Pages the server answered, whatever the status. */
  readonly pagesFetched: number;
  /** Pages with no answer: timeout, connection, too large, lease lost. */
  readonly pagesFailed: number;
  /** Pages not requested: refused by policy, robots, or past a limit. */
  readonly pagesSkipped: number;
  readonly failureCode: CrawlFailureCode | null;
  /** Supabase Auth user id of the operator who asked, where one did. */
  readonly createdBy: string | null;
  readonly source: CrawlSource;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly updatedAt: string;
};

// ---------------------------------------------------------------------------
// One discovered URL, and what it answered
// ---------------------------------------------------------------------------

/**
 * Where one URL is in the fetch stage.
 *
 * `pending` is the queue. `fetched` means the server answered — a 404 and a
 * 500 are answers, and findings, not failures. The three ends that are not an
 * answer are kept apart on purpose: `failed` is "we asked and got nothing",
 * `refused` is "the URL policy would not let us ask", and `skipped` is "we
 * chose not to ask", which is what robots.txt and a reached limit produce.
 */
export type CrawlPageState =
  | "pending"
  | "fetching"
  | "fetched"
  | "failed"
  | "refused"
  | "skipped";

/** Why a page was deliberately not requested. */
export type CrawlPageSkipReason = "robots-disallowed" | "page-limit";

/** A failure the fetch stage can record beyond the fetcher's own set. */
export type CrawlPageFailure = FetchFailure | "lease-expired";

/** One discovered URL and everything observed about it. Facts only. */
export type CrawlPage = {
  readonly crawlId: string;
  readonly url: string;
  readonly state: CrawlPageState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly httpStatus: number | null;
  /** Where the request ended up, after redirects. */
  readonly finalUrl: string | null;
  readonly redirects: readonly RedirectHop[];
  readonly contentType: string | null;
  readonly bytes: number | null;
  readonly durationMs: number | null;
  readonly failure: CrawlPageFailure | null;
  readonly refusal: UrlRefusal | null;
  readonly skipReason: CrawlPageSkipReason | null;
  readonly discoveredAt: string;
  readonly fetchedAt: string | null;
};

/** A leased page, with the token a result must be recorded against. */
export type ClaimedPage = CrawlPage & { readonly leaseToken: string };

/** What one attempt at one URL concluded. Written back under the lease. */
export type PageObservation =
  | {
      readonly state: "fetched";
      readonly httpStatus: number;
      readonly finalUrl: string;
      readonly redirects: readonly RedirectHop[];
      readonly contentType: string | null;
      readonly bytes: number;
      readonly durationMs: number;
      /**
       * Read from the response body while the fetch pass still held it. The
       * body itself is never stored and never leaves that function.
       */
      readonly signals: PageSignals;
    }
  | {
      readonly state: "failed";
      readonly failure: CrawlPageFailure;
      readonly refusal: UrlRefusal | null;
      readonly redirects: readonly RedirectHop[];
      readonly durationMs: number;
    }
  | { readonly state: "refused"; readonly refusal: UrlRefusal }
  | { readonly state: "skipped"; readonly skipReason: CrawlPageSkipReason };

/** What one slice of the fetch stage did. */
export type FetchPassResult = {
  readonly claimed: number;
  readonly fetched: number;
  readonly failed: number;
  readonly skipped: number;
  readonly recovered: number;
  /** Why the slice stopped, so a caller knows whether to come back. */
  readonly stoppedBy: "empty" | "budget" | "batch-limit";
  readonly remaining: number;
};

// ---------------------------------------------------------------------------
// On-page signals
// ---------------------------------------------------------------------------

/**
 * How reading one response's signals went.
 *
 * `not-html` is not a failure: a PDF or an image is a fact about the page, and
 * calling it a parse error would put it beside genuinely broken markup.
 */
export type SignalState =
  /** HTML, read successfully. Absent values are null; nothing is invented. */
  | "parsed"
  /** The server answered with something that is not HTML. */
  | "not-html"
  /** HTML, but nothing in the body. */
  | "empty"
  /** The extractor itself could not finish. */
  | "failed";

/**
 * The factual on-page signals of one page.
 *
 * Observations, not judgements: what the document says, with no view on
 * whether a missing description or three `h1`s is a problem. Multiple headings
 * are kept as they were found, because choosing one is already an opinion.
 *
 * Every value is null where the page did not carry it, and the numeric fields
 * are null for anything but a `parsed` page — a word count of zero on a PDF
 * would be a measurement nobody made.
 */
export type PageSignals = {
  readonly state: SignalState;
  readonly title: string | null;
  readonly metaDescription: string | null;
  /** As written in the document, not resolved. */
  readonly canonicalUrl: string | null;
  /** The generic `robots` meta, lower-cased; not `googlebot` or another agent. */
  readonly metaRobots: string | null;
  readonly h1: readonly string[];
  readonly h2: readonly string[];
  readonly wordCount: number | null;
  /** Links to the crawled host. */
  readonly internalLinks: number | null;
  /** Links to any other host. */
  readonly externalLinks: number | null;
  /** Fragments, mailto/tel/javascript, and hrefs that do not parse. */
  readonly otherLinks: number | null;
  readonly parsedAt: string;
};
