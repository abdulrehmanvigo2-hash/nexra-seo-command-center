import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SOURCE_1, SOURCE_2 } from "../test-support/memory-store.ts";
import { articleResultToOutcome, articleRowToArticle, ArticleRowError, type ContentArticlesDatabase } from "./schema.ts";
import { ArticleStoreError, createSupabaseArticleStore } from "./store.ts";

/**
 * The Supabase article store: what it sends, and how it reads what comes
 * back. A small fake client records every call; the database functions
 * themselves were exercised against PostgreSQL separately. The store never
 * writes a table directly: every write is one of the two RPCs.
 */

type Row = Record<string, unknown>;
type Call = { readonly kind: "select" | "rpc"; readonly target: string; readonly filters: readonly string[]; readonly args?: Row };

const ARTICLE: Row = {
  id: "40000000-0000-4000-8000-000000000001",
  project_id: "halcyon-fintech",
  source_plan_run_id: "10000000-0000-4000-8000-000000000001",
  status: "drafting",
  current_version: 1,
  approved_version: null,
  approved_by: null,
  approved_at: null,
  created_by: "00000000-0000-4000-8000-0000000000aa",
  created_at: "2026-09-23T12:00:00+00:00",
  updated_at: "2026-09-23T12:00:00+00:00",
};
const VERSION: Row = {
  id: "50000000-0000-4000-8000-000000000001",
  article_id: ARTICLE.id,
  version: 1,
  origin: "operator",
  canonical_content: '{"format":"nexra-article-content/1","topic":"x"}',
  content_sha256: "a".repeat(64),
  created_by: ARTICLE.created_by,
  created_at: ARTICLE.created_at,
};
const SOURCE_ROW = (position: number, ref: typeof SOURCE_1): Row => ({
  id: `60000000-0000-4000-8000-00000000000${position}`,
  article_version_id: VERSION.id,
  position,
  source_draft_id: ref.draftId,
  source_version: ref.version,
  source_version_id: ref.versionId,
  source_content_sha256: ref.contentSha256,
  created_at: ARTICLE.created_at,
});

function fakeClient(tables: Record<string, Row[]>, rpcAnswer: unknown, rpcError: unknown = null) {
  const calls: Call[] = [];
  class Query {
    private filters: string[] = [];
    private rows: Row[];
    private readonly table: string;
    constructor(table: string) {
      this.table = table;
      this.rows = [...(tables[table] ?? [])];
    }
    select() {
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push(`${column}=${String(value)}`);
      this.rows = this.rows.filter((r) => r[column] === value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push(`${column} in ${values.length}`);
      this.rows = this.rows.filter((r) => values.includes(r[column]));
      return this;
    }
    order(column: string, options: { ascending: boolean }) {
      this.rows.sort((a, b) => ((a[column] as number) - (b[column] as number)) * (options.ascending ? 1 : -1));
      return this;
    }
    limit() {
      return this;
    }
    maybeSingle() {
      calls.push({ kind: "select", target: this.table, filters: this.filters });
      return Promise.resolve({ data: this.rows[0] ?? null, error: null });
    }
    then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
      calls.push({ kind: "select", target: this.table, filters: this.filters });
      return Promise.resolve({ data: this.rows, error: null }).then(resolve);
    }
  }
  const client = {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Row) => {
      calls.push({ kind: "rpc", target: name, filters: [], args });
      return Promise.resolve({ data: rpcAnswer, error: rpcError });
    },
  };
  return { calls, client: client as unknown as SupabaseClient<ContentArticlesDatabase> };
}

