import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createCrawlService } from "../service.ts";
import { unavailableCrawlStore, type CrawlStore } from "../contract.ts";
import { DEFAULT_USER_AGENT, type CrawlConfig } from "../config.ts";
import type { CrawlFindingsStore, StoredCrawlFinding, StoredCrawlFindingsReport } from "../findings/store-contract.ts";
import { OVERVIEW_EXTERNAL_HOST_LIMIT, OVERVIEW_LINK_LIMIT, OVERVIEW_PAGE_LIMIT, overviewReport, summarizeLinks, type CrawlLinkSummary } from "./contract.ts";
import { EMPTY_LIVE_FILTERS, coverageBanner, pageDetailHref, presentLiveTechnical } from "./present.ts";
import type { ProjectRepository } from "@/lib/projects/contract";
import type { Crawl, CrawlLink, CrawlPage } from "@/types/crawl";
import type { ProjectRecord } from "@/types/project";

/**
 * The live Technical SEO screen (Phase 3, checkpoint 3.2): one recorded
 * crawl presented honestly — every count of the fetched pages, the coverage
 * banner on every surface, unknown readings kept unknown, and the read
 * scoped to the project's own site.
 */

const OPERATOR = "00000000-0000-4000-8000-00000000aaaa";
const CRAWL: Crawl = {
  id: "75d1bfbe-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: { maxPages: 5, maxDepth: 3, maxDurationMs: 60_000 },
  userAgent: DEFAULT_USER_AGENT,
  robotsState: "fetched",
  sitemapState: "fetched",
  pagesDiscovered: 7,
  pagesFetched: 5,
  pagesFailed: 0,
  error: null,
  createdBy: OPERATOR,
  startedAt: "2026-09-27T04:19:04.000Z",
  finishedAt: "2026-09-27T04:19:08.000Z",
};

let n = 0;
function page(path: string, over: Partial<CrawlPage> = {}): CrawlPage {
  n += 1;
  return {
    id: `p0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    crawlId: CRAWL.id,
    url: `https://nexraagency.com${path}`,
    finalUrl: `https://nexraagency.com${path}`,
    fetchState: "fetched",
    httpStatus: 200,
    redirectHops: 0,
    redirectChain: [],
    contentType: "text/html",
    contentBytes: 1000,
    robotsMeta: null,
    robotsTxtAllowed: true,
    canonicalHref: null,
    canonicalResolved: null,
    canonicalIsSelf: true,
    title: `Title ${path}`,
    titleLength: 20,
    metaDescription: null,
    metaDescriptionLength: null,
    h1Count: 1,
    firstH1: "H1",
    h2Count: 2,
    h3Count: 0,
    imageCount: 1,
    imagesWithoutAlt: 0,
    xRobotsTag: null,
    robotsNoindex: false,
    robotsNofollow: false,
    wordCount: 300,
    htmlLang: "en",
    hreflangCount: 0,
    hreflangMalformed: 0,
    ogTagCount: 2,
    ogTitle: null,
    ogImage: null,
    twitterCard: null,
    responseMs: 120,
    schemaTypes: [],
    schemaBlocks: 0,
    schemaParseFailed: false,
    inSitemap: true,
    depth: 1,
    internalLinksIn: 2,
    internalLinksOut: 4,
    fetchedAt: "2026-09-27T04:19:05.000Z",
    errorCode: null,
    ...over,
  };
}

const HOME = page("/", { depth: 0, internalLinksIn: 0, schemaTypes: ["Organization", "WebSite"], schemaBlocks: 2 });
const SERVICES = page("/services", { canonicalIsSelf: false, robotsNoindex: null, schemaTypes: ["Service"], schemaBlocks: 1 });
const ABOUT = page("/about", { internalLinksIn: 0, inSitemap: null, httpStatus: 200 });
const BLOG = page("/blog", { robotsNoindex: true, schemaParseFailed: true, schemaBlocks: 1 });
const CONTACT = page("/contact", { depth: null, responseMs: null });
const SKIPPED_A = page("/careers", { fetchState: "budget-skipped", httpStatus: null, depth: null, title: null, responseMs: null, inSitemap: null, robotsTxtAllowed: null });
const SKIPPED_B = page("/privacy", { fetchState: "budget-skipped", httpStatus: null, depth: null, title: null, responseMs: null, inSitemap: null, robotsTxtAllowed: null });
const PAGES = [HOME, SERVICES, ABOUT, BLOG, CONTACT, SKIPPED_A, SKIPPED_B];

