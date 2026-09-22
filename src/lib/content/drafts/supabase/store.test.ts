import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CreateDraftFromWriterInput } from "../../../../types/content-draft.ts";
import { FakeDraftSupabase, asDraftClient, postgrestError } from "./fake-client.ts";
import { ContentDraftRowError, versionRowToVersion, draftRowToDraft } from "./schema.ts";
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
