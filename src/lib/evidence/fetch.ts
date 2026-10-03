import { DOCUMENT_TYPES, fetchPage, type Fetch, type FetchOutcome } from "@/lib/crawl/fetcher";
import type { AddressResolver } from "@/lib/crawl/network-guard";
import { groupFor, isAllowed, parseRobots, robotsPath } from "@/lib/crawl/robots";
import { normaliseUrl } from "@/lib/crawl/url-policy";
import { extractPageText } from "@/lib/evidence/text";

/**
 * Fetching one outside page under the crawler's rules (M4, PR 5). The crawler's fetcher does the exchange — every
 * redirect hop through the address guard, a pinned connection, a 2 MB body bound, a 10 s timeout, the crawler's user
 * agent — confined to the page's own host (a redirect elsewhere is `off-site`; `www.` and the bare host are one).
 * robots.txt is read first and obeyed: a disallowed page is never requested; a robots.txt that could not be read (an
 * error or a 5xx) is not permission, so the page is not requested either (`robots-unreachable`); a missing robots.txt
 * (404 or another 4xx) allows. Only HTML is read; its visible text is kept, capped. No AI and no provider call.
 */

export type SourceFetchState =
  | "fetched" | "http-error" | "non-html" | "robots-disallowed" | "robots-unreachable" | "timeout" | "dns-error" | "connection-error"
  | "too-large" | "redirect-loop" | "too-many-redirects" | "refused-unsafe" | "off-site" | "no-text";

export type FetchedSource = {
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly state: SourceFetchState;
  readonly httpStatus: number | null;
  readonly robots: "allowed" | "disallowed" | "unreachable";
  readonly title: string | null;
  readonly text: string | null;
};

export type SourceFetchOptions = {
  readonly userAgent: string;
  readonly fetch?: Fetch;
  readonly resolve?: AddressResolver;
  readonly timeoutMs?: number;
};

/** The host a source fetch is confined to: the URL's host without a leading `www.`. */
export function sourceHostScope(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function stateOf(outcome: FetchOutcome): SourceFetchState {
  if (outcome.ok) return outcome.state;
  return outcome.state === "off-site" ? "off-site" : outcome.state;
}

export async function fetchSource(requestedUrl: string, options: SourceFetchOptions): Promise<FetchedSource> {
  const normalised = normaliseUrl(requestedUrl);
  const empty = { finalUrl: null, httpStatus: null, title: null, text: null } as const;
  if (!normalised.ok || (normalised.parsed.protocol !== "https:" && normalised.parsed.protocol !== "http:")) {
    return { requestedUrl, ...empty, state: "refused-unsafe", robots: "unreachable" };
  }
  const url = normalised.parsed;
  const hostScope = sourceHostScope(url);
  const base = { userAgent: options.userAgent, hostScope, fetch: options.fetch, resolve: options.resolve, timeoutMs: options.timeoutMs };

  const robotsOutcome = await fetchPage(`${url.origin}/robots.txt`, { ...base, accept: DOCUMENT_TYPES });
  let allowed: boolean;
  if (robotsOutcome.ok && robotsOutcome.status >= 400 && robotsOutcome.status < 500) {
    allowed = true;
  } else if (robotsOutcome.ok && robotsOutcome.status < 400 && robotsOutcome.body !== null) {
    allowed = isAllowed(groupFor(parseRobots(robotsOutcome.body), options.userAgent), robotsPath(url));
  } else if (!robotsOutcome.ok && robotsOutcome.state === "refused-unsafe") {
    return { requestedUrl, ...empty, state: "refused-unsafe", robots: "unreachable" };
  } else {
    return { requestedUrl, ...empty, state: "robots-unreachable", robots: "unreachable" };
  }
  if (!allowed) return { requestedUrl, ...empty, state: "robots-disallowed", robots: "disallowed" };

  const page = await fetchPage(normalised.url, base);
  if (!page.ok) return { requestedUrl, ...empty, finalUrl: page.finalUrl, state: stateOf(page), robots: "allowed" };
  if (page.state !== "fetched" || page.body === null) {
    return { requestedUrl, finalUrl: page.finalUrl, httpStatus: page.status, title: null, text: null, state: page.state === "fetched" ? "no-text" : page.state, robots: "allowed" };
  }
  const { title, text } = extractPageText(page.body);
  return { requestedUrl, finalUrl: page.finalUrl, httpStatus: page.status, title, text, state: text === null ? "no-text" : "fetched", robots: "allowed" };
}
