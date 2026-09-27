import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { ANALYTICS_TABS, HIDDEN_ANALYTICS_TABS, resolveAnalyticsTab } from "./screen.ts";

/**
 * Checkpoint 4.3: the Analytics screen over stored data only, kept from
 * drifting in the files themselves — the tabs, the hidden modelled
 * sections, the fixture imports and the new route's gates.
 */

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const WORKSPACE = read("src/components/analytics/analytics-workspace.tsx");
const OBSERVED = read("src/components/analytics/observed-analytics.tsx");
const PAGE = read("src/app/(app)/analytics/page.tsx");
const ROUTE = read("src/app/api/search-console/latest-window/route.ts");
const READER = read("src/lib/search-console/latest/index.ts");

describe("the tabs", () => {
  test("Overview, Pages and Learnings only; Trends, Segments, Attribution and Movements are hidden", () => {
    assert.deepEqual(
      ANALYTICS_TABS.map((t) => [t.id, t.label]),
      [
        ["overview", "Overview"],
        ["pages", "Pages"],
        ["learnings", "Learnings"],
      ],
    );
    for (const hidden of HIDDEN_ANALYTICS_TABS) {
      assert.equal(ANALYTICS_TABS.some((t) => t.id === hidden), false);
      assert.equal(resolveAnalyticsTab(hidden), "overview");
    }
    assert.deepEqual([...HIDDEN_ANALYTICS_TABS], ["trends", "segments", "attribution", "anomalies"]);
    assert.equal(resolveAnalyticsTab("learnings"), "learnings");
    assert.equal(resolveAnalyticsTab(null), "overview");
    for (const label of ["Trends", "Segments", "Attribution", "Movements"]) assert.doesNotMatch(WORKSPACE, new RegExp(`"${label}"`));
  });
});

describe("the screen", () => {
  test("imports no fixture, carries no Modelled tag, and shows the Observed badge", () => {
    for (const file of [WORKSPACE, OBSERVED, PAGE]) {
      assert.doesNotMatch(file, /@\/lib\/mock|components\/analytics\/(overview-view|insight-views|tables|analytics-toolbar|analytics-chrome|filters|sorting)|PerformanceChart/);
      assert.doesNotMatch(file, /Modelled/);
    }
    assert.match(WORKSPACE, />\s*Observed\s*</);
  });

  test("Overview mounts the Search Console panel (with its stored history); Pages the pages view and the query × page pairs", () => {
    assert.match(WORKSPACE, /tab === "overview" && <SearchConsolePanel projectId=\{projectId\} rangeId="30d" view="summary" \/>/);
    assert.match(WORKSPACE, /<SearchConsolePanel projectId=\{projectId\} rangeId="30d" view="pages" \/>/);
    assert.match(WORKSPACE, /<SearchConsoleQueryPages key=\{projectId\} projectId=\{projectId\} \/>/);
    assert.match(WORKSPACE, /<LearningsList key=\{projectId\} projectId=\{projectId\} \/>/);
    assert.match(WORKSPACE, /<LatestWindowTiles key=\{projectId\} projectId=\{projectId\} readiness=\{tab === "overview"\} \/>/);
  });

  test("the Learnings entries carry the not-a-measurement label and an empty state", () => {
    assert.match(OBSERVED, /\{LEARNING_LABEL\}/);
    assert.match(OBSERVED, /title="No learnings yet"/);
  });
});

describe("the latest-window route", () => {
  test("GET only: operator first, then the project's shape, then its existence, then the reader; never cached", () => {
    const order = ["await getOperator()", "isStorableProjectId(projectId)", "projectRepository.getProjectById(projectId)", "readLatestSearchConsoleWindow(projectId)"].map((s) => ROUTE.indexOf(s));
    assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `order ${order}`);
    assert.match(ROUTE, /"Cache-Control": "private, no-store"/);
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    assert.doesNotMatch(ROUTE, /searchParams\.get\("property"\)|error\.message/);
    assert.match(READER, /^import "server-only";/);
    assert.match(READER, /searchConsoleProperties\(\)\.get\(projectId\)/);
  });
});
