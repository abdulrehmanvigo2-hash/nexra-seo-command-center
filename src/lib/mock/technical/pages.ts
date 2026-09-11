import { DATA_AS_OF, clamp, rand, randInt, round } from "@/lib/mock/dashboard/core";
import { CONTENT_RANGE, getContentRecords } from "@/lib/mock/content";
import {
  META_LENGTH,
  MIN_INTERNAL_LINKS_IN,
  TITLE_LENGTH,
  cwvStateFor,
  depthScore,
  linkScore,
  pageScore,
  vitalsScore,
} from "@/lib/mock/technical/scoring";
import type {
  CanonicalState,
  ContentFormat,
  CrawlState,
  IndexStatus,
  Indexability,
  PageVitals,
  RobotsDirective,
  SchemaState,
  TechnicalPage,
} from "@/types/technical";

/**
 * The technical page inventory.
 *
 * Derived, never authored. Content Studio owns the pages this product has; a
 * technical page is one of those read through a technical lens, and the URL,
 * title, format, project, cluster, and internal-link counts on it are the
 * content record's own. There is no second inventory to keep in step.
 *
 * Only published records appear. A brief in draft has no HTTP status, no
 * canonical, and nothing to index, and inventing those would be putting
 * findings on screen against a page that does not exist yet.
 *
 * What a crawler or a search engine would tell us — the response code, the
 * robots directive, the field vitals, whether the page was actually kept in
 * the index — has no source in this milestone (CLAUDE.md §4), so it is drawn
 * deterministically from each page's own seed. Stable between the server
 * render and the browser, identical on every reload, and tagged `seeded`
 * wherever it reaches the screen.
 */

export const TECHNICAL_AS_OF = DATA_AS_OF;
export const TECHNICAL_RANGE = CONTENT_RANGE;

// ---------------------------------------------------------------------------
// Modelled signal tables
// ---------------------------------------------------------------------------

/**
 * Response codes, by share of the inventory.
 *
 * Weighted so that every state is reachable on a dataset of this size without
 * the site reading as broken: the overwhelming majority serve, a handful
 * redirect, and a small tail fails.
 */
const STATUS_BANDS: readonly { readonly status: number; readonly upTo: number }[] =
  [
    { status: 200, upTo: 0.876 },
    { status: 301, upTo: 0.918 },
    { status: 302, upTo: 0.941 },
    { status: 404, upTo: 0.971 },
    { status: 410, upTo: 0.981 },
    { status: 500, upTo: 0.991 },
    { status: 503, upTo: 1 },
  ];

function statusFor(seed: number): number {
  const draw = rand(seed, 11);
  for (const band of STATUS_BANDS) {
    if (draw < band.upTo) return band.status;
  }
  return 200;
}

function robotsFor(seed: number): RobotsDirective {
  const draw = rand(seed, 12);
  if (draw < 0.058) return "noindex,follow";
  if (draw < 0.079) return "noindex,nofollow";
  if (draw < 0.113) return "index,nofollow";
  return "index,follow";
}

function canonicalStateFor(seed: number): CanonicalState {
  const draw = rand(seed, 13);
  if (draw < 0.112) return "points-elsewhere";
  if (draw < 0.166) return "missing";
  if (draw < 0.203) return "conflict";
  return "self";
}

/**
 * Baseline vitals per page format.
 *
 * A product page carrying a gallery and a price widget is not a text article,
 * and giving both the same starting point would flatten the one distinction
 * the reading has. LCP and INP in milliseconds, CLS unitless.
 */
const VITAL_BASE: Readonly<
  Record<ContentFormat, { lcp: number; inp: number; cls: number }>
> = {
  guide: { lcp: 2_150, inp: 165, cls: 0.06 },
  comparison: { lcp: 2_460, inp: 195, cls: 0.09 },
  landing: { lcp: 2_720, inp: 210, cls: 0.11 },
  product: { lcp: 3_180, inp: 245, cls: 0.19 },
  location: { lcp: 2_580, inp: 205, cls: 0.1 },
  article: { lcp: 1_980, inp: 150, cls: 0.05 },
  resource: { lcp: 2_240, inp: 175, cls: 0.07 },
  tool: { lcp: 3_420, inp: 390, cls: 0.12 },
};

