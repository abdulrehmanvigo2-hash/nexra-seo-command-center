import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun } from "../../types/agent-run.ts";
import type { Crawl, CrawlPage } from "../../types/crawl.ts";
import type { ProjectIntake, ProjectRecord } from "../../types/project.ts";
import { canonicalCompetitorHost } from "./competitor-target.ts";
import {
  DECLARATIONS_LABEL,
  comparisonRunsFor,
  competitorBanner,
  competitorHref,
  competitorReadFailure,
  readCompetitorList,
  readCompetitorOverview,
  type CompetitorOverviewReaders,
} from "./competitor-overview.ts";

/**
 * Checkpoint 4.4: the Competitor Intelligence screen over stored crawls.
 * Fixtures mirror production: project nexra-agency (nexraagency.com), one
 * recorded competitor, 2vautomation.ai, crawled once — crawl f4f5fda7,
 * partial on the page budget, 5 of 50 discovered pages fetched. Each case is
 * a way the screen could mislead: an unrecorded domain answered, another
 * host's pages shown under this one's heading, a missing crawl shown as an
 * empty site, or another competitor's review listed.
 */

function crawl(over: Partial<Crawl>): Crawl {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    projectId: "nexra-agency",
    startUrl: "https://nexraagency.com/",
    hostScope: "nexraagency.com",
    status: "partial",
    stopReason: "page-budget",
    budget: { maxPages: 5, maxDepth: 3, maxDurationMs: 60_000 } as Crawl["budget"],
    userAgent: "NexraBot",
    robotsState: "fetched",
    sitemapState: "fetched",
    pagesDiscovered: 7,
    pagesFetched: 5,
    pagesFailed: 0,
    error: null,
    createdBy: "operator",
    startedAt: "2026-09-27T08:00:00.000Z",
    finishedAt: "2026-09-27T08:01:00.000Z",
    ...over,
  };
}

function page(url: string, over: Partial<CrawlPage> = {}): CrawlPage {
  return {
    id: `page-${url}`,
    crawlId: "c",
    url,
    finalUrl: url,
    fetchState: "fetched",
    httpStatus: 200,
    title: null,
    firstH1: null,
    metaDescription: null,
    canonicalResolved: null,
    schemaTypes: [],
    ...over,
  } as CrawlPage;
}

const OWN = crawl({ id: "75d1bfbe-0000-0000-0000-000000000000" });
const OWN_PAGES = [page("https://nexraagency.com/", { title: "Nexra Agency", firstH1: "AI SEO", schemaTypes: ["ProfessionalService"] })];

const RIVAL = crawl({
  id: "f4f5fda7-e809-4108-8555-0cd286fdcc4b",
  startUrl: "https://2vautomation.ai/",
  hostScope: "2vautomation.ai",
  pagesDiscovered: 50,
  pagesFetched: 5,
  startedAt: "2026-09-21T15:38:42.583Z",
});
const RIVAL_PAGES = [
  page("https://www.2vautomation.ai/n8n-automation-agency/", { title: "n8n Automation Agency & n8n Consultants | Certified Partner | 2V", firstH1: "n8n Automation Agency", schemaTypes: ["Organization", "FAQPage", "ProfessionalService"] }),
  page("https://2vautomation.ai/", {
    title: "AI Automation Partner for $1M+ Teams | 2V Automation",
    firstH1: "We take the manual work out of running your business.",
    metaDescription: "2V Automation takes the manual work out of running your business.",
    canonicalResolved: "https://www.2vautomation.ai/",
    schemaTypes: ["Organization", "WebSite", "WebPage", "VideoObject", "FAQPage"],
  }),
  page("https://www.2vautomation.ai/about/", { fetchState: "budget-skipped", httpStatus: null }),
];

function readers(over: Partial<{ own: Crawl[]; rival: Crawl[]; detail: Map<string, { crawl: Crawl; pages: CrawlPage[] }>; recorded: string[] }> = {}): CompetitorOverviewReaders {
  const detail = over.detail ?? new Map([
    [OWN.id, { crawl: OWN, pages: OWN_PAGES }],
    [RIVAL.id, { crawl: RIVAL, pages: RIVAL_PAGES }],
  ]);
  return {
    getProjectById: async (id) => (id === "nexra-agency" ? ({ id, name: "Nexra Agency", domain: "nexraagency.com" } as ProjectRecord) : null),
    getProjectIntake: async () => ({ competitorDomains: over.recorded ?? ["https://2vautomation.ai/"], intakeNotes: "" }) as ProjectIntake,
    listProjectCrawls: async () => over.own ?? [OWN],
    listCompetitorCrawls: async (_p, host) => (host === "2vautomation.ai" ? (over.rival ?? [RIVAL]) : []),
    crawls: { getCrawl: async (id: string) => detail.get(id) ?? null } as unknown as CompetitorOverviewReaders["crawls"],
  };
}