const LINKS: CrawlLinkSummary = { read: 46, cut: false, internal: 40, external: 6, nofollow: 1, externalHosts: [{ host: "linkedin.com", edges: 4 }, { host: "x.com", edges: 2 }], moreExternalHosts: 0 };

let ordinal = 0;
function finding(rule: StoredCrawlFinding["rule"], severity: StoredCrawlFinding["severity"], category: StoredCrawlFinding["category"], urls: string[], urlCount = urls.length): StoredCrawlFinding {
  ordinal += 1;
  return { id: `${rule}:${String(ordinal).padStart(16, "0")}`, rule, severity, category, urls, urlCount, observed: {}, message: `${rule} message`, ordinal };
}

const FINDINGS = [
  finding("title-duplicate", "medium", "metadata", [SERVICES.url, ABOUT.url]),
  finding("h1-missing", "medium", "headings", [BLOG.url]),
  finding("meta-description-long", "low", "metadata", [BLOG.url]),
  finding("meta-description-duplicate", "low", "metadata", [HOME.url, ABOUT.url], 3),
  finding("internal-link-broken", "high", "links", [HOME.url]),
];

const REPORT: StoredCrawlFindingsReport = {
  header: {
    id: "rep-1",
    crawlId: CRAWL.id,
    projectId: CRAWL.projectId,
    ruleVersion: 3,
    coverage: { pagesTotal: 7, pagesFetched: 5, pagesNotFetched: 0, pagesNotReached: 2 },
    linksRead: 46,
    linksCut: false,
    findingsTotal: 5,
    counts: { "title-duplicate": 1, "h1-missing": 1, "meta-description-long": 1, "meta-description-duplicate": 1, "internal-link-broken": 1 },
    truncatedRules: [],
    recordedAt: CRAWL.finishedAt!,
  },
  findings: FINDINGS,
  findingsTruncated: false,
};

const view = (filters = EMPTY_LIVE_FILTERS, report = overviewReport(REPORT)) => presentLiveTechnical({ crawl: CRAWL, pages: PAGES, links: LINKS, report, filters });

describe("the coverage banner (A4)", () => {
  test("states the crawl, its partial status and stop reason, what was fetched and not reached, and the edges read", () => {
    assert.equal(
      coverageBanner(CRAWL, PAGES, LINKS),
      "Crawl 75d1bfbe · Partial — stopped on the page budget · 5 of 7 discovered pages fetched, 2 not reached · 46 link edges read",
    );
    assert.equal(view().banner, coverageBanner(CRAWL, PAGES, LINKS));
  });

  test("names pages tried but not read, a cut edge read, and a crawl still running", () => {
    const failed = page("/down", { fetchState: "http-error", httpStatus: 500 });
    const banner = coverageBanner({ ...CRAWL, status: "running", stopReason: null }, [...PAGES, failed], { ...LINKS, cut: true });
    assert.match(banner, /Running — still running/);
    assert.match(banner, /2 not reached, 1 tried but not read/);
    assert.match(banner, /46 link edges read \(cut at the read limit\)/);
  });
});

describe("the page chrome: live tiles, no health score", () => {
  test("pages fetched, not reached, findings by severity from the report's counts, and the rule version", () => {
    const tiles = view().tiles;
    assert.deepEqual(tiles.map((t) => t.id), ["fetched", "not-reached", "findings", "rules"]);
    assert.equal(tiles[0].value, "5 of 7");
    assert.equal(tiles[1].value, "2");
    assert.equal(tiles[2].value, "5");
    assert.equal(tiles[2].detail, "0 critical · 1 high · 2 medium · 2 low");
    assert.equal(tiles[3].value, "v3");
    assert.doesNotMatch(JSON.stringify(tiles), /score|health/i);
  });

  test("a crawl with no report, or a report at earlier rules, says so and shows no findings", () => {
    const none = view(EMPTY_LIVE_FILTERS, { status: "not-recorded" });
    assert.equal(none.tiles[2].value, "—");
    assert.match(none.report.note ?? "", /No findings were recorded for this crawl\. .*not a clean site/);
    assert.equal(none.counts.findings, 0);
    const older = view(EMPTY_LIVE_FILTERS, overviewReport({ ...REPORT, header: { ...REPORT.header, ruleVersion: 2 } }));
    assert.equal(older.report.status, "other-rules");
    assert.match(older.report.note ?? "", /rule version 2, not the current rules/);
    assert.equal(older.counts.findings, 0);
  });
});

