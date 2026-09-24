import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Crawl, CrawlPage } from "../../../../types/crawl.ts";
import { computeCrawlFindings } from "../compute.ts";
import { FINDINGS_READ_LIMIT, unavailableCrawlFindingsStore } from "../store-contract.ts";
import { findingRowToFinding, findingToArgument, recordResultToOutcome, reportRowToHeader, type CrawlFindingsDatabase } from "./schema.ts";
import { createSupabaseCrawlFindingsStore, CrawlFindingsStoreError } from "./store.ts";

/**
 * Checkpoint T3. On trial: that the store calls exactly the T3 database
 * function with exactly its parameters, that a library report is sent as
 * the function takes it, that what the function and the tables answer is
 * read field by field, and that a row the migration would never produce is
 * refused rather than passed on. Every read is scoped to one project.
 */

const MIGRATION = "supabase/migrations/20260928120000_create_crawl_findings.sql";

const CRAWL: Crawl = {
  id: "8f1c0d2e-0000-4000-8000-000000000001",
  projectId: "nexra-agency",
  startUrl: "https://nexraagency.com/",
  hostScope: "nexraagency.com",
  status: "completed",
  stopReason: "completed",
  budget: { maxPages: 50, maxDepth: 3, maxDurationMs: 60_000 },
  userAgent: "NexraBot/0.1",
  robotsState: "fetched",
  sitemapState: "absent",
  pagesDiscovered: 2,
  pagesFetched: 2,
  pagesFailed: 0,
  error: null,
  createdBy: "00000000-0000-4000-8000-00000000000a",
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T10:00:04.500Z",
};

const page = (path: string, overrides: Partial<CrawlPage> = {}): CrawlPage => ({
  id: path, crawlId: CRAWL.id, url: `https://nexraagency.com${path}`, finalUrl: `https://nexraagency.com${path}`, fetchState: "fetched", httpStatus: 200,
  redirectHops: 0, redirectChain: [], contentType: "text/html", contentBytes: 100, robotsMeta: null, robotsTxtAllowed: true,
  canonicalHref: null, canonicalResolved: null, canonicalIsSelf: null, title: `A long enough title for the ${path} page here`, titleLength: 38,
  metaDescription: `Description for ${path}`, metaDescriptionLength: 20, h1Count: 1, firstH1: "h", schemaTypes: [], schemaBlocks: 1, schemaParseFailed: false,
  inSitemap: null, depth: path === "/" ? 0 : 1, internalLinksIn: path === "/" ? 0 : 1, internalLinksOut: 1, fetchedAt: null, errorCode: null, ...overrides,
});

const REPORT = computeCrawlFindings({ crawl: CRAWL, pages: [page("/"), page("/a", { h1Count: 0 })], links: [] });

const REPORT_ROW = {
  id: "5b8a6b4e-8c0e-4d6f-9d1a-2f7c3b4a5d6e", crawl_id: CRAWL.id, project_id: "nexra-agency", rule_version: 1,
  pages_total: 2, pages_fetched: 2, pages_not_fetched: 0, pages_not_reached: 0, links_read: 0, links_cut: false,
  findings_total: 1, counts: { "h1-missing": 1 }, truncated_rules: [], recorded_at: "2026-09-20T10:00:05+00:00",
};
const FINDING_ROW = {
  id: "f1", report_id: REPORT_ROW.id, crawl_id: CRAWL.id, project_id: "nexra-agency", finding_key: REPORT.findings[0].id, rule: "h1-missing",
  category: "headings", severity: "medium", urls: ["https://nexraagency.com/a"], url_count: 1, observed: { h1Count: 0 }, message: "The page has no H1.", ordinal: 0,
};

function migrationParameters(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = sql.match(/create function public\.nexra_crawl_findings_record\(([\s\S]*?)\)\s*returns jsonb/);
  assert.ok(match, "the T3 migration declares the record function");
  return match[1].split("\n").map((l) => l.trim()).filter((l) => l.startsWith("p_")).map((l) => l.split(/\s+/)[0]);
}

