/**
 * The crawl boundary: how this product asks a real website what it has.
 *
 * The beginning of the measurement pipeline. Three layers, and nothing above
 * them yet:
 *
 *   * `url-policy` decides what may be fetched at all. Read it before adding
 *     anything that reaches the network — the URLs a crawl follows come from an
 *     operator-supplied domain and then from the site's own markup, so this is
 *     where a request to somewhere this server should never reach is refused.
 *   * `fetcher` and `robots` make one polite request and obey the site's rules.
 *   * `sitemap` turns those into the list of pages a site says it has.
 *   * `contract` and `supabase/store` keep a pass, so a crawl is a record with
 *     a lifecycle rather than something that happened inside one request.
 *
 * Nothing in a request path calls any of it yet: there is no route, no UI and
 * no schedule. A first crawl composes from what is here — create a crawl, start
 * it, run `discoverSitemapUrls`, then `recordDiscovery` or `fail`.
 *
 * Import from here, not from the files behind it.
 */

export {
  CRAWLER_USER_AGENT,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  fetchPage,
  fetchRobots,
  type FetchPageOptions,
} from "@/lib/crawl/fetcher";

export {
  CRAWLER_TOKEN,
  MAX_CRAWL_DELAY_SECONDS,
  MAX_ROBOTS_BYTES,
  crawlDelayMs,
  groupFor,
  isAllowed,
  parseRobots,
  patternMatches,
} from "@/lib/crawl/robots";

export {
  MAX_URL_LENGTH,
  canonicaliseUrl,
  checkFetchableUrl,
  checkPublicAddress,
  checkUrl,
  isInternalAddress,
  type AddressLookup,
} from "@/lib/crawl/url-policy";

export {
  MAX_DISCOVERED_URLS,
  MAX_SITEMAP_BYTES,
  MAX_SITEMAP_DEPTH,
  MAX_SITEMAP_DOCUMENTS,
  discoverSitemapUrls,
  initialSitemaps,
  parseSitemap,
  type DiscoverOptions,
} from "@/lib/crawl/sitemap";

export type {
  CrawlStore,
  CreateCrawlInput,
  CreateCrawlResult,
} from "@/lib/crawl/contract";

export { CrawlStoreError, createSupabaseCrawlStore } from "@/lib/crawl/supabase/store";
export { type CrawlsDatabase } from "@/lib/crawl/supabase/schema";
