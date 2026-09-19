import "server-only";

import { fetchPage, fetchRobots, type FetchPageOptions } from "@/lib/crawl/fetcher";
import { checkUrl } from "@/lib/crawl/url-policy";
import type {
  DiscoveredUrl,
  DiscoveryLimit,
  SitemapDiscovery,
  SitemapDocument,
  SitemapKind,
  SitemapSource,
  RobotsPolicy,
} from "@/types/crawl";

/**
 * Finding out which pages a site says it has.
 *
 * The cheapest and politest way to learn a site's inventory: ask it. A sitemap
 * is the owner's own list, so reading one costs a handful of requests where
 * link-following would cost thousands, and it is where a first crawl should
 * start.
 *
 * What it does not do is trust the answer. A sitemap is a file on someone
 * else's server that can list anything at all, so every URL in one goes through
 * the same policy as a URL found any other way, and the walk is bounded in
 * every direction a hostile or simply broken file could push it: how many
 * documents are read, how deep an index may nest, and how many URLs come back.
 *
 * Gzipped sitemaps (`.xml.gz`) are **not** read, and the content-type gate
 * refuses them. Node has `DecompressionStream`, so supporting them needs no
 * dependency — but it does need a second byte cap applied to the
 * *decompressed* stream, because the fetcher's cap counts bytes on the wire
 * and a few hundred kilobytes of gzip expands to gigabytes. That cap belongs
 * in the fetch boundary, with its own tests, rather than bolted on here; until
 * then a site publishing only gzipped sitemaps discovers its homepage and
 * nothing else, and says so through a `unsupported-type` document failure.
 *
 * The XML is read by pulling `<loc>` values out rather than by building a
 * document tree. That is deliberate. A real sitemap is a flat list of
 * locations; the fields around them are not read, an XML parser would be a
 * dependency and an attack surface (entity expansion, external entities) for no
 * gain, and a malformed file should yield the locations it does contain rather
 * than nothing at all.
 */

/** Sitemap documents read in one pass, across every level of nesting. */
export const MAX_SITEMAP_DOCUMENTS = 50;

/** How deeply sitemap indexes may nest before the walk stops. */
export const MAX_SITEMAP_DEPTH = 3;

/** URLs kept from one pass. The protocol's own per-file limit is 50,000. */
export const MAX_DISCOVERED_URLS = 50_000;

/** A sitemap may be larger than a page; the protocol allows 50 MB uncompressed. */
export const MAX_SITEMAP_BYTES = 10_000_000;

const XML_TYPES = ["text/xml", "application/xml", "text/plain", "application/rss+xml"] as const;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Resolves the entities a sitemap may legitimately contain, and no others. */
function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const LOC = /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi;
const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

/**
 * The locations in one sitemap document, and whether it is an index.
 *
 * `unknown` means neither root element was recognised — the file was served but
 * is not a sitemap. Its locations, if any, are still returned: a site that
 * wraps its list in something unexpected is more common than one that means to
 * mislead.
 */
export function parseSitemap(xml: string): { kind: SitemapKind; locations: readonly string[] } {
  // Comments first: a commented-out <loc> is not a location.
  const body = xml.replace(/<!--[\s\S]*?-->/g, "");

  const kind: SitemapKind = /<sitemapindex[\s>]/i.test(body)
    ? "sitemapindex"
    : /<urlset[\s>]/i.test(body)
      ? "urlset"
      : "unknown";

  const locations: string[] = [];
  for (const match of body.matchAll(LOC)) {
    const raw = match[1];
    const cdata = raw.match(CDATA);
    const text = (cdata ? cdata[1] : decodeXmlText(raw)).trim();
    if (text.length > 0) locations.push(text);
  }

  return { kind, locations };
}

export type DiscoverOptions = FetchPageOptions & {
  /** Reuse a robots.txt already read for this site rather than fetching again. */
  readonly robots?: RobotsPolicy;
  readonly maxDocuments?: number;
  readonly maxDepth?: number;
  readonly maxUrls?: number;
};

