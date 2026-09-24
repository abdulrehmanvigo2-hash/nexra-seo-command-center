import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PROPOSE_REFUSALS } from "@/lib/content/articles/proposals/contract";
import { proposeResultToOutcome, withdrawResultToOutcome, type ArticleProposalsDatabase } from "@/lib/content/articles/proposals/supabase/schema";
import { createSupabaseArticleProposalStore } from "@/lib/content/articles/proposals/supabase/store";
import { ArticleRowError } from "@/lib/content/articles/supabase/schema";
import { ArticleStoreError } from "@/lib/content/articles/supabase/store";

/**
 * The Supabase article proposal store: what it sends, and how it reads what
 * comes back. A small fake client records every call. The answers below
 * were captured verbatim from the committed functions
 * (`nexra_article_publication_propose` / `_withdraw`, 20260925120000) on a
 * disposable local PostgreSQL 16 built by `supabase/tests/run.sh`; the
 * functions' behaviour is exercised there. The store never writes a table:
 * every write is one of the two RPCs.
 */

type Row = Record<string, unknown>;
type Call = { readonly kind: "select" | "rpc"; readonly target: string; readonly filters: readonly string[]; readonly columns?: string; readonly args?: Row };

const CAPTURED_ROW: Row = {
  id: "fe1ffe18-5680-4bb1-b821-f84852f6b30c",
  slug: "capture-one",
  status: "proposed",
  article_id: "50df476d-96fb-4f48-bd97-8d11740d4a96",
  created_at: "2026-09-24T03:17:09.496153+00:00",
  project_id: "nexra-agency",
  updated_at: "2026-09-24T03:17:09.496153+00:00",
  approval_id: "65548470-71fe-42a0-a1ce-4a67f23a8c8f",
  approved_at: "2026-09-24T03:17:09.496153+00:00",
  approved_by: "00000000-0000-4000-8000-0000000000bb",
  destination: "nexra-agency-website",
  requested_by: "00000000-0000-4000-8000-0000000000cc",
  withdrawn_at: null,
  withdrawn_by: null,
  content_sha256: "1a26a91d7633480f050dcaca45fa06fb17b859ec093ce3cff658f2f7719d70f9",
  preview_format: "article-proposal-text/1",
  preview_sha256: "a".repeat(64),
  article_version: 1,
  article_version_id: "bee94005-4142-41e0-9f95-20d4912195d5",
};
const CAPTURED_WITHDRAWN_ROW: Row = {
  ...CAPTURED_ROW,
  status: "withdrawn",
  updated_at: "2026-09-24T03:17:09.535709+00:00",
  withdrawn_at: "2026-09-24T03:17:09.535709+00:00",
  withdrawn_by: "00000000-0000-4000-8000-0000000000dd",
};
const OTHER_PROJECT_ROW: Row = { ...CAPTURED_ROW, id: "fe1ffe18-5680-4bb1-b821-f84852f6b30d", project_id: "verdant-home" };
const DRAFT_ROW: Row = { id: "d6000000-0000-4000-8000-000000000001", draft_id: "d6200000-0000-4000-8000-000000000001", destination: "nexra-agency-website", slug: "capture-one", status: "proposed" };

function fakeClient(tables: Record<string, Row[]>, rpcAnswer: unknown, failures: { readonly select?: string; readonly rpc?: boolean } = {}) {
  const calls: Call[] = [];
  const failure = { code: "PGRST000", message: "connection refused", details: "", hint: "" };
  class Query {
    private filters: string[] = [];
    private rows: Row[];
    private columns = "";
    private readonly table: string;
    constructor(table: string) {
      this.table = table;
      this.rows = [...(tables[table] ?? [])];
    }
    select(columns: string) {
      this.columns = columns;
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push(`${column}=${String(value)}`);
      this.rows = this.rows.filter((r) => r[column] === value);
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    private answer() {
      calls.push({ kind: "select", target: this.table, filters: this.filters, columns: this.columns });
      return failures.select === this.table ? { data: null, error: failure } : { data: this.rows, error: null };
    }
    maybeSingle() {
      const a = this.answer();
      return Promise.resolve(a.error ? a : { data: a.data?.[0] ?? null, error: null });
    }
    then<T>(resolve: (value: unknown) => T) {
      return Promise.resolve(this.answer()).then(resolve);
    }
  }
  const client = {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Row) => {
      calls.push({ kind: "rpc", target: name, filters: [], args });
      return Promise.resolve(failures.rpc ? { data: null, error: failure } : { data: rpcAnswer, error: null });
    },
  };
  return { calls, client: client as unknown as SupabaseClient<ArticleProposalsDatabase> };
}

