/**
 * The observed pages of one crawl, as plain data for a table.
 *
 * This is the whole of the bridge between a real crawl and what an operator
 * reads. It deliberately produces nothing shaped like `@/types/technical`: a
 * `TechnicalPage` carries indexation, Core Web Vitals, a health score and a
 * content record, none of which a crawler establishes, and half of whose
 * fields are non-nullable — so mapping into it would force a value for every
 * reading this crawl does not have. What a crawl saw is reported as what a
 * crawl saw, beside the modelled layer and never inside it.
 *
 * One rule runs through every function here: **a null is a question nobody
 * answered.** It never becomes 0, false, "OK", "healthy", or "no issue". The
 * tests beside this file are mostly about that single sentence.
 */

import type { CrawlFetchState, CrawlPage } from "@/types/crawl";

/** What a cell shows, and what it means when the value is absent. */
export type Cell = {
  readonly text: string;
  /** Hover text. Always present where `text` is the unknown marker. */
  readonly title?: string;
};

/** Shown wherever a reading was not established. Never a zero. */
export const UNKNOWN = "—";

const unknown = (why: string): Cell => ({ text: UNKNOWN, title: `Not established — ${why}` });

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Pages split by what is actually known about them.
 *
 * Three groups rather than two, because "we fetched it", "we tried and it did
 * not work", and "we never looked" are three different findings. Collapsing
 * the third into either of the others is how a five-page crawl starts reading
 * as a clean bill of health for a whole site.
 */
export type PageGroups = {
  /** A response arrived and was parsed. */
  readonly fetched: readonly CrawlPage[];
  /** An outcome was observed, but no page was read: an error, a redirect
   *  problem, a robots refusal, an off-site link. */
  readonly notFetched: readonly CrawlPage[];
  /** Discovered, in scope, and never tried before a budget ran out. */
  readonly notReached: readonly CrawlPage[];
};

export function groupPages(pages: readonly CrawlPage[]): PageGroups {
  return {
    fetched: pages.filter((page) => page.fetchState === "fetched"),
    notReached: pages.filter((page) => page.fetchState === "budget-skipped"),
    notFetched: pages.filter(
      (page) => page.fetchState !== "fetched" && page.fetchState !== "budget-skipped",
    ),
  };
}

export const GROUP_HEADING = {
  fetched: {
    title: "Pages fetched",
    note: "A response arrived and was read. Everything below is what the page returned, not what any search engine did with it.",
  },
  notFetched: {
    title: "Not fetched",
    note: "An outcome was observed, but no page was read.",
  },
  notReached: {
    title: "Discovered, not reached within the budget",
    note: "These URLs were found and never tried. Nothing is known about them — this is not a clean result for them.",
  },
} as const;

