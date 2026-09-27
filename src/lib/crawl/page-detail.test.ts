import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createCrawlService } from "./service.ts";
import { unavailableCrawlStore, type CrawlStore } from "./contract.ts";
import { DEFAULT_USER_AGENT, type CrawlConfig } from "./config.ts";
import type { CrawlFindingsStore, StoredCrawlFinding, StoredCrawlFindingsReport, StoredCrawlFindingsReportHeader } from "./findings/store-contract.ts";
import type { CrawlFindingTriageStore } from "./findings/triage/store-contract.ts";
import type { FindingTriage } from "./findings/triage/contract.ts";
import { UNKNOWN, presentPageDetail } from "./page-detail.ts";
import type { ProjectRepository } from "@/lib/projects/contract";
import type { Crawl, CrawlLink, CrawlPage } from "@/types/crawl";
import type { ProjectRecord } from "@/types/project";

/**
 * Checkpoint 3.3: the live page detail (the page → crawl → project chain,
 * edges both ways, the findings naming the page, declared-only wording) and
 * the derived finding history through the crawl service; then the route and
 * screen surfaces as text.
 */

const OPERATOR = "00000000-0000-4000-8000-00000000aaaa";
const PROJECT = { id: "nexra-agency", name: "Nexra Agency", domain: "nexraagency.com" } as ProjectRecord;
const CONFIG: CrawlConfig = { enabled: true, allowedHosts: ["nexraagency.com"], userAgent: DEFAULT_USER_AGENT, budget: { maxPages: 5, maxDepth: 3, maxDurationMs: 60_000 }, concurrency: 1 };

const crawlOf = (id: string, over: Partial<Crawl> = {}): Crawl => ({
  id,
  projectId: PROJECT.id,
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "partial",
  stopReason: "page-budget",
  budget: CONFIG.budget,
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
  ...over,
});
const CRAWL = crawlOf("75d1bfbe-0000-4000-8000-000000000001");
const RIVAL = crawlOf("c1000000-0000-4000-8000-000000000009", { hostScope: "rival.example", startUrl: "https://rival.example/" });

const page = (id: string, url: string, over: Partial<CrawlPage> = {}): CrawlPage => ({
  id,
  crawlId: CRAWL.id,
  url,
  finalUrl: url,
  fetchState: "fetched",
  httpStatus: 200,
  redirectHops: 0,
  redirectChain: [],
  contentType: "text/html; charset=utf-8",
  contentBytes: 1000,
  robotsMeta: "index, follow",
  robotsTxtAllowed: true,
  canonicalHref: "/about",
  canonicalResolved: url,
  canonicalIsSelf: true,
  title: "About Nexra",
  titleLength: 11,
  metaDescription: null,
  metaDescriptionLength: null,
  h1Count: 1,
  firstH1: "About us",
  h2Count: 3,
  h3Count: 0,
  imageCount: 4,
  imagesWithoutAlt: 1,
  xRobotsTag: null,
  robotsNoindex: false,
  robotsNofollow: false,
  wordCount: 640,
  htmlLang: "en",
  hreflangCount: 0,
  hreflangMalformed: 0,
  ogTagCount: 3,
  ogTitle: "About",
  ogImage: null,
  twitterCard: "summary",
  responseMs: 180,
  schemaTypes: ["Organization"],
  schemaBlocks: 1,
  schemaParseFailed: false,
  inSitemap: null,
  depth: 1,
  internalLinksIn: 2,
  internalLinksOut: 5,
  fetchedAt: CRAWL.finishedAt,
  errorCode: null,
  ...over,
});
const ABOUT = page("aaaaaaaa-0000-4000-8000-000000000001", "https://nexraagency.com/about");
const SKIPPED = page("aaaaaaaa-0000-4000-8000-000000000002", "https://nexraagency.com/careers", { fetchState: "budget-skipped", httpStatus: null, title: null, responseMs: null, depth: null });
const RIVAL_PAGE = page("aaaaaaaa-0000-4000-8000-000000000003", "https://rival.example/", { crawlId: RIVAL.id });

const link = (from: string, to: string, internal = true, anchor: string | null = "About"): CrawlLink => ({ crawlId: CRAWL.id, fromUrl: from, toUrl: to, rel: null, isInternal: internal, anchorText: anchor });
const LINKS = [
  link("https://nexraagency.com/", ABOUT.url),
  link("https://nexraagency.com/blog", ABOUT.url, true, null),
  link(ABOUT.url, "https://linkedin.com/company/nexra", false, "LinkedIn"),
  link("https://nexraagency.com/", "https://nexraagency.com/blog"),
];