const INPUT = {
  projectId: "nexra-agency",
  articleId: CAPTURED_ROW.article_id as string,
  articleVersion: 1,
  articleVersionId: CAPTURED_ROW.article_version_id as string,
  contentSha256: CAPTURED_ROW.content_sha256 as string,
  approvalId: CAPTURED_ROW.approval_id as string,
  destination: "nexra-agency-website",
  slug: "capture-one",
  previewFormat: "article-proposal-text/1" as const,
  previewSha256: "a".repeat(64),
  requestedBy: "00000000-0000-4000-8000-0000000000cc",
};

describe("reads", () => {
  test("proposals are read by project and article, with explicit columns; another project's rows are never returned", async () => {
    const { calls, client } = fakeClient({ nexra_article_publication_proposals: [CAPTURED_ROW, OTHER_PROJECT_ROW] }, null);
    const store = createSupabaseArticleProposalStore(client);
    const list = await store.listProposals("nexra-agency", INPUT.articleId);
    assert.deepEqual(list.map((p) => p.id), [CAPTURED_ROW.id]);
    assert.equal(await store.getProposal("verdant-home", CAPTURED_ROW.id as string), null);
    assert.equal((await store.getProposal("nexra-agency", CAPTURED_ROW.id as string))?.slug, "capture-one");
    for (const call of calls) {
      assert.ok(call.filters.some((f) => f.startsWith("project_id=")), JSON.stringify(call));
      assert.ok(call.columns?.startsWith("id, project_id, article_id"), call.columns);
      assert.ok(!call.columns?.includes("*"));
    }
  });

  test("slug holders come from both proposal tables, active only, for exactly that destination and slug (D3)", async () => {
    const { calls, client } = fakeClient({ nexra_article_publication_proposals: [CAPTURED_ROW, CAPTURED_WITHDRAWN_ROW], nexra_content_publication_proposals: [DRAFT_ROW] }, null);
    const holders = await createSupabaseArticleProposalStore(client).listSlugHolders("nexra-agency-website", "capture-one");
    assert.deepEqual(holders.map((h) => h.kind), ["article", "draft"]);
    assert.deepEqual(calls.map((c) => [c.target, c.filters]), [
      ["nexra_article_publication_proposals", ["destination=nexra-agency-website", "slug=capture-one", "status=proposed"]],
      ["nexra_content_publication_proposals", ["destination=nexra-agency-website", "slug=capture-one", "status=proposed"]],
    ]);
    assert.deepEqual(calls.map((c) => c.columns), ["id, article_id, destination, slug", "id, draft_id, destination, slug"]);
  });

  test("a failed read throws; it never becomes an empty list or a missing proposal", async () => {
    for (const table of ["nexra_article_publication_proposals", "nexra_content_publication_proposals"]) {
      const { client } = fakeClient({}, null, { select: table });
      const store = createSupabaseArticleProposalStore(client);
      await assert.rejects(store.listSlugHolders("nexra-agency-website", "capture-one"), ArticleStoreError);
    }
    const { client } = fakeClient({}, null, { select: "nexra_article_publication_proposals" });
    const store = createSupabaseArticleProposalStore(client);
    await assert.rejects(store.listProposals("nexra-agency", INPUT.articleId), ArticleStoreError);
    await assert.rejects(store.getProposal("nexra-agency", CAPTURED_ROW.id as string), ArticleStoreError);
  });

  test("an incomplete or inconsistent row is refused, not passed on", async () => {
    for (const bad of [
      { ...CAPTURED_ROW, preview_format: "draft-section-text/1" },
      { ...CAPTURED_ROW, status: "published" },
      { ...CAPTURED_ROW, content_sha256: "ABC" },
      { ...CAPTURED_ROW, article_version: "1" },
      { ...CAPTURED_ROW, slug: null },
      { ...CAPTURED_ROW, status: "withdrawn" },
      { ...CAPTURED_WITHDRAWN_ROW, withdrawn_by: null },
    ]) {
      const { client } = fakeClient({ nexra_article_publication_proposals: [bad] }, null);
      await assert.rejects(createSupabaseArticleProposalStore(client).listProposals("nexra-agency", INPUT.articleId), ArticleRowError, JSON.stringify(bad));
    }
  });
});

