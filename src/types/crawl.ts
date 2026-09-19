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
