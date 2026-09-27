/**
 * The live Technical SEO screen, as plain data (Phase 3, checkpoint 3.2).
 *
 * Every figure here is read off one recorded crawl — its pages, its link
 * summary and the findings recorded for it — and says so. Three rules decide
 * every line:
 *
 *   * **Of the fetched pages.** A crawl stopped on its budget saw some of the
 *     site. Aggregates count the pages it fetched, and every surface carries
 *     the same coverage banner, so nothing reads as a site-wide total.
 *   * **A null is unknown.** A reading the crawler did not establish is
 *     counted as unknown, never as a pass, a zero or a no.
 *   * **Declared, not observed by Google.** Robots, canonical and sitemap
 *     readings are what the page declared; nothing here says whether a page
 *     is indexed, how it ranks, or how it performs for users.
 */

import { RULES } from "@/lib/crawl/findings/rules";
import type { FindingCategory, FindingSeverity } from "@/lib/crawl/findings/contract";
import { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_ORDER, type Tone } from "@/lib/crawl/findings/present";
import type { StoredCrawlFinding } from "@/lib/crawl/findings/store-contract";
import type { CrawlLinkSummary, OverviewReport } from "@/lib/crawl/overview/contract";
import { STATUS_LABEL, STOP_REASON } from "@/lib/crawl/panel-state";
import { groupPages, pathOf } from "@/lib/crawl/pages-view";
import type { Crawl, CrawlPage } from "@/types/crawl";

export type { Tone };

/** The screen's filters. Each narrows the findings and the pages together. */
export type LiveFilters = {
  readonly severity: FindingSeverity | "all";
  readonly category: FindingCategory | "all";
  /** A substring of a page URL. */
  readonly search: string;
};

