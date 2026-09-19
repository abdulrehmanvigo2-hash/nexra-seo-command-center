import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import type { UrlCheck, UrlRefusal } from "@/types/crawl";

/**
 * Which URLs the crawler is allowed to ask for.
 *
 * A project's website is a string an operator typed. Everything the crawler
 * fetches is derived from it — the domain itself, then whatever that page links
 * to, then whatever those pages link to. That makes this the boundary where a
 * server-side request forgery would happen if it were going to: a hostname that
 * resolves to `127.0.0.1`, to a private subnet, or to a cloud provider's
 * metadata endpoint would have this server fetch its own internals and store
 * the answer where an operator can read it.
 *
 * So a URL is checked twice. `checkUrl` applies the rules that need no network
 * — scheme, credentials, port, shape, length, and whether the crawl is still on
 * the site it started on. `checkPublicAddress` then resolves the hostname and
 * refuses it if any address it answers with is one this server should not be
 * asking. Both run again on every redirect hop, because a redirect is a URL the
 * site chose, not one we did.
 *
 * Server-only: it resolves DNS, and nothing in a browser has any business
 * deciding what this server may fetch.
 */

/** Longest URL the crawler will follow or store. */
export const MAX_URL_LENGTH = 2_048;

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Default ports, which are the only ports the crawler will talk to. */
const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  "http:": "80",
  "https:": "443",
};

/** A hostname shape a public site can actually have: labels and a letter TLD. */
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Anything that is an address rather than a name, including IPv6 in brackets. */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpLiteral(hostname: string): boolean {
  // `URL` keeps IPv6 hosts in brackets, so they are recognisable on sight.
  return hostname.startsWith("[") || IPV4_LITERAL.test(hostname) || /^\d+$/.test(hostname);
}

/**
 * Parses and normalises a URL, optionally against the page it was found on.
 *
 * Drops the fragment, which never reaches a server and would otherwise make one
 * page look like many. Everything else is left as the site wrote it: a query
 * string can be the only thing distinguishing two real pages, and trailing
 * slashes are the site's business, not ours.
 */
export function canonicaliseUrl(input: string, base?: string): URL | null {
  const text = input.trim();
  if (text.length === 0) return null;
  let url: URL;
  try {
    url = base === undefined ? new URL(text) : new URL(text, base);
  } catch {
    return null;
  }
  url.hash = "";
  return url;
}

function refuse(refusal: UrlRefusal): UrlCheck {
  return { ok: false, refusal };
}

/**
 * A host with its leading `www.` removed, if it had one.
 *
 * `www.example.com` and `example.com` are one site: almost every site on the
 * web serves one and redirects to it from the other, and which of the two an
 * operator typed into the project's domain field is an accident. Treating them
 * as different hosts means the very first hop of a crawl — the apex redirecting
 * to the canonical www host, or the reverse — is refused as off-site, and the
 * site reads as unreachable when it is simply canonicalising.
 *
 * Only the exact label `www` is dropped, and only once. Everything else about
 * the hostname is left alone, so this widens "the same site" by one specific
 * host and by nothing else.
 */
