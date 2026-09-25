/**
 * One HTTP exchange, bounded in every direction that can hurt.
 *
 * Redirects are followed by hand rather than by the runtime, for one reason:
 * every hop has to go back through the address guard. A site can redirect a
 * crawler anywhere, and a guard that only ran on the URL an operator supplied
 * protects nothing — the third hop is where a request ends up at the metadata
 * endpoint.
 *
 * Each hop is validated *and pinned* on its own: the guard picks one approved
 * address for that hop, and `pinnedRequest` connects to exactly that address.
 * Hop three is pinned by hop three's own check, never by hop zero's, and no
 * hop's connection re-resolves the name it was approved under.
 *
 * The sender and the resolver are injected, so the engine's whole behaviour
 * can be exercised without a network.
 */

import { guardUrl, type AddressResolver, type ResolvedAddress } from "./network-guard.ts";
import { pinnedRequest } from "./pinned-request.ts";
import { normaliseUrl } from "./url-policy.ts";
import type { CrawlFetchState } from "@/types/crawl";

/** How long one request may take, matching the Search Console client. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** The largest response body this crawler reads, in bytes. */
export const MAX_BODY_BYTES = 2_097_152;

/** How many redirects one URL may take before the chain is abandoned. */
export const MAX_REDIRECT_HOPS = 10;

/**
 * Bound on the stored content type.
 *
 * A header is whatever the origin sends, and the column that holds it has a
 * declared limit; an unbounded one would fail the insert of the whole crawl.
 */
const MAX_CONTENT_TYPE = 200;
/** The stored bound of the `X-Robots-Tag` header, matching the page column. */
const MAX_ROBOTS_TAG = 200;

/** Media types a page fetch will read a body for. */
export const HTML_TYPES: readonly string[] = ["text/html", "application/xhtml+xml"];

/**
 * Media types a supporting-document fetch will read a body for.
 *
 * robots.txt is `text/plain` and a sitemap is usually `application/xml`, so
 * neither would ever be read under the page rules above. They get their own
 * list rather than a widened one: a crawl must not start parsing every
 * `application/xml` response it meets as though it were a page.
 */
export const DOCUMENT_TYPES: readonly string[] = [
  "text/plain",
  "text/xml",
  "application/xml",
  "text/html",
  "application/xhtml+xml",
];

export type FetchOutcome =
  | {
      readonly ok: true;
      readonly finalUrl: string;
      readonly status: number;
      readonly redirectChain: readonly string[];
      readonly contentType: string | null;
      readonly contentBytes: number;
      /**
       * The `X-Robots-Tag` header as sent, whitespace-collapsed and bounded;
       * null when the response carried none. Read off any response, HTML or
       * not, since the header applies to the resource whatever its type.
       */
      readonly xRobotsTag: string | null;
      /** Present only for HTML; other types are recorded, never parsed. */
      readonly body: string | null;
      readonly state: Extract<CrawlFetchState, "fetched" | "http-error" | "non-html">;
    }
  | {
      readonly ok: false;
      readonly finalUrl: string | null;
      readonly redirectChain: readonly string[];
      readonly state: Extract<
        CrawlFetchState,
        | "timeout"
        | "dns-error"
        | "connection-error"
        | "too-large"
        | "redirect-loop"
        | "too-many-redirects"
        | "refused-unsafe"
        | "off-site"
      >;
    };

/**
 * How a request is actually sent.
 *
 * The approved address is a parameter rather than something the sender works
 * out, because a sender that resolves the name itself is the bug this design
 * exists to prevent.
 */
export type Fetch = (
  input: string,
  init: { readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal },
  pin: ResolvedAddress,
) => Promise<Response>;

export type FetcherOptions = {
  readonly userAgent: string;
  readonly hostScope: string;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly fetch?: Fetch;
  readonly resolve?: AddressResolver;
  /** Media types whose body is read. Defaults to HTML only. */
  readonly accept?: readonly string[];
};

/**
 * Reads at most `limit` bytes of a response, abandoning the rest.
 *
 * Streamed rather than awaited whole: `response.text()` on a multi-gigabyte
 * body would buy the origin a way to exhaust this server's memory, and a
 * `content-length` header is a claim, not a measurement.
 */
async function readBounded(
  response: Response,
  limit: number,
): Promise<{ readonly text: string; readonly bytes: number } | "too-large"> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return "too-large";

  const body = response.body;
  if (body === null) return { text: "", bytes: 0 };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return "too-large";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes };
}

