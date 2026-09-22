import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proposeResultToOutcome, PublicationProposalRowError, type ContentPublicationsDatabase, type PublicationProposalRow } from "./schema.ts";
import { createSupabaseProposalStore } from "./store.ts";

/**
 * The store over a recording fake client: which table, which filters, which
 * patch, which function and which arguments. Nothing here touches a
 * database or a network; the migration's behaviour was exercised separately
 * against a throwaway local PostgreSQL 16, and its text is checked below.
 */

type Call = {
  table?: string;
  rpc?: string;
  args?: Record<string, unknown>;
  select?: string;
  update?: Record<string, unknown>;
  filters: [string, unknown][];
  order?: [string, unknown];
  limit?: number;
  single?: boolean;
};

const ROW: PublicationProposalRow = {
  id: "00000000-0000-4000-8000-0000000000f1",
  project_id: "nexra-agency",
  draft_id: "00000000-0000-4000-8000-0000000000d1",
  version: 2,
  version_id: "00000000-0000-4000-8000-0000000000e2",
  content_sha256: "a".repeat(64),
  approved_by: "00000000-0000-4000-8000-00000000000d",
  approved_at: "2026-09-22T15:00:00.123456+00:00",
  destination: "nexra-agency-website",
  slug: "lead-follow-up",
  preview_format: "draft-section-text/1",
  preview_sha256: "b".repeat(64),
  status: "proposed",
  requested_by: "00000000-0000-4000-8000-00000000000a",
  withdrawn_by: null,
  withdrawn_at: null,
  created_at: "2026-09-22T16:00:00.000000+00:00",
  updated_at: "2026-09-22T16:00:00.000000+00:00",
};

function fakeClient(answers: { rows?: unknown[] | null; rpc?: unknown; error?: { code: string; message: string } }) {
  const calls: Call[] = [];
  const result = () => ({ data: answers.rows ?? [], error: answers.error ?? null });
  function query(call: Call) {
    const builder = {
      select(columns: string) {
        call.select = columns;
        return builder;
      },
      update(patch: Record<string, unknown>) {
        call.update = patch;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return builder;
      },
      order(column: string, options: unknown) {
        call.order = [column, options];
        return builder;
      },
      limit(n: number) {
        call.limit = n;
        return builder;
      },
      async maybeSingle() {
        call.single = true;
        const rows = answers.rows ?? [];
        return { data: rows.length > 0 ? rows[0] : null, error: answers.error ?? null };
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return builder;
  }
  const client = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      return query(call);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ rpc: name, args, filters: [] });
      return { data: answers.rpc ?? null, error: answers.error ?? null };
    },
  };
  return { client: client as unknown as SupabaseClient<ContentPublicationsDatabase>, calls };
}

const INPUT = {
  projectId: "nexra-agency",
  draftId: ROW.draft_id,
  version: 2,
  versionId: ROW.version_id,
  contentSha256: ROW.content_sha256,
  approvedBy: ROW.approved_by,
  approvedAt: ROW.approved_at,
  destination: ROW.destination,
  slug: ROW.slug,
  previewFormat: "draft-section-text/1" as const,
  previewSha256: ROW.preview_sha256,
  requestedBy: ROW.requested_by,
};

