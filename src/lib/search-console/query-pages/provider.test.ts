import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SearchConsoleConfig } from "../config.ts";
import type { SearchAnalyticsRequest, SearchConsoleClient } from "../google-client.ts";
import { isAbsoluteHttpUrl, mapQueryPageRows } from "../mappers.ts";
import { QUERY_PAGE_ROW_LIMIT, createMisconfiguredProvider, createSearchConsoleProvider } from "../provider.ts";

/**
 * P4c provider read: one real request with the dimensions query and page,
 * capped at QUERY_PAGE_ROW_LIMIT, for the mapped property only, cached
 * apart from the single-dimension reads, mapped without repair.
 */

const WINDOW = { rangeId: "30d", startDate: "2026-08-19", endDate: "2026-09-17", days: 30 } as const;
const PROPERTY = "sc-domain:nexraagency.com";

function fakeClient(rows: unknown, fail?: Error) {
  const requests: { property: string; request: SearchAnalyticsRequest }[] = [];
  const client: SearchConsoleClient = {
    listSites: async () => ({ siteEntry: [{ siteUrl: PROPERTY, permissionLevel: "siteFullUser" }] }),
    querySearchAnalytics: async (property, request) => {
      requests.push({ property, request });
      if (fail) throw fail;
      return { rows };
    },
  };
  return { client, requests };
}

const config: SearchConsoleConfig = { status: "configured", credentials: { clientEmail: "sa@example.iam", privateKey: "not-a-real-key" }, properties: new Map([["nexra-agency", PROPERTY]]) };

describe("mapQueryPageRows", () => {
  test("keeps rows with exactly [query, page] keys and impressions; drops the rest without repair; a repeated pair keeps its first row", () => {
    const rows = mapQueryPageRows({
      rows: [
        { keys: ["seo agency", "https://nexraagency.com/"], clicks: 12, impressions: 300, ctr: 0.04, position: 4.1 },
        { keys: ["seo agency", "https://nexraagency.com/"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
        { keys: ["zero", "https://nexraagency.com/"], clicks: 0, impressions: 0, ctr: 0, position: 0 },
        { keys: ["one key only"], clicks: 1, impressions: 10, ctr: 0.1, position: 1 },
        { keys: ["", "https://nexraagency.com/"], clicks: 1, impressions: 10, ctr: 0.1, position: 1 },
        { keys: ["relative", "/services"], clicks: 1, impressions: 10, ctr: 0.1, position: 1 },
        { keys: ["ok", "https://nexraagency.com/services"], clicks: "1", impressions: 10, ctr: 0.1, position: 1 },
        { keys: ["kept", "https://nexraagency.com/services"], clicks: 2, impressions: 10, ctr: 0.2, position: 3 },
      ],
    });
    assert.deepEqual(rows, [
      { query: "seo agency", page: "https://nexraagency.com/", clicks: 12, impressions: 300, ctr: 0.04, position: 4.1 },
      { query: "kept", page: "https://nexraagency.com/services", clicks: 2, impressions: 10, ctr: 0.2, position: 3 },
    ]);
    assert.deepEqual(mapQueryPageRows({}), []);
    assert.deepEqual(mapQueryPageRows(null), []);
    assert.ok(isAbsoluteHttpUrl("http://x.example/a") && !isAbsoluteHttpUrl("https://x.example/a b") && !isAbsoluteHttpUrl("ftp://x.example/"));
  });
});

describe("getQueryPagePerformance", () => {
  test("sends one request with dimensions [query, page] and the row limit, for the mapped property, and answers for it", async () => {
    const { client, requests } = fakeClient([{ keys: ["q", "https://nexraagency.com/"], clicks: 1, impressions: 10, ctr: 0.1, position: 2 }]);
    const provider = createSearchConsoleProvider({ config, client, log: () => {} });
    const result = await provider.getQueryPagePerformance("nexra-agency", WINDOW);
    assert.ok(result.ok);
    assert.deepEqual([result.property, result.stale, result.value], [PROPERTY, false, [{ query: "q", page: "https://nexraagency.com/", clicks: 1, impressions: 10, ctr: 0.1, position: 2 }]]);
    assert.deepEqual(requests, [{ property: PROPERTY, request: { startDate: "2026-08-19", endDate: "2026-09-17", dimensions: ["query", "page"], rowLimit: QUERY_PAGE_ROW_LIMIT } }]);
    assert.equal(QUERY_PAGE_ROW_LIMIT, 250);
  });

  test("is cached apart from the single-dimension reads: a query read and a pair read are two requests, a repeated pair read is none", async () => {
    const { client, requests } = fakeClient([]);
    const provider = createSearchConsoleProvider({ config, client, log: () => {} });
    await provider.getQueryPerformance("nexra-agency", WINDOW);
    await provider.getQueryPagePerformance("nexra-agency", WINDOW);
    await provider.getQueryPagePerformance("nexra-agency", WINDOW);
    assert.deepEqual(requests.map((r) => r.request.dimensions), [["query"], ["query", "page"]]);
    assert.deepEqual(requests.map((r) => r.request.rowLimit), [25, 250]);
  });

  test("an unmapped project is not-connected without a request; a failing read is unavailable, never a row; misconfigured answers so", async () => {
    const { client, requests } = fakeClient([], Object.assign(new Error("boom"), { name: "SearchConsoleProviderError" }));
    const provider = createSearchConsoleProvider({ config, client, log: () => {} });
    assert.deepEqual(await provider.getQueryPagePerformance("unmapped", WINDOW), { ok: false, failure: { state: "not-connected", reason: "no-property" } });
    assert.equal(requests.length, 0);
    const failed = await provider.getQueryPagePerformance("nexra-agency", WINDOW);
    assert.ok(!failed.ok && failed.failure.state === "unavailable");
    assert.deepEqual(await createMisconfiguredProvider().getQueryPagePerformance("nexra-agency", WINDOW), { ok: false, failure: { state: "unavailable", reason: "misconfigured" } });
  });
});
