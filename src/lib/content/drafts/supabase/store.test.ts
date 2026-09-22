import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CreateDraftFromWriterInput } from "../../../../types/content-draft.ts";
import { FakeDraftSupabase, asDraftClient, postgrestError } from "./fake-client.ts";
import { ContentDraftRowError, draftRowToDraft, saveVersionResultToOutcome, versionRowToVersion } from "./schema.ts";
import { ContentDraftStoreError, createSupabaseDraftStore } from "./store.ts";

/**
 * The store over a fake client: no database, no network. The fake enforces
 * the two unique keys; the last suite checks what the store emits against
 * the other bounds the migration declares.
 */

const INPUT: CreateDraftFromWriterInput = {
  projectId: "nexra-agency",
  sourceWriterRunId: "11111111-0000-4000-8000-000000000070",
  sourcePlanRunId: "11111111-0000-4000-8000-000000000060",
  sectionIndex: 1,
  sectionLabel: "What automated lead follow-up does [crawl /]",
  title: "What automated lead follow-up does [crawl /]",
  body: "Nexra Agency's home page presents automated lead follow-up as the service it leads with.",
  claims: ["The home page title names automation. [crawl /]", "The page has one h1. [crawl /]"],
  placeholders: ["[NEEDS EVIDENCE: how quickly a lead is contacted]"],
  createdBy: "00000000-0000-4000-8000-00000000000a",
};

function storeWith() {
  const db = new FakeDraftSupabase();
  return { db, store: createSupabaseDraftStore(asDraftClient(db)) };
}

describe("createSupabaseDraftStore — create", () => {
  test("writes one parent and one version 1, and reads them back mapped", async () => {
    const { db, store } = storeWith();
    const outcome = await store.createFromWriterRun(INPUT);
    assert.equal(outcome.status, "created");
    if (outcome.status !== "created") return;
    assert.equal(db.rows.nexra_content_drafts.length, 1);
    assert.equal(db.rows.nexra_content_draft_versions.length, 1);
    assert.deepEqual(db.writes, [
      { table: "nexra_content_drafts", operation: "insert" },
      { table: "nexra_content_draft_versions", operation: "insert" },
    ]);

    const { draft, version } = outcome.saved;
    assert.equal(draft.projectId, "nexra-agency");
    assert.equal(draft.sourceWriterRunId, INPUT.sourceWriterRunId);
    assert.equal(draft.sourcePlanRunId, INPUT.sourcePlanRunId);
    assert.equal(draft.sectionIndex, 1);
    assert.equal(draft.sectionLabel, INPUT.sectionLabel);
    assert.equal(draft.status, "drafting");
    assert.equal(draft.currentVersion, 1);
    assert.equal(draft.approvedVersion, null);
    assert.equal(draft.publishedVersion, null);
    assert.equal(draft.remoteContentId, null);
    assert.equal(draft.createdBy, INPUT.createdBy);
    assert.equal(version.draftId, draft.id);
    assert.equal(version.version, 1);
    assert.equal(version.origin, "writer");
    assert.equal(version.title, INPUT.title);
    assert.equal(version.body, INPUT.body);
    assert.deepEqual(version.claims, INPUT.claims);
    assert.deepEqual(version.placeholders, INPUT.placeholders);
    assert.equal(version.factCheck, null);
    assert.equal(version.createdBy, INPUT.createdBy);
  });

  test("the same Writer run cannot seed a second draft: the unique key answers exists and nothing is written", async () => {
    const { db, store } = storeWith();
    assert.equal((await store.createFromWriterRun(INPUT)).status, "created");
    const again = await store.createFromWriterRun({ ...INPUT, body: "different text" });
    assert.deepEqual(again, { status: "exists" });
    assert.equal(db.rows.nexra_content_drafts.length, 1);
    assert.equal(db.rows.nexra_content_draft_versions.length, 1);
    assert.equal(db.rows.nexra_content_draft_versions[0].body, INPUT.body);
  });

  test("a failed version insert removes the parent again, so no draft exists without its version 1", async () => {
    const { db, store } = storeWith();
    db.failNext({ table: "nexra_content_draft_versions", operation: "insert", error: postgrestError("23514", "check violation", "secret row content") });
    await assert.rejects(() => store.createFromWriterRun(INPUT), (error: unknown) => {
      assert.ok(error instanceof ContentDraftStoreError);
      assert.match(error.message, /create draft version failed/);
      assert.ok(!error.message.includes("secret row content"));
      return true;
    });
    assert.equal(db.rows.nexra_content_drafts.length, 0);
    assert.equal(db.rows.nexra_content_draft_versions.length, 0);
    assert.deepEqual(db.writes.map((write) => write.operation), ["insert", "insert", "delete"]);
    // And the run can be saved cleanly afterwards.
    assert.equal((await store.createFromWriterRun(INPUT)).status, "created");
  });

  test("a parent insert failure that is not the unique key is an error, not exists", async () => {
    const { store } = storeWith();
    const { db } = storeWith();
    void db;
    const failing = new FakeDraftSupabase();
    failing.failNext({ table: "nexra_content_drafts", operation: "insert", error: postgrestError("42501", "permission denied") });
    await assert.rejects(() => createSupabaseDraftStore(asDraftClient(failing)).createFromWriterRun(INPUT), /create draft failed \(42501\)/);
    void store;
  });
});