function fakeClient(options: { rpc?: { data?: unknown; error?: { code: string; message: string } }; reports?: unknown[]; findings?: unknown[]; findingsError?: { code: string; message: string } } = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const queries: { table: string; eq: [string, unknown][]; order: [string, unknown][]; limit: number }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: options.rpc?.data ?? null, error: options.rpc?.error ?? null };
    },
    from: (table: string) => {
      const q = { table, eq: [] as [string, unknown][], order: [] as [string, unknown][], limit: 0 };
      queries.push(q);
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => (q.eq.push([c, v]), builder),
        order: (c: string, o: unknown) => (q.order.push([c, o]), builder),
        limit: async (n: number) => {
          q.limit = n;
          if (table === "nexra_crawl_findings_reports") return { data: options.reports ?? [], error: null };
          return options.findingsError ? { data: null, error: options.findingsError } : { data: options.findings ?? [], error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient<CrawlFindingsDatabase>;
  return { client, rpcCalls, queries };
}

describe("recording against the T3 function", () => {
  test("calls nexra_crawl_findings_record with exactly the migration's parameters, in its order, from a library report", async () => {
    const { client, rpcCalls } = fakeClient({ rpc: { data: { outcome: "created", report: REPORT_ROW, findings: 1 } } });
    const outcome = await createSupabaseCrawlFindingsStore(client).record({ projectId: "nexra-agency", crawlId: CRAWL.id, report: REPORT, links: { read: 0, cut: false } });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].fn, "nexra_crawl_findings_record");
    assert.deepEqual(Object.keys(rpcCalls[0].args), migrationParameters());
    assert.equal(migrationParameters().length, 12);
    const args = rpcCalls[0].args;
    assert.deepEqual([args.p_project_id, args.p_crawl_id, args.p_rule_version, args.p_pages_total, args.p_pages_fetched, args.p_pages_not_fetched, args.p_pages_not_reached, args.p_links_read, args.p_links_cut], ["nexra-agency", CRAWL.id, 1, 2, 2, 0, 0, 0, false]);
    assert.deepEqual(args.p_counts, { "h1-missing": 1 });
    assert.deepEqual(args.p_truncated_rules, []);
    assert.deepEqual(args.p_findings, [{ key: REPORT.findings[0].id, rule: "h1-missing", category: "headings", severity: "medium", urls: ["https://nexraagency.com/a"], urlCount: 1, observed: { h1Count: 0 }, message: "The page has no H1." }]);
    assert.ok(outcome.status === "created" && outcome.findings === 1 && outcome.header.id === REPORT_ROW.id);
  });

  test("exists, not-found, wrong-project and not-reviewable are read back; a database error is thrown with its code", async () => {
    const exists = fakeClient({ rpc: { data: { outcome: "exists", report: REPORT_ROW } } });
    const read = await createSupabaseCrawlFindingsStore(exists.client).record({ projectId: "nexra-agency", crawlId: CRAWL.id, report: REPORT, links: { read: 0, cut: false } });
    assert.ok(read.status === "exists" && read.header.findingsTotal === 1);
    for (const outcome of ["not-found", "wrong-project", "not-reviewable"] as const) {
      const c = fakeClient({ rpc: { data: { outcome } } });
      assert.deepEqual(await createSupabaseCrawlFindingsStore(c.client).record({ projectId: "nexra-agency", crawlId: CRAWL.id, report: REPORT, links: { read: 0, cut: false } }), { status: outcome });
    }
    const failing = fakeClient({ rpc: { error: { code: "23514", message: "violates check constraint" } } });
    await assert.rejects(
      () => createSupabaseCrawlFindingsStore(failing.client).record({ projectId: "nexra-agency", crawlId: CRAWL.id, report: REPORT, links: { read: 0, cut: false } }),
      (e: unknown) => e instanceof CrawlFindingsStoreError && e.code === "23514",
    );
    assert.throws(() => recordResultToOutcome({ outcome: "updated" }), /does not recognise/);
  });

  test("a finding argument carries only the eight fields the function reads", () => {
    assert.deepEqual(Object.keys(findingToArgument(REPORT.findings[0])), ["key", "rule", "category", "severity", "urls", "urlCount", "observed", "message"]);
  });
});

