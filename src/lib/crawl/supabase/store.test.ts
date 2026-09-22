import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FakeSupabase, asSupabaseClient, postgrestError } from "./fake-client.ts";
import { createSupabaseCrawlStore } from "./store.ts";
import { CrawlRowError, crawlRowToCrawl, pageToInsert, type CrawlRow } from "./schema.ts";
import type { NewCrawl } from "../contract.ts";
import type { CrawlPage } from "@/types/crawl";

/**
 * The store over a fake client: no database, no network.
 *
 * A fake cannot enforce Postgres constraints, so the last suite here checks
 * the rows the store actually produces against the bounds the migration
 * declares. That is the part a real crawl of a real site would otherwise be
 * the first thing to discover.
 */

const NEW_CRAWL: NewCrawl = {
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  budget: { maxPages: 5, maxDepth: 1, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  createdBy: "00000000-0000-4000-8000-00000000aaaa",
};

function storeWith(): { db: FakeSupabase; store: ReturnType<typeof createSupabaseCrawlStore> } {
  const db = new FakeSupabase();
  return { db, store: createSupabaseCrawlStore(asSupabaseClient(db)) };
}

function pageFixture(url: string, overrides: Partial<CrawlPage> = {}): Omit<CrawlPage, "id" | "crawlId"> {
  return {
    url,
    finalUrl: url,
    fetchState: "fetched",
    httpStatus: 200,
    redirectHops: 0,
    redirectChain: [],
    contentType: "text/html; charset=utf-8",
    contentBytes: 120,
    robotsMeta: null,
    robotsTxtAllowed: true,
    canonicalHref: null,
    canonicalResolved: null,
    canonicalIsSelf: null,
    title: "A page",
    titleLength: 6,
    metaDescription: null,
    metaDescriptionLength: null,
    h1Count: 1,
    firstH1: "A page",
    schemaTypes: [],
    schemaBlocks: 0,
    schemaParseFailed: false,
    inSitemap: null,
    depth: 0,
    internalLinksIn: 0,
    internalLinksOut: 0,
    fetchedAt: "2026-09-20T00:00:00.000Z",
    errorCode: null,
    ...overrides,
  };
}

describe("createSupabaseCrawlStore — create", () => {
  test("inserts a running crawl and returns it mapped", async () => {
    const { db, store } = storeWith();
    const outcome = await store.insert(NEW_CRAWL);

    assert.equal(outcome.status, "inserted");
    assert.ok(outcome.status === "inserted");
    assert.equal(outcome.crawl.status, "running");
    assert.equal(outcome.crawl.projectId, "nexra-agency");
    assert.equal(outcome.crawl.hostScope, "nexraagency.com");
    assert.deepEqual(outcome.crawl.budget, NEW_CRAWL.budget);
    assert.equal(db.rows.nexra_crawls.length, 1);
  });

  test("a missing project is reported, not thrown", async () => {
    const { db, store } = storeWith();
    db.failNext({
      table: "nexra_crawls",
      operation: "insert",
      error: postgrestError("23503", 'insert violates foreign key constraint "crawls_project_fkey"'),
    });
    assert.deepEqual(await store.insert(NEW_CRAWL), { status: "missing-project" });
  });

  test("any other database failure throws without quoting row values", async () => {
    const { db, store } = storeWith();
    db.failNext({
      table: "nexra_crawls",
      operation: "insert",
      error: postgrestError("42501", "permission denied for table crawls", "secret row content"),
    });
    await assert.rejects(
      () => store.insert(NEW_CRAWL),
      (error: Error) => {
        assert.equal(error.name, "CrawlStoreError");
        assert.match(error.message, /create crawl failed \(42501\)/);
        // Postgres `details` can quote the offending row; it must not travel.
        assert.ok(!error.message.includes("secret row content"));
        return true;
      },
    );
  });
});

describe("createSupabaseCrawlStore — finish", () => {
  const completion = {
    status: "completed",
    stopReason: "completed",
    robotsState: "fetched",
    sitemapState: "absent",
    pagesDiscovered: 5,
    pagesFetched: 5,
    pagesFailed: 0,
    error: null,
  } as const;

  test("records the terminal status, counters and finish time", async () => {
    const { db, store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");

    const finished = await store.finish(created.crawl.id, completion);
    assert.ok(finished);
    assert.equal(finished.status, "completed");
    assert.equal(finished.stopReason, "completed");
    assert.equal(finished.pagesFetched, 5);
    assert.equal(finished.robotsState, "fetched");
    assert.equal(finished.sitemapState, "absent");
    assert.ok(finished.finishedAt !== null, "a finished crawl must carry a finish time");
    assert.equal(db.rows.nexra_crawls[0].status, "completed");
  });

  test("records a partial crawl as a result, not a failure", async () => {
    const { store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");

    const finished = await store.finish(created.crawl.id, {
      ...completion,
      status: "partial",
      stopReason: "page-budget",
      pagesFetched: 5,
      pagesDiscovered: 40,
    });
    assert.ok(finished);
    assert.equal(finished.status, "partial");
    assert.equal(finished.stopReason, "page-budget");
    assert.equal(finished.error, null);
  });

  test("records a failure with its fixed code and message", async () => {
    const { store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");

    const finished = await store.finish(created.crawl.id, {
      ...completion,
      status: "failed",
      stopReason: "error",
      pagesDiscovered: 0,
      pagesFetched: 0,
      error: { code: "blocked-by-robots", message: "robots.txt disallows this crawler." },
    });
    assert.ok(finished);
    assert.equal(finished.status, "failed");
    assert.deepEqual(finished.error, {
      code: "blocked-by-robots",
      message: "robots.txt disallows this crawler.",
    });
  });

  test("a second finish cannot overwrite the first outcome", async () => {
    const { store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");

    assert.ok(await store.finish(created.crawl.id, completion));
    // The update is conditional on the crawl still running, so the second
    // attempt matches nothing and answers null.
    const again = await store.finish(created.crawl.id, { ...completion, pagesFetched: 999 });
    assert.equal(again, null);
  });
});

describe("createSupabaseCrawlStore — pages and links", () => {
  test("writes pages and links and reads them back", async () => {
    const { db, store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");
    const id = created.crawl.id;

    await store.savePages(id, [pageFixture("https://nexraagency.com/")]);
    await store.saveLinks(id, [
      { fromUrl: "https://nexraagency.com/", toUrl: "https://nexraagency.com/about", rel: null, isInternal: true },
    ]);

    assert.equal(db.rows.nexra_crawl_pages.length, 1);
    assert.equal(db.rows.nexra_crawl_links.length, 1);

    const pages = await store.listPages(id, 500);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].url, "https://nexraagency.com/");
    assert.equal(pages[0].fetchState, "fetched");
    assert.equal(pages[0].crawlId, id);
  });

  test("an empty page set writes nothing rather than an empty insert", async () => {
    const { db, store } = storeWith();
    await store.savePages("some-crawl", []);
    await store.saveLinks("some-crawl", []);
    assert.equal(db.insertBatches.length, 0);
  });

  test("large sets are written in bounded batches", async () => {
    const { db, store } = storeWith();
    const pages = Array.from({ length: 1_100 }, (_, index) =>
      pageFixture(`https://nexraagency.com/p${index}`),
    );
    await store.savePages("crawl-1", pages);

    const batches = db.insertBatches.filter((entry) => entry.table === "nexra_crawl_pages");
    assert.equal(batches.length, 3, "1,100 rows must not be sent as one statement");
    assert.deepEqual(
      batches.map((entry) => entry.count),
      [500, 500, 100],
    );
  });

  test("preserves unknown as null rather than collapsing it", async () => {
    const { store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");

    await store.savePages(created.crawl.id, [
      pageFixture("https://nexraagency.com/x", {
        inSitemap: null,
        robotsTxtAllowed: null,
        canonicalIsSelf: null,
        depth: null,
      }),
    ]);

    const [page] = await store.listPages(created.crawl.id, 10);
    assert.equal(page.inSitemap, null, "unknown sitemap membership must survive the round trip");
    assert.equal(page.robotsTxtAllowed, null);
    assert.equal(page.canonicalIsSelf, null);
    assert.equal(page.depth, null);
  });

  test("a page that was never fetched carries no invented readings", async () => {
    const { store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");

    await store.savePages(created.crawl.id, [
      pageFixture("https://nexraagency.com/skipped", {
        fetchState: "budget-skipped",
        httpStatus: null,
        contentType: null,
        contentBytes: null,
        fetchedAt: null,
        title: null,
        titleLength: null,
        firstH1: null,
        h1Count: null,
        errorCode: "budget-skipped",
      }),
    ]);

    const [page] = await store.listPages(created.crawl.id, 10);
    assert.equal(page.fetchState, "budget-skipped");
    assert.equal(page.httpStatus, null);
    assert.equal(page.fetchedAt, null);
    assert.equal(page.title, null);
  });
});

describe("createSupabaseCrawlStore — reads", () => {
  test("getById returns null for an unknown crawl", async () => {
    const { store } = storeWith();
    assert.equal(await store.getById("00000000-0000-4000-8000-0000000000ff"), null);
  });

  test("lists a project's crawls newest first, bounded by the limit", async () => {
    const { db, store } = storeWith();
    for (const started of ["2026-09-18T00:00:00.000Z", "2026-09-20T00:00:00.000Z", "2026-09-19T00:00:00.000Z"]) {
      const created = await store.insert(NEW_CRAWL);
      assert.ok(created.status === "inserted");
      const row = db.rows.nexra_crawls.find((entry) => entry.id === created.crawl.id);
      if (row) row.started_at = started;
    }

    const all = await store.listByProject("nexra-agency", 25);
    assert.deepEqual(
      all.map((crawl) => crawl.startedAt),
      ["2026-09-20T00:00:00.000Z", "2026-09-19T00:00:00.000Z", "2026-09-18T00:00:00.000Z"],
    );

    assert.equal((await store.listByProject("nexra-agency", 2)).length, 2);
    assert.equal((await store.listByProject("another-project", 25)).length, 0);
  });

  test("with a host scope, lists only the crawls confined to exactly that host", async () => {
    const { store } = storeWith();
    await store.insert(NEW_CRAWL);
    await store.insert({ ...NEW_CRAWL, startUrl: "https://rival.example/", hostScope: "rival.example" });
    await store.insert({ ...NEW_CRAWL, startUrl: "https://www.nexraagency.com/", hostScope: "www.nexraagency.com" });

    const own = await store.listByProject("nexra-agency", 25, "nexraagency.com");
    assert.deepEqual(own.map((crawl) => crawl.hostScope), ["nexraagency.com"]);
    const rival = await store.listByProject("nexra-agency", 25, "rival.example");
    assert.deepEqual(rival.map((crawl) => crawl.hostScope), ["rival.example"]);
    assert.equal((await store.listByProject("nexra-agency", 25, "unrecorded.example")).length, 0);
    assert.equal((await store.listByProject("another-project", 25, "rival.example")).length, 0);
    // Without a host, every crawl of the project, as before.
    assert.equal((await store.listByProject("nexra-agency", 25)).length, 3);
  });
});

describe("isolation from the foreign crawl subsystem", () => {
  test("the store only ever names nexra_-prefixed tables", async () => {
    /*
     * This database also holds a separate, live crawl subsystem that owns the
     * unprefixed names crawls, crawl_pages, crawl_page_signals and crawl_urls.
     * A query against one of those would read or write another system's data.
     * The fake records every table the store touches, so this asserts the
     * boundary directly rather than trusting the type checker alone.
     */
    const { db, store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");
    await store.savePages(created.crawl.id, [pageFixture("https://nexraagency.com/")]);
    await store.saveLinks(created.crawl.id, [
      { fromUrl: "https://nexraagency.com/", toUrl: "https://nexraagency.com/a", rel: null, isInternal: true },
    ]);
    await store.finish(created.crawl.id, {
      status: "completed",
      stopReason: "completed",
      robotsState: "fetched",
      sitemapState: "absent",
      pagesDiscovered: 1,
      pagesFetched: 1,
      pagesFailed: 0,
      error: null,
    });
    await store.getById(created.crawl.id);
    await store.listByProject("nexra-agency", 25);
    await store.listPages(created.crawl.id, 500);

    const touched = new Set(db.insertBatches.map((entry) => entry.table));
    for (const table of touched) {
      assert.ok(table.startsWith("nexra_"), `store wrote to unprefixed table "${table}"`);
    }
    // And the fake itself cannot hold an unprefixed table.
    assert.deepEqual(Object.keys(db.rows).sort(), [
      "nexra_crawl_links",
      "nexra_crawl_pages",
      "nexra_crawls",
    ]);
  });
});

describe("row mapping is total", () => {
  test("an unrecognised status is a failure, never a coerced default", () => {
    const row = {
      id: "x",
      project_id: "p",
      start_url: "https://example.com/",
      host_scope: "example.com",
      status: "sort-of-done",
      stop_reason: null,
      max_pages: 5,
      max_depth: 1,
      max_duration_ms: 60_000,
      user_agent: "NexraBot/0.1",
      robots_state: "fetched",
      sitemap_state: "absent",
      pages_discovered: 0,
      pages_fetched: 0,
      pages_failed: 0,
      error_code: null,
      error_message: null,
      created_by: "u",
      started_at: "2026-09-20T00:00:00.000Z",
      finished_at: null,
    } satisfies CrawlRow;

    assert.throws(() => crawlRowToCrawl(row), CrawlRowError);
  });
});

/**
 * The bounds `supabase/migrations/20260920120000_create_crawls.sql` declares.
 *
 * A fake client cannot enforce these, so they are asserted directly against
 * what the store would send. Without this, an over-long canonical href or
 * content type from a real site would fail the whole batch insert, and the
 * first place anyone would learn that is a live crawl.
 */
describe("rows satisfy the migration's constraints", () => {
  const LONG = "a".repeat(5_000);

  test("a page with pathological field lengths still fits every column bound", () => {
    const row = pageToInsert(
      "crawl-1",
      pageFixture("https://nexraagency.com/", {
        canonicalHref: `https://nexraagency.com/${LONG}`,
        contentType: `text/html; ${LONG}`,
        title: LONG,
        metaDescription: LONG,
        firstH1: LONG,
        robotsMeta: LONG,
        schemaTypes: Array.from({ length: 200 }, (_, index) => `Type${index}`),
        errorCode: null,
      }),
    );

    const within = (value: unknown, limit: number, column: string): void => {
      if (typeof value !== "string") return;
      assert.ok(
        value.length <= limit,
        `${column} is ${value.length} characters; the column allows ${limit}`,
      );
    };

    within(row.url, 2048, "url");
    within(row.final_url, 2048, "final_url");
    within(row.canonical_href, 2048, "canonical_href");
    within(row.canonical_resolved, 2048, "canonical_resolved");
    within(row.content_type, 200, "content_type");
    within(row.title, 1000, "title");
    within(row.meta_description, 2000, "meta_description");
    within(row.first_h1, 1000, "first_h1");
    within(row.robots_meta, 200, "robots_meta");

    assert.ok(
      (row.schema_types ?? []).length <= 50,
      `schema_types has ${(row.schema_types ?? []).length} entries; the column allows 50`,
    );
    assert.ok((row.redirect_chain ?? []).length <= 10);
    assert.ok((row.redirect_hops ?? 0) <= 10);
  });

  test("a link's rel attribute fits its column", async () => {
    const { db, store } = storeWith();
    await store.saveLinks("crawl-1", [
      {
        fromUrl: "https://nexraagency.com/",
        toUrl: "https://nexraagency.com/x",
        rel: LONG,
        isInternal: true,
      },
    ]);
    const rel = db.rows.nexra_crawl_links[0].rel;
    assert.ok(
      typeof rel === "string" && rel.length <= 200,
      `rel is ${String(rel).length} characters; the column allows 200`,
    );
  });
});

describe("createSupabaseCrawlStore — listLinks", () => {
  const links = (crawlId: string) => [
    { fromUrl: "https://nexraagency.com/", toUrl: "https://nexraagency.com/about", rel: null, isInternal: true },
    { fromUrl: "https://nexraagency.com/about", toUrl: "https://www.linkedin.com/company/nexra", rel: "nofollow noopener", isInternal: false },
    { fromUrl: "https://nexraagency.com/", toUrl: "https://www.linkedin.com/company/nexra", rel: null, isInternal: false },
    { fromUrl: "https://nexraagency.com/services", toUrl: "https://partner.example/tools", rel: "sponsored", isInternal: false },
    { fromUrl: "https://nexraagency.com/about", toUrl: "https://nexraagency.com/", rel: null, isInternal: true },
  ].map((link) => ({ ...link, crawlId }));

  test("reads a crawl's edges back exactly as written, external edges first, in a fixed order", async () => {
    const { store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");
    const id = created.crawl.id;
    await store.saveLinks(id, links(id));

    const read = await store.listLinks(id, 100);
    assert.deepEqual(read, [
      { crawlId: id, fromUrl: "https://nexraagency.com/services", toUrl: "https://partner.example/tools", rel: "sponsored", isInternal: false },
      { crawlId: id, fromUrl: "https://nexraagency.com/", toUrl: "https://www.linkedin.com/company/nexra", rel: null, isInternal: false },
      { crawlId: id, fromUrl: "https://nexraagency.com/about", toUrl: "https://www.linkedin.com/company/nexra", rel: "nofollow noopener", isInternal: false },
      { crawlId: id, fromUrl: "https://nexraagency.com/about", toUrl: "https://nexraagency.com/", rel: null, isInternal: true },
      { crawlId: id, fromUrl: "https://nexraagency.com/", toUrl: "https://nexraagency.com/about", rel: null, isInternal: true },
    ]);
  });

  test("filters by the exact crawl id: another crawl's edges are never read", async () => {
    const { store } = storeWith();
    const first = await store.insert(NEW_CRAWL);
    const second = await store.insert({ ...NEW_CRAWL, projectId: "halcyon-fintech" });
    assert.ok(first.status === "inserted" && second.status === "inserted");
    await store.saveLinks(first.crawl.id, links(first.crawl.id));
    await store.saveLinks(second.crawl.id, links(second.crawl.id).slice(0, 2));

    assert.equal((await store.listLinks(first.crawl.id, 100)).length, 5);
    assert.equal((await store.listLinks(second.crawl.id, 100)).length, 2);
    assert.ok((await store.listLinks(second.crawl.id, 100)).every((link) => link.crawlId === second.crawl.id));
    assert.deepEqual(await store.listLinks("no-such-crawl", 100), []);
  });

  test("the limit bounds the read, and the external edges are the ones kept", async () => {
    const { store } = storeWith();
    const created = await store.insert(NEW_CRAWL);
    assert.ok(created.status === "inserted");
    await store.saveLinks(created.crawl.id, links(created.crawl.id));

    const two = await store.listLinks(created.crawl.id, 2);
    assert.equal(two.length, 2);
    assert.ok(two.every((link) => !link.isInternal));
  });

  test("a store failure surfaces as a CrawlStoreError that quotes no row", async () => {
    const { db, store } = storeWith();
    db.failNext({ table: "nexra_crawl_links", operation: "select", error: postgrestError("42P01", "relation does not exist", "secret row content") });
    await assert.rejects(() => store.listLinks("some-crawl", 10), (error: unknown) => {
      assert.ok(error instanceof Error && error.name === "CrawlStoreError");
      assert.match(error.message, /list crawl links failed/);
      assert.ok(!error.message.includes("secret row content"));
      return true;
    });
  });
});
