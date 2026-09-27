import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Checkpoint 3.2: the surfaces that are not pure modules — the new route and
 * the Technical SEO screen. These checks keep the gate order, the project
 * check, the observed-only screen and the hidden fixture surfaces from
 * drifting in the files themselves.
 */

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const ROUTE = read("src/app/api/crawls/latest-overview/route.ts");
const SCREEN = read("src/components/technical/technical-seo.tsx");
const VIEWS = read("src/components/technical/live-views.tsx");
const SERVICE = read("src/lib/crawl/service.ts");

describe("GET /api/crawls/latest-overview", () => {
  test("operator first, then the project id shape, then the read limit, then the project check, then the service", () => {
    const order = ["getOperator()", "overviewReadRequest(", 'crawlLimiter("read")', "projectRepository.getProjectById(", "getLatestCrawlOverview("];
    const at = order.map((needle) => ROUTE.indexOf(needle));
    assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at, "in this order");
    assert.match(ROUTE, /errorResponse\("unauthorized", 401\)/);
    assert.match(ROUTE, /errorResponse\("not-found", 404\)/);
    assert.match(ROUTE, /errorResponse\("unavailable", 503\)/);
    assert.match(ROUTE, /logFailure\("latest crawl overview read", error\)/);
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/, "GET only");
    assert.doesNotMatch(ROUTE, /error\.message|String\(error\)/);
  });

  test("the service reads the project's own host only, bounded, and never starts a crawl", () => {
    const body = SERVICE.slice(SERVICE.indexOf("async getLatestCrawlOverview("), SERVICE.indexOf("async getCrawl(id"));
    assert.match(body, /store\.listByProject\(projectId, 1, projectHost\)/);
    assert.match(body, /OVERVIEW_PAGE_LIMIT/);
    assert.match(body, /OVERVIEW_LINK_LIMIT/);
    assert.doesNotMatch(body, /engine\(|startCrawl|savePages|saveLinks|insert\(/);
  });
});

describe("the Technical SEO screen reads observed data only", () => {
  test("no fixture import, no modelled label, one read through the overview endpoint", () => {
    for (const text of [SCREEN, VIEWS]) {
      assert.doesNotMatch(text, /@\/lib\/mock/);
      assert.doesNotMatch(text, /Modelled data|MODELLED_SOURCE_NOTE|ProvenanceTag/);
    }
    assert.match(SCREEN, /fetch\(overviewUrl\(projectId\)/);
    assert.doesNotMatch(SCREEN, /method: "POST"/, "the screen itself writes nothing");
  });

  test("the fixture-only surfaces are hidden: no Vitals, Opportunities, answer-engine access, index coverage or health score", () => {
    assert.doesNotMatch(SCREEN, /VitalsView|OpportunitiesView|AgentAccessPanel|IndexationView|IssuesView|getVitalsSummary|healthScore/);
    assert.doesNotMatch(SCREEN, /id: "vitals"|id: "opportunities"|id: "indexation"/);
    for (const id of ["overview", "issues", "crawlability", "pages", "schema", "links"]) assert.match(SCREEN, new RegExp(`id: "${id}"`));
  });

  test("every state is kept apart: no stored project, loading, failed, unavailable, no crawl, and a crawl", () => {
    assert.match(SCREEN, /storedProjects\.length === 0 &&/);
    for (const state of ['"loading"', '"failed"', '"unavailable"']) assert.match(SCREEN, new RegExp(`load\\.status === ${state}`));
    assert.match(SCREEN, /load\.overview\.status === "none"/);
    assert.match(SCREEN, /No crawl recorded for this project/);
    assert.match(SCREEN, /This says nothing about the site itself/);
  });

  test("every section carries the coverage banner and says its counts are of the fetched pages", () => {
    assert.match(VIEWS, /<CoverageBanner text=\{banner\} \/>/);
    assert.match(VIEWS, /OF_FETCHED_NOTE/);
    assert.match(VIEWS, /no inbound link from the fetched pages/i);
    assert.match(VIEWS, /Detected types only/);
    assert.match(VIEWS, /server response|Server response/);
    assert.match(VIEWS, /not a Core Web Vitals reading/);
    assert.match(SCREEN, /<CoverageBanner text=\{view\.banner\} \/>/);
  });

  test("page rows link to the page-detail route by the crawl page's own id", () => {
    assert.match(VIEWS, /href=\{row\.href\}/);
    assert.match(read("src/lib/crawl/overview/present.ts"), /`\/technical\/pages\/\$\{encodeURIComponent\(pageId\)\}`/);
  });
});