export const EMPTY_LIVE_FILTERS: LiveFilters = { severity: "all", category: "all", search: "" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The route a page row links to (checkpoint 3.3 makes it live), keyed by the crawl page's own id. */
export function pageDetailHref(pageId: string): string {
  return `/technical/pages/${encodeURIComponent(pageId)}`;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * The one sentence every section carries, in the crawl panel's wording:
 * "Crawl 75d1bfbe · Partial — stopped on the page budget · 5 of 7 discovered
 * pages fetched, 2 not reached · 46 link edges read".
 */
export function coverageBanner(crawl: Crawl, pages: readonly CrawlPage[], links: CrawlLinkSummary): string {
  const groups = groupPages(pages);
  const status = STATUS_LABEL[crawl.status].label;
  const reason = crawl.stopReason === null ? "still running" : STOP_REASON[crawl.stopReason].replace(/^./, (c) => c.toLowerCase());
  const failed = groups.notFetched.length > 0 ? `, ${groups.notFetched.length} tried but not read` : "";
  const edges = `${plural(links.read, "link edge")} read${links.cut ? " (cut at the read limit)" : ""}`;
  return `Crawl ${crawl.id.slice(0, 8)} · ${status} — ${reason} · ${groups.fetched.length} of ${crawl.pagesDiscovered} discovered pages fetched, ${groups.notReached.length} not reached${failed} · ${edges}`;
}

/** Said under every aggregate. */
export const OF_FETCHED_NOTE = "Counts are of the pages this crawl fetched, not of the whole site.";

export const LIVE_PROVENANCE =
  "Observed by this product's own crawler and recorded when the crawl finished. Robots, canonical and sitemap readings are what each page declared; nothing here says whether a page is indexed, how it ranks, what traffic it gets or how it performs for users.";

// ---------------------------------------------------------------------------
// Findings and filters
// ---------------------------------------------------------------------------

function findingsOf(report: OverviewReport): readonly StoredCrawlFinding[] {
  return report.status === "recorded" ? report.report.findings : [];
}

function matchesFinding(finding: StoredCrawlFinding, filters: LiveFilters): boolean {
  if (filters.severity !== "all" && finding.severity !== filters.severity) return false;
  if (filters.category !== "all" && finding.category !== filters.category) return false;
  const needle = filters.search.trim().toLowerCase();
  if (needle.length > 0 && !finding.urls.some((url) => url.toLowerCase().includes(needle))) return false;
  return true;
}

/** Findings that name each URL, over the recorded findings. */
function findingsByUrl(findings: readonly StoredCrawlFinding[]): Map<string, StoredCrawlFinding[]> {
  const byUrl = new Map<string, StoredCrawlFinding[]>();
  for (const finding of findings) {
    for (const url of finding.urls) {
      const list = byUrl.get(url) ?? [];
      list.push(finding);
      byUrl.set(url, list);
    }
  }
  return byUrl;
}

const SEVERITY_RANK: Readonly<Record<FindingSeverity, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

function highestSeverity(findings: readonly StoredCrawlFinding[] | undefined): FindingSeverity | null {
  if (!findings || findings.length === 0) return null;
  return findings.reduce<FindingSeverity>((best, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[best] ? f.severity : best), findings[0].severity);
}

/** A page passes when the search names it and, where a severity or category is chosen, a matching finding names it. */
function matchesPage(page: CrawlPage, filters: LiveFilters, byUrl: ReadonlyMap<string, readonly StoredCrawlFinding[]>): boolean {
  const needle = filters.search.trim().toLowerCase();
  if (needle.length > 0 && !page.url.toLowerCase().includes(needle)) return false;
  if (filters.severity === "all" && filters.category === "all") return true;
  return (byUrl.get(page.url) ?? []).some((f) => matchesFinding(f, { ...filters, search: "" }));
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export type Tile = { readonly id: string; readonly label: string; readonly value: string; readonly detail: string };
export type CountRow = { readonly key: string; readonly label: string; readonly count: number; readonly tone?: Tone };

export type PageRow = {
  readonly id: string;
  readonly url: string;
  readonly path: string;
  readonly href: string;
  readonly fetchState: CrawlPage["fetchState"];
  readonly fetched: boolean;
  readonly httpStatus: number | null;
  readonly title: string | null;
  readonly depth: number | null;
  readonly highestSeverity: FindingSeverity | null;
  readonly findings: number;
};

export type FindingSummaryRow = {
  readonly key: string;
  readonly severity: FindingSeverity;
  readonly severityLabel: string;
  readonly tone: Tone;
  readonly ruleLabel: string;
  readonly categoryLabel: string;
  readonly message: string;
  readonly paths: readonly string[];
  /** URLs the finding names beyond those stored with it. */
  readonly morePages: number;
};

export type LiveTechnicalView = {
  readonly banner: string;
  readonly finishedAt: string | null;
  readonly statusLabel: string;
  readonly hostScope: string;
  readonly report: { readonly status: OverviewReport["status"]; readonly ruleVersion: number | null; readonly note: string | null };
  readonly tiles: readonly Tile[];
  readonly filterCounts: { readonly severity: Readonly<Record<string, number>>; readonly category: Readonly<Record<string, number>> };
  readonly overview: {
    readonly findingsBySeverity: readonly CountRow[];
    readonly pagesBySeverity: readonly CountRow[];
    readonly findingsByCategory: readonly CountRow[];
    readonly atAGlance: readonly CountRow[];
    readonly statusMix: readonly CountRow[];
    readonly topFindings: readonly FindingSummaryRow[];
    readonly mostAffected: readonly { readonly path: string; readonly url: string; readonly findings: number }[];
  };
  readonly crawlability: {
    readonly robotsState: string;
    readonly sitemapState: string;
    readonly fetchStates: readonly CountRow[];
    readonly depth: readonly CountRow[];
    readonly rows: readonly (PageRow & {
      readonly robotsTxtAllowed: boolean | null;
      readonly redirectHops: number;
      readonly inSitemap: boolean | null;
      readonly responseMs: number | null;
    })[];
  };
  readonly schema: {
    readonly pagesWithTypes: number;
    readonly parseFailures: number;
    readonly fetched: number;
    readonly types: readonly CountRow[];
    readonly rows: readonly (PageRow & { readonly schemaTypes: readonly string[]; readonly schemaBlocks: number; readonly schemaParseFailed: boolean })[];
  };
  readonly links: {
    readonly summary: CrawlLinkSummary;
    readonly noInbound: readonly { readonly path: string; readonly url: string; readonly depth: number | null; readonly inSitemap: boolean | null }[];
    readonly broken: readonly FindingSummaryRow[];
    readonly rows: readonly (PageRow & { readonly linksIn: number; readonly linksOut: number })[];
  };
  readonly pages: readonly PageRow[];
  readonly counts: { readonly findings: number; readonly pages: number; readonly fetched: number };
};

const DOC_STATE: Readonly<Record<Crawl["robotsState"], string>> = { fetched: "Read", absent: "Not present (404)", unavailable: "Could not be read" };

function summaryRow(finding: StoredCrawlFinding): FindingSummaryRow {
  return {
    key: finding.id,
    severity: finding.severity,
    severityLabel: SEVERITY_LABEL[finding.severity].label,
    tone: SEVERITY_LABEL[finding.severity].tone,
    ruleLabel: RULES[finding.rule].label,
    categoryLabel: CATEGORY_LABEL[finding.category],
    message: finding.message,
    paths: finding.urls.map(pathOf),
    morePages: Math.max(0, finding.urlCount - finding.urls.length),
  };
}

function tally<T extends string>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function reportState(report: OverviewReport): LiveTechnicalView["report"] {
  switch (report.status) {
    case "recorded":
      return { status: "recorded", ruleVersion: report.report.header.ruleVersion, note: report.report.findingsTruncated ? "The findings read was cut at its limit; the counts above are the recorded totals." : null };
    case "other-rules":
      return { status: "other-rules", ruleVersion: report.ruleVersion, note: `Findings for this crawl were recorded under rule version ${report.ruleVersion}, not the current rules, so they are not shown here.` };
    case "not-recorded":
      return { status: "not-recorded", ruleVersion: null, note: "No findings were recorded for this crawl. Nothing is inferred in their place: an absent report is not a clean site." };
  }
}

/** Builds the screen from one recorded crawl. Pure. */
export function presentLiveTechnical(input: {
  readonly crawl: Crawl;
  readonly pages: readonly CrawlPage[];
  readonly links: CrawlLinkSummary;
  readonly report: OverviewReport;
  readonly filters: LiveFilters;
}): LiveTechnicalView {
  const { crawl, pages, links, report, filters } = input;
  const groups = groupPages(pages);
  const allFindings = findingsOf(report);
  const byUrlAll = findingsByUrl(allFindings);
  const findings = allFindings.filter((f) => matchesFinding(f, filters));
  const byUrl = findingsByUrl(findings);
  const shownPages = pages.filter((page) => matchesPage(page, filters, byUrlAll));
  const shownFetched = shownPages.filter((page) => page.fetchState === "fetched");

  const pageRow = (page: CrawlPage): PageRow => ({
    id: page.id,
    url: page.url,
    path: pathOf(page.url),
    href: pageDetailHref(page.id),
    fetchState: page.fetchState,
    fetched: page.fetchState === "fetched",
    httpStatus: page.httpStatus,
    title: page.title,
    depth: page.depth,
    highestSeverity: highestSeverity(byUrl.get(page.url)),
    findings: byUrl.get(page.url)?.length ?? 0,
  });

  // Tiles: the report's recorded totals by severity, unfiltered, so a tile
  // never disagrees with the report it names.
  const severityTotals = new Map<FindingSeverity, number>();
  if (report.status === "recorded") {
    for (const [rule, count] of Object.entries(report.report.header.counts)) {
      const meta = RULES[rule as keyof typeof RULES];
      if (!meta || typeof count !== "number") continue;
      severityTotals.set(meta.severity, (severityTotals.get(meta.severity) ?? 0) + count);
    }
  }
  const findingsTile =
    report.status === "recorded"
      ? SEVERITY_ORDER.map((s) => `${severityTotals.get(s) ?? 0} ${SEVERITY_LABEL[s].label.toLowerCase()}`).join(" · ")
      : "not recorded";
  const tiles: Tile[] = [
    { id: "fetched", label: "Pages fetched", value: `${groups.fetched.length} of ${crawl.pagesDiscovered}`, detail: "Discovered in-scope URLs this crawl read." },
    { id: "not-reached", label: "Not reached", value: String(groups.notReached.length), detail: "Discovered but not tried before the budget ran out. Not looked at." },
    { id: "findings", label: "Findings by severity", value: report.status === "recorded" ? String(report.report.header.findingsTotal) : "—", detail: findingsTile },
    { id: "rules", label: "Rule version", value: report.status === "recorded" ? `v${report.report.header.ruleVersion}` : report.status === "other-rules" ? `v${report.ruleVersion}` : "—", detail: report.status === "recorded" ? "Fixed rules applied when the crawl finished." : "No findings at the current rules." },
  ];

  // Overview panels.
  const sevTally = tally(findings.map((f) => f.severity));
  const findingsBySeverity = SEVERITY_ORDER.map((s) => ({ key: s, label: SEVERITY_LABEL[s].label, count: sevTally.get(s) ?? 0, tone: SEVERITY_LABEL[s].tone }));

  const pageSeverity = tally(shownFetched.map((page) => highestSeverity(byUrl.get(page.url)) ?? "none"));
  const pagesBySeverity: CountRow[] = [
    ...SEVERITY_ORDER.map((s) => ({ key: s, label: SEVERITY_LABEL[s].label, count: pageSeverity.get(s) ?? 0, tone: SEVERITY_LABEL[s].tone })),
    { key: "none", label: "No finding names it", count: pageSeverity.get("none") ?? 0 },
  ];

  const catTally = tally(findings.map((f) => f.category));
  const findingsByCategory = [...catTally.entries()]
    .map(([key, count]) => ({ key, label: CATEGORY_LABEL[key], count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));

  const count = (predicate: (page: CrawlPage) => boolean | null) => {
    let yes = 0;
    let unknown = 0;
    for (const page of shownFetched) {
      const value = predicate(page);
      if (value === null) unknown += 1;
      else if (value) yes += 1;
    }
    return { yes, unknown };
  };
  const noindex = count((p) => p.robotsNoindex);
  const canonicalElsewhere = count((p) => (p.canonicalIsSelf === null ? null : !p.canonicalIsSelf));
  const inSitemap = count((p) => p.inSitemap);
  const atAGlance: CountRow[] = [
    { key: "noindex", label: `Declare noindex${noindex.unknown ? ` (${noindex.unknown} unknown)` : ""}`, count: noindex.yes },
    { key: "canonical", label: `Canonical points elsewhere${canonicalElsewhere.unknown ? ` (${canonicalElsewhere.unknown} unknown)` : ""}`, count: canonicalElsewhere.yes },
    { key: "sitemap", label: `Listed in the sitemap${inSitemap.unknown ? ` (${inSitemap.unknown} unknown)` : ""}`, count: inSitemap.yes },
  ];
  const statusTally = tally(shownFetched.map((p) => (p.httpStatus === null ? "unknown" : String(p.httpStatus))));
  const statusMix = [...statusTally.entries()].map(([key, n]) => ({ key, label: key === "unknown" ? "Status unknown" : `HTTP ${key}`, count: n })).sort((a, b) => (a.key < b.key ? -1 : 1));

  const topFindings = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.ordinal - b.ordinal).slice(0, 5).map(summaryRow);
  const mostAffected = [...byUrl.entries()]
    .map(([url, list]) => ({ url, path: pathOf(url), findings: list.length }))
    .sort((a, b) => b.findings - a.findings || (a.url < b.url ? -1 : 1))
    .slice(0, 5);

  // Crawlability.
  const fetchStates = [...tally(shownPages.map((p) => p.fetchState)).entries()].map(([key, n]) => ({ key, label: key === "budget-skipped" ? "Not reached (budget)" : key, count: n }));
  const depthTally = tally(shownFetched.map((p) => (p.depth === null ? "unknown" : String(p.depth))));
  const depth = [...depthTally.entries()].map(([key, n]) => ({ key, label: key === "unknown" ? "Depth unknown" : `Depth ${key}`, count: n })).sort((a, b) => (a.key < b.key ? -1 : 1));

  // Schema: detected types only.
  const typeTally = tally(shownFetched.flatMap((p) => [...new Set(p.schemaTypes)]));
  const types = [...typeTally.entries()].map(([key, n]) => ({ key, label: key, count: n })).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));

  // Links.
  const noInbound = shownFetched
    .filter((p) => p.depth !== null && p.depth > 0 && p.internalLinksIn === 0)
    .map((p) => ({ path: pathOf(p.url), url: p.url, depth: p.depth, inSitemap: p.inSitemap }));
  const broken = findings.filter((f) => f.rule === "internal-link-broken").map(summaryRow);

  const sevCounts: Record<string, number> = {};
  const catCounts: Record<string, number> = {};
  for (const f of allFindings) {
    if (matchesFinding(f, { ...filters, severity: "all" })) sevCounts[f.severity] = (sevCounts[f.severity] ?? 0) + 1;
    if (matchesFinding(f, { ...filters, category: "all" })) catCounts[f.category] = (catCounts[f.category] ?? 0) + 1;
  }

  return {
    banner: coverageBanner(crawl, pages, links),
    finishedAt: crawl.finishedAt,
    statusLabel: STATUS_LABEL[crawl.status].label,
    hostScope: crawl.hostScope,
    report: reportState(report),
    tiles,
    filterCounts: { severity: sevCounts, category: catCounts },
    overview: { findingsBySeverity, pagesBySeverity, findingsByCategory, atAGlance, statusMix, topFindings, mostAffected },
    crawlability: {
      robotsState: DOC_STATE[crawl.robotsState],
      sitemapState: DOC_STATE[crawl.sitemapState],
      fetchStates,
      depth,
      rows: shownPages.map((p) => ({ ...pageRow(p), robotsTxtAllowed: p.robotsTxtAllowed, redirectHops: p.redirectHops, inSitemap: p.inSitemap, responseMs: p.responseMs })),
    },
    schema: {
      pagesWithTypes: shownFetched.filter((p) => p.schemaTypes.length > 0).length,
      parseFailures: shownFetched.filter((p) => p.schemaParseFailed).length,
      fetched: shownFetched.length,
      types,
      rows: shownFetched.map((p) => ({ ...pageRow(p), schemaTypes: p.schemaTypes, schemaBlocks: p.schemaBlocks, schemaParseFailed: p.schemaParseFailed })),
    },
    links: {
      summary: links,
      noInbound,
      broken,
      rows: shownFetched.map((p) => ({ ...pageRow(p), linksIn: p.internalLinksIn, linksOut: p.internalLinksOut })),
    },
    pages: shownPages.map(pageRow),
    counts: { findings: findings.length, pages: shownPages.length, fetched: shownFetched.length },
  };
}
