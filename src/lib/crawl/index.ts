/**
 * The crawl boundary: how this product asks a real website for a page.
 *
 * The first step of the measurement pipeline and, for now, the whole of it.
 * Nothing above this module exists yet — there is no page inventory, no issue
 * detection and no crawl storage — and nothing in a request path calls any of
 * it. What is here is the part everything else will go through, built first
 * because it is the part that has to be right: the URLs a crawl follows come
 * from an operator-supplied domain and then from the site's own markup, so this
 * is where a request to somewhere this server should never reach gets refused.
 *
 * Read `url-policy.ts` before adding anything that fetches.
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