describe("createSupabaseDraftStore — read", () => {
  test("finds by project and Writer run, and never across projects", async () => {
    const { store } = storeWith();
    const created = await store.createFromWriterRun(INPUT);
    assert.ok(created.status === "created");
    const found = await store.findByWriterRunId("nexra-agency", INPUT.sourceWriterRunId);
    assert.deepEqual(found, created.saved);
    assert.equal(await store.findByWriterRunId("halcyon-fintech", INPUT.sourceWriterRunId), null);
    assert.equal(await store.findByWriterRunId("nexra-agency", "11111111-0000-4000-8000-000000000071"), null);
    assert.deepEqual(await store.getByProjectAndId("nexra-agency", created.saved.draft.id), created.saved);
    assert.equal(await store.getByProjectAndId("halcyon-fintech", created.saved.draft.id), null);
    assert.deepEqual(await store.getCurrentVersion(created.saved.draft.id), created.saved.version);
    assert.equal(await store.getCurrentVersion("00000000-0000-4000-8000-000000000999"), null);
  });

  test("a draft whose current version is missing is reported as an error, never as an empty draft", async () => {
    const { db, store } = storeWith();
    const created = await store.createFromWriterRun(INPUT);
    assert.ok(created.status === "created");
    db.rows.nexra_content_draft_versions = [];
    await assert.rejects(() => store.findByWriterRunId("nexra-agency", INPUT.sourceWriterRunId), /names version 1, which does not exist/);
  });

  test("a store failure surfaces as a ContentDraftStoreError that quotes no row", async () => {
    const { db, store } = storeWith();
    db.failNext({ table: "nexra_content_drafts", operation: "select", error: postgrestError("42P01", "relation does not exist", "secret row content") });
    await assert.rejects(() => store.findByWriterRunId("nexra-agency", INPUT.sourceWriterRunId), (error: unknown) => {
      assert.ok(error instanceof ContentDraftStoreError);
      assert.ok(!error.message.includes("secret row content"));
      return true;
    });
  });
});

