import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Checkpoint 4.4: the Competitor Intelligence surfaces kept from drifting in
 * the files themselves — the route's gates, the host-keyed detail route and
 * the hidden SERP-backed views.
 */

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const ROUTE = read("src/app/api/crawls/competitor-overview/route.ts");
const PAGE = read("src/app/(app)/competitors/page.tsx");
const DETAIL = read("src/app/(app)/competitors/[host]/page.tsx");
const SCREEN = read("src/components/competitors/observed-competitors.tsx");

describe("the competitor-overview route", () => {
  test("GET only: operator, then the request's shape, then the read limit, then the project, then the reader", () => {
    const get = ROUTE.slice(ROUTE.indexOf("export async function GET"));
    const order = ["await getOperator()", "isStorableProjectId(project)", "COMPETITOR_INPUT.test(competitor)", 'crawlLimiter("read")', "projectRepository.getProjectById(project)", "readCompetitorList(readers(), project)"].map((s) => get.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `order ${order}`);
    assert.match(get, /readCompetitorOverview\(readers\(\), \{ projectId: project, competitorDomain: competitor \}\)/);
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    assert.match(ROUTE, /"competitor-not-recorded": 422/);
    assert.doesNotMatch(ROUTE, /error\.message|String\(error\)/);
  });
});

describe("the detail route, keyed by host (Q3)", () => {
  test("the host's shape first, then the operator, then a stored project that recorded it; nothing prerendered, no fixture", () => {
    const order = ["canonicalCompetitorHost(decodeURIComponent(raw))", "if (host === null) notFound();", "await getOperator()", "projectRepository.getProjectIntake(project.id)", "if (!recorded.includes(host)) continue;"].map((s) => DETAIL.indexOf(s));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `order ${order}`);
    assert.match(DETAIL.slice(DETAIL.lastIndexOf("}\n  notFound();")), /notFound\(\);/);
    assert.doesNotMatch(DETAIL, /generateStaticParams|@\/lib\/mock|CompetitorWorkspace/);
  });
});

describe("the screen", () => {
  test("imports no fixture, carries the Observed badge and no Modelled tag, and shows no SERP-backed view", () => {
    for (const file of [PAGE, DETAIL, SCREEN]) {
      assert.doesNotMatch(file, /@\/lib\/mock|components\/competitors\/(competitor-intelligence|competitor-workspace|battles-view|clusters-view|compare-view|gaps-view|intent-view|opportunities-view|overlap-table|overview-view|pages-view|threats-view|competitors-table|competitor-summary|competitor-toolbar|competitor-chrome)/);
      assert.doesNotMatch(file, /Modelled/);
    }
    assert.match(SCREEN, />\s*Observed\s*</);
    const rendered = SCREEN.replace(/\/\*\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(rendered, /visibility share|keyword overlap|content gap|SERP threat|top pages|position band|momentum|costing us|\/keywords\/clusters/i);
    assert.match(SCREEN, /<QueuedReview review=\{COMPETITOR_COMPARISON_REVIEW\}/);
    assert.match(SCREEN, /Not crawled yet/);
  });
});