describe("readCompetitorList", () => {
  test("lists each recorded competitor with its newest crawl and banner", async () => {
    const result = await readCompetitorList(readers(), "nexra-agency");
    assert.ok(result.ok);
    assert.equal(result.view.projectHost, "nexraagency.com");
    assert.equal(result.view.competitors.length, 1);
    const [only] = result.view.competitors;
    assert.equal(only.host, "2vautomation.ai");
    assert.equal(only.latest?.id, RIVAL.id);
    assert.equal(only.banner, "Crawl f4f5fda7 · Partial — stopped on the page budget · 5 of 50 discovered pages fetched, 45 not reached");
  });

  test("a recorded competitor never crawled answers null, not an empty crawl", async () => {
    const result = await readCompetitorList(readers({ rival: [] }), "nexra-agency");
    assert.ok(result.ok);
    assert.equal(result.view.competitors[0].latest, null);
    assert.equal(result.view.competitors[0].banner, null);
  });

  test("an unknown project is refused; invalid or duplicate intake entries are dropped", async () => {
    assert.deepEqual(await readCompetitorList(readers(), "other"), { ok: false, reason: "project-not-found" });
    const result = await readCompetitorList(readers({ recorded: ["2vautomation.ai", "https://2vautomation.ai/blog", "10.0.0.1", "nexraagency.com"] }), "nexra-agency");
    assert.ok(result.ok);
    assert.deepEqual(result.view.competitors.map((c) => c.host), ["2vautomation.ai"]);
  });
});

describe("readCompetitorOverview", () => {
  test("puts the newest own-site crawl beside the competitor's, with only fetched pages' declarations", async () => {
    const result = await readCompetitorOverview(readers(), { projectId: "nexra-agency", competitorDomain: "2vautomation.ai" });
    assert.ok(result.ok);
    const { project, competitor } = result.view;
    assert.equal(project.status, "crawled");
    assert.equal(competitor.status, "crawled");
    if (competitor.status !== "crawled" || project.status !== "crawled") return;
    assert.deepEqual(competitor.pages.map((p) => p.path), ["/", "/n8n-automation-agency/"]);
    assert.deepEqual(competitor.pages[0], {
      url: "https://2vautomation.ai/",
      path: "/",
      title: "AI Automation Partner for $1M+ Teams | 2V Automation",
      firstH1: "We take the manual work out of running your business.",
      metaDescription: "2V Automation takes the manual work out of running your business.",
      canonical: "https://www.2vautomation.ai/",
      schemaTypes: ["Organization", "WebSite", "WebPage", "VideoObject", "FAQPage"],
    });
    assert.equal(project.pages[0].title, "Nexra Agency");
    assert.match(competitor.banner, /5 of 50 discovered pages fetched, 45 not reached/);
    assert.equal(DECLARATIONS_LABEL, "What each site's pages declared, as crawled");
    assert.doesNotMatch(JSON.stringify(result.view), /rank|visibility|traffic|authority|score/i);
  });

  test("a competitor never crawled answers not-crawled", async () => {
    const result = await readCompetitorOverview(readers({ rival: [] }), { projectId: "nexra-agency", competitorDomain: "2vautomation.ai" });
    assert.ok(result.ok);
    assert.deepEqual(result.view.competitor, { status: "not-crawled", host: "2vautomation.ai" });
  });

  test("an unrecorded domain, the project's own site or a URL is refused before any crawl is read", async () => {
    let listed = 0;
    const base = readers();
    const counting: CompetitorOverviewReaders = { ...base, listCompetitorCrawls: async (...args) => ((listed += 1), base.listCompetitorCrawls(...args)), listProjectCrawls: async (...args) => ((listed += 1), base.listProjectCrawls(...args)) };
    assert.deepEqual(await readCompetitorOverview(counting, { projectId: "nexra-agency", competitorDomain: "rival.example" }), { ok: false, reason: "competitor-not-recorded" });
    assert.deepEqual(await readCompetitorOverview(counting, { projectId: "nexra-agency", competitorDomain: "www.nexraagency.com" }), { ok: false, reason: "competitor-is-project-site" });
    assert.deepEqual(await readCompetitorOverview(counting, { projectId: "nexra-agency", competitorDomain: "https://2vautomation.ai/" }), { ok: false, reason: "competitor-invalid" });
    assert.deepEqual(await readCompetitorOverview(counting, { projectId: "missing", competitorDomain: "2vautomation.ai" }), { ok: false, reason: "project-not-found" });
    assert.equal(listed, 0);
  });

  test("a row read back under another project or host is never shown under this side's heading", async () => {
    const foreign = { crawl: { ...RIVAL, hostScope: "elsewhere.example" }, pages: RIVAL_PAGES };
    const result = await readCompetitorOverview(readers({ detail: new Map([[OWN.id, { crawl: OWN, pages: OWN_PAGES }], [RIVAL.id, foreign]]) }), { projectId: "nexra-agency", competitorDomain: "2vautomation.ai" });
    assert.ok(result.ok);
    assert.equal(result.view.competitor.status, "crawled");
    if (result.view.competitor.status === "crawled") assert.deepEqual(result.view.competitor.pages, []);
  });

  test("a failed newest crawl shows its state and no declarations, never an older crawl", async () => {
    const failed = crawl({ id: "11111111-0000-0000-0000-000000000000", hostScope: "2vautomation.ai", status: "failed", stopReason: "error", startedAt: "2026-09-26T00:00:00.000Z" });
    const result = await readCompetitorOverview(readers({ rival: [RIVAL, failed] }), { projectId: "nexra-agency", competitorDomain: "2vautomation.ai" });
    assert.ok(result.ok);
    assert.equal(result.view.competitor.status, "crawled");
    if (result.view.competitor.status === "crawled") {
      assert.equal(result.view.competitor.crawl.id, failed.id);
      assert.deepEqual(result.view.competitor.pages, []);
    }
  });
});