describe("createSupabaseProposalStore", () => {
  test("creates only through the one database function, passing every binding argument", async () => {
    const { client, calls } = fakeClient({ rpc: { outcome: "created", proposal: ROW } });
    const outcome = await createSupabaseProposalStore(client).create(INPUT);
    assert.equal(outcome.status, "created");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].rpc, "nexra_content_publication_propose");
    assert.deepEqual(calls[0].args, {
      p_project_id: "nexra-agency",
      p_draft_id: ROW.draft_id,
      p_version: 2,
      p_version_id: ROW.version_id,
      p_content_sha256: ROW.content_sha256,
      p_approved_by: ROW.approved_by,
      p_approved_at: ROW.approved_at,
      p_destination: "nexra-agency-website",
      p_slug: "lead-follow-up",
      p_preview_format: "draft-section-text/1",
      p_preview_sha256: ROW.preview_sha256,
      p_requested_by: ROW.requested_by,
    });
  });

  test("maps every outcome the function answers, and refuses a shape it did not promise", async () => {
    const cases: [unknown, string][] = [
      [{ outcome: "exists", proposal: ROW }, "exists"],
      [{ outcome: "not-found" }, "not-found"],
      [{ outcome: "version-not-found" }, "version-not-found"],
      [{ outcome: "stale", current_version: 3, status: "drafting" }, "stale"],
      [{ outcome: "ineligible", reason: "fact-check-not-passed" }, "ineligible"],
      [{ outcome: "ineligible", reason: "unresolved-placeholders" }, "ineligible"],
      [{ outcome: "content-mismatch" }, "content-mismatch"],
      [{ outcome: "slug-taken" }, "slug-taken"],
    ];
    for (const [rpc, status] of cases) {
      const { client } = fakeClient({ rpc });
      assert.equal((await createSupabaseProposalStore(client).create(INPUT)).status, status, JSON.stringify(rpc));
    }
    assert.deepEqual(proposeResultToOutcome({ outcome: "stale", current_version: 3 }), { outcome: "stale", currentVersion: 3 });
    assert.throws(() => proposeResultToOutcome({ outcome: "published" }), PublicationProposalRowError);
    assert.throws(() => proposeResultToOutcome({ outcome: "ineligible", reason: "override" }), PublicationProposalRowError);
    assert.throws(() => proposeResultToOutcome({ outcome: "stale" }), PublicationProposalRowError);
    assert.throws(() => proposeResultToOutcome({ outcome: "created", proposal: { ...ROW, status: "published" } }), PublicationProposalRowError);
  });

  test("withdraws in one statement conditional on the proposal still being active, patching the status and the withdrawer only", async () => {
    const { client, calls } = fakeClient({ rows: [{ ...ROW, status: "withdrawn", withdrawn_by: ROW.requested_by, withdrawn_at: "2026-09-22T17:00:00+00:00" }] });
    const outcome = await createSupabaseProposalStore(client).withdraw({
      projectId: "nexra-agency",
      draftId: ROW.draft_id,
      proposalId: ROW.id,
      withdrawnBy: ROW.requested_by,
    });
    assert.equal(outcome.status, "withdrawn");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, "nexra_content_publication_proposals");
    assert.deepEqual(calls[0].update, { status: "withdrawn", withdrawn_by: ROW.requested_by });
    assert.deepEqual(calls[0].filters, [
      ["id", ROW.id],
      ["project_id", "nexra-agency"],
      ["draft_id", ROW.draft_id],
      ["status", "proposed"],
    ]);
    const { client: none } = fakeClient({ rows: [] });
    assert.equal((await createSupabaseProposalStore(none).withdraw({ projectId: "nexra-agency", draftId: ROW.draft_id, proposalId: ROW.id, withdrawnBy: ROW.requested_by })).status, "unchanged");
  });

  test("every read names the project and the draft; the active read names the status", async () => {
    const { client, calls } = fakeClient({ rows: [ROW] });
    const store = createSupabaseProposalStore(client);
    assert.equal((await store.findActiveForDraft("nexra-agency", ROW.draft_id))?.id, ROW.id);
    assert.equal((await store.getById("nexra-agency", ROW.draft_id, ROW.id))?.id, ROW.id);
    assert.equal((await store.listForDraft("nexra-agency", ROW.draft_id, 10)).length, 1);
    for (const call of calls) {
      assert.equal(call.table, "nexra_content_publication_proposals");
      assert.deepEqual(call.filters.slice(0, 2), [["project_id", "nexra-agency"], ["draft_id", ROW.draft_id]]);
      assert.equal(call.update, undefined, "a read wrote");
    }
    assert.deepEqual(calls[0].filters[2], ["status", "proposed"]);
    assert.deepEqual(calls[1].filters[2], ["id", ROW.id]);
    assert.equal(calls[2].limit, 10);
  });

  test("a store error is raised with the operation's name, never swallowed", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "permission denied" } });
    await assert.rejects(() => createSupabaseProposalStore(client).create(INPUT), /create proposal failed \(42501\)/);
  });
});

const MIGRATION = new URL("../../../../../supabase/migrations/20260922140000_create_content_publication_proposals.sql", import.meta.url);