describe("reads", () => {
  test("every read names the project, and versions come back with their sources in order", async () => {
    const { calls, client } = fakeClient(
      { nexra_articles: [ARTICLE], nexra_article_versions: [VERSION], nexra_article_version_sources: [SOURCE_ROW(2, SOURCE_2), SOURCE_ROW(1, SOURCE_1)] },
      null,
    );
    const store = createSupabaseArticleStore(client);
    const article = await store.getByProjectAndId("halcyon-fintech", ARTICLE.id as string);
    assert.equal(article?.id, ARTICLE.id);
    assert.equal(await store.getByProjectAndId("verdant-home", ARTICLE.id as string), null);
    assert.ok(calls.every((c) => c.target !== "nexra_articles" || c.filters.includes("project_id=halcyon-fintech") || c.filters.includes("project_id=verdant-home")));
    const versions = await store.listVersions(ARTICLE.id as string, 100);
    assert.deepEqual(
      versions[0].sources.map((s) => s.versionId),
      [SOURCE_1.versionId, SOURCE_2.versionId],
    );
  });

  test("source versions are read by project, draft and number", async () => {
    const drafts = [{ id: SOURCE_1.draftId, project_id: "halcyon-fintech", section_label: "S", source_plan_run_id: null }];
    const rows = [{ id: SOURCE_1.versionId, draft_id: SOURCE_1.draftId, version: 1, title: "T", body: "B" }];
    const { calls, client } = fakeClient({ nexra_content_drafts: drafts, nexra_content_draft_versions: rows }, null);
    const store = createSupabaseArticleStore(client);
    assert.equal((await store.getSourceVersion("halcyon-fintech", SOURCE_1.draftId, 1))?.versionId, SOURCE_1.versionId);
    assert.equal(await store.getSourceVersion("verdant-home", SOURCE_1.draftId, 1), null);
    assert.ok(calls.filter((c) => c.target === "nexra_content_drafts").every((c) => c.filters.some((f) => f.startsWith("project_id="))));
  });
});

describe("writes are the two functions only", () => {
  test("create sends the server's canonical text, hash, sources and operator", async () => {
    const answer = { outcome: "created", article: ARTICLE, version: VERSION, sources: [SOURCE_ROW(1, SOURCE_1)] };
    const { calls, client } = fakeClient({}, answer);
    const store = createSupabaseArticleStore(client);
    const outcome = await store.create({
      projectId: "halcyon-fintech",
      sourcePlanRunId: ARTICLE.source_plan_run_id as string,
      canonicalContent: VERSION.canonical_content as string,
      contentSha256: VERSION.content_sha256 as string,
      sources: [SOURCE_1],
      createdBy: ARTICLE.created_by as string,
    });
    assert.equal(outcome.status, "created");
    assert.deepEqual(calls, [
      {
        kind: "rpc",
        target: "nexra_article_create",
        filters: [],
        args: {
          p_project_id: "halcyon-fintech",
          p_source_plan_run_id: ARTICLE.source_plan_run_id,
          p_canonical_content: VERSION.canonical_content,
          p_content_sha256: VERSION.content_sha256,
          p_sources: [{ draft_id: SOURCE_1.draftId, version: 1, version_id: SOURCE_1.versionId, content_sha256: SOURCE_1.contentSha256 }],
          p_created_by: ARTICLE.created_by,
        },
      },
    ]);
  });

  test("save maps every refusal the function can answer", async () => {
    const cases: [unknown, unknown][] = [
      [{ outcome: "stale", current_version: 3 }, { status: "stale", currentVersion: 3 }],
      [{ outcome: "archived" }, { status: "archived" }],
      [{ outcome: "not-found" }, { status: "not-found" }],
      [{ outcome: "content-mismatch" }, { status: "content-mismatch" }],
      [{ outcome: "source-invalid", index: 0, reason: "hash-mismatch" }, { status: "source-invalid", index: 0, reason: "hash-mismatch" }],
      [{ outcome: "source-invalid", index: null, reason: "count" }, { status: "source-invalid", index: null, reason: "count" }],
    ];
    for (const [answer, expected] of cases) {
      const { client } = fakeClient({}, answer);
      const outcome = await createSupabaseArticleStore(client).saveVersion({
        projectId: "halcyon-fintech",
        articleId: ARTICLE.id as string,
        expectedVersion: 1,
        canonicalContent: "x",
        contentSha256: "x",
        sources: [SOURCE_1],
        createdBy: ARTICLE.created_by as string,
      });
      assert.deepEqual(outcome, expected);
    }
  });

  test("a database error or an answer the product does not recognise is an error, not a guess", async () => {
    const failing = fakeClient({}, null, { code: "42501", message: "permission denied" });
    await assert.rejects(
      createSupabaseArticleStore(failing.client).create({ projectId: "p", sourcePlanRunId: "x", canonicalContent: "x", contentSha256: "x", sources: [], createdBy: "x" }),
      ArticleStoreError,
    );
    assert.throws(() => articleResultToOutcome({ outcome: "published" }), ArticleRowError);
    assert.throws(() => articleResultToOutcome({ outcome: "source-invalid", reason: "approved" }), ArticleRowError);
    assert.throws(() => articleRowToArticle({ ...ARTICLE, status: "published" }), ArticleRowError);
    assert.throws(() => articleResultToOutcome({ outcome: "created", article: ARTICLE, version: VERSION }), ArticleRowError);
  });
});
