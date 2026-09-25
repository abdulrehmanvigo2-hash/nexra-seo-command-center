/**
 * The crawl itself: a breadth-first walk of one host, inside fixed budgets.
 *
 * Breadth-first rather than depth-first because depth is one of the readings
 * this produces, and only a breadth-first frontier gives every page the
 * shortest link distance from the start URL rather than the first one found.
 *
 * Everything the engine cannot do without — fetching, resolving, the clock —
 * is injected. There is no `Date.now()` and no bare `fetch` in this file, so a
 * test can drive a whole crawl, including its time budget, without a network
 * and without waiting.
 *
 * The engine returns a result; it writes nothing. Persistence is the service's
 * job, which keeps the rules about what was observed separate from the rules
 * about what is stored.
 */

import {
  extractDocument,
  isNofollow,
  metaForbidsFollowing,
  metaForbidsIndexing,
  type ExtractedDocument,
} from "./extract.ts";
import { DOCUMENT_TYPES, fetchPage, type Fetch, type FetchOutcome } from "./fetcher.ts";
import type { AddressResolver } from "./network-guard.ts";
import { groupFor, isAllowed, parseRobots, robotsPath, type RobotsGroup } from "./robots.ts";
import { parseSitemap } from "./sitemap.ts";
import { isWithinHostScope, normaliseUrl } from "./url-policy.ts";
import type {
  CrawlBudget,
  CrawlDocumentState,
  CrawlFetchState,
  CrawlLink,
  CrawlStopReason,
} from "@/types/crawl";

/** How many requests may be in flight at once. One host, so: politely few. */
export const DEFAULT_CONCURRENCY = 3;

/** The longest `Crawl-delay` this crawler will honour, in milliseconds. */
export const MAX_CRAWL_DELAY_MS = 5_000;

/** What the engine records for one URL. Storage shapes come later. */
export type CrawledPage = {
  readonly url: string;
  readonly finalUrl: string | null;
  readonly fetchState: CrawlFetchState;
  readonly httpStatus: number | null;
  readonly redirectHops: number;
  readonly redirectChain: readonly string[];
  readonly contentType: string | null;
  readonly contentBytes: number | null;
  readonly robotsMeta: string | null;
  readonly robotsTxtAllowed: boolean | null;
  readonly canonicalHref: string | null;
  readonly canonicalResolved: string | null;
  readonly canonicalIsSelf: boolean | null;
  readonly title: string | null;
  readonly titleLength: number | null;
  readonly metaDescription: string | null;
  readonly metaDescriptionLength: number | null;
  readonly h1Count: number | null;
  readonly firstH1: string | null;
  readonly h2Count: number | null;
  readonly h3Count: number | null;
  readonly imageCount: number | null;
  readonly imagesWithoutAlt: number | null;
  readonly xRobotsTag: string | null;
  readonly robotsNoindex: boolean | null;
  readonly robotsNofollow: boolean | null;
  readonly wordCount: number | null;
  readonly htmlLang: string | null;
  readonly hreflangCount: number | null;
  readonly hreflangMalformed: number | null;
  readonly ogTagCount: number | null;
  readonly ogTitle: string | null;
  readonly ogImage: string | null;
  readonly twitterCard: string | null;
  readonly responseMs: number | null;
  readonly schemaTypes: readonly string[];
  readonly schemaBlocks: number;
  readonly schemaParseFailed: boolean;
  readonly inSitemap: boolean | null;
  readonly depth: number | null;
  readonly internalLinksIn: number;
  readonly internalLinksOut: number;
  readonly fetchedAt: string | null;
  readonly errorCode: string | null;
};

export type CrawlResult = {
  readonly pages: readonly CrawledPage[];
  readonly links: readonly Omit<CrawlLink, "crawlId">[];
  readonly robotsState: CrawlDocumentState;
  readonly sitemapState: CrawlDocumentState;
  readonly stopReason: CrawlStopReason;
  readonly pagesDiscovered: number;
  readonly pagesFetched: number;
  readonly pagesFailed: number;
  /** Set only when the crawl could not begin at all. */
  readonly startFailure: "blocked-by-robots" | "start-unreachable" | "start-unsafe" | null;
};

