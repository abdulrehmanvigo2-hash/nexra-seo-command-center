import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Checkpoint T4: the surfaces that are not the service — the read route and
 * the panel. Their behaviour is in the pure modules beside this file; these
 * checks keep the route's gates and the panel's labels from drifting in the
 * files themselves.
 */

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const ROUTE = read("src/app/api/crawls/[crawlId]/findings/route.ts");
const SECTION = read("src/components/crawl/crawl-findings.tsx");
const PANEL = read("src/components/crawl/crawl-panel.tsx");
const TECHNICAL = read("src/components/technical/technical-seo.tsx");

describe("the findings read route", () => {
  test("is GET only, confirms the operator first, validates both ids, and is rate-limited as a crawl read", () => {
    assert.match(ROUTE, /export async function GET\(/);
    assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/);
    const operator = ROUTE.indexOf("await getOperator()");
    const parse = ROUTE.indexOf("findingsReadRequest(");
    const limit = ROUTE.indexOf('crawlLimiter("read")');
    const read = ROUTE.indexOf("getCrawlFindings(");
    assert.ok(operator > 0 && operator < parse && parse < limit && limit < read);
    assert.match(ROUTE, /searchParams\.get\("project"\)/);
  });

  test("answers each service outcome with a fixed code and never an exception's text", () => {
    assert.match(ROUTE, /case "unavailable":\s+return errorResponse\("unavailable", 503\)/);
    assert.match(ROUTE, /case "not-found":\s+return errorResponse\("not-found", 404\)/);
    assert.match(ROUTE, /case "not-recorded":\s+return json\(\{ status: "not-recorded", crawl: read\.crawl \}\)/);
    assert.match(ROUTE, /case "recorded":\s+return json\(\{ status: "recorded", crawl: read\.crawl, report: read\.report \}\)/);
    assert.match(ROUTE, /logFailure\("crawl findings read", error\)/);
    assert.match(ROUTE, /errorResponse\("failed", 500\)/);
    assert.doesNotMatch(ROUTE, /error\.message|String\(error\)/);
  });

  test("reads only: it imports no engine, fetcher, compute or store", () => {
    for (const forbidden of ["engine", "fetcher", "computeCrawlFindings", "supabase", "recordFindings"]) {
      assert.doesNotMatch(ROUTE, new RegExp(forbidden), forbidden);
    }
  });
});

describe("the findings section", () => {
  test("is mounted inside the crawl panel for the crawl on screen, scoped to the project", () => {
    assert.match(PANEL, /import \{ CrawlFindings \} from "@\/components\/crawl\/crawl-findings"/);
    assert.match(PANEL, /<CrawlFindings projectId=\{projectId\} crawlId=\{shown\.id\} \/>/);
    assert.equal((PANEL.match(/<CrawlFindings /g) ?? []).length, 1);
  });

  test("reads through the findings endpoint only and offers no control: nothing fixes, dispatches or writes", () => {
    assert.match(SECTION, /findingsUrl\(projectId, crawlId\)/);
    assert.doesNotMatch(SECTION, /method: "POST"|<Button|<form|onClick|useQueuedReview/);
    assert.doesNotMatch(SECTION, /@\/lib\/mock/);
  });

  test("keeps every state: loading, unavailable, failed, not recorded, recorded with none, and recorded", () => {
    for (const state of ['"loading"', '"unavailable"', '"failed"', '"not-recorded"', '"recorded"']) assert.match(SECTION, new RegExp(`load\\.status === ${state}`));
    assert.match(SECTION, /findingsTotal === 0/);
    assert.match(SECTION, /noFindingsWording\(/);
    assert.match(SECTION, /notRecordedWording\(/);
    assert.match(SECTION, /FINDINGS_UNAVAILABLE_WORDING/);
    assert.match(SECTION, /findingsReadFailure\(/);
  });

  test("is labelled as observed data and never presents the modelled registry as live or itself as a fixture", () => {
    assert.match(SECTION, /Observed findings/);
    assert.match(SECTION, /Not fixture data/);
    assert.match(SECTION, /view\.provenance/);
    assert.match(TECHNICAL, /Modelled data over the/, "the Technical SEO screen still labels its fixtures");
    assert.doesNotMatch(TECHNICAL, /crawl-findings|CrawlFindings/, "the modelled screen is not rewired");
  });
});