describe("helpers", () => {
  test("the banner counts pages tried but not read apart from pages not reached", () => {
    assert.equal(competitorBanner(crawl({ id: "abcdef12", pagesDiscovered: 10, pagesFetched: 5, pagesFailed: 2 })), "Crawl abcdef12 · Partial — stopped on the page budget · 5 of 10 discovered pages fetched, 3 not reached, 2 tried but not read");
  });

  test("the detail route is keyed by host; fixture ids are not hosts and fall through to not-found", () => {
    assert.equal(competitorHref("2vautomation.ai", "nexra-agency"), "/competitors/2vautomation.ai?project=nexra-agency");
    assert.equal(canonicalCompetitorHost("2vautomation.ai"), "2vautomation.ai");
    for (const fixtureId of ["nexra-agency--rival", "nexra-agency--rival-0", "atlas-dental--brightsmile"]) assert.equal(canonicalCompetitorHost(fixtureId), null);
  });

  test("comparison runs are this competitor's only, newest first", () => {
    const run = (id: string, domain: string, over: Partial<AgentRun> = {}) =>
      ({ id, agentId: "market-intelligence", taskType: "competitor-comparison-review", input: { competitorDomain: domain }, status: "completed", executor: "ai", resultSummary: `summary ${id}`, resultMetadata: {}, error: null, createdAt: `2026-09-2${id}T00:00:00.000Z`, finishedAt: null, ...over }) as AgentRun;
    const rows = comparisonRunsFor(
      [run("1", "2vautomation.ai"), run("3", "rival.example"), run("2", "2vautomation.ai", { status: "failed", resultSummary: null, error: { code: "rejected-output", message: "x" } }), run("4", "2vautomation.ai", { taskType: "crawl-review" } as Partial<AgentRun>)],
      "2vautomation.ai",
    );
    assert.deepEqual(rows.map((r) => [r.id, r.status, r.summary, r.errorCode]), [
      ["2", "failed", null, "rejected-output"],
      ["1", "completed", "summary 1", null],
    ]);
  });

  test("read failures are worded apart from empty results", () => {
    assert.match(competitorReadFailure(422, "competitor-not-recorded"), /not one of the competitor domains recorded/);
    assert.match(competitorReadFailure(500), /read failure, not an empty result/);
  });
});