describe("row mapping against the migration's bounds", () => {
  test("arrays round-trip, and a row whose claims are not an array of strings is refused", () => {
    const { db } = storeWith();
    void db;
    const base = {
      id: "00000000-0000-4000-8000-000000000002",
      draft_id: "00000000-0000-4000-8000-000000000001",
      version: 1,
      origin: "writer",
      title: INPUT.title,
      body: INPUT.body,
      claims: [...INPUT.claims],
      placeholders: [],
      fact_check: null,
      created_by: INPUT.createdBy,
      created_at: "2026-09-22T12:00:00.000Z",
    };
    assert.deepEqual(versionRowToVersion(base).claims, INPUT.claims);
    assert.throws(() => versionRowToVersion({ ...base, claims: "not an array" }), ContentDraftRowError);
    assert.throws(() => versionRowToVersion({ ...base, claims: [1, 2] }), ContentDraftRowError);
    assert.throws(() => versionRowToVersion({ ...base, origin: "model" }), ContentDraftRowError);
    assert.throws(() => versionRowToVersion({ ...base, fact_check: [] }), ContentDraftRowError);
    assert.throws(
      () =>
        draftRowToDraft({
          id: base.draft_id,
          project_id: "nexra-agency",
          source_writer_run_id: INPUT.sourceWriterRunId,
          source_plan_run_id: null,
          section_index: null,
          section_label: "x",
          status: "live",
          current_version: 1,
          approved_version: null,
          approved_by: null,
          approved_at: null,
          published_version: null,
          published_at: null,
          remote_content_id: null,
          remote_target: null,
          created_by: INPUT.createdBy,
          created_at: base.created_at,
          updated_at: base.created_at,
        }),
      ContentDraftRowError,
    );
  });

  test("what the store writes stays within the columns' declared bounds", async () => {
    const { db, store } = storeWith();
    await store.createFromWriterRun(INPUT);
    const [draft] = db.rows.nexra_content_drafts;
    const [version] = db.rows.nexra_content_draft_versions;
    assert.ok(typeof draft.section_label === "string" && draft.section_label.length <= 400);
    assert.ok(typeof version.title === "string" && version.title.length <= 400);
    assert.ok(typeof version.body === "string" && version.body.length >= 1 && version.body.length <= 20_000);
    assert.ok(Array.isArray(version.claims) && Array.isArray(version.placeholders));
    assert.equal(version.origin, "writer");
    assert.equal(version.version, 1);
    assert.equal(draft.status, "drafting");
  });
});