describe("the Overview tab", () => {
  test("findings by severity and by category", () => {
    const o = view().overview;
    assert.deepEqual(o.findingsBySeverity.map((r) => [r.key, r.count]), [["critical", 0], ["high", 1], ["medium", 2], ["low", 2]]);
    assert.deepEqual(o.findingsByCategory.map((r) => [r.key, r.count]), [["metadata", 3], ["headings", 1], ["links", 1]]);
  });

  test("pages by severity: each fetched page at the highest severity naming it; unread pages are not counted", () => {
    const o = view().overview;
    // HOME high (broken link), SERVICES medium, ABOUT medium, BLOG medium, CONTACT none.
    assert.deepEqual(o.pagesBySeverity.map((r) => [r.key, r.count]), [["critical", 0], ["high", 1], ["medium", 3], ["low", 0], ["none", 1]]);
    assert.equal(o.pagesBySeverity.reduce((sum, r) => sum + r.count, 0), 5, "of the fetched pages");
  });

  test("at a glance: declared signals over the fetched pages, unknown readings counted apart, never as a pass", () => {
    const o = view().overview;
    assert.deepEqual(o.statusMix.map((r) => [r.label, r.count]), [["HTTP 200", 5]]);
    const glance = Object.fromEntries(o.atAGlance.map((r) => [r.key, r]));
    assert.equal(glance.noindex.count, 1);
    assert.match(glance.noindex.label, /\(1 unknown\)/);
    assert.equal(glance.canonical.count, 1);
    assert.equal(glance.sitemap.count, 4);
    assert.match(glance.sitemap.label, /\(1 unknown\)/);
  });

  test("top priority findings (most severe first, at most five) and most affected pages", () => {
    const o = view().overview;
    assert.equal(o.topFindings[0].ruleLabel, "Internal link to an error page");
    assert.ok(o.topFindings.length <= 5);
    // Most findings first, then by URL: "/" (duplicate meta + broken link), "/about", "/blog", then "/services".
    assert.deepEqual(o.mostAffected.map((m) => [m.path, m.findings]), [["/", 2], ["/about", 2], ["/blog", 2], ["/services", 1]]);
    // A finding naming more pages than it stored says so.
    const dup = view().overview.topFindings.find((f) => f.ruleLabel === "Duplicate meta description");
    assert.equal(dup?.morePages, 1);
  });
});

describe("Crawlability, Schema, Links and Pages", () => {
  test("crawlability: every recorded URL with fetch state; depth histogram over fetched pages; response time as recorded", () => {
    const c = view().crawlability;
    assert.equal(c.rows.length, 7);
    assert.deepEqual(Object.fromEntries(c.fetchStates.map((r) => [r.key, r.count])), { fetched: 5, "budget-skipped": 2 });
    assert.equal(c.fetchStates.find((r) => r.key === "budget-skipped")?.label, "Not reached (budget)");
    assert.deepEqual(c.depth.map((r) => [r.label, r.count]), [["Depth 0", 1], ["Depth 1", 3], ["Depth unknown", 1]]);
    assert.equal(c.robotsState, "Read");
    assert.equal(c.rows.find((r) => r.path === "/contact")?.responseMs, null);
  });

  test("schema: detected types only, counted over the fetched pages", () => {
    const s = view().schema;
    assert.equal(s.pagesWithTypes, 2);
    assert.equal(s.parseFailures, 1);
    assert.equal(s.fetched, 5);
    assert.deepEqual(s.types.map((t) => [t.key, t.count]), [["Organization", 1], ["Service", 1], ["WebSite", 1]]);
  });

  test("links: the summary, pages with no inbound link from the fetched pages (never the start URL), and broken-link findings", () => {
    const l = view().links;
    assert.equal(l.summary.read, 46);
    assert.deepEqual(l.noInbound.map((p) => p.path), ["/about"]);
    assert.equal(l.broken.length, 1);
    assert.deepEqual(l.rows.map((r) => r.linksIn), [0, 2, 0, 2, 2]);
  });

  test("pages: every recorded URL links to the crawl page's own id; unread pages carry no severity", () => {
    const pages = view().pages;
    assert.equal(pages.length, 7);
    assert.equal(pages[0].href, `/technical/pages/${HOME.id}`);
    assert.equal(pageDetailHref("a b"), "/technical/pages/a%20b");
    const skipped = pages.find((p) => p.path === "/careers")!;
    assert.equal(skipped.fetched, false);
    assert.equal(skipped.highestSeverity, null);
  });
});