/** The structured data each format should be carrying. */
const SCHEMA_TYPES: Readonly<Record<ContentFormat, readonly string[]>> = {
  guide: ["Article", "FAQPage", "BreadcrumbList"],
  comparison: ["Article", "ItemList", "BreadcrumbList"],
  landing: ["WebPage", "Organization", "BreadcrumbList"],
  product: ["Product", "Offer", "AggregateRating"],
  location: ["LocalBusiness", "PostalAddress", "BreadcrumbList"],
  article: ["Article", "Person", "BreadcrumbList"],
  resource: ["WebPage", "ItemList", "BreadcrumbList"],
  tool: ["SoftwareApplication", "HowTo", "BreadcrumbList"],
};

function schemaStateFor(seed: number, format: ContentFormat): SchemaState {
  const draw = rand(seed, 14);
  // Formats that earn rich results are marked up more often in practice, so
  // the draw is shifted rather than the states being handed out evenly.
  const favoured =
    format === "product" || format === "location" || format === "tool";
  const complete = favoured ? 0.52 : 0.38;

  if (draw < complete) return "complete";
  if (draw < complete + 0.28) return "partial";
  if (draw < complete + 0.36) return "invalid";
  return "missing";
}

const SCHEMA_VALUE: Readonly<Record<SchemaState, number>> = {
  complete: 100,
  partial: 60,
  invalid: 30,
  missing: 15,
};

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

function pathOf(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "") || "/";
}

/**
 * Clicks from the home page.
 *
 * Read off the URL and the page's role in its cluster rather than modelled: a
 * hub is linked from the top of the site, a supporting page sits under it, and
 * a page nothing links to is as far in as the sitemap can put it.
 */
function depthOf(path: string, isPillar: boolean, linksIn: number): number {
  const segments = path.split("/").filter(Boolean).length;
  if (path === "/") return 0;

  const base = isPillar ? Math.min(segments, 2) : Math.max(segments, 2);
  // A page nothing links to is not reachable by clicking at all: a crawler
  // gets to it through the sitemap, which is as far in as this model goes.
  const buried = linksIn === 0 ? 3 : linksIn < MIN_INTERNAL_LINKS_IN ? 1 : 0;
  return clamp(base + buried, 1, 7);
}

function vitalsFor(
  seed: number,
  format: ContentFormat,
  wordCount: number,
  traffic: number,
): PageVitals {
  const base = VITAL_BASE[format];

  // Longer pages carry more above the fold; the effect is small and capped so
  // that word count nudges the reading rather than deciding it.
  const weight = clamp(wordCount / 2_400, 0, 1);

  const lcp = Math.round(
    base.lcp * (0.66 + rand(seed, 21) * 0.62) + weight * 320,
  );
  const inp = Math.round(base.inp * (0.62 + rand(seed, 22) * 0.7));
  const cls = round(base.cls * (0.55 + rand(seed, 23) * 1), 3);

  // A page nobody visits has no field data behind it. Saying "no data" is
  // honest; inventing a reading from a sample of nothing is not.
  if (traffic < 25) {
    return { lcp, inp, cls, state: "unmeasured", score: 60 };
  }

  return {
    lcp,
    inp,
    cls,
    state: cwvStateFor(lcp, inp, cls),
    score: vitalsScore(lcp, inp, cls),
  };
}

function crawlStateFor(
  status: number,
  blocked: boolean,
): CrawlState {
  if (status >= 500) return "server-error";
  if (status === 404 || status === 410) return "broken";
  if (status >= 300 && status < 400) return "redirected";
  if (blocked) return "blocked";
  return "crawlable";
}

function indexabilityFor(
  crawlState: CrawlState,
  robots: RobotsDirective,
  canonical: CanonicalState,
): Indexability {
  if (crawlState === "broken" || crawlState === "server-error") return "error";
  if (crawlState === "redirected") return "redirect";
  if (crawlState === "blocked") return "blocked";
  if (robots.startsWith("noindex")) return "noindex";
  if (canonical === "points-elsewhere") return "canonicalised";
  return "indexable";
}

