import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * P4d: the route's gates and the panel's mount, kept from drifting in the
 * files themselves. Behaviour lives in view.test.ts and compare.test.ts.
 */

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const ROUTE = read("src/app/api/search-console/history/route.ts");
const REPORT_ROUTE = read("src/app/api/search-console/report/route.ts");
const SECTION = read("src/components/search-console/search-console-history.tsx");
const PANEL = read("src/components/search-console/search-console-panel.tsx");
const VIEW = read("src/lib/search-console/history/view.ts");

describe("the history route", () => {
  test("is GET only, confirms the operator first, validates the project and fixes the range, and never caches", () => {
    assert.match(ROUTE, /export async function GET\(/);
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    const operator = ROUTE.indexOf("await getOperator()");
    const project = ROUTE.indexOf("isStorableProjectId(projectId)");
    const exists = ROUTE.indexOf("projectRepository.getProjectById(projectId)");
    const history = ROUTE.indexOf("readSearchConsoleHistory(projectId)");
    assert.ok(operator > 0 && operator < project && project < exists && exists < history);
    assert.match(ROUTE, /rangeId !== HISTORY_RANGE_ID/);
    // The CP1c guard: nothing under src/app names the snapshot module; the range constant comes through the view.
    assert.doesNotMatch(ROUTE, /search-console\/snapshots/);
    assert.match(ROUTE, /"Cache-Control": "private, no-store"/);
  });

  test("takes no property from the request and reads through the P4a reader only: no store, no Google, no write", () => {
    assert.doesNotMatch(ROUTE, /searchParams\.get\("property"\)|searchConsoleProperties|searchConsoleProvider|getSearchConsoleReport|snapshotStore|\.record\(|supabase/);
    assert.match(ROUTE, /presentHistory\(comparison\)/);
    assert.match(ROUTE, /status: 503/);
    assert.match(ROUTE, /status: 404/);
    assert.match(ROUTE, /status: 401/);
    assert.match(ROUTE, /status: 400/);
    assert.doesNotMatch(ROUTE, /error\.message/);
  });

  test("the live report route is unchanged in its gates", () => {
    assert.match(REPORT_ROUTE, /getSearchConsoleReport\(searchConsoleProvider\(\), projectId, rangeId\)/);
    assert.doesNotMatch(REPORT_ROUTE, /history/);
  });
});

describe("the history section", () => {
  test("is mounted once inside the Search Console panel, for the stored window only, with its own load", () => {
    assert.match(PANEL, /import \{ SearchConsoleHistory \} from "@\/components\/search-console\/search-console-history"/);
    assert.equal((PANEL.match(/<SearchConsoleHistory /g) ?? []).length, 1);
    assert.match(PANEL, /projectId && rangeId === "30d" && <SearchConsoleHistory projectId=\{projectId\} view=\{view\} \/>/);
    // The live report's own hook and footer are untouched.
    assert.match(PANEL, /function useSearchConsoleReport\(projectId: string \| null, rangeId: RangeId\)/);
    assert.match(PANEL, /\/api\/search-console\/report\?project=/);
    assert.doesNotMatch(SECTION, /useSearchConsoleReport|\/api\/search-console\/report/);
    assert.match(SECTION, /historyUrl\(projectId\)/);
  });

  test("keeps every state apart and offers no control", () => {
    for (const state of ['"loading"', '"failed"', '"loaded"']) assert.match(SECTION, new RegExp(`load\\.status === ${state}`));
    assert.match(SECTION, /describeHistoryStatus\(/);
    assert.match(SECTION, /LIST_UNAVAILABLE_COPY\[list\.reason\]/);
    assert.match(SECTION, /view\.totals === null/);
    assert.match(SECTION, /previousNoData/);
    assert.match(SECTION, /latestPartial/);
    assert.match(SECTION, /Not established: the previous window had no impressions/);
    assert.match(SECTION, /no baseline/);
    assert.doesNotMatch(SECTION, /<Button|<form|onClick|method: "POST"|@\/lib\/mock/);
  });

  test("is labelled as stored history, shows the caveats, and the view module holds no server import", () => {
    assert.match(SECTION, /Change since last stored snapshot/);
    assert.match(SECTION, /Stored history/);
    assert.match(SECTION, /view\.caveats\.map/);
    assert.doesNotMatch(VIEW, /server-only|snapshots\/index|@\/lib\/search-console"/);
  });
});