describe("filters narrow the findings and the pages together", () => {
  test("severity", () => {
    const v = view({ ...EMPTY_LIVE_FILTERS, severity: "high" });
    assert.equal(v.counts.findings, 1);
    assert.deepEqual(v.pages.map((p) => p.path), ["/"]);
    assert.deepEqual(v.overview.pagesBySeverity.find((r) => r.key === "high")?.count, 1);
  });

  test("category", () => {
    const v = view({ ...EMPTY_LIVE_FILTERS, category: "headings" });
    assert.equal(v.counts.findings, 1);
    assert.deepEqual(v.pages.map((p) => p.path), ["/blog"]);
  });

  test("URL search", () => {
    const v = view({ ...EMPTY_LIVE_FILTERS, search: "/about" });
    assert.deepEqual(v.pages.map((p) => p.path), ["/about"]);
    assert.equal(v.counts.findings, 2);
  });

  test("option counts are each counted with their own filter released", () => {
    const v = view({ ...EMPTY_LIVE_FILTERS, severity: "high" });
    assert.equal(v.filterCounts.severity.medium, 2);
    assert.equal(v.filterCounts.category.links, 1);
    assert.equal(v.filterCounts.category.metadata, undefined);
  });
});

describe("the contract helpers", () => {
  test("summarizeLinks counts internal, external and nofollow edges and ranks external hosts", () => {
    const link = (to: string, internal: boolean, rel: string | null = null): CrawlLink => ({ crawlId: CRAWL.id, fromUrl: HOME.url, toUrl: to, rel, isInternal: internal, anchorText: null });
    const s = summarizeLinks([link(SERVICES.url, true), link("https://linkedin.com/a", false, "nofollow noopener"), link("https://linkedin.com/b", false), link("https://x.com/", false), link("not a url", false)]);
    assert.deepEqual({ read: s.read, cut: s.cut, internal: s.internal, external: s.external, nofollow: s.nofollow }, { read: 5, cut: false, internal: 1, external: 4, nofollow: 1 });
    assert.deepEqual(s.externalHosts, [{ host: "linkedin.com", edges: 2 }, { host: "x.com", edges: 1 }]);
    const many = Array.from({ length: OVERVIEW_EXTERNAL_HOST_LIMIT + 3 }, (_, i) => link(`https://h${i}.example/`, false));
    assert.equal(summarizeLinks(many).moreExternalHosts, 3);
    assert.equal(summarizeLinks(many, many.length).cut, true);
  });

  test("overviewReport presents the current rule version only", () => {
    assert.deepEqual(overviewReport(null), { status: "not-recorded" });
    assert.equal(overviewReport(REPORT).status, "recorded");
    assert.deepEqual(overviewReport({ ...REPORT, header: { ...REPORT.header, ruleVersion: 2 } }), { status: "other-rules", ruleVersion: 2 });
  });
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

const CONFIG: CrawlConfig = { enabled: true, allowedHosts: ["nexraagency.com"], userAgent: DEFAULT_USER_AGENT, budget: CRAWL.budget, concurrency: 1 };
const PROJECT = { id: "nexra-agency", name: "Nexra Agency", domain: "nexraagency.com" } as ProjectRecord;
const projects = (...records: ProjectRecord[]) => ({ async getProjectById(id: string) { return records.find((r) => r.id === id) ?? null; } }) as ProjectRepository;

function store(crawls: readonly Crawl[]) {
  const calls: string[] = [];
  const s: CrawlStore = {
    ...unavailableCrawlStore,
    storesCrawls: true,
    async listByProject(projectId, limit, hostScope) {
      calls.push(`list:${projectId}:${limit}:${hostScope}`);
      return crawls.filter((c) => c.projectId === projectId && (hostScope === undefined || c.hostScope === hostScope)).slice(0, limit);
    },
    async listPages(crawlId, limit) {
      calls.push(`pages:${crawlId}:${limit}`);
      return PAGES.slice(0, limit);
    },
    async listLinks(crawlId, limit) {
      calls.push(`links:${crawlId}:${limit}`);
      return [{ crawlId, fromUrl: HOME.url, toUrl: SERVICES.url, rel: null, isInternal: true, anchorText: "Services" }];
    },
  };
  return { s, calls };
}

function findings(report: StoredCrawlFindingsReport | null) {
  const reads: string[] = [];
  const f: CrawlFindingsStore = {
    storesFindings: true,
    async record() { throw new Error("not under test"); },
    async getReport(projectId, crawlId) {
      reads.push(`${projectId}:${crawlId}`);
      return report;
    },
    async getLatestReportHeader() { throw new Error("not under test"); },
  };
  return { f, reads };
}

describe("getLatestCrawlOverview", () => {
  test("reads the newest crawl of the project's own host only, then its pages, edges and report, bounded", async () => {
    const competitor = { ...CRAWL, id: "c1000000-0000-4000-8000-000000000009", hostScope: "rival.example", startedAt: "2026-09-28T00:00:00.000Z" };
    const { s, calls } = store([competitor, CRAWL]);
    const { f, reads } = findings(REPORT);
    const service = createCrawlService({ store: s, projects: projects(PROJECT), config: CONFIG, findings: f });
    const overview = await service.getLatestCrawlOverview(PROJECT.id);
    assert.equal(overview.status, "crawled");
    if (overview.status !== "crawled") return;
    assert.equal(overview.crawl.id, CRAWL.id, "never the competitor's crawl");
    assert.deepEqual(calls, [`list:nexra-agency:1:nexraagency.com`, `pages:${CRAWL.id}:${OVERVIEW_PAGE_LIMIT}`, `links:${CRAWL.id}:${OVERVIEW_LINK_LIMIT}`]);
    assert.deepEqual(reads, [`nexra-agency:${CRAWL.id}`]);
    assert.equal(overview.pages.length, 7);
    assert.equal(overview.pagesCut, false);
    assert.equal(overview.links.internal, 1);
    assert.equal(overview.report.status, "recorded");
  });

  test("unavailable without a crawl store; none for an unknown project, a project with no crawl, or no usable domain", async () => {
    assert.deepEqual(await createCrawlService({ store: unavailableCrawlStore, projects: projects(PROJECT), config: CONFIG }).getLatestCrawlOverview(PROJECT.id), { status: "unavailable" });
    const { s } = store([]);
    const service = createCrawlService({ store: s, projects: projects(PROJECT), config: CONFIG });
    assert.deepEqual(await service.getLatestCrawlOverview(PROJECT.id), { status: "none" });
    assert.deepEqual(await service.getLatestCrawlOverview("other-project"), { status: "none" });
    const noDomain = createCrawlService({ store: store([CRAWL]).s, projects: projects({ ...PROJECT, domain: "" }), config: CONFIG });
    assert.deepEqual(await noDomain.getLatestCrawlOverview(PROJECT.id), { status: "none" });
  });

  test("no findings store, or no report, reads as not-recorded — never an empty clean report", async () => {
    const plain = await createCrawlService({ store: store([CRAWL]).s, projects: projects(PROJECT), config: CONFIG }).getLatestCrawlOverview(PROJECT.id);
    assert.equal(plain.status === "crawled" && plain.report.status, "not-recorded");
    const empty = await createCrawlService({ store: store([CRAWL]).s, projects: projects(PROJECT), config: CONFIG, findings: findings(null).f }).getLatestCrawlOverview(PROJECT.id);
    assert.equal(empty.status === "crawled" && empty.report.status, "not-recorded");
  });
});