const finding = (key: string, rule: StoredCrawlFinding["rule"], urls: string[], urlCount = urls.length, ordinal = 0): StoredCrawlFinding => ({
  id: key,
  rule,
  category: "metadata",
  severity: "medium",
  urls,
  urlCount,
  observed: {},
  message: `${rule} message`,
  ordinal,
});
const header = (crawlId: string, ruleVersion = 3): StoredCrawlFindingsReportHeader => ({
  id: `rep-${crawlId}`,
  crawlId,
  projectId: PROJECT.id,
  ruleVersion,
  coverage: { pagesTotal: 7, pagesFetched: 5, pagesNotFetched: 0, pagesNotReached: 2 },
  linksRead: 46,
  linksCut: false,
  findingsTotal: 2,
  counts: {},
  truncatedRules: [],
  recordedAt: "2026-09-27T04:19:08.000Z",
});
const REPORT: StoredCrawlFindingsReport = {
  header: header(CRAWL.id),
  findings: [finding("title-duplicate:aaaaaaaaaaaaaaaa", "title-duplicate", ["https://nexraagency.com/", ABOUT.url], 3), finding("h1-missing:bbbbbbbbbbbbbbbb", "h1-missing", ["https://nexraagency.com/blog"], 1, 1)],
  findingsTruncated: false,
};
const DECISION: FindingTriage = { id: "t1", projectId: PROJECT.id, findingKey: "title-duplicate:aaaaaaaaaaaaaaaa", rule: "title-duplicate", findingId: "f", reportId: "r", crawlId: CRAWL.id, status: "acknowledged", note: null, setBy: OPERATOR, setAt: "2026-09-27T05:00:00.000Z", createdAt: "2026-09-27T05:00:00.000Z" };

function store(options: { pages?: CrawlPage[]; crawls?: Crawl[] } = {}): CrawlStore {
  const pages = options.pages ?? [ABOUT, SKIPPED, RIVAL_PAGE];
  const crawls = options.crawls ?? [CRAWL, RIVAL];
  return {
    ...unavailableCrawlStore,
    storesCrawls: true,
    async getPage(id) {
      return pages.find((p) => p.id === id) ?? null;
    },
    async getById(id) {
      return crawls.find((c) => c.id === id) ?? null;
    },
    async listLinks() {
      return LINKS;
    },
    async listPages(crawlId) {
      return pages.filter((p) => p.crawlId === crawlId);
    },
    async listByProject(projectId, limit, hostScope) {
      return crawls.filter((c) => c.projectId === projectId && c.hostScope === hostScope).slice(0, limit);
    },
  };
}
function findings(reports: Record<string, StoredCrawlFindingsReport>): CrawlFindingsStore {
  return {
    storesFindings: true,
    async record() {
      throw new Error("not under test");
    },
    async getReport(_projectId, crawlId) {
      return reports[crawlId] ?? null;
    },
    async getLatestReportHeader() {
      throw new Error("not under test");
    },
    async listReportHeaders() {
      return Object.values(reports).map((r) => r.header);
    },
  };
}
const triage: CrawlFindingTriageStore = {
  storesTriage: true,
  async listForProject() {
    return [DECISION, { ...DECISION, id: "t2", findingKey: "other-rule:cccccccccccccccc" }];
  },
  async set() {
    throw new Error("not under test");
  },
};
const projects = (...records: ProjectRecord[]) => ({ async getProjectById(id: string) { return records.find((r) => r.id === id) ?? null; } }) as ProjectRepository;
const service = (over: { s?: CrawlStore; p?: ProjectRepository; f?: CrawlFindingsStore } = {}) =>
  createCrawlService({ store: over.s ?? store(), projects: over.p ?? projects(PROJECT), config: CONFIG, findings: over.f ?? findings({ [CRAWL.id]: REPORT }), triage });