describe("reading recorded findings", () => {
  test("reads the newest report for the project's crawl, then its findings in recorded order, both scoped to the project", async () => {
    const { client, queries } = fakeClient({ reports: [REPORT_ROW], findings: [FINDING_ROW] });
    const report = await createSupabaseCrawlFindingsStore(client).getReport("nexra-agency", CRAWL.id);
    assert.ok(report);
    assert.deepEqual(queries.map((q) => [q.table, q.eq, q.order, q.limit]), [
      ["nexra_crawl_findings_reports", [["project_id", "nexra-agency"], ["crawl_id", CRAWL.id]], [["rule_version", { ascending: false }]], 1],
      ["nexra_crawl_findings", [["project_id", "nexra-agency"], ["report_id", REPORT_ROW.id]], [["ordinal", { ascending: true }]], FINDINGS_READ_LIMIT],
    ]);
    assert.deepEqual(report.header, {
      id: REPORT_ROW.id, crawlId: CRAWL.id, projectId: "nexra-agency", ruleVersion: 1,
      coverage: { pagesTotal: 2, pagesFetched: 2, pagesNotFetched: 0, pagesNotReached: 0 },
      linksRead: 0, linksCut: false, findingsTotal: 1, counts: { "h1-missing": 1 }, truncatedRules: [], recordedAt: "2026-09-20T10:00:05+00:00",
    });
    assert.deepEqual(report.findings, [{ id: REPORT.findings[0].id, rule: "h1-missing", category: "headings", severity: "medium", urls: ["https://nexraagency.com/a"], urlCount: 1, observed: { h1Count: 0 }, message: "The page has no H1.", ordinal: 0 }]);
    assert.equal(report.findingsTruncated, false);
  });

  test("no report reads as null; a findings read error is thrown by code", async () => {
    assert.equal(await createSupabaseCrawlFindingsStore(fakeClient({ reports: [] }).client).getReport("nexra-agency", CRAWL.id), null);
    const failing = fakeClient({ reports: [REPORT_ROW], findingsError: { code: "42501", message: "permission denied" } });
    await assert.rejects(() => createSupabaseCrawlFindingsStore(failing.client).getReport("nexra-agency", CRAWL.id), (e: unknown) => e instanceof CrawlFindingsStoreError && e.code === "42501");
  });

  test("a row the migration would never produce is refused on read", () => {
    assert.throws(() => reportRowToHeader({ ...REPORT_ROW, counts: [1] }), /counts is not an object/);
    assert.throws(() => reportRowToHeader({ ...REPORT_ROW, links_cut: "no" }), /links_cut/);
    assert.throws(() => findingRowToFinding({ ...FINDING_ROW, rule: "made-up-rule" }), /not one this product knows/);
    assert.throws(() => findingRowToFinding({ ...FINDING_ROW, severity: "blocker" }), /severity/);
    assert.throws(() => findingRowToFinding({ ...FINDING_ROW, finding_key: "title-missing:0123456789abcdef" }), /does not name its rule/);
    assert.throws(() => findingRowToFinding({ ...FINDING_ROW, urls: [] }), /urls is out of range/);
    assert.throws(() => findingRowToFinding({ ...FINDING_ROW, observed: { nested: { a: 1 } } }), /not a scalar/);
  });

  test("the unavailable store records nothing and reads nothing", async () => {
    assert.equal(unavailableCrawlFindingsStore.storesFindings, false);
    assert.deepEqual(await unavailableCrawlFindingsStore.record({ projectId: "p", crawlId: "c", report: REPORT, links: { read: 0, cut: false } }), { status: "not-found" });
    assert.equal(await unavailableCrawlFindingsStore.getReport("p", "c"), null);
  });
});