describe("createSupabaseDraftStore — versions", () => {
  const EDIT = {
    projectId: "nexra-agency",
    expectedVersion: 1,
    title: "What automated lead follow-up does",
    body: "An operator rewrote this section by hand.",
    createdBy: "00000000-0000-4000-8000-00000000000c",
  };

  async function seeded() {
    const { db, store } = storeWith();
    const created = await store.createFromWriterRun(INPUT);
    assert.ok(created.status === "created");
    db.writes.length = 0;
    return { db, store, draftId: created.saved.draft.id, first: created.saved.version };
  }

  test("saving an edit goes through the one database function, which writes version 2 with no claims and advances the parent together", async () => {
    const { db, store, draftId, first } = await seeded();
    const outcome = await store.saveVersion({ ...EDIT, draftId });
    assert.equal(outcome.status, "created");
    if (outcome.status !== "created") return;
    assert.deepEqual(db.writes, [{ table: "nexra_content_drafts", operation: "rpc" }], "one call, no separate inserts or updates");
    assert.equal(outcome.saved.draft.id, draftId);
    assert.equal(outcome.saved.draft.currentVersion, 2);
    assert.equal(outcome.saved.version.version, 2);
    assert.equal(outcome.saved.version.origin, "operator");
    assert.equal(outcome.saved.version.title, EDIT.title);
    assert.equal(outcome.saved.version.body, EDIT.body);
    assert.deepEqual(outcome.saved.version.claims, []);
    assert.deepEqual(outcome.saved.version.placeholders, []);
    assert.equal(outcome.saved.version.factCheck, null);
    assert.equal(outcome.saved.version.createdBy, EDIT.createdBy);
    // Version 1's row is exactly what it was.
    const rows = db.rows.nexra_content_draft_versions;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].version, 1);
    assert.equal(rows[0].origin, "writer");
    assert.equal(rows[0].body, INPUT.body);
    assert.deepEqual(rows[0].claims, INPUT.claims);
    assert.deepEqual(await store.getCurrentVersion(draftId), outcome.saved.version);
    assert.deepEqual(await store.getByProjectAndId("nexra-agency", draftId), outcome.saved);
    void first;
  });

  test("the function's stale, not-found and archived answers are passed through, and none of them writes", async () => {
    const { db, store, draftId } = await seeded();
    assert.deepEqual(await store.saveVersion({ ...EDIT, draftId, expectedVersion: 2 }), { status: "stale", currentVersion: 1 });
    assert.deepEqual(await store.saveVersion({ ...EDIT, draftId, projectId: "halcyon-fintech" }), { status: "not-found" });
    assert.deepEqual(await store.saveVersion({ ...EDIT, draftId: "00000000-0000-4000-8000-000000000999" }), { status: "not-found" });
    db.rows.nexra_content_drafts[0].status = "archived";
    assert.deepEqual(await store.saveVersion({ ...EDIT, draftId }), { status: "archived" });
    assert.equal(db.rows.nexra_content_draft_versions.length, 1);
    assert.equal(db.rows.nexra_content_drafts[0].current_version, 1);
  });

  test("a second save from the same version is stale once the first has landed", async () => {
    const { store, draftId } = await seeded();
    assert.equal((await store.saveVersion({ ...EDIT, draftId })).status, "created");
    assert.deepEqual(await store.saveVersion({ ...EDIT, draftId, body: "A different edit of version 1." }), { status: "stale", currentVersion: 2 });
    const third = await store.saveVersion({ ...EDIT, draftId, expectedVersion: 2, body: "An edit of version 2." });
    assert.ok(third.status === "created" && third.saved.version.version === 3);
  });

  test("an edit returns a fact-checked or approved parent to drafting and leaves the approval columns as they were", async () => {
    const { db, store, draftId } = await seeded();
    Object.assign(db.rows.nexra_content_drafts[0], { status: "approved", approved_version: 1, approved_by: INPUT.createdBy, approved_at: "2026-09-22T12:05:00.000Z" });
    const outcome = await store.saveVersion({ ...EDIT, draftId });
    assert.ok(outcome.status === "created");
    assert.equal(outcome.saved.draft.status, "drafting");
    assert.equal(outcome.saved.draft.approvedVersion, 1);
    assert.equal(outcome.saved.draft.approvedBy, INPUT.createdBy);
    assert.equal(outcome.saved.draft.publishedVersion, null);
  });

  test("lists a draft's versions newest first, within the limit, and only that draft's", async () => {
    const { db, store, draftId } = await seeded();
    await store.saveVersion({ ...EDIT, draftId });
    await store.saveVersion({ ...EDIT, draftId, expectedVersion: 2, body: "Third." });
    const other = await store.createFromWriterRun({ ...INPUT, sourceWriterRunId: "11111111-0000-4000-8000-000000000071" });
    assert.ok(other.status === "created");
    const all = await store.listVersions(draftId, 100);
    assert.deepEqual(all.map((version) => version.version), [3, 2, 1]);
    assert.ok(all.every((version) => version.draftId === draftId));
    assert.deepEqual((await store.listVersions(draftId, 2)).map((version) => version.version), [3, 2]);
    assert.deepEqual((await store.listVersions(other.saved.draft.id, 100)).map((version) => version.version), [1]);
    assert.deepEqual(await store.listVersions("00000000-0000-4000-8000-000000000999", 100), []);
    assert.equal(db.rows.nexra_content_draft_versions.length, 4);
  });

  test("a function or list failure is a ContentDraftStoreError that quotes no row text", async () => {
    const { db, store, draftId } = await seeded();
    db.failNext({ table: "nexra_content_drafts", operation: "rpc", error: postgrestError("42501", "permission denied", "secret row content") });
    await assert.rejects(() => store.saveVersion({ ...EDIT, draftId }), (error: unknown) => {
      assert.ok(error instanceof ContentDraftStoreError);
      assert.match(error.message, /save draft version failed \(42501\)/);
      assert.ok(!error.message.includes("secret row content"));
      return true;
    });
    assert.equal(db.rows.nexra_content_draft_versions.length, 1);
    db.failNext({ table: "nexra_content_draft_versions", operation: "select", error: postgrestError("42P01", "relation does not exist", "secret row content") });
    await assert.rejects(() => store.listVersions(draftId, 100), (error: unknown) => {
      assert.ok(error instanceof ContentDraftStoreError);
      assert.match(error.message, /list draft versions failed/);
      assert.ok(!error.message.includes("secret row content"));
      return true;
    });
  });

  test("an answer from the function that this product does not recognise is an error, never a saved version", () => {
    assert.throws(() => saveVersionResultToOutcome({ outcome: "merged" }), ContentDraftRowError);
    assert.throws(() => saveVersionResultToOutcome({ outcome: "stale" }), ContentDraftRowError);
    assert.throws(() => saveVersionResultToOutcome(null), ContentDraftRowError);
    assert.throws(() => saveVersionResultToOutcome([]), ContentDraftRowError);
    assert.deepEqual(saveVersionResultToOutcome({ outcome: "stale", current_version: 4 }), { outcome: "stale", currentVersion: 4 });
    assert.deepEqual(saveVersionResultToOutcome({ outcome: "not-found" }), { outcome: "not-found" });
    assert.deepEqual(saveVersionResultToOutcome({ outcome: "archived" }), { outcome: "archived" });
  });
});

