/**
 * Sitemaps, read for one fact only: which URLs the site says it has.
 *
 * Pure, and deliberately not an XML parser. A sitemap's useful content is a
 * flat list of `<loc>` elements, and adding a general XML parser to read them
 * would be a dependency bought for one tag. Anything that is not a well-formed
 * `<loc>` is skipped rather than guessed at; a sitemap this cannot read yields
 * no URLs, and the caller records `unavailable` rather than "no pages".
 */

/** The largest sitemap document this crawler will read, in bytes. */
export const MAX_SITEMAP_BYTES = 10_485_760;

/** How many URLs are taken from one sitemap document. */
export const MAX_SITEMAP_URLS = 5_000;

/** How many child sitemaps of an index are followed. */
export const MAX_SITEMAP_INDEX_CHILDREN = 20;

export type SitemapDocument = {
  /** `<loc>` values under `<url>` entries — the pages themselves. */
  readonly urls: readonly string[];
  /** `<loc>` values under `<sitemap>` entries — child sitemaps to follow. */
  readonly children: readonly string[];
};

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (match) => ENTITIES[match] ?? match);
}

/**
 * Reads a sitemap or a sitemap index.
 *
 * Whether a `<loc>` names a page or a child sitemap is decided by its
 * enclosing element, so the two are told apart by the surrounding
 * `<sitemap>` / `<url>` tag rather than by guessing from the URL.
 */
export function parseSitemap(xml: string): SitemapDocument {
  const urls: string[] = [];
  const children: string[] = [];

  // Strip comments and CDATA markers first so a commented-out <loc> is not
  // read as a live one.
  const text = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

  const entryPattern = /<(sitemap|url)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entryPattern.exec(text)) !== null) {
    const isChild = entry[1].toLowerCase() === "sitemap";
    const target = isChild ? children : urls;
    if (target.length >= (isChild ? MAX_SITEMAP_INDEX_CHILDREN : MAX_SITEMAP_URLS)) continue;

    const loc = /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/i.exec(entry[2]);
    if (loc === null) continue;
    const value = decodeEntities(loc[1].trim());
    if (value !== "") target.push(value);
  }

  return { urls, children };
}