describe("getCrawlPageDetail: the page → crawl → project chain", () => {
  test("a page of the project's own crawl, with edges both ways, the findings naming it and their decisions", async () => {
    const detail = await service().getCrawlPageDetail(ABOUT.id);
    assert.equal(detail.status, "found");
    if (detail.status !== "found") return;
    assert.equal(detail.crawl.id, CRAWL.id);
    assert.deepEqual(detail.inbound.map((l) => l.fromUrl), ["https://nexraagency.com/", "https://nexraagency.com/blog"]);
    assert.deepEqual(detail.outbound.map((l) => l.toUrl), ["https://linkedin.com/company/nexra"]);
    assert.deepEqual(detail.findings.map((f) => f.id), ["title-duplicate:aaaaaaaaaaaaaaaa"]);
    assert.deepEqual(detail.triage.map((d) => d.id), ["t1"], "only decisions on findings that name the page");
    assert.equal(detail.linksCut, false);
  });

  test("unknown page, competitor crawl page, missing crawl, gone project and no-domain project are not found", async () => {
    assert.deepEqual(await service().getCrawlPageDetail("aaaaaaaa-0000-4000-8000-00000000ffff"), { status: "not-found" });
    assert.deepEqual(await service().getCrawlPageDetail(RIVAL_PAGE.id), { status: "not-found" });
    assert.deepEqual(await service({ s: store({ crawls: [] }) }).getCrawlPageDetail(ABOUT.id), { status: "not-found" });
    assert.deepEqual(await service({ p: projects() }).getCrawlPageDetail(ABOUT.id), { status: "not-found" });
    assert.deepEqual(await service({ p: projects({ ...PROJECT, domain: "" }) }).getCrawlPageDetail(ABOUT.id), { status: "not-found" });
  });

  test("unavailable without a crawl store; a report under earlier rules shows no findings", async () => {
    assert.deepEqual(await createCrawlService({ store: unavailableCrawlStore, projects: projects(PROJECT), config: CONFIG }).getCrawlPageDetail(ABOUT.id), { status: "unavailable" });
    const older = await service({ f: findings({ [CRAWL.id]: { ...REPORT, header: header(CRAWL.id, 2) } }) }).getCrawlPageDetail(ABOUT.id);
    assert.equal(older.status === "found" && older.report.status, "other-rules");
    assert.equal(older.status === "found" && older.findings.length, 0);
  });
});

describe("presentPageDetail", () => {
  test("a fetched page: the four fact groups, declared-only wording, crawler-measured response, unknowns as a dash", async () => {
    const detail = await service().getCrawlPageDetail(ABOUT.id);
    if (detail.status !== "found") throw new Error("not found");
    const view = presentPageDetail(detail);
    assert.equal(view.banner, "Crawl 75d1bfbe · Partial — stopped on the page budget · 5 of 7 discovered pages fetched · this page was fetched and read");
    assert.deepEqual(view.groups.map((g) => g.id), ["response", "indexing", "markup", "linking"]);
    const fact = (group: string, label: string) => view.groups.find((g) => g.id === group)!.facts.find((f) => f.label === label)!.value;
    assert.equal(fact("response", "Server response, crawler-measured"), "180 ms");
    assert.match(view.groups[0].note, /not a Core Web Vitals reading/);
    assert.match(view.groups[1].note, /Declared by the page — not whether Google indexed it/);
    assert.equal(fact("indexing", "Listed in the sitemap"), UNKNOWN, "a null is unknown, never No");
    assert.equal(fact("markup", "Meta description"), UNKNOWN);
    assert.equal(fact("markup", "Title"), "About Nexra (11 characters)");
    assert.equal(fact("markup", "H1 / H2 / H3"), "1 / 3 / 0");
    assert.equal(fact("markup", "Images (without alt)"), "4 (1)");
    assert.equal(fact("markup", "Detected structured data types"), "Organization");
    assert.deepEqual(view.inbound.map((e) => [e.path, e.anchor]), [["/", "About"], ["/blog", "(no anchor text)"]]);
    assert.deepEqual(view.outbound.map((e) => [e.path, e.internal]), [["https://linkedin.com/company/nexra", false]]);
    assert.equal(view.findings.length, 1);
    assert.equal(view.findings[0].statusLabel, "Acknowledged");
    assert.equal(view.findings[0].partialUrls, true);
    assert.doesNotMatch(JSON.stringify(view), /score|Core Web Vitals: |indexed:/i);
  });

  test("a page discovered but not fetched shows only that", async () => {
    const detail = await service().getCrawlPageDetail(SKIPPED.id);
    if (detail.status !== "found") throw new Error("not found");
    const view = presentPageDetail(detail);
    assert.equal(view.fetched, false);
    assert.deepEqual(view.groups.map((g) => g.id), ["response"]);
    assert.match(view.banner, /this page was discovered, not fetched$/);
    assert.match(view.findingsNote, /not fetched, so no rule looked at it/);
  });
});