describe("the proposal migration", () => {
  test("adds one nexra_-prefixed table and touches no existing table, column, function or grant", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    const code = sql.replace(/--.*$/gm, "");
    assert.deepEqual([...code.matchAll(/create table ([\w.]+)/g)].map((m) => m[1]), ["public.nexra_content_publication_proposals"]);
    assert.doesNotMatch(code, /alter table public\.(?!nexra_content_publication_proposals)/, "an existing table is altered");
    assert.doesNotMatch(code, /nexra_content_draft_save_version/, "the Stage 2 save function is touched");
    assert.doesNotMatch(code, /published_version|published_at|remote_content_id|remote_target/, "the parent's published columns are touched");
    assert.doesNotMatch(code, /\bdrop\b/i);
    for (const name of [...code.matchAll(/create (?:unique )?(?:index|trigger|function) (?:public\.)?(\w+)/g)].map((m) => m[1])) {
      assert.match(name, /^nexra_/, name);
    }
  });

  test("allows only proposed and withdrawn, one active proposal per draft and per destination slug", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    assert.match(sql, /check \(status in \('proposed', 'withdrawn'\)\)/);
    assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /'(published|merged|deployed|pr-opened|live)'/);
    assert.match(sql, /create unique index nexra_content_publication_proposals_one_active_per_draft\s+on public\.nexra_content_publication_proposals \(draft_id\)\s+where status = 'proposed';/);
    assert.match(sql, /create unique index nexra_content_publication_proposals_one_active_per_slug\s+on public\.nexra_content_publication_proposals \(destination, slug\)\s+where status = 'proposed';/);
  });

  test("binds the exact version by number and row, freezes the binding, keeps withdrawn final, and never deletes", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    assert.match(sql, /foreign key \(draft_id, version\) references public\.nexra_content_draft_versions \(draft_id, version\)/);
    assert.match(sql, /version_id uuid not null\s+constraint \w+ references public\.nexra_content_draft_versions \(id\)/);
    const guard = sql.match(/create function public\.nexra_content_publication_proposals_guard_update\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
    for (const column of ["project_id", "draft_id", "version", "version_id", "content_sha256", "approved_by", "approved_at", "destination", "slug", "preview_format", "preview_sha256", "requested_by", "created_at"]) {
      assert.match(guard, new RegExp(`new\\.${column} is distinct from old\\.${column}`), column);
    }
    assert.match(guard, /if old\.status = 'withdrawn' then/);
    assert.match(guard, /new\.withdrawn_at := now\(\);/, "the withdrawal time is the database's");
    assert.match(sql, /before delete on public\.nexra_content_publication_proposals/);
    assert.match(sql, /before truncate on public\.nexra_content_publication_proposals/);
  });

  test("creation locks the draft, re-checks approval, row, check, placeholders and hash, and is the only way in", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    const fn = sql.match(/create function public\.nexra_content_publication_propose\([\s\S]*?\$\$;/)?.[0] ?? "";
    assert.match(fn, /security definer\s+set search_path = ''/);
    assert.match(fn, /where id = p_draft_id and project_id = p_project_id\s+for update;/);
    assert.match(fn, /v_draft\.status <> 'approved'/);
    assert.match(fn, /v_draft\.current_version <> p_version/);
    assert.match(fn, /v_draft\.approved_version is distinct from p_version/);
    assert.match(fn, /v_draft\.approved_at is distinct from p_approved_at/);
    assert.match(fn, /v_version\.id <> p_version_id/);
    assert.match(fn, /fact_check ->> 'status' is distinct from 'passed'/);
    assert.match(fn, /jsonb_array_length\(v_version\.placeholders\) > 0/);
    assert.match(fn, /convert_to\('nexra-content-draft-version\/1', 'UTF8'\) \|\| decode\('00', 'hex'\)/);
    assert.match(fn, /if v_hash <> p_content_sha256 then/);
    // The approval snapshot stored is the locked parent's, not the caller's.
    assert.match(fn, /v_hash, v_draft\.approved_by, v_draft\.approved_at,/);
    // No outbound anything.
    assert.doesNotMatch(fn, /http|net\.|pg_net|dblink|copy |notify/i);
    // Grants: service_role reads and updates, executes the function, and has no insert or delete.
    assert.match(sql, /revoke all on table public\.nexra_content_publication_proposals from service_role;\s+grant select, update on table public\.nexra_content_publication_proposals to service_role;/);
    assert.match(sql, /alter table public\.nexra_content_publication_proposals enable row level security;/);
    assert.doesNotMatch(sql, /create policy/);
    assert.doesNotMatch(sql, /grant [^;]*insert[^;]*nexra_content_publication_proposals/i);
  });
});
