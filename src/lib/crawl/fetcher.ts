import "server-only";

import { CRAWLER_TOKEN, MAX_ROBOTS_BYTES, parseRobots } from "@/lib/crawl/robots";
import {
  canonicaliseUrl,
  checkFetchableUrl,
  type AddressLookup,
} from "@/lib/crawl/url-policy";
import type {
  FetchFailure,
  FetchOutcome,
  RedirectHop,
  RobotsPolicy,
  UrlRefusal,
} from "@/types/crawl";

/**
 * One polite HTTP request to a site the agency does not control.
 *
 * The only place in the product that fetches a crawled page, so every rule
 * about how this crawler behaves on someone else's server lives here: it says
 * who it is, it waits no longer than it should, it reads no more than it needs,
 * and it follows a bounded number of redirects, re-checking the policy at every
 * hop because each hop is a URL the site chose rather than one we did.
 *
 * Redirects are followed by hand (`redirect: "manual"`). Letting the runtime
 * follow them would hand a site the ability to bounce this server at an address
 * the policy exists to refuse, and would lose the chain — which is itself an
 * SEO finding worth keeping.
 *
 * Nothing here decides what a page means. It returns a body or a reason there
 * is none, and both are values: a crawl walks thousands of URLs and most of the
 * interesting ones fail, so a refusal has to be as ordinary as a success.
 */

/** Sent on every request, so a site owner can identify and block this crawler. */
export const CRAWLER_USER_AGENT = `Mozilla/5.0 (compatible; ${CRAWLER_TOKEN}/1.0; +https://nexra.example/bot)`;

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 2_000_000;
export const DEFAULT_MAX_REDIRECTS = 5;

/** Content types the crawler will read a body for. */
const HTML_TYPES = ["text/html", "application/xhtml+xml"] as const;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type FetchPageOptions = {
  /** Restricts the whole redirect chain to one host. */
  readonly site?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  /** Content-type prefixes to accept; defaults to HTML. */
  readonly accept?: readonly string[];
  readonly fetch?: Fetch;
  readonly lookup?: AddressLookup;
  readonly now?: () => number;
};

function failed(
  url: string,
  failure: FetchFailure,
  elapsedMs: number,
  redirects: readonly RedirectHop[],
  refusal: UrlRefusal | null = null,
): FetchOutcome {
  return { state: "failed", url, failure, refusal, elapsedMs, redirects };
}

/** The media type without its parameters, lower-cased. */
function mediaType(header: string | null): string | null {
  if (header === null) return null;
  return header.split(";")[0].trim().toLowerCase();
}

/**
 * Reads at most `maxBytes` from the response.
 *
 * Streamed rather than `response.text()`: a `Content-Length` can lie or be
 * absent, and the point of a cap is not to hold a body this server never agreed
 * to receive. Returns null once the cap is passed, and the caller stops.
 */
async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; bytes: number } | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const body = response.body;
  if (!body) return { text: "", bytes: 0 };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    // Releasing matters even on the over-size path: the socket is ours to close.
    reader.releaseLock();
    if (bytes > maxBytes) await body.cancel().catch(() => undefined);
  }

  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder("utf-8").decode(joined), bytes };
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Fetches one URL, following redirects within the policy.
 *
 * The URL is checked before the first request and again before every hop, so a
 * chain cannot walk off the site or onto an internal address one step at a
 * time.
 */
export async function fetchPage(
  target: string,
  options: FetchPageOptions = {},
): Promise<FetchOutcome> {
  const {
    site,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    accept = HTML_TYPES,
    fetch: send = (input, init) => fetch(input, init),
    lookup,
    now = Date.now,
  } = options;

  const startedAt = now();
  const redirects: RedirectHop[] = [];
  const elapsed = () => now() - startedAt;

  let current = target;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const checked = await checkFetchableUrl(current, { site, lookup });
    if (!checked.ok) {
      // The first URL being refused is the caller's problem; a later one is the
      // site redirecting somewhere the crawler will not go. Either way the
      // refusal itself is carried: "we declined to ask" is a different finding
      // from "the site did not answer", and a crawl log has to tell them apart.
      return failed(
        current,
        hop === 0 ? "refused" : "redirect-refused",
        elapsed(),
        redirects,
        checked.refusal,
      );
    }
    current = checked.url;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await send(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "user-agent": CRAWLER_USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-language": "en",
        },
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return failed(current, timedOut ? "timeout" : "network", elapsed(), redirects);
    } finally {
      clearTimeout(timer);
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (location === null) {
        // A redirect with nowhere to go is the end of the chain, not a failure:
        // the status is a finding in its own right.
        return {
          state: "fetched",
          url: current,
          status: response.status,
          contentType: mediaType(response.headers.get("content-type")),
          body: "",
          bytes: 0,
          elapsedMs: elapsed(),
          redirects,
        };
      }
      redirects.push({ url: current, status: response.status, location });
      const next = canonicaliseUrl(location, current);
      if (!next) return failed(current, "redirect-refused", elapsed(), redirects, "hostname");
      current = next.href;
      continue;
    }

    const contentType = mediaType(response.headers.get("content-type"));
    // An error status has no body worth reading, but the status itself is the
    // finding, so it comes back as a fetch rather than a failure.
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        state: "fetched",
        url: current,
        status: response.status,
        contentType,
        body: "",
        bytes: 0,
        elapsedMs: elapsed(),
        redirects,
      };
    }

    if (contentType !== null && !accept.some((prefix) => contentType.startsWith(prefix))) {
      await response.body?.cancel().catch(() => undefined);
      return failed(current, "unsupported-type", elapsed(), redirects);
    }

    let read: { text: string; bytes: number } | null;
    try {
      read = await readCapped(response, maxBytes);
    } catch {
      return failed(current, "network", elapsed(), redirects);
    }
    if (read === null) return failed(current, "too-large", elapsed(), redirects);

    return {
      state: "fetched",
      url: current,
      status: response.status,
      contentType,
      body: read.text,
      bytes: read.bytes,
      elapsedMs: elapsed(),
      redirects,
    };
  }

  return failed(current, "too-many-redirects", elapsed(), redirects);
}

/**
 * Reads a site's robots.txt.
 *
 * The distinction the rest of the crawler depends on: a 404 means the file is
 * simply absent and everything is allowed, while a server error, a timeout or a
 * refused connection means the site could not tell us its rules — and a site
 * that could not tell us has not consented, so nothing is allowed. Erring the
 * other way is how a crawler earns a block.
 */
export async function fetchRobots(
  origin: string,
  options: FetchPageOptions = {},
): Promise<RobotsPolicy> {
  const base = canonicaliseUrl(origin);
  if (!base) return { state: "unavailable" };

  const outcome = await fetchPage(new URL("/robots.txt", base.origin).href, {
    ...options,
    site: base.hostname,
    maxBytes: options.maxBytes ?? MAX_ROBOTS_BYTES,
    accept: ["text/", "application/"],
  });

  if (outcome.state === "failed") {
    // Nothing to read and no way to know why the site withheld it.
    return { state: "unavailable" };
  }
  if (outcome.status === 404 || outcome.status === 410) return { state: "missing" };
  if (outcome.status >= 400) return { state: "unavailable" };

  return parseRobots(outcome.body);
}
