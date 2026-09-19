import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CrawlRowError,
  crawlRowToCrawl,
  crawlUrlRowToDiscovered,
  discoveredUrlInserts,
} from "@/lib/crawl/supabase/schema";

/**
 * The row translation is the point where a schema that has drifted from the
 * migration has to fail loudly rather than produce a crawl with an undefined
 * status, so these tests are mostly about what it refuses.
 */

const ROW = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  project_id: "nexra-agency",
  site: "nexraagency.com",
  status: "completed",
  robots_state: "parsed",
  sitemap_count: 3,
  discovered_count: 42,
  limits: ["urls"],
  failure_code: null,
  created_by: "11111111-2222-3333-4444-555555555555",
  source: "operator",
  created_at: "2026-09-19T04:00:00+00:00",
  started_at: "2026-09-19T04:00:05+00:00",
  finished_at: "2026-09-19T04:01:00.000+00:00",
  updated_at: "2026-09-19T04:01:00+00:00",
};

describe("crawlRowToCrawl", () => {
  test("maps a full row to the domain shape", () => {
    assert.deepEqual(crawlRowToCrawl(ROW), {
      id: ROW.id,
      projectId: "nexra-agency",
      site: "nexraagency.com",
      status: "completed",
      robotsState: "parsed",
      sitemapCount: 3,
      discoveredCount: 42,
      limits: ["urls"],
      failureCode: null,
      createdBy: ROW.created_by,
      source: "operator",
      createdAt: "2026-09-19T04:00:00Z",
      startedAt: "2026-09-19T04:00:05Z",
      finishedAt: "2026-09-19T04:01:00Z",
      updatedAt: "2026-09-19T04:01:00Z",
    });
  });

  test("normalises Postgres timestamps to the product's own form", () => {
    const crawl = crawlRowToCrawl({ ...ROW, created_at: "2026-09-19T04:00:00.000+00:00" });
    assert.equal(crawl.createdAt, "2026-09-19T04:00:00Z");
  });

  test("carries a queued crawl's nulls through", () => {
    const crawl = crawlRowToCrawl({
      ...ROW,
      status: "queued",
      robots_state: null,
      started_at: null,
      finished_at: null,
      created_by: null,
      limits: [],
    });
    assert.equal(crawl.robotsState, null);
    assert.equal(crawl.startedAt, null);
    assert.equal(crawl.finishedAt, null);
    assert.equal(crawl.createdBy, null);
    assert.deepEqual(crawl.limits, []);
  });

  test("refuses a status the migration does not define", () => {
    assert.throws(() => crawlRowToCrawl({ ...ROW, status: "paused" }), CrawlRowError);
  });

  test("refuses an unknown failure code, robots state or limit", () => {
    assert.throws(() => crawlRowToCrawl({ ...ROW, failure_code: "exploded" }), CrawlRowError);
    assert.throws(() => crawlRowToCrawl({ ...ROW, robots_state: "maybe" }), CrawlRowError);
    assert.throws(() => crawlRowToCrawl({ ...ROW, limits: ["everything"] }), CrawlRowError);
  });

  test("refuses a missing column rather than inventing one", () => {
    const withoutSite: Record<string, unknown> = { ...ROW };
    delete withoutSite.site;
    assert.throws(() => crawlRowToCrawl(withoutSite), CrawlRowError);
  });

  test("refuses a negative or non-integer count", () => {
    assert.throws(() => crawlRowToCrawl({ ...ROW, discovered_count: -1 }), CrawlRowError);
    assert.throws(() => crawlRowToCrawl({ ...ROW, sitemap_count: 1.5 }), CrawlRowError);
  });

  test("refuses an unparsable timestamp", () => {
    assert.throws(() => crawlRowToCrawl({ ...ROW, created_at: "whenever" }), CrawlRowError);
  });

  test("refuses something that is not a row", () => {
    assert.throws(() => crawlRowToCrawl(null), CrawlRowError);
    assert.throws(() => crawlRowToCrawl("a row"), CrawlRowError);
  });
});

describe("crawlUrlRowToDiscovered", () => {
  test("maps a URL row", () => {
    assert.deepEqual(
      crawlUrlRowToDiscovered({
        crawl_id: ROW.id,
        url: "https://nexraagency.com/",
        source: "homepage",
        discovered_at: "2026-09-19T04:00:10+00:00",
      }),
      { url: "https://nexraagency.com/", source: "homepage" },
    );
  });

  test("refuses an unknown source", () => {
    assert.throws(
      () =>
        crawlUrlRowToDiscovered({
          crawl_id: ROW.id,
          url: "https://nexraagency.com/",
          source: "guessed",
          discovered_at: "2026-09-19T04:00:10+00:00",
        }),
      CrawlRowError,
    );
  });
});

describe("discoveredUrlInserts", () => {
  test("builds one row per URL, tagged with the crawl", () => {
    assert.deepEqual(
      discoveredUrlInserts("crawl-1", [
        { url: "https://example.com/", source: "homepage" },
        { url: "https://example.com/a", source: "robots" },
      ]),
      [
        { crawl_id: "crawl-1", url: "https://example.com/", source: "homepage" },
        { crawl_id: "crawl-1", url: "https://example.com/a", source: "robots" },
      ],
    );
  });

  test("leaves discovered_at to the database default", () => {
    const [row] = discoveredUrlInserts("crawl-1", [
      { url: "https://example.com/", source: "homepage" },
    ]);
    assert.equal("discovered_at" in row, false);
  });
});