function classifyNetworkError(error: unknown): Extract<CrawlFetchState, "timeout" | "dns-error" | "connection-error"> {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return "timeout";
    const code = (error as { cause?: { code?: unknown } }).cause?.code;
    if (typeof code === "string" && (code === "ENOTFOUND" || code === "EAI_AGAIN")) return "dns-error";
  }
  return "connection-error";
}

/**
 * Fetches one URL, following redirects by hand and guarding every hop.
 *
 * Every hop is re-normalised, re-scoped, and re-resolved. A redirect that
 * leaves the crawl's host scope ends the chain as `off-site` rather than being
 * followed, because a crawl of one client's site must not become a crawl of
 * whatever their site points at.
 */
export async function fetchPage(url: string, options: FetcherOptions): Promise<FetchOutcome> {
  const {
    userAgent,
    hostScope,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBodyBytes = MAX_BODY_BYTES,
    fetch: send = pinnedRequest,
    resolve,
    accept = HTML_TYPES,
  } = options;

  const redirectChain: string[] = [];
  const seen = new Set<string>([url]);
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const normalised = normaliseUrl(current);
    if (!normalised.ok) {
      return { ok: false, finalUrl: null, redirectChain, state: "refused-unsafe" };
    }

    const verdict = await guardUrl(normalised.parsed, { resolve, hostScope });
    if (!verdict.ok) {
      return {
        ok: false,
        finalUrl: normalised.url,
        redirectChain,
        state:
          verdict.reason === "off-scope"
            ? "off-site"
            : verdict.reason === "dns-error"
              ? "dns-error"
              : "refused-unsafe",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await send(
        normalised.url,
        {
          method: "GET",
          signal: controller.signal,
          headers: {
            "user-agent": userAgent,
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "accept-language": "en",
          },
        },
        // This hop's own approved address, from this hop's own check.
        verdict.pin,
      );
    } catch (error) {
      return { ok: false, finalUrl: normalised.url, redirectChain, state: classifyNetworkError(error) };
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
      const next = normaliseUrl(location, normalised.url);
      if (!next.ok) {
        return { ok: false, finalUrl: normalised.url, redirectChain, state: "refused-unsafe" };
      }
      if (seen.has(next.url)) {
        return { ok: false, finalUrl: normalised.url, redirectChain, state: "redirect-loop" };
      }
      if (hop === MAX_REDIRECT_HOPS) {
        return { ok: false, finalUrl: normalised.url, redirectChain, state: "too-many-redirects" };
      }
      redirectChain.push(normalised.url);
      seen.add(next.url);
      current = next.url;
      continue;
    }

    const rawContentType = response.headers.get("content-type");
    const contentType =
      rawContentType === null ? null : rawContentType.slice(0, MAX_CONTENT_TYPE);
    const rawRobotsTag = response.headers.get("x-robots-tag");
    const xRobotsTag =
      rawRobotsTag === null ? null : rawRobotsTag.replace(/\s+/g, " ").trim().slice(0, MAX_ROBOTS_TAG);
    const mediaType = (rawContentType ?? "").split(";")[0].trim().toLowerCase();
    // A response with no content-type at all is read when the caller accepts
    // text, since robots.txt is commonly served without one.
    const readable =
      accept.includes(mediaType) || (mediaType === "" && accept.includes("text/plain"));

    if (!readable) {
      // Read nothing: the body is not ours to parse and not worth the bytes.
      await response.body?.cancel();
      return {
        ok: true,
        finalUrl: normalised.url,
        status: response.status,
        redirectChain,
        contentType,
        contentBytes: 0,
        xRobotsTag,
        body: null,
        state: response.status >= 400 ? "http-error" : "non-html",
      };
    }

    const read = await readBounded(response, maxBodyBytes);
    if (read === "too-large") {
      return { ok: false, finalUrl: normalised.url, redirectChain, state: "too-large" };
    }

    return {
      ok: true,
      finalUrl: normalised.url,
      status: response.status,
      redirectChain,
      contentType,
      contentBytes: read.bytes,
      xRobotsTag,
      body: read.text,
      state: response.status >= 400 ? "http-error" : "fetched",
    };
  }

  return { ok: false, finalUrl: current, redirectChain, state: "too-many-redirects" };
}