export type EngineOptions = {
  readonly startUrl: string;
  readonly hostScope: string;
  readonly userAgent: string;
  readonly budget: CrawlBudget;
  readonly concurrency?: number;
  readonly fetch?: Fetch;
  readonly resolve?: AddressResolver;
  /** Monotonic milliseconds. Injected so a time budget is testable. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
};

type Queued = { readonly url: string; readonly depth: number };

/**
 * What the engine records for a URL, including outcomes the fetcher never
 * produces because no request was made: a URL robots.txt put out of bounds,
 * and one a budget left unvisited. Both are findings and both get a row.
 */
type PageOutcome =
  | FetchOutcome
  | {
      readonly ok: false;
      readonly finalUrl: null;
      readonly redirectChain: readonly [];
      readonly state: Extract<CrawlFetchState, "blocked-by-robots" | "budget-skipped">;
    };

/** A fetch failure's state doubles as its stored error code. */
function errorCodeFor(state: CrawlFetchState): string | null {
  return state === "fetched" ? null : state;
}

function toPage(
  url: string,
  depth: number | null,
  outcome: PageOutcome,
  extracted: ExtractedDocument | null,
  context: {
    readonly robotsTxtAllowed: boolean | null;
    readonly inSitemap: boolean | null;
    readonly fetchedAt: string | null;
  },
): CrawledPage {
  const base: Omit<
    CrawledPage,
    | "finalUrl"
    | "fetchState"
    | "httpStatus"
    | "redirectHops"
    | "redirectChain"
    | "contentType"
    | "contentBytes"
  > = {
    url,
    robotsMeta: extracted?.robotsMeta ?? null,
    robotsTxtAllowed: context.robotsTxtAllowed,
    canonicalHref: extracted?.canonicalHref ?? null,
    canonicalResolved: null,
    canonicalIsSelf: null,
    title: extracted?.title ?? null,
    titleLength: extracted?.title == null ? null : extracted.title.length,
    metaDescription: extracted?.metaDescription ?? null,
    metaDescriptionLength:
      extracted?.metaDescription == null ? null : extracted.metaDescription.length,
    h1Count: extracted?.h1Count ?? null,
    firstH1: extracted?.firstH1 ?? null,
    h2Count: extracted?.h2Count ?? null,
    h3Count: extracted?.h3Count ?? null,
    imageCount: extracted?.imageCount ?? null,
    imagesWithoutAlt: extracted?.imagesWithoutAlt ?? null,
    // Header and derived robots readings need a response; set below when one arrived.
    xRobotsTag: null,
    // M2 content signals: read off the parsed HTML alone, so a URL that never
    // answered, or answered with something other than HTML, keeps them null.
    wordCount: extracted?.wordCount ?? null,
    htmlLang: extracted?.htmlLang ?? null,
    hreflangCount: extracted?.hreflangCount ?? null,
    hreflangMalformed: extracted?.hreflangMalformed ?? null,
    ogTagCount: extracted?.ogTagCount ?? null,
    ogTitle: extracted?.ogTitle ?? null,
    ogImage: extracted?.ogImage ?? null,
    twitterCard: extracted?.twitterCard ?? null,
    responseMs: null,
    robotsNoindex: null,
    robotsNofollow: null,
    schemaTypes: extracted?.schemaTypes ?? [],
    schemaBlocks: extracted?.schemaBlocks ?? 0,
    schemaParseFailed: extracted?.schemaParseFailed ?? false,
    inSitemap: context.inSitemap,
    depth,
    // Both counts are filled in after the walk, from the edges it recorded:
    // the raw anchor list is not a link count, since it still holds
    // duplicates, fragments, mailto and other non-URLs, and external targets.
    internalLinksIn: 0,
    internalLinksOut: 0,
    fetchedAt: context.fetchedAt,
    errorCode: null,
  };

  if (!outcome.ok) {
    return {
      ...base,
      finalUrl: outcome.finalUrl,
      fetchState: outcome.state,
      httpStatus: null,
      redirectHops: outcome.redirectChain.length,
      redirectChain: outcome.redirectChain,
      contentType: null,
      contentBytes: null,
      errorCode: errorCodeFor(outcome.state),
    };
  }

  // The canonical is resolved against `<base href>` when the page declares
  // one, exactly as a browser would, and against the final URL otherwise.
  const resolveBase = extracted?.baseHref ?? outcome.finalUrl;
  let canonicalResolved: string | null = null;
  if (extracted?.canonicalHref != null) {
    const resolved = normaliseUrl(extracted.canonicalHref, resolveBase);
    canonicalResolved = resolved.ok ? resolved.url : null;
  }

  // Both robots readings take the meta tag and the header together. A page
  // with neither said nothing forbidding, which is a fact about the response;
  // only a URL with no response at all stays unknown (null, above).
  const robotsMeta = extracted?.robotsMeta ?? null;

  return {
    ...base,
    finalUrl: outcome.finalUrl,
    fetchState: outcome.state,
    httpStatus: outcome.status,
    xRobotsTag: outcome.xRobotsTag,
    // Timing is a property of the response, HTML or not.
    responseMs: outcome.responseMs,
    robotsNoindex: metaForbidsIndexing(robotsMeta) || metaForbidsIndexing(outcome.xRobotsTag),
    robotsNofollow: metaForbidsFollowing(robotsMeta) || metaForbidsFollowing(outcome.xRobotsTag),
    redirectHops: outcome.redirectChain.length,
    redirectChain: outcome.redirectChain,
    contentType: outcome.contentType,
    contentBytes: outcome.contentBytes,
    canonicalResolved,
    canonicalIsSelf: canonicalResolved === null ? null : canonicalResolved === outcome.finalUrl,
    errorCode: errorCodeFor(outcome.state),
  };
}

/**
 * Runs one crawl.
 *
 * Stops on the first of: an empty frontier (`completed`), the page budget, or
 * the time budget. A budgeted stop is reported honestly — the pages it did
 * reach are real observations, and the ones it did not are recorded as
 * `budget-skipped` rather than omitted, so nothing downstream can mistake
 * "not looked at" for "not there".
 */
export async function runCrawl(options: EngineOptions): Promise<CrawlResult> {
  const {
    startUrl,
    hostScope,
    userAgent,
    budget,
    concurrency = DEFAULT_CONCURRENCY,
    fetch: send,
    resolve,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    timeoutMs,
    maxBodyBytes,
  } = options;

  const startedAt = now();
  const outOfTime = (): boolean => now() - startedAt >= budget.maxDurationMs;

  const fetchOne = (url: string): Promise<FetchOutcome> =>
    fetchPage(url, { userAgent, hostScope, fetch: send, resolve, timeoutMs, maxBodyBytes });

  /** robots.txt and sitemaps are not HTML, so they are read under their own types. */
  const fetchDocument = (url: string): Promise<FetchOutcome> =>
    fetchPage(url, {
      userAgent,
      hostScope,
      fetch: send,
      resolve,
      timeoutMs,
      maxBodyBytes,
      accept: DOCUMENT_TYPES,
    });

  // --- robots.txt -------------------------------------------------------
  // Read first and obeyed throughout. A file we could not read is not
  // permission: `unavailable` leaves `robotsTxtAllowed` null on every page.
  const origin = new URL(startUrl).origin;
  let robotsState: CrawlDocumentState = "unavailable";
  let robotsGroup: RobotsGroup | null = null;
  let declaredSitemaps: readonly string[] = [];

  const robotsOutcome = await fetchDocument(`${origin}/robots.txt`);
  if (robotsOutcome.ok && robotsOutcome.status === 404) {
    robotsState = "absent";
  } else if (robotsOutcome.ok && robotsOutcome.status < 400 && robotsOutcome.body !== null) {
    const file = parseRobots(robotsOutcome.body);
    robotsGroup = groupFor(file, userAgent);
    declaredSitemaps = file.sitemaps;
    robotsState = "fetched";
  }

  const allowedByRobots = (url: string): boolean | null => {
    if (robotsState === "unavailable") return null;
    if (robotsState === "absent") return true;
    return isAllowed(robotsGroup, robotsPath(new URL(url)));
  };

  const crawlDelayMs = Math.min(
    (robotsGroup?.crawlDelaySeconds ?? 0) * 1_000,
    MAX_CRAWL_DELAY_MS,
  );

  const startAllowed = allowedByRobots(startUrl);
  if (startAllowed === false) {
    return {
      pages: [],
      links: [],
      robotsState,
      sitemapState: "unavailable",
      stopReason: "error",
      pagesDiscovered: 0,
      pagesFetched: 0,
      pagesFailed: 0,
      startFailure: "blocked-by-robots",
    };
  }

  // --- sitemaps ---------------------------------------------------------
  // Membership is only ever `true` for a URL a sitemap actually listed. When
  // no sitemap could be read the whole signal stays null: unknown, not false.
  const sitemapUrls = new Set<string>();
  let sitemapState: CrawlDocumentState = "unavailable";
  let sitemapSeen = false;

  const readSitemap = async (url: string, depth: number): Promise<void> => {
    if (depth > 1 || outOfTime()) return;
    const outcome = await fetchDocument(url);
    if (!outcome.ok) return;
    if (outcome.status === 404) {
      // The origin says there is no sitemap here. That is a reading, not a
      // failure to read, so long as nothing else was found.
      if (!sitemapSeen) sitemapState = "absent";
      return;
    }
    if (outcome.status >= 400 || outcome.body === null) return;
    const document = parseSitemap(outcome.body);
    sitemapState = "fetched";
    sitemapSeen = true;
    for (const entry of document.urls) {
      const normalised = normaliseUrl(entry);
      if (normalised.ok && isWithinHostScope(normalised.parsed.hostname, hostScope)) {
        sitemapUrls.add(normalised.url);
      }
    }
    for (const child of document.children) await readSitemap(child, depth + 1);
  };

  const sitemapCandidates = declaredSitemaps.length > 0 ? declaredSitemaps : [`${origin}/sitemap.xml`];
  for (const candidate of sitemapCandidates) {
    const normalised = normaliseUrl(candidate);
    if (normalised.ok) await readSitemap(normalised.url, 0);
  }
  if (sitemapSeen) sitemapState = "fetched";

  const inSitemap = (url: string): boolean | null =>
    sitemapState === "fetched" ? sitemapUrls.has(url) : null;

  // --- the walk ---------------------------------------------------------
  const pages = new Map<string, CrawledPage>();
  const links: Omit<CrawlLink, "crawlId">[] = [];
  const linkKeys = new Set<string>();
  const inboundCounts = new Map<string, number>();
  const outboundCounts = new Map<string, number>();
  const known = new Set<string>([startUrl]);
  let frontier: Queued[] = [{ url: startUrl, depth: 0 }];
  let stopReason: CrawlStopReason = "completed";
  let startFailure: CrawlResult["startFailure"] = null;

  const recordLink = (from: string, to: string, rel: string | null, isInternal: boolean, anchorText: string): void => {
    const key = `${from}\u0000${to}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ fromUrl: from, toUrl: to, rel, isInternal, anchorText });
    // One distinct internal edge counts once on each end. Every source is a
    // fetched page, so the pages' outbound counts sum to the crawl's internal
    // edge count; a target that was never queued (a nofollow link) has an
    // inbound count and no page row, so the inbound side has no such sum.
    if (isInternal) {
      inboundCounts.set(to, (inboundCounts.get(to) ?? 0) + 1);
      outboundCounts.set(from, (outboundCounts.get(from) ?? 0) + 1);
    }
  };

  while (frontier.length > 0) {
    if (outOfTime()) {
      stopReason = "time-budget";
      break;
    }
    if (pages.size >= budget.maxPages) {
      stopReason = "page-budget";
      break;
    }

    const room = budget.maxPages - pages.size;
    const batch = frontier.splice(0, Math.min(concurrency, room));
    const next: Queued[] = [];

    const results = await Promise.all(
      batch.map(async (item): Promise<{ readonly item: Queued; readonly page: CrawledPage }> => {
        const allowed = allowedByRobots(item.url);
        if (allowed === false) {
          return {
            item,
            page: toPage(
              item.url,
              item.depth,
              { ok: false, finalUrl: null, redirectChain: [], state: "blocked-by-robots" },
              null,
              { robotsTxtAllowed: false, inSitemap: inSitemap(item.url), fetchedAt: null },
            ),
          };
        }

        const outcome = await fetchOne(item.url);
        const extracted =
          outcome.ok && outcome.body !== null ? extractDocument(outcome.body) : null;
        const page = toPage(item.url, item.depth, outcome, extracted, {
          robotsTxtAllowed: allowed,
          inSitemap: inSitemap(item.url),
          fetchedAt: new Date().toISOString(),
        });

        // A nofollow directive in the response header is honoured exactly as
        // one in the page's meta tag: no edge recorded, nothing queued.
        const headerForbidsFollowing = outcome.ok && metaForbidsFollowing(outcome.xRobotsTag);
        if (extracted !== null && !metaForbidsFollowing(extracted.robotsMeta) && !headerForbidsFollowing) {
          const base = extracted.baseHref ?? outcome.finalUrl ?? item.url;
          for (const link of extracted.links) {
            const resolved = normaliseUrl(link.href, base);
            if (!resolved.ok) continue;
            const internal = isWithinHostScope(resolved.parsed.hostname, hostScope);
            recordLink(item.url, resolved.url, link.rel, internal, link.text);
            if (!internal || isNofollow(link.rel)) continue;
            if (known.has(resolved.url)) continue;
            if (item.depth + 1 > budget.maxDepth) continue;
            known.add(resolved.url);
            next.push({ url: resolved.url, depth: item.depth + 1 });
          }
        }
        return { item, page };
      }),
    );

    for (const { item, page } of results) {
      pages.set(item.url, page);
      if (item.url === startUrl && page.fetchState !== "fetched") {
        if (page.fetchState === "refused-unsafe") startFailure = "start-unsafe";
        else if (page.fetchState === "blocked-by-robots") startFailure = "blocked-by-robots";
        else if (page.fetchState !== "http-error" && page.fetchState !== "non-html") {
          startFailure = "start-unreachable";
        }
      }
    }

    frontier = [...frontier, ...next];
    if (crawlDelayMs > 0 && frontier.length > 0) await sleep(crawlDelayMs);
  }

  // Anything discovered and never reached is recorded as such, so the record
  // distinguishes "we did not look" from "there is nothing there".
  for (const item of frontier) {
    if (pages.has(item.url)) continue;
    pages.set(
      item.url,
      toPage(
        item.url,
        item.depth,
        { ok: false, finalUrl: null, redirectChain: [], state: "budget-skipped" },
        null,
        { robotsTxtAllowed: allowedByRobots(item.url), inSitemap: inSitemap(item.url), fetchedAt: null },
      ),
    );
  }

  const withCounts = [...pages.values()].map((page) => ({
    ...page,
    internalLinksIn: inboundCounts.get(page.url) ?? 0,
    internalLinksOut: outboundCounts.get(page.url) ?? 0,
  }));

  return {
    pages: withCounts,
    links,
    robotsState,
    sitemapState,
    stopReason: startFailure !== null ? "error" : stopReason,
    pagesDiscovered: known.size,
    pagesFetched: withCounts.filter((page) => page.fetchState === "fetched").length,
    pagesFailed: withCounts.filter(
      (page) => page.fetchState !== "fetched" && page.fetchState !== "budget-skipped",
    ).length,
    startFailure,
  };
}