/**
 * Whether the page is in the index.
 *
 * A separate question from whether it *may* be, and answered separately. Only
 * an indexable page can be indexed, not-indexed, or pending; everything else
 * is excluded, except the small number of pages a search engine keeps despite
 * being told not to — which is a real and confusing state, so the model
 * produces it rather than pretending it cannot happen.
 */
function indexStatusFor(
  seed: number,
  indexability: Indexability,
): { status: IndexStatus; note: string } {
  if (indexability === "indexable") {
    const draw = rand(seed, 31);
    if (draw < 0.796) {
      return { status: "indexed", note: "Open to indexing and in the index." };
    }
    if (draw < 0.918) {
      return {
        status: "not-indexed",
        note: "Eligible and absent — the page is being discovered and not kept.",
      };
    }
    return {
      status: "pending",
      note: "Discovered, not yet processed.",
    };
  }

  if (indexability === "noindex" && rand(seed, 32) < 0.14) {
    return {
      status: "indexed",
      note: "Indexed while carrying a noindex directive — the two contradict each other.",
    };
  }

  const reason: Record<Indexability, string> = {
    indexable: "",
    noindex: "Excluded by its own noindex directive.",
    canonicalised: "Excluded in favour of the URL its canonical names.",
    blocked: "Never requested — robots.txt disallows the path.",
    redirect: "Excluded because the URL redirects.",
    error: "Excluded because the URL does not serve.",
  };

  return { status: "excluded", note: reason[indexability] };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

let pageCache: readonly TechnicalPage[] | null = null;

function build(): readonly TechnicalPage[] {
  const published = getContentRecords().filter(
    (record) => record.url !== null,
  );

  // Titles are compared within a project, not across the portfolio: two
  // clients may legitimately both have an "Pricing" page, and calling that a
  // duplicate would be a finding against nothing.
  const titleCounts = new Map<string, number>();
  for (const record of published) {
    const key = `${record.projectId}::${record.title.trim().toLowerCase()}`;
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }

  // Which URLs do not serve, so that a page linking to one can be told.
  const brokenIds = new Set<string>();
  for (const record of published) {
    const status = statusFor(record.seed);
    if (status === 404 || status === 410 || status >= 500) {
      brokenIds.add(record.id);
    }
  }

  const pages = published.map((record) => {
    const url = record.url as string;
    const path = pathOf(url);
    const seed = record.seed;

    const httpStatus = statusFor(seed);
    const robots = robotsFor(seed);
    const canonicalState = canonicalStateFor(seed);
    const blocked = rand(seed, 15) < 0.031;

    const crawlState = crawlStateFor(httpStatus, blocked);
    const indexability = indexabilityFor(crawlState, robots, canonicalState);
    const { status: indexStatus, note: indexNote } = indexStatusFor(
      seed,
      indexability,
    );

    const redirectHops =
      crawlState === "redirected" ? (rand(seed, 16) < 0.36 ? 2 : 1) : 0;
    const redirectTarget =
      crawlState === "redirected" ? `${path.replace(/\/$/, "")}-v2` : null;

    const canonicalTarget =
      canonicalState === "self"
        ? url
        : canonicalState === "missing"
          ? null
          : `${url.replace(/\/[^/]*$/, "")}/`;

    const isPillar = record.role === "pillar";
    const crawlDepth = depthOf(path, isPillar, record.internalLinksIn);
    const orphan = record.internalLinksIn === 0;

    // A page is submitted unless it cannot be indexed, with a modelled tail of
    // omissions and of URLs that should never have been submitted at all.
    const sitemapDraw = rand(seed, 17);
    const inSitemap =
      indexability === "indexable"
        ? sitemapDraw >= 0.092
        : sitemapDraw < 0.135;

    const metaDraw = rand(seed, 18);
    const metaLength =
      metaDraw < 0.093 ? null : randInt(seed, 19, 44, 196);
    const titleLength = record.title.length;
    const hasH1 = rand(seed, 20) >= 0.042;
    const duplicateTitle =
      (titleCounts.get(
        `${record.projectId}::${record.title.trim().toLowerCase()}`,
      ) ?? 0) > 1;

    const vitals = vitalsFor(
      seed,
      record.format,
      record.wordCount,
      record.traffic,
    );

    const schemaState = schemaStateFor(seed, record.format);
    const expected = SCHEMA_TYPES[record.format];
    const schemaTypes =
      schemaState === "missing"
        ? []
        : schemaState === "partial"
          ? expected.slice(0, 1 + (rand(seed, 24) < 0.5 ? 0 : 1))
          : expected;

    const linksToBroken = record.linksTo.some((id) => brokenIds.has(id));

    // -- the score -------------------------------------------------------
    const fetchable =
      crawlState === "crawlable"
        ? 100
        : crawlState === "redirected"
          ? redirectHops > 1
            ? 32
            : 48
          : crawlState === "blocked"
            ? 20
            : crawlState === "server-error"
              ? 5
              : 0;

    const indexableValue: Record<Indexability, number> = {
      indexable: 100,
      canonicalised: 55,
      redirect: 35,
      noindex: 25,
      blocked: 15,
      error: 0,
    };

    let metadata = 100;
    if (titleLength < TITLE_LENGTH.min || titleLength > TITLE_LENGTH.max) {
      metadata -= 18;
    }
    if (metaLength === null) metadata -= 30;
    else if (metaLength < META_LENGTH.min || metaLength > META_LENGTH.max) {
      metadata -= 15;
    }
    if (!hasH1) metadata -= 22;
    if (duplicateTitle) metadata -= 15;

    const score = pageScore({
      fetchable,
      indexable: indexableValue[indexability],
      metadata: clamp(metadata, 0, 100),
      depth: depthScore(crawlDepth),
      linksIn: linkScore(record.internalLinksIn),
      vitals: vitals.score,
      schema: SCHEMA_VALUE[schemaState],
    });

    const page: TechnicalPage = {
      id: `tech-${record.id}`,
      contentId: record.id,
      url,
      path,
      title: record.title,
      format: record.format,
      projectId: record.projectId,
      projectName: record.projectName,
      clusterId: record.clusterId,
      clusterName: record.clusterName,
      httpStatus,
      redirectTarget,
      redirectHops,
      crawlState,
      robots,
      indexability,
      indexStatus,
      indexNote,
      canonicalState,
      canonicalTarget,
      inSitemap,
      crawlDepth,
      orphan,
      internalLinksIn: record.internalLinksIn,
      internalLinksOut: record.internalLinksOut,
      titleLength,
      metaLength,
      hasH1,
      vitals,
      schemaState,
      schemaTypes,
      // Filled by the issue registry, which is the only thing that decides
      // what is wrong with a page. Assigned there rather than guessed here.
      issueIds: [],
      issueCount: 0,
      severity: "healthy",
      score,
      seed,
    };

    return { page, duplicateTitle, linksToBroken };
  });

  // The findings each page carries are what the registry raises against it,
  // and the registry reads these pages — so the two are joined in one place,
  // by `attachIssues` below, rather than each deciding for itself.
  pageFacts = new Map(
    pages.map((entry) => [
      entry.page.id,
      {
        duplicateTitle: entry.duplicateTitle,
        linksToBroken: entry.linksToBroken,
      },
    ]),
  );

  return pages.map((entry) => entry.page);
}

/** Per-page facts the registry needs that are not on the page record. */
export type PageFacts = {
  readonly duplicateTitle: boolean;
  readonly linksToBroken: boolean;
};

let pageFacts: Map<string, PageFacts> = new Map();

/**
 * The inventory before any finding is attached.
 *
 * The issue registry is the only thing that decides what is wrong with a page,
 * so it reads these and republishes them with their findings. Nothing outside
 * `issues.ts` should call this.
 */
export function getBasePages(): readonly TechnicalPage[] {
  pageCache ??= build();
  return pageCache;
}

export function getPageFacts(pageId: string): PageFacts {
  getBasePages();
  return pageFacts.get(pageId) ?? { duplicateTitle: false, linksToBroken: false };
}
