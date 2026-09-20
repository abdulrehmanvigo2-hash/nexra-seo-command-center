/**
 * What counts as the same URL, and which URLs this crawler is willing to try.
 *
 * Pure: no network, no clock, no environment. Everything here is a decision
 * about a string, which is why it is also where the crawl's scope rules live —
 * they must be testable without touching a site.
 */

/** The only schemes a crawl will fetch. */
const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];

/** The only ports a crawl will fetch. */
const ALLOWED_PORTS: readonly string[] = ["", "80", "443"];

/**
 * Query parameters dropped during normalisation.
 *
 * Campaign tags identify the click, not the document: two URLs differing only
 * by `utm_source` are one page, and keeping both would crawl it twice and
 * report it twice.
 */
const TRACKING_PARAMETERS: readonly RegExp[] = [
  /^utm_/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^fbclid$/i,
  /^msclkid$/i,
  /^mc_eid$/i,
  /^mc_cid$/i,
  /^_ga$/i,
  /^ref$/i,
];

export const MAX_URL_LENGTH = 2048;

export type UrlRejection =
  | "unparseable"
  | "bad-scheme"
  | "bad-port"
  | "too-long"
  | "has-credentials";

export type NormalisedUrl =
  | { readonly ok: true; readonly url: string; readonly parsed: URL }
  | { readonly ok: false; readonly reason: UrlRejection };

/**
 * The canonical form this crawl stores and deduplicates by.
 *
 * Deliberately conservative. Scheme and host are lower-cased and a default
 * port is dropped, because those are case- and redundancy-insensitive by
 * specification. The path's case and its trailing slash are left exactly as
 * found: plenty of origins serve `/About` and `/about`, or `/x` and `/x/`, as
 * different documents, and collapsing them here would invent an equivalence
 * this crawler never observed.
 */
export function normaliseUrl(input: string, base?: string): NormalisedUrl {
  if (input.length > MAX_URL_LENGTH) return { ok: false, reason: "too-long" };

  let parsed: URL;
  try {
    parsed = base === undefined ? new URL(input) : new URL(input, base);
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, reason: "bad-scheme" };
  }
  // Credentials in a URL would be sent to the origin as a header. A crawler
  // has no business carrying someone's password around, and a link offering
  // one is a good reason to leave the URL alone.
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "has-credentials" };
  }
  if (!ALLOWED_PORTS.includes(parsed.port)) {
    return { ok: false, reason: "bad-port" };
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }
  // A fragment is resolved by the browser and never sent to the origin, so two
  // URLs differing only by one are the same request.
  parsed.hash = "";

  const keep = [...parsed.searchParams.entries()].filter(
    ([name]) => !TRACKING_PARAMETERS.some((pattern) => pattern.test(name)),
  );
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  parsed.search = "";
  for (const [name, value] of keep) parsed.searchParams.append(name, value);

  const url = parsed.toString();
  if (url.length > MAX_URL_LENGTH) return { ok: false, reason: "too-long" };
  return { ok: true, url, parsed };
}

/**
 * Whether `host` is the scope host or a subdomain of it.
 *
 * The label boundary is the whole point: `evil-example.com` must not match a
 * scope of `example.com`, and a plain `endsWith` would let it. Comparison is
 * on lower-cased hosts with any trailing dot removed.
 */
export function isWithinHostScope(host: string, scope: string): boolean {
  const target = host.toLowerCase().replace(/\.$/, "");
  const root = scope.toLowerCase().replace(/\.$/, "");
  if (root === "") return false;
  return target === root || target.endsWith(`.${root}`);
}

/**
 * The host a crawl of `domain` is confined to.
 *
 * `projects.domain` is already canonical (lower case, no scheme, no trailing
 * slash), but it is operator-entered, so this refuses anything that is not a
 * plain hostname rather than trusting the column.
 */
export function hostScopeFromDomain(domain: string): string | null {
  const trimmed = domain.trim().toLowerCase().replace(/\.$/, "");
  if (trimmed === "") return null;
  // A hostname, not a URL, not a path, not an address with a port.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** The URL a crawl of this domain starts from. */
export function startUrlForDomain(domain: string): string | null {
  const host = hostScopeFromDomain(domain);
  return host === null ? null : `https://${host}/`;
}