/** The sitemaps to try first: what robots.txt names, else the conventional one. */
export function initialSitemaps(
  origin: string,
  robots: RobotsPolicy,
): readonly { url: string; source: SitemapSource }[] {
  if (robots.state === "parsed" && robots.sitemaps.length > 0) {
    return robots.sitemaps.map((url) => ({ url, source: "robots" as const }));
  }
  return [{ url: new URL("/sitemap.xml", origin).href, source: "well-known" }];
}

/**
 * Reads a site's sitemaps and returns the page URLs they list.
 *
 * Breadth-first, so a site whose index names twenty sitemaps has all twenty
 * counted before any of their children are read, and a limit reached partway
 * leaves a usable spread of the site rather than the whole of its first branch.
 *
 * The site's own homepage is always included. Every sitemap claims to list a
 * site's pages and many are stale or partial, so the one URL a crawl can be
 * certain of is the one it was pointed at.
 */
export async function discoverSitemapUrls(
  site: string,
  options: DiscoverOptions = {},
): Promise<SitemapDiscovery> {
  const {
    robots: given,
    maxDocuments = MAX_SITEMAP_DOCUMENTS,
    maxDepth = MAX_SITEMAP_DEPTH,
    maxUrls = MAX_DISCOVERED_URLS,
    ...fetchOptions
  } = options;

  const checked = checkUrl(site.includes("://") ? site : `https://${site}`);
  if (!checked.ok) {
    return { urls: [], documents: [], robots: "unavailable", limits: [] };
  }
  const origin = new URL(checked.url).origin;
  const host = new URL(checked.url).hostname;

  const robots = given ?? (await fetchRobots(origin, fetchOptions));

  const documents: SitemapDocument[] = [];
  const limits = new Set<DiscoveryLimit>();

  // The homepage is a finding in its own right, and the first thing a crawl
  // will fetch, so it is in the list before any sitemap is read.
  const urls = new Map<string, DiscoveredUrl>();
  urls.set(`${origin}/`, { url: `${origin}/`, source: "homepage" });

  const seenDocuments = new Set<string>();
  let queue = initialSitemaps(origin, robots).map((entry) => ({ ...entry, depth: 0 }));

  while (queue.length > 0) {
    const next: typeof queue = [];

    for (const entry of queue) {
      if (documents.length >= maxDocuments) {
        limits.add("sitemaps");
        break;
      }

      // A sitemap is itself a URL from an untrusted file: same rules, same host.
      const location = checkUrl(entry.url, { site: host });
      if (!location.ok || seenDocuments.has(location.url)) continue;
      seenDocuments.add(location.url);

      const outcome = await fetchPage(location.url, {
        ...fetchOptions,
        site: host,
        maxBytes: fetchOptions.maxBytes ?? MAX_SITEMAP_BYTES,
        accept: XML_TYPES,
      });

      if (outcome.state === "failed") {
        documents.push({
          url: location.url,
          source: entry.source,
          kind: "unknown",
          locations: 0,
          failure: outcome.failure,
        });
        continue;
      }
      if (outcome.status !== 200) {
        documents.push({
          url: location.url,
          source: entry.source,
          kind: "unknown",
          locations: 0,
          failure: "malformed",
        });
        continue;
      }

      const { kind, locations } = parseSitemap(outcome.body);
      documents.push({
        url: location.url,
        source: entry.source,
        kind,
        locations: locations.length,
        // A document that is neither a urlset nor an index and lists nothing is
        // the only case worth calling malformed: it told us nothing at all.
        failure: kind === "unknown" && locations.length === 0 ? "malformed" : null,
      });

      for (const raw of locations) {
        const child = checkUrl(raw, { site: host });
        if (!child.ok) continue;

        if (kind === "sitemapindex") {
          if (entry.depth + 1 > maxDepth) {
            limits.add("depth");
            continue;
          }
          next.push({ url: child.url, source: "index", depth: entry.depth + 1 });
          continue;
        }

        if (urls.size >= maxUrls) {
          limits.add("urls");
          break;
        }
        // First listing wins: a URL in two sitemaps is one page.
        if (!urls.has(child.url)) {
          urls.set(child.url, { url: child.url, source: entry.source });
        }
      }
    }

    if (documents.length >= maxDocuments && next.length > 0) {
      limits.add("sitemaps");
      break;
    }
    queue = next;
  }

  return {
    urls: [...urls.values()],
    documents,
    robots: robots.state,
    limits: [...limits],
  };
}