describe("writes are the two functions only", () => {
  test("propose sends exactly the server's binding, by the SQL parameter names", async () => {
    const { calls, client } = fakeClient({}, { outcome: "created", proposal: CAPTURED_ROW });
    const outcome = await createSupabaseArticleProposalStore(client).propose(INPUT);
    assert.equal(outcome.status, "created");
    assert.deepEqual(calls, [
      {
        kind: "rpc",
        target: "nexra_article_publication_propose",
        filters: [],
        args: {
          p_project_id: INPUT.projectId,
          p_article_id: INPUT.articleId,
          p_article_version: 1,
          p_article_version_id: INPUT.articleVersionId,
          p_content_sha256: INPUT.contentSha256,
          p_approval_id: INPUT.approvalId,
          p_destination: INPUT.destination,
          p_slug: INPUT.slug,
          p_preview_format: "article-proposal-text/1",
          p_preview_sha256: INPUT.previewSha256,
          p_requested_by: INPUT.requestedBy,
        },
      },
    ]);
  });

  test("withdraw sends the project, proposal and the server's operator", async () => {
    const { calls, client } = fakeClient({}, { outcome: "withdrawn", proposal: CAPTURED_WITHDRAWN_ROW });
    const outcome = await createSupabaseArticleProposalStore(client).withdraw({ projectId: "nexra-agency", proposalId: CAPTURED_ROW.id as string, withdrawnBy: "00000000-0000-4000-8000-0000000000dd" });
    assert.equal(outcome.status, "withdrawn");
    assert.deepEqual(calls[0].args, { p_project_id: "nexra-agency", p_proposal_id: CAPTURED_ROW.id, p_withdrawn_by: "00000000-0000-4000-8000-0000000000dd" });
  });

  test("a failed function call throws; it is never an outcome", async () => {
    const { client } = fakeClient({}, null, { rpc: true });
    const store = createSupabaseArticleProposalStore(client);
    await assert.rejects(store.propose(INPUT), ArticleStoreError);
    await assert.rejects(store.withdraw({ projectId: "nexra-agency", proposalId: CAPTURED_ROW.id as string, withdrawnBy: INPUT.requestedBy }), ArticleStoreError);
  });

  test("the store has no table write: the client's from() is only ever read", async () => {
    const { calls, client } = fakeClient({ nexra_article_publication_proposals: [CAPTURED_ROW] }, { outcome: "created", proposal: CAPTURED_ROW });
    const store = createSupabaseArticleProposalStore(client);
    await store.listProposals("nexra-agency", INPUT.articleId);
    await store.propose(INPUT);
    assert.ok(calls.every((c) => c.kind === "rpc" || c.columns !== undefined));
  });
});

describe("outcome mapping (captured answers)", () => {
  test("created, exists and active-exists carry the proposal", () => {
    for (const outcome of ["created", "exists", "active-exists"] as const) {
      const mapped = proposeResultToOutcome({ outcome, proposal: CAPTURED_ROW });
      assert.equal(mapped.status, outcome);
      assert.equal("proposal" in mapped && mapped.proposal.id, CAPTURED_ROW.id);
    }
  });

  test("every documented refusal maps to itself; extra fields are ignored", () => {
    for (const outcome of PROPOSE_REFUSALS) assert.deepEqual(proposeResultToOutcome({ outcome }), { status: outcome });
    assert.deepEqual(proposeResultToOutcome({ outcome: "stale", current_version: 1, approved_version: 1 }), { status: "stale" });
  });

  test("withdrawn, already-withdrawn and not-found", () => {
    assert.equal(withdrawResultToOutcome({ outcome: "withdrawn", proposal: CAPTURED_WITHDRAWN_ROW }).status, "withdrawn");
    assert.equal(withdrawResultToOutcome({ outcome: "already-withdrawn", proposal: CAPTURED_WITHDRAWN_ROW }).status, "already-withdrawn");
    assert.deepEqual(withdrawResultToOutcome({ outcome: "not-found" }), { status: "not-found" });
  });

  test("an unknown outcome, a missing proposal, or a withdrawal that is not withdrawn is an error, never a success", () => {
    assert.throws(() => proposeResultToOutcome({ outcome: "published" }), ArticleRowError);
    assert.throws(() => proposeResultToOutcome({ outcome: "created" }), ArticleRowError);
    assert.throws(() => proposeResultToOutcome(null), ArticleRowError);
    assert.throws(() => withdrawResultToOutcome({ outcome: "withdrawn", proposal: CAPTURED_ROW }), ArticleRowError);
    assert.throws(() => withdrawResultToOutcome({ outcome: "deleted" }), ArticleRowError);
  });
});