export function bareHost(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/**
 * Whether a URL's host is the site the crawl is pinned to.
 *
 * Compared as whole labels rather than by suffix: `evil-example.com` ends with
 * `example.com` under a naive check, and a crawl that wanders onto another host
 * is both a bug and a way to make this server fetch somewhere it was never
 * pointed. The one host treated as the same site is the `www.` pair above.
 */
function sameSite(hostname: string, site: string): boolean {
  return bareHost(hostname) === bareHost(site.toLowerCase());
}

/**
 * The rules that need no network.
 *
 * `site` limits the crawl to one host — the apex and its `www.` form counting
 * as one, and nothing else. A subdomain is a different site, and a suffix match
 * is never enough.
 */
export function checkUrl(
  input: string | URL,
  options: { readonly site?: string } = {},
): UrlCheck {
  const url = typeof input === "string" ? canonicaliseUrl(input) : input;
  if (!url) return refuse("hostname");

  if (!ALLOWED_SCHEMES.has(url.protocol)) return refuse("scheme");
  if (url.username !== "" || url.password !== "") return refuse("credentials");
  if (url.port !== "" && url.port !== DEFAULT_PORTS[url.protocol]) return refuse("port");

  const hostname = url.hostname.toLowerCase();
  if (isIpLiteral(hostname)) return refuse("ip-literal");
  if (!HOSTNAME.test(hostname)) return refuse("hostname");

  const href = url.href;
  if (href.length > MAX_URL_LENGTH) return refuse("too-long");

  if (options.site !== undefined && !sameSite(hostname, options.site)) {
    return refuse("off-site");
  }

  return { ok: true, url: href };
}

// ---------------------------------------------------------------------------
// Where a hostname actually points
// ---------------------------------------------------------------------------

function ipv4IsInternal(parts: readonly number[]): boolean {
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // protocol assignments and TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function parseIpv4(address: string): number[] | null {
  if (!IPV4_LITERAL.test(address)) return null;
  const parts = address.split(".").map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

/**
 * Whether one resolved address is somewhere this server must not fetch.
 *
 * IPv4-mapped and IPv4-compatible IPv6 addresses are unwrapped first: without
 * that, `::ffff:127.0.0.1` reads as an ordinary IPv6 address and walks past
 * every IPv4 rule above.
 */
export function isInternalAddress(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];

  const asIpv4 = parseIpv4(value);
  if (asIpv4) return ipv4IsInternal(asIpv4);

  if (!value.includes(":")) return true; // Neither v4 nor v6: not something to trust.

  const embedded = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded) {
    const parts = parseIpv4(embedded[1]);
    if (parts && ipv4IsInternal(parts)) return true;
  }

  if (value === "::" || value === "::1") return true; // unspecified, loopback
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(value)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(value)) return true; // ff00::/8 multicast
  if (value.startsWith("2001:db8:")) return true; // documentation
  if (value.startsWith("64:ff9b:")) return true; // NAT64
  return false;
}

export type AddressLookup = (
  hostname: string,
) => Promise<readonly { readonly address: string }[]>;

const defaultLookup: AddressLookup = (hostname) => dnsLookup(hostname, { all: true });

/**
 * Resolves a hostname and refuses it if anything it answers with is internal.
 *
 * Every address is checked, not just the first: a name that resolves to one
 * public address and one loopback address is a name that can be made to hit
 * loopback, and which one the runtime picks is not ours to predict.
 *
 * A caveat worth stating plainly, because it cannot be fixed here: this
 * resolves the name, and then `fetch` resolves it again when it connects. A
 * record that changes in between would not be caught. Closing that needs the
 * connection pinned to an address that has already been checked, which belongs
 * with the socket, not with this rule. What this does stop is the realistic
 * case — a hostname, entered or linked to, that simply points somewhere
 * internal.
 */
export async function checkPublicAddress(
  hostname: string,
  lookup: AddressLookup = defaultLookup,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly refusal: UrlRefusal }> {
  let addresses: readonly { readonly address: string }[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return { ok: false, refusal: "dns" };
  }

  if (addresses.length === 0) return { ok: false, refusal: "dns" };
  if (addresses.some((entry) => isInternalAddress(entry.address))) {
    return { ok: false, refusal: "private-address" };
  }
  return { ok: true };
}

/** Both checks, in the order that avoids a needless lookup. */
export async function checkFetchableUrl(
  input: string | URL,
  options: { readonly site?: string; readonly lookup?: AddressLookup } = {},
): Promise<UrlCheck> {
  const checked = checkUrl(input, { site: options.site });
  if (!checked.ok) return checked;

  const { hostname } = new URL(checked.url);
  const resolved = await checkPublicAddress(hostname, options.lookup);
  return resolved.ok ? checked : { ok: false, refusal: resolved.refusal };
}