describe("getFindingHistory through the service", () => {
  test("derives from the own-site crawls' reports; crawls without a report read not recorded", async () => {
    const earlier = crawlOf("3398ff1a-0000-4000-8000-000000000001", { startedAt: "2026-09-25T11:07:53.000Z" });
    const oldest = crawlOf("13211e31-0000-4000-8000-000000000001", { startedAt: "2026-09-20T00:00:00.000Z" });
    const s = store({ crawls: [CRAWL, earlier, oldest, RIVAL], pages: [ABOUT, { ...ABOUT, id: "x", crawlId: earlier.id }] });
    const read = await service({ s, f: findings({ [CRAWL.id]: REPORT, [earlier.id]: { ...REPORT, header: header(earlier.id) } }) }).getFindingHistory(PROJECT.id);
    assert.equal(read.status, "derived");
    if (read.status !== "derived") return;
    assert.deepEqual(read.history.compared.map((c) => c.id), [earlier.id, CRAWL.id]);
    assert.deepEqual(read.history.notRecorded.map((c) => c.id), [oldest.id]);
    assert.ok(read.history.current.every((r) => r.state === "persisted"));
  });

  test("unavailable without stores; none for an unknown project or one with no own-site crawl", async () => {
    assert.deepEqual(await createCrawlService({ store: store(), projects: projects(PROJECT), config: CONFIG }).getFindingHistory(PROJECT.id), { status: "unavailable" });
    assert.deepEqual(await service().getFindingHistory("other-project"), { status: "none" });
    assert.deepEqual(await service({ s: store({ crawls: [RIVAL] }) }).getFindingHistory(PROJECT.id), { status: "none" });
  });
});

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const PAGE_ROUTE = read("src/app/(app)/technical/pages/[pageId]/page.tsx");
const HISTORY_ROUTE = read("src/app/api/crawls/finding-history/route.ts");
const DETAIL_VIEW = read("src/components/technical/live-page-detail.tsx");
const SCREEN = read("src/components/technical/technical-seo.tsx");

describe("the page-detail route", () => {
  test("no fixture and no prerender: the uuid shape, then the operator, then the read limit, then the service", () => {
    assert.doesNotMatch(PAGE_ROUTE, /@\/lib\/mock|generateStaticParams|TechnicalPageWorkspace/);
    const order = ["UUID.test(id)", "getOperator()", 'crawlLimiter("read").consume(operator.id)', "getCrawlPageDetail("];
    const at = order.map((needle) => PAGE_ROUTE.indexOf(needle));
    assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.match(PAGE_ROUTE, /if \(detail\.status === "not-found"\) notFound\(\);/);
    assert.equal((PAGE_ROUTE.match(/notFound\(\)/g) ?? []).length, 3, "bad shape, no operator, not found");
  });

  test("the view is observed-only and never shows a score, vitals or index status", () => {
    assert.doesNotMatch(DETAIL_VIEW, /@\/lib\/mock|MODELLED|ProvenanceTag|VitalValue|ScoreBreakdown/);
    assert.match(DETAIL_VIEW, /CoverageBanner text=\{view\.banner\}/);
    assert.match(DETAIL_VIEW, /nothing here reports indexation, rankings, traffic or Core Web Vitals/);
  });
});

describe("the finding-history route and panel", () => {
  test("operator first, then the project id shape, the read limit, the project check, then the service; GET only", () => {
    const order = ["getOperator()", "latestFindingsReadRequest(", 'crawlLimiter("read")', "projectRepository.getProjectById(", "getFindingHistory("];
    const at = order.map((needle) => HISTORY_ROUTE.indexOf(needle));
    assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.doesNotMatch(HISTORY_ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    assert.doesNotMatch(HISTORY_ROUTE, /error\.message|String\(error\)/);
  });

  test("the Issues tab mounts the history panel beside the observed findings", () => {
    assert.match(SCREEN, /<FindingHistoryPanel projectId=\{projectId\} \/>/);
    assert.ok(SCREEN.indexOf("<ObservedFindings ") < SCREEN.indexOf("<FindingHistoryPanel "));
  });
});
