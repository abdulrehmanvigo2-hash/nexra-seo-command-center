import "server-only";

import { MAX_HTML_BYTES } from "@/lib/crawl/html";
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
/**
 * The largest body this crawler will read, and why that number.
 *
 * It is the extractor's own ceiling. `extractSignals` scans at most
 * `MAX_HTML_BYTES` and truncates beyond it, so a body larger than this is one
 * nobody would parse in full — and a word count taken from a truncated
 * document would be a measurement of the truncation, not of the page. Reading
 * to exactly that point and refusing past it keeps the two ends agreeing:
 * everything fetched is parsed whole, and everything else is refused outright
 * rather than silently measured wrong.
 */
export const DEFAULT_MAX_BYTES = MAX_HTML_BYTES;
export const DEFAULT_MAX_REDIRECTS = 5;

/**
 * What a gzip payload may expand to. Separate from the wire cap on purpose:
 * compression ratios of a thousand to one are ordinary, and malicious ones are
 * far higher.
 */
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 20_000_000;

/** Content types the crawler will read a body for. */
const HTML_TYPES = ["text/html", "application/xhtml+xml"] as const;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type FetchPageOptions = {
  /** Restricts the whole redirect chain to one site (a host and its `www.`). */
  readonly site?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  /** Content-type prefixes to accept; defaults to HTML. */
  readonly accept?: readonly string[];
  /**
   * Decompress a gzip *payload* (`.xml.gz`, `application/gzip`) under
   * `maxDecompressedBytes`. Off by default: only sitemap discovery asks for it.
   */
  readonly gunzip?: boolean;
  /** Cap on what a gzip payload may become. Ignored unless `gunzip`. */
  readonly maxDecompressedBytes?: number;
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
 * Reads at most `maxBytes` of the response, as bytes.
 *
 * Streamed rather than `response.arrayBuffer()`: a `Content-Length` can lie or
 * be absent, and the point of a cap is not to hold a body this server never
 * agreed to receive. Returns null once the cap is passed, and the caller stops.
 */
async function readCappedBytes(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const body = response.body;
  if (!body) return new Uint8Array(0);

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
  return joined;
}

/**
 * Decompresses a gzip payload under its own, separate cap.
 *
 * Needed for `.xml.gz` sitemaps, where the *body* is gzip data. This is not
 * the same thing as `Content-Encoding: gzip`, which the runtime already
 * decompresses before the cap above ever counts a byte — that case has always
 * been safe, because the cap is applied to what comes out.
 *
 * Here there are two caps and both matter. The wire cap bounds what is read
 * from the socket; this one bounds what the compressed bytes are allowed to
 * become, which is what stops a few hundred kilobytes of zeros claiming to be
 * gigabytes. Output is counted as it arrives and the stream is cancelled the
 * moment it passes the limit, so the bomb is never allocated.
 *
 * Null means "could not read this": either it expanded past the cap, or it is
 * not valid gzip. Neither is a reason to hold anything in memory.
 */
async function inflateCapped(bytes: Uint8Array, maxBytes: number): Promise<string | null> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  } catch {
    return null;
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      // Checked before keeping the chunk: the cap is on what is held, not on
      // what has already been held.
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } catch {
    // Malformed gzip. The stream rejects rather than producing garbage.
    return null;
  } finally {
    reader.releaseLock();
    await stream.cancel().catch(() => undefined);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}

/** Whether a response is a gzip payload rather than gzip transfer encoding. */
export function isGzipPayload(url: string, contentType: string | null): boolean {
  if (contentType !== null) {
    const media = contentType.split(";")[0].trim().toLowerCase();
    if (media === "application/gzip" || media === "application/x-gzip") return true;
  }
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".gz");
  } catch {
    return false;
  }
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
    gunzip = false,
    maxDecompressedBytes = DEFAULT_MAX_DECOMPRESSED_BYTES,
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

    // A gzip payload is accepted on its own terms: the caller asked for one,
    // and its media type is never in the HTML or XML list it would be checked
    // against.
    const compressed = gunzip && isGzipPayload(current, contentType);
    if (
      !compressed &&
      contentType !== null &&
      !accept.some((prefix) => contentType.startsWith(prefix))
    ) {
      await response.body?.cancel().catch(() => undefined);
      return failed(current, "unsupported-type", elapsed(), redirects);
    }

    let raw: Uint8Array | null;
    try {
      raw = await readCappedBytes(response, maxBytes);
    } catch {
      return failed(current, "network", elapsed(), redirects);
    }
    if (raw === null) return failed(current, "too-large", elapsed(), redirects);

    let body: string;
    if (compressed) {
      const inflated = await inflateCapped(raw, maxDecompressedBytes);
      // Expanded past its cap, or not valid gzip. Either way there is nothing
      // here this crawler can read.
      if (inflated === null) return failed(current, "unsupported-type", elapsed(), redirects);
      body = inflated;
    } else {
      body = new TextDecoder("utf-8").decode(raw);
    }

    return {
      state: "fetched",
      url: current,
      status: response.status,
      contentType,
      body,
      // The bytes that crossed the wire, which is what a crawl is accountable
      // for; a decompressed size is not a transfer size.
      bytes: raw.byteLength,
      elapsedMs: elapsed(),
      redirects,
    };
  }

  return failed(current, "too-many-redirects", elapsed(), redirects);
}

/** A redirect chain as one line, for the diagnostic below. */
function describeChain(redirects: readonly RedirectHop[]): string {
  if (redirects.length === 0) return "none";
  return redirects.map((hop) => `${hop.status}->${hop.location}`).join(" ");
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
    // Nothing to read, and `unavailable` is where six unrelated causes meet: a
    // DNS failure, a refused address, a redirect off the site, a timeout, a
    // dropped connection, a body too large. The crawl record keeps only the
    // fixed code `robots-unavailable`, so without this line nobody — operator
    // or engineer — can tell a site that blocked this crawler from one that
    // never answered. Server-side only, and the URL is the public site the
    // operator asked to crawl.
    console.warn(
      `crawl robots unavailable: ${outcome.url} failure=${outcome.failure}` +
        (outcome.refusal === null ? "" : ` refusal=${outcome.refusal}`) +
        ` chain=${describeChain(outcome.redirects)}`,
    );
    return { state: "unavailable" };
  }
  if (outcome.status === 404 || outcome.status === 410) return { state: "missing" };
  if (outcome.status >= 400) {
    // The site answered, and refused. A 403 here is usually a bot filter.
    console.warn(
      `crawl robots unavailable: ${outcome.url} status=${outcome.status}` +
        ` chain=${describeChain(outcome.redirects)}`,
    );
    return { state: "unavailable" };
  }

  return parseRobots(outcome.body);
}