/**
 * Version permanence. The fake mirrors the two guards the migrations put on
 * `nexra_content_draft_versions` — no update to identity or text, no delete
 * at all — so these tests state what the database refuses and what the
 * store does around it. The migration text itself is checked in the last
 * test; the SQL is exercised on a real Postgres outside this runner.
 */
describe("version rows are permanent", () => {
  const EDIT = {
    projectId: "nexra-agency",
    title: "Edited title",
    body: "An operator rewrote this section by hand.",
    createdBy: "00000000-0000-4000-8000-00000000000c",
  };

  async function withThreeVersions() {
    const { db, store } = storeWith();
    const created = await store.createFromWriterRun(INPUT);
    assert.ok(created.status === "created");
    const draftId = created.saved.draft.id;
    assert.equal((await store.saveVersion({ ...EDIT, draftId, expectedVersion: 1 })).status, "created");
    assert.equal((await store.saveVersion({ ...EDIT, draftId, expectedVersion: 2, body: "Third." })).status, "created");
    return { db, store, draftId };
  }

  function assertIntegrity(db: FakeDraftSupabase) {
    for (const draft of db.rows.nexra_content_drafts) {
      const versions = db.rows.nexra_content_draft_versions.filter((row) => row.draft_id === draft.id).map((row) => row.version as number).sort((a, b) => a - b);
      assert.deepEqual(versions, Array.from({ length: versions.length }, (_, index) => index + 1), `draft ${String(draft.id)}: versions are numbered 1..N without gaps`);
      assert.equal(draft.current_version, versions.length, `draft ${String(draft.id)}: current_version names the newest version`);
      assert.equal(db.rows.nexra_content_draft_versions.find((row) => row.draft_id === draft.id && row.version === 1)?.origin, "writer");
    }
    const parents = new Set(db.rows.nexra_content_drafts.map((row) => row.id));
    assert.ok(db.rows.nexra_content_draft_versions.every((row) => parents.has(row.draft_id)), "no version without its parent");
  }

  test("a direct delete of any version row is refused and removes nothing, version 1 included", async () => {
    const { db, draftId } = await withThreeVersions();
    const before = JSON.stringify(db.rows.nexra_content_draft_versions);
    for (const version of [1, 2, 3]) {
      const result = await db.from("nexra_content_draft_versions").delete().eq("draft_id", draftId).eq("version", version);
      assert.equal(result.error?.code, "23514", `version ${version}`);
      assert.match(result.error?.message ?? "", /a version is never deleted/);
    }
    const all = await db.from("nexra_content_draft_versions").delete().eq("draft_id", draftId);
    assert.equal(all.error?.code, "23514");
    assert.equal(JSON.stringify(db.rows.nexra_content_draft_versions), before);
    assert.equal(db.rows.nexra_content_draft_versions.length, 3);
    assertIntegrity(db);
  });

  test("deleting a parent that has versions is refused too, because its cascade would delete them; the parent and every version stay", async () => {
    const { db, store, draftId } = await withThreeVersions();
    const result = await db.from("nexra_content_drafts").delete().eq("id", draftId);
    assert.equal(result.error?.code, "23514");
    assert.equal(db.rows.nexra_content_drafts.length, 1);
    assert.equal(db.rows.nexra_content_draft_versions.length, 3);
    assert.deepEqual((await store.listVersions(draftId, 100)).map((version) => version.version), [3, 2, 1]);
    assertIntegrity(db);
  });

  test("the Stage 1 compensation still removes a parent that has no version 1, because the cascade then reaches no version row", async () => {
    const { db, store } = storeWith();
    db.failNext({ table: "nexra_content_draft_versions", operation: "insert", error: postgrestError("23514", "check violation") });
    await assert.rejects(() => store.createFromWriterRun(INPUT), /create draft version failed/);
    assert.equal(db.rows.nexra_content_drafts.length, 0, "the parent without a version was removed");
    assert.equal(db.rows.nexra_content_draft_versions.length, 0);
    assert.equal((await store.createFromWriterRun(INPUT)).status, "created");
    assertIntegrity(db);
  });

  test("a version's identity and text still cannot be updated, while fact_check can be written once for that exact version", async () => {
    const { db, draftId } = await withThreeVersions();
    const v1 = db.rows.nexra_content_draft_versions.find((row) => row.draft_id === draftId && row.version === 1)!;
    for (const patch of [{ body: "tampered" }, { title: "tampered" }, { claims: [] }, { origin: "operator" }, { version: 9 }, { created_by: EDIT.createdBy }]) {
      const result = await db.from("nexra_content_draft_versions").update(patch).eq("id", v1.id);
      assert.equal(result.error?.code, "23514", JSON.stringify(patch));
      assert.match(result.error?.message ?? "", /a version is immutable/);
    }
    assert.equal(v1.body, INPUT.body);
    assert.deepEqual(v1.claims, INPUT.claims);
    const check = { checkedAt: "2026-09-22T13:00:00.000Z", verdict: "needs-work", claims: [{ text: INPUT.claims[0], status: "supported" }] };
    const written = await db.from("nexra_content_draft_versions").update({ fact_check: check }).eq("id", v1.id);
    assert.equal(written.error, null);
    assert.deepEqual(v1.fact_check, check);
    // Version 2 is untouched by version 1's check.
    assert.equal(db.rows.nexra_content_draft_versions.find((row) => row.draft_id === draftId && row.version === 2)?.fact_check, null);
    assertIntegrity(db);
  });

  test("versions 2 and 3 are still created normally under the guards, and the history stays whole", async () => {
    const { db, store, draftId } = await withThreeVersions();
    const fourth = await store.saveVersion({ ...EDIT, draftId, expectedVersion: 3, body: "Fourth." });
    assert.ok(fourth.status === "created" && fourth.saved.version.version === 4);
    assert.deepEqual(db.writes.filter((write) => write.operation === "delete"), [], "creating versions deletes nothing");
    assert.deepEqual((await store.listVersions(draftId, 100)).map((version) => [version.version, version.body]), [
      [4, "Fourth."],
      [3, "Third."],
      [2, EDIT.body],
      [1, INPUT.body],
    ]);
    assertIntegrity(db);
  });

  test("the migration declares the delete guard as a before-delete row trigger and a before-truncate trigger, and changes nothing else", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(new URL("../../../../../supabase/migrations/20260922130100_content_draft_versions_guard_delete.sql", import.meta.url), "utf8");
    assert.match(sql, /create function public\.nexra_content_draft_versions_guard_delete\(\)\s+returns trigger\s+language plpgsql\s+set search_path = ''/);
    assert.match(sql, /raise exception 'nexra_content_draft_versions: a version is never deleted; archive the draft instead'\s+using errcode = 'check_violation';/);
    assert.match(sql, /create trigger nexra_content_draft_versions_guard_delete\s+before delete on public\.nexra_content_draft_versions\s+for each row\s+execute function public\.nexra_content_draft_versions_guard_delete\(\);/);
    assert.match(sql, /create trigger nexra_content_draft_versions_guard_truncate\s+before truncate on public\.nexra_content_draft_versions\s+for each statement\s+execute function public\.nexra_content_draft_versions_guard_delete\(\);/);
    // No `when` clause: nothing lets a delete through, the parent's cascade included.
    assert.doesNotMatch(sql, /\bwhen \(/i);
    // Nothing else is touched: in the statements (comments aside) there is no
    // alter, drop, grant, insert or update, and no mention of the save
    // function, the update guard or the foreign key.
    const statements = sql.replace(/^\s*--.*$/gm, "").replace(/comment on function[\s\S]*?';/g, "");
    assert.doesNotMatch(statements, /\b(alter|drop|grant|revoke|insert|update)\b/i);
    assert.doesNotMatch(statements, /nexra_content_draft_save_version|guard_update|fkey|cascade/);
  });
});

/**
 * Stage 3: the fact-check written onto one exact version, once, with
 * nothing else in the patch; and the parent's one conditional transition.
 */
describe("createSupabaseDraftStore — fact-check", () => {
  const CHECK = {
    status: "passed" as const,
    draftId: "",
    version: 2,
    checkedAt: "2026-09-22T14:00:00.000Z",
    checkedByRunId: "11111111-0000-4000-8000-000000000080",
    recordedAt: "2026-09-22T14:05:00.000Z",
    recordedBy: INPUT.createdBy,
    crawlId: "8f1c0d2e-0000-4000-8000-000000000001",
    searchWindow: null,
    summary: "One sentence, supported.",
    supported: [{ text: "The home page title names automation.", evidence: "crawl /", note: null }],
    partial: [],
    unsupported: [],
    unverifiable: [],
    editorial: [],
  };

  async function withEdit() {
    const { db, store } = storeWith();
    const created = await store.createFromWriterRun(INPUT);
    assert.ok(created.status === "created");
    const draftId = created.saved.draft.id;
    const edited = await store.saveVersion({ projectId: "nexra-agency", draftId, expectedVersion: 1, title: "Edited", body: "An operator rewrote this.", createdBy: INPUT.createdBy });
    assert.ok(edited.status === "created");
    db.writes.length = 0;
    return { db, store, draftId, factCheck: { ...CHECK, draftId } };
  }

  test("getVersion reads one exact version by draft and number, and null otherwise", async () => {
    const { store, draftId } = await withEdit();
    assert.equal((await store.getVersion(draftId, 1))?.origin, "writer");
    assert.equal((await store.getVersion(draftId, 2))?.origin, "operator");
    assert.equal(await store.getVersion(draftId, 3), null);
    assert.equal(await store.getVersion("00000000-0000-4000-8000-000000000999", 1), null);
  });

  test("recordFactCheck writes fact_check onto version 2 and nothing else, once; the second recording is answered already-checked without a write", async () => {
    const { db, store, draftId, factCheck } = await withEdit();
    const before = db.rows.nexra_content_draft_versions.map((row) => ({ ...row }));
    const outcome = await store.recordFactCheck({ draftId, version: 2, factCheck });
    assert.equal(outcome.status, "recorded");
    if (outcome.status !== "recorded") return;
    assert.deepEqual(outcome.version.factCheck, factCheck);
    assert.equal(outcome.version.version, 2);
    assert.deepEqual(db.writes, [{ table: "nexra_content_draft_versions", operation: "update" }]);
    const after = db.rows.nexra_content_draft_versions;
    for (const [index, row] of after.entries()) {
      const { fact_check: was, ...restBefore } = before[index];
      const { fact_check: now, ...restAfter } = row;
      assert.deepEqual(restAfter, restBefore, `version ${String(row.version)}: a column other than fact_check changed`);
      assert.equal(was, null);
      assert.deepEqual(now, row.version === 2 ? factCheck : null);
    }
    db.writes.length = 0;
    const again = await store.recordFactCheck({ draftId, version: 2, factCheck: { ...factCheck, summary: "A second check." } });
    assert.equal(again.status, "already-checked");
    if (again.status === "already-checked") assert.deepEqual(again.version.factCheck, factCheck);
    assert.equal((db.rows.nexra_content_draft_versions[1].fact_check as { summary: string }).summary, "One sentence, supported.");
    assert.deepEqual(await store.recordFactCheck({ draftId, version: 9, factCheck }), { status: "not-found" });
    assert.deepEqual(await store.recordFactCheck({ draftId: "00000000-0000-4000-8000-000000000999", version: 1, factCheck }), { status: "not-found" });
    // Version 1 can still be checked on its own, independently.
    assert.equal((await store.recordFactCheck({ draftId, version: 1, factCheck: { ...factCheck, version: 1 } })).status, "recorded");
  });

  test("markFactChecked moves the parent only while the checked version is current and the parent is drafting, and touches no version", async () => {
    const { db, store, draftId } = await withEdit();
    assert.deepEqual(await store.markFactChecked({ projectId: "nexra-agency", draftId, version: 1 }), { status: "unchanged" }, "a check of an earlier version advanced the parent");
    assert.deepEqual(await store.markFactChecked({ projectId: "halcyon-fintech", draftId, version: 2 }), { status: "unchanged" }, "another project reached the parent");
    assert.equal(db.rows.nexra_content_drafts[0].status, "drafting");
    const marked = await store.markFactChecked({ projectId: "nexra-agency", draftId, version: 2 });
    assert.equal(marked.status, "updated");
    if (marked.status === "updated") {
      assert.equal(marked.draft.status, "fact-checked");
      assert.equal(marked.draft.currentVersion, 2);
      assert.equal(marked.draft.approvedVersion, null);
      assert.equal(marked.draft.publishedVersion, null);
    }
    assert.deepEqual(await store.markFactChecked({ projectId: "nexra-agency", draftId, version: 2 }), { status: "unchanged" }, "a second mark changed something");
    assert.deepEqual(db.writes.map((write) => write.table), ["nexra_content_drafts", "nexra_content_drafts", "nexra_content_drafts", "nexra_content_drafts"]);
    assert.ok(db.rows.nexra_content_draft_versions.every((row) => row.fact_check === null));
    // An edit afterwards returns the parent to drafting through the save function, as before.
    const next = await store.saveVersion({ projectId: "nexra-agency", draftId, expectedVersion: 2, title: "Edited", body: "Third.", createdBy: INPUT.createdBy });
    assert.ok(next.status === "created" && next.saved.draft.status === "drafting");
  });

  test("a failed update is a ContentDraftStoreError that quotes no row, and nothing is recorded", async () => {
    const { db, store, draftId, factCheck } = await withEdit();
    db.failNext({ table: "nexra_content_draft_versions", operation: "update", error: postgrestError("23514", "a version is immutable", "secret row content") });
    await assert.rejects(() => store.recordFactCheck({ draftId, version: 2, factCheck }), (error: unknown) => {
      assert.ok(error instanceof ContentDraftStoreError);
      assert.match(error.message, /record fact-check failed \(23514\)/);
      assert.ok(!error.message.includes("secret row content"));
      return true;
    });
    assert.ok(db.rows.nexra_content_draft_versions.every((row) => row.fact_check === null));
    db.failNext({ table: "nexra_content_drafts", operation: "update", error: postgrestError("42501", "permission denied", "secret row content") });
    await assert.rejects(() => store.markFactChecked({ projectId: "nexra-agency", draftId, version: 2 }), /mark draft fact-checked failed \(42501\)/);
    assert.equal(db.rows.nexra_content_drafts[0].status, "drafting");
  });
});