export const FETCH_STATE_LABEL: Readonly<Record<CrawlFetchState, string>> = {
  fetched: "Fetched",
  "http-error": "HTTP error",
  "redirect-loop": "Redirect loop",
  "too-many-redirects": "Too many redirects",
  timeout: "Timed out",
  "dns-error": "DNS error",
  "connection-error": "Connection error",
  "too-large": "Body too large",
  "non-html": "Not HTML",
  "blocked-by-robots": "Blocked by robots.txt",
  "refused-unsafe": "Refused as unsafe",
  "off-site": "Off-site",
  "budget-skipped": "Not reached",
};

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** The path alone, for a dense table. Falls back to the whole URL. */
export function pathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}` || "/";
  } catch {
    return url;
  }
}

export function httpStatusCell(page: CrawlPage): Cell {
  if (page.httpStatus === null) return unknown("no response was recorded");
  // A status is a status. It says the server answered, and nothing about
  // whether anyone indexed the page.
  return { text: String(page.httpStatus), title: "The HTTP status the server returned." };
}

export function depthCell(page: CrawlPage): Cell {
  if (page.depth === null) return unknown("the page was never reached, so its link distance is unknown");
  return { text: String(page.depth), title: "Link distance from the start URL, within this crawl." };
}

export function countCell(value: number | null, what: string): Cell {
  return value === null ? unknown(`no ${what} was read`) : { text: String(value) };
}

export function inSitemapCell(page: CrawlPage): Cell {
  if (page.inSitemap === null) {
    return unknown("the sitemap could not be read, so membership is unknown");
  }
  return { text: page.inSitemap ? "Yes" : "No" };
}

export function robotsTxtCell(page: CrawlPage): Cell {
  if (page.robotsTxtAllowed === null) {
    return unknown("robots.txt could not be read, which is never treated as permission");
  }
  return { text: page.robotsTxtAllowed ? "Allowed" : "Disallowed" };
}

/**
 * The robots meta directive as written.
 *
 * A page with no directive is reported as having none. It is *not* reported as
 * `index,follow`: that is what a crawler may assume, not what the page said,
 * and the difference matters the moment someone edits the page.
 */
export function robotsMetaCell(page: CrawlPage): Cell {
  if (page.fetchState !== "fetched") return unknown("the page was not read");
  return page.robotsMeta === null
    ? { text: "No directive", title: "The page carries no robots meta tag. That is not the same as index,follow." }
    : { text: page.robotsMeta };
}

/**
 * What the canonical says. `canonicalIsSelf` is null when the page declares
 * none at all, which is a different finding from one pointing elsewhere.
 */
export function canonicalCell(page: CrawlPage): Cell {
  if (page.fetchState !== "fetched") return unknown("the page was not read");
  if (page.canonicalIsSelf === null) return { text: "None declared" };
  return page.canonicalIsSelf
    ? { text: "Self" }
    : { text: "Points elsewhere", title: page.canonicalResolved ?? page.canonicalHref ?? undefined };
}

/**
 * Structured data, reported at the level the crawl observed it.
 *
 * Never "complete" or "partial": completeness needs an expectation of what
 * this page's schema ought to contain, and this crawler has none.
 */
export function schemaCell(page: CrawlPage): Cell {
  if (page.fetchState !== "fetched") return unknown("the page was not read");
  if (page.schemaParseFailed) {
    return { text: "Unparseable", title: "A JSON-LD block was present and would not parse." };
  }
  if (page.schemaBlocks === 0) return { text: "None found" };
  const types = page.schemaTypes.length > 0 ? page.schemaTypes.join(", ") : undefined;
  return { text: `${page.schemaBlocks} block${page.schemaBlocks === 1 ? "" : "s"}`, title: types };
}

export function redirectCell(page: CrawlPage): Cell {
  if (page.fetchState === "budget-skipped") return unknown("the page was never reached");
  if (page.redirectHops === 0) return { text: "None" };
  return {
    text: `${page.redirectHops} hop${page.redirectHops === 1 ? "" : "s"}`,
    title:
      page.finalUrl ?? (page.redirectChain.length > 0 ? page.redirectChain.join(" → ") : undefined),
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type PageRow = {
  readonly id: string;
  readonly path: string;
  readonly url: string;
  readonly state: string;
  readonly cells: readonly { readonly key: string; readonly cell: Cell }[];
};

/**
 * Columns, with the caveats that keep them honest.
 *
 * `linksOut` carries its scope in the label. A bounded crawl counts the links
 * it saw, which is not a site-wide figure and cannot decide whether a page is
 * orphaned — so no such column exists here.
 */
export const COLUMNS = [
  { key: "status", label: "HTTP", title: "The status the server returned. Not an indexation signal." },
  { key: "depth", label: "Depth", title: "Link distance from the start URL, within this crawl." },
  { key: "title", label: "Title", title: "Length of the title element, in characters." },
  { key: "meta", label: "Meta", title: "Length of the meta description, in characters." },
  { key: "h1", label: "H1", title: "How many h1 elements the page carries." },
  { key: "canonical", label: "Canonical" },
  { key: "robotsMeta", label: "Robots meta", title: "The directive as written on the page." },
  { key: "sitemap", label: "In sitemap" },
  { key: "schema", label: "Schema" },
  { key: "redirects", label: "Redirects" },
  {
    key: "linksOut",
    label: "Links out",
    title: "Internal links this crawl saw on the page. Counted within this crawl only, never site-wide.",
  },
] as const;

export function pageRow(page: CrawlPage): PageRow {
  return {
    id: page.id,
    path: pathOf(page.url),
    url: page.url,
    state: FETCH_STATE_LABEL[page.fetchState],
    cells: [
      { key: "status", cell: httpStatusCell(page) },
      { key: "depth", cell: depthCell(page) },
      { key: "title", cell: countCell(page.titleLength, "title") },
      { key: "meta", cell: countCell(page.metaDescriptionLength, "meta description") },
      { key: "h1", cell: countCell(page.h1Count, "h1") },
      { key: "canonical", cell: canonicalCell(page) },
      { key: "robotsMeta", cell: robotsMetaCell(page) },
      { key: "sitemap", cell: inSitemapCell(page) },
      { key: "schema", cell: schemaCell(page) },
      { key: "redirects", cell: redirectCell(page) },
      {
        key: "linksOut",
        cell: { text: String(page.internalLinksOut), title: "Within this crawl only." },
      },
    ],
  };
}

/**
 * The one line of provenance that sits under the table.
 *
 * Short on purpose. It names the two things a reader is most likely to assume
 * were measured, and says they were not.
 */
export const PROVENANCE_NOTE =
  "Observed by this crawler at the time of the crawl. Whether Google indexes a URL is Search Console's to report, and Core Web Vitals come from real user measurement — neither is shown here, and a 200 is not an index entry.";
