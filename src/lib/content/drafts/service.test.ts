import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun, JsonObject } from "../../../types/agent-run.ts";
import type { ContentDraftVersion, CreateDraftFromWriterInput, DraftWithCurrentVersion, SaveVersionInput } from "../../../types/content-draft.ts";
import type { ContentDraftStore } from "./contract.ts";
import { MAX_DRAFT_BODY_LENGTH, MAX_DRAFT_TITLE_LENGTH } from "./edit-rules.ts";
import { unavailableDraftStore } from "./contract.ts";
import { CRAWL_ID, OPERATOR_ID, PLAN_ID, WRITER_RUN_ID, writerRun } from "./test-support/fixtures.ts";
import { createDraftService } from "./service.ts";

/**
 * The service over an in-memory store and an in-memory run reader, recording
 * every call: what is written, when, and — for every refusal — that nothing
 * was.
 */

function memoryStore(options: { storesDrafts?: boolean; raceOnce?: boolean; raceOnSave?: boolean; failSave?: boolean } = {}) {
  const drafts: DraftWithCurrentVersion[] = [];
  /** Every version ever written, in write order. Nothing here is ever changed or removed. */
  const versions: ContentDraftVersion[] = [];
  const calls: string[] = [];
  let raced = options.raceOnce ?? false;
  let raceSave = options.raceOnSave ?? false;
  let failSave = options.failSave ?? false;
  function currentOf(entry: DraftWithCurrentVersion): ContentDraftVersion {
    return versions.find((version) => version.draftId === entry.draft.id && version.version === entry.draft.currentVersion) ?? entry.version;
  }
  function writeVersion(entry: DraftWithCurrentVersion, input: SaveVersionInput): ContentDraftVersion {
    const next = entry.draft.currentVersion + 1;
    const version: ContentDraftVersion = {
      id: `${entry.draft.id.slice(0, -2)}${String(next).padStart(2, "0")}`,
      draftId: entry.draft.id,
      version: next,
      origin: "operator",
      title: input.title,
      body: input.body,
      claims: [],
      placeholders: [],
      factCheck: null,
      createdBy: input.createdBy,
      createdAt: `2026-09-22T12:${String(next).padStart(2, "0")}:00.000Z`,
    };
    versions.push(version);
    const status = entry.draft.status === "fact-checked" || entry.draft.status === "approved" ? "drafting" : entry.draft.status;
    const draft = { ...entry.draft, currentVersion: next, status, updatedAt: version.createdAt };
    drafts[drafts.indexOf(entry)] = { draft, version };
    return version;
  }
  const store: ContentDraftStore = {
    storesDrafts: options.storesDrafts ?? true,
    async findByWriterRunId(projectId, writerRunId) {
      calls.push("find");
      return drafts.find((entry) => entry.draft.projectId === projectId && entry.draft.sourceWriterRunId === writerRunId) ?? null;
    },
    async getByProjectAndId(projectId, draftId) {
      calls.push("get");
      return drafts.find((entry) => entry.draft.projectId === projectId && entry.draft.id === draftId) ?? null;
    },
    async createFromWriterRun(input: CreateDraftFromWriterInput) {
      calls.push("create");
      if (raced) {
        // Another save wins the unique key between our find and our insert.
        raced = false;
        const winner = saved(input, "00000000-0000-4000-8000-00000000cafe");
        drafts.push(winner);
        versions.push(winner.version);
        return { status: "exists" };
      }
      if (drafts.some((entry) => entry.draft.sourceWriterRunId === input.sourceWriterRunId)) return { status: "exists" };
      const entry = saved(input, `00000000-0000-4000-8000-${String(drafts.length + 1).padStart(12, "0")}`);
      drafts.push(entry);
      versions.push(entry.version);
      return { status: "created", saved: entry };
    },
    async getCurrentVersion(draftId) {
      calls.push("version");
      const entry = drafts.find((candidate) => candidate.draft.id === draftId);
      return entry === undefined ? null : currentOf(entry);
    },
    async listVersions(draftId, limit) {
      calls.push("list");
      return versions
        .filter((version) => version.draftId === draftId)
        .sort((a, b) => b.version - a.version)
        .slice(0, limit);
    },
    async saveVersion(input) {
      calls.push("save");
      if (failSave) {
        failSave = false;
        throw new Error("store unavailable");
      }
      const entry = drafts.find((candidate) => candidate.draft.projectId === input.projectId && candidate.draft.id === input.draftId);
      if (entry === undefined) return { status: "not-found" };
      if (entry.draft.status === "archived") return { status: "archived" };
      if (raceSave) {
        // Another operator's save lands between the service's read and this write.
        raceSave = false;
        writeVersion(entry, { ...input, title: "Their title", body: "Their text.", createdBy: "00000000-0000-4000-8000-00000000000b" });
      }
      const current = drafts.find((candidate) => candidate.draft.id === input.draftId)!;
      if (current.draft.currentVersion !== input.expectedVersion) return { status: "stale", currentVersion: current.draft.currentVersion };
      writeVersion(current, input);
      return { status: "created", saved: drafts.find((candidate) => candidate.draft.id === input.draftId)! };
    },
    async getVersion(draftId, version) {
      calls.push("get-version");
      return versions.find((entry) => entry.draftId === draftId && entry.version === version) ?? null;
    },
    async recordFactCheck(input) {
      calls.push("record");
      const index = versions.findIndex((entry) => entry.draftId === input.draftId && entry.version === input.version);
      if (index === -1) return { status: "not-found" };
      if (versions[index].factCheck !== null) return { status: "already-checked", version: versions[index] };
      // Only fact_check changes: the row is otherwise the same object's fields.
      versions[index] = { ...versions[index], factCheck: input.factCheck as unknown as JsonObject };
      const entry = drafts.find((candidate) => candidate.draft.id === input.draftId);
      if (entry && entry.version.version === input.version) drafts[drafts.indexOf(entry)] = { ...entry, version: versions[index] };
      return { status: "recorded", version: versions[index] };
    },
    async markFactChecked(input) {
      calls.push("mark");
      const entry = drafts.find((candidate) => candidate.draft.projectId === input.projectId && candidate.draft.id === input.draftId);
      if (!entry || entry.draft.currentVersion !== input.version || entry.draft.status !== "drafting") return { status: "unchanged" };
      const draft = { ...entry.draft, status: "fact-checked" as const, updatedAt: "2026-09-22T13:00:00.000Z" };
      drafts[drafts.indexOf(entry)] = { ...entry, draft };
      return { status: "updated", draft };
    },
  };
  return { store, drafts, versions, calls };
}

function saved(input: CreateDraftFromWriterInput, id: string): DraftWithCurrentVersion {
  const version: ContentDraftVersion = {
    id: `${id.slice(0, -2)}01`,
    draftId: id,
    version: 1,
    origin: "writer",
    title: input.title,
    body: input.body,
    claims: input.claims,
    placeholders: input.placeholders,
    factCheck: null,
    createdBy: input.createdBy,
    createdAt: "2026-09-22T12:00:00.000Z",
  };
  return {
    draft: {
      id,
      projectId: input.projectId,
      sourceWriterRunId: input.sourceWriterRunId,
      sourcePlanRunId: input.sourcePlanRunId,
      sectionIndex: input.sectionIndex,
      sectionLabel: input.sectionLabel,
      status: "drafting",
      currentVersion: 1,
      approvedVersion: null,
      approvedBy: null,
      approvedAt: null,
      publishedVersion: null,
      publishedAt: null,
      remoteContentId: null,
      remoteTarget: null,
      createdBy: input.createdBy,
      createdAt: "2026-09-22T12:00:00.000Z",
      updatedAt: "2026-09-22T12:00:00.000Z",
    },
    version,
  };
}

function runReader(runs: readonly AgentRun[]) {
  let reads = 0;
  return {
    reads: () => reads,
    reader: {
      async getById(id: string) {
        reads += 1;
        return runs.find((run) => run.id === id) ?? null;
      },
    },
  };
}

const REQUEST = { projectId: "nexra-agency", writerRunId: WRITER_RUN_ID, operatorId: OPERATOR_ID };

describe("draftService.saveWriterRun", () => {
  test("creates one draft with version 1 from an eligible Writer run, carrying the run's provenance and the parsed text", async () => {
    const { store, drafts, calls } = memoryStore();
    const runs = runReader([writerRun()]);
    const result = await createDraftService({ store, runs: runs.reader }).saveWriterRun(REQUEST);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.created, true);
    assert.equal(drafts.length, 1);
    const { draft, version } = result.saved;
    assert.equal(draft.projectId, "nexra-agency");
    assert.equal(draft.sourceWriterRunId, WRITER_RUN_ID);
    assert.equal(draft.sourcePlanRunId, PLAN_ID);
    assert.equal(draft.sectionIndex, 1);
    assert.equal(draft.sectionLabel, "What automated lead follow-up does [crawl /]");
    assert.equal(draft.status, "drafting");
    assert.equal(draft.currentVersion, 1);
    assert.equal(draft.createdBy, OPERATOR_ID);
    assert.equal(version.version, 1);
    assert.equal(version.origin, "writer");
    assert.equal(version.title, draft.sectionLabel);
    assert.match(version.body, /^Nexra Agency's home page presents automated lead follow-up/);
    assert.equal(version.claims.length, 3);
    assert.deepEqual(version.placeholders, ["[NEEDS EVIDENCE: how quickly a lead is contacted]"]);
    assert.equal(version.factCheck, null);
    assert.deepEqual(result.saved.versions, [version], "a new draft's history is its version 1 alone");
    assert.deepEqual(calls, ["find", "create"]);
    assert.equal(runs.reads(), 1);
    // The crawl the draft rests on is in the run's metadata, not re-read.
    assert.equal(CRAWL_ID, "8f1c0d2e-0000-4000-8000-000000000001");
  });

  test("saving the same run twice returns the existing draft: no second parent, no version 2, and the run is not re-read", async () => {
    const { store, drafts, calls } = memoryStore();
    const runs = runReader([writerRun()]);
    const service = createDraftService({ store, runs: runs.reader });
    const first = await service.saveWriterRun(REQUEST);
    const second = await service.saveWriterRun({ ...REQUEST, writerRunId: WRITER_RUN_ID.toUpperCase() });
    assert.ok(first.ok && second.ok);
    if (!first.ok || !second.ok) return;
    assert.equal(second.created, false);
    assert.equal(second.saved.draft.id, first.saved.draft.id);
    assert.equal(second.saved.version.version, 1);
    assert.deepEqual(second.saved.versions.map((version) => version.version), [1]);
    assert.equal(drafts.length, 1);
    assert.deepEqual(calls, ["find", "create", "find", "list"]);
    assert.equal(runs.reads(), 1);
  });

  test("a concurrent save that loses the unique key re-reads the winner and reports created: false", async () => {
    const { store, drafts } = memoryStore({ raceOnce: true });
    const result = await createDraftService({ store, runs: runReader([writerRun()]).reader }).saveWriterRun(REQUEST);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.created, false);
    assert.equal(result.saved.draft.id, "00000000-0000-4000-8000-00000000cafe");
    assert.equal(result.saved.versions.length, 1);
    assert.equal(drafts.length, 1);
  });

  test("is refused before any write for a run of another project, another agent, another task, an unfinished, failed, simulated, ungrounded or empty run, or missing provenance", async () => {
    const cases: [Partial<AgentRun>, string, string][] = [
      [{ projectId: "halcyon-fintech" }, "nexra-agency", "run-not-in-project"],
      [{ agentId: "content-strategist" }, "nexra-agency", "wrong-agent"],
      [{ taskType: "content-plan-review", input: {} }, "nexra-agency", "wrong-task"],
      [{ status: "queued", resultSummary: null, resultMetadata: null, executor: null }, "nexra-agency", "run-unfinished"],
      [{ status: "running" }, "nexra-agency", "run-unfinished"],
      [{ status: "failed" }, "nexra-agency", "run-not-completed"],
      [{ status: "cancelled" }, "nexra-agency", "run-not-completed"],
      [{ resultSummary: "" }, "nexra-agency", "run-no-result"],
      [{ executor: "mock", resultMetadata: { simulated: true, grounded: false } }, "nexra-agency", "run-simulated"],
      [{ resultMetadata: { simulated: false, grounded: false } }, "nexra-agency", "run-not-grounded"],
      [{ resultMetadata: { simulated: false, grounded: true } }, "nexra-agency", "provenance-missing"],
      [{ resultSummary: "not the Writer's contract" }, "nexra-agency", "output-malformed"],
    ];
    for (const [overrides, projectId, refusal] of cases) {
      const { store, drafts, calls } = memoryStore();
      const result = await createDraftService({ store, runs: runReader([writerRun(overrides)]).reader }).saveWriterRun({ ...REQUEST, projectId });
      assert.equal(result.ok, false, refusal);
      assert.equal(result.ok ? null : result.reason, "ineligible", refusal);
      assert.equal(result.ok || result.reason !== "ineligible" ? null : result.refusal, refusal);
      assert.equal(drafts.length, 0, `${refusal}: something was written`);
      assert.deepEqual(calls, ["find"], refusal);
    }
  });

  test("a run that does not exist is not found, and an id of the wrong shape is refused before anything is read", async () => {
    const { store, calls } = memoryStore();
    const runs = runReader([]);
    const service = createDraftService({ store, runs: runs.reader });
    assert.deepEqual(await service.saveWriterRun(REQUEST), { ok: false, reason: "not-found" });
    assert.equal(runs.reads(), 1);
    for (const request of [
      { ...REQUEST, projectId: "Nexra Agency" },
      { ...REQUEST, projectId: "" },
      { ...REQUEST, writerRunId: "not-a-uuid" },
      { ...REQUEST, operatorId: "operator" },
    ]) {
      assert.deepEqual(await service.saveWriterRun(request), { ok: false, reason: "invalid" }, JSON.stringify(request));
    }
    assert.equal(runs.reads(), 1);
    assert.deepEqual(calls, ["find"]);
  });

  test("with no draft store, nothing is written and the answer says so", async () => {
    const runs = runReader([writerRun()]);
    const result = await createDraftService({ store: unavailableDraftStore, runs: runs.reader }).saveWriterRun(REQUEST);
    assert.deepEqual(result, { ok: false, reason: "unavailable" });
    assert.equal(runs.reads(), 0);
  });

  test("the service has no provider, crawler or publisher to call: its only dependencies are the store and the run reader", () => {
    const service = createDraftService({ store: memoryStore().store, runs: runReader([]).reader });
    assert.deepEqual(Object.keys(service).sort(), ["findForWriterRun", "getHistory", "recordFactCheck", "saveVersion", "saveWriterRun"]);
  });
});

describe("draftService.findForWriterRun", () => {
  test("restores the saved draft by project and run, and nothing across projects", async () => {
    const { store } = memoryStore();
    const service = createDraftService({ store, runs: runReader([writerRun()]).reader });
    assert.deepEqual(await service.findForWriterRun("nexra-agency", WRITER_RUN_ID), { ok: true, saved: null });
    await service.saveWriterRun(REQUEST);
    const found = await service.findForWriterRun("nexra-agency", WRITER_RUN_ID.toUpperCase());
    assert.ok(found.ok && found.saved !== null && found.saved.version.version === 1);
    assert.deepEqual(found.saved.versions, [found.saved.version]);
    assert.deepEqual(await service.findForWriterRun("halcyon-fintech", WRITER_RUN_ID), { ok: true, saved: null });
    assert.deepEqual(await service.findForWriterRun("nexra-agency", "nope"), { ok: false, reason: "invalid" });
    assert.deepEqual(await createDraftService({ store: unavailableDraftStore, runs: runReader([]).reader }).findForWriterRun("nexra-agency", WRITER_RUN_ID), { ok: false, reason: "unavailable" });
  });
});

/**
 * Stage 2: an operator's edit becomes the next immutable version. These
 * tests read the store's own version log after every save to show that no
 * earlier version was changed, and that a refused save wrote nothing.
 */

const EDITOR = "00000000-0000-4000-8000-00000000000c";

async function seeded(options: Parameters<typeof memoryStore>[0] = {}) {
  const memory = memoryStore(options);
  const service = createDraftService({ store: memory.store, runs: runReader([writerRun()]).reader });
  const created = await service.saveWriterRun(REQUEST);
  assert.ok(created.ok && created.created);
  if (!created.ok) throw new Error("unreachable");
  memory.calls.length = 0;
  return { ...memory, service, original: created.saved };
}

function edit(draftId: string, expectedVersion: number, text: { title?: string; body?: string } = {}) {
  return {
    projectId: "nexra-agency",
    draftId,
    expectedVersion,
    title: text.title ?? "What automated lead follow-up does",
    body: text.body ?? "An operator rewrote this section by hand.",
    operatorId: EDITOR,
  };
}

describe("draftService.saveVersion", () => {
  test("the first edit becomes version 2 and the second version 3; every earlier version keeps its exact text and version 1 stays the Writer's original", async () => {
    const { service, versions, original } = await seeded();
    const draftId = original.draft.id;
    const v1 = { ...original.version };

    const second = await service.saveVersion(edit(draftId, 1, { body: "Second text." }));
    assert.ok(second.ok && second.created);
    if (!second.ok) return;
    assert.equal(second.saved.draft.currentVersion, 2);
    assert.equal(second.saved.version.version, 2);
    assert.equal(second.saved.version.origin, "operator");
    assert.equal(second.saved.version.body, "Second text.");
    assert.equal(second.saved.version.createdBy, EDITOR);
    assert.deepEqual(second.saved.versions.map((version) => version.version), [1, 2]);

    const third = await service.saveVersion(edit(draftId, 2, { body: "Third text." }));
    assert.ok(third.ok && third.created);
    if (!third.ok) return;
    assert.equal(third.saved.draft.currentVersion, 3);
    assert.equal(third.saved.version.version, 3);
    assert.deepEqual(third.saved.versions.map((version) => [version.version, version.origin, version.body]), [
      [1, "writer", v1.body],
      [2, "operator", "Second text."],
      [3, "operator", "Third text."],
    ]);

    // The store's own log: three rows, version 1 byte-for-byte the original,
    // and the parent's draft id shared by all of them.
    assert.equal(versions.length, 3);
    assert.deepEqual(versions[0], v1);
    assert.deepEqual(versions[0].claims, original.version.claims);
    assert.deepEqual(versions[0].placeholders, original.version.placeholders);
    assert.ok(versions.every((version) => version.draftId === draftId));
    // The parent's other fields are untouched by editing.
    assert.equal(third.saved.draft.status, "drafting");
    assert.equal(third.saved.draft.approvedVersion, null);
    assert.equal(third.saved.draft.publishedVersion, null);
    assert.equal(third.saved.draft.sourceWriterRunId, WRITER_RUN_ID);
    assert.equal(third.saved.draft.createdBy, OPERATOR_ID);
  });

  test("an edited version inherits no claims, placeholders or fact-check from version 1, and the title can change too", async () => {
    const { service, original } = await seeded();
    assert.equal(original.version.claims.length, 3);
    const result = await service.saveVersion(edit(original.draft.id, 1, { title: "A new title", body: "New body." }));
    assert.ok(result.ok && result.created);
    if (!result.ok) return;
    assert.deepEqual(result.saved.version.claims, []);
    assert.deepEqual(result.saved.version.placeholders, []);
    assert.equal(result.saved.version.factCheck, null);
    assert.equal(result.saved.version.title, "A new title");
    // And version 1 in the same history still carries the Writer's.
    assert.equal(result.saved.versions[0].claims.length, 3);
    assert.deepEqual(result.saved.versions[0].placeholders, ["[NEEDS EVIDENCE: how quickly a lead is contacted]"]);
  });

  test("a save from a version that is no longer current is refused as stale, names the current version, and writes nothing", async () => {
    const { service, versions, calls, original } = await seeded();
    const draftId = original.draft.id;
    assert.ok((await service.saveVersion(edit(draftId, 1, { body: "Second text." }))).ok);
    calls.length = 0;
    const stale = await service.saveVersion(edit(draftId, 1, { body: "Based on version 1, which is gone." }));
    assert.deepEqual(stale, { ok: false, reason: "stale", currentVersion: 2 });
    assert.equal(versions.length, 2);
    assert.deepEqual(calls, ["get"], "a stale save never reaches the store's write");
    // The version the stale edit would have overtaken is intact.
    assert.equal(versions[1].body, "Second text.");
  });

  test("two operators saving from the same version: the first wins, the second is refused as stale by the store, and the texts are never combined", async () => {
    const { service, versions, calls, original } = await seeded({ raceOnSave: true });
    const draftId = original.draft.id;
    const result = await service.saveVersion(edit(draftId, 1, { body: "Our text." }));
    assert.deepEqual(result, { ok: false, reason: "stale", currentVersion: 2 });
    assert.deepEqual(calls, ["get", "save"]);
    assert.equal(versions.length, 2);
    assert.equal(versions[1].body, "Their text.");
    assert.ok(!versions.some((version) => version.body.includes("Our text.")));
    // Reloading shows the winner as current; saving from it then succeeds.
    const history = await service.getHistory("nexra-agency", draftId);
    assert.ok(history.ok && history.saved?.draft.currentVersion === 2);
    const retry = await service.saveVersion(edit(draftId, 2, { body: "Our text, over theirs." }));
    assert.ok(retry.ok && retry.created && retry.saved.draft.currentVersion === 3);
  });

  test("a store failure during the save leaves the previous version current and writes nothing", async () => {
    const { service, versions, drafts, original } = await seeded({ failSave: true });
    await assert.rejects(() => service.saveVersion(edit(original.draft.id, 1)), /store unavailable/);
    assert.equal(versions.length, 1);
    assert.equal(drafts[0].draft.currentVersion, 1);
    // The next attempt from the same version succeeds: nothing was half-written.
    const retry = await service.saveVersion(edit(original.draft.id, 1));
    assert.ok(retry.ok && retry.created && retry.saved.draft.currentVersion === 2);
  });

  test("an unchanged edit creates no version and answers with the current history", async () => {
    const { service, versions, calls, original } = await seeded();
    const same = await service.saveVersion(
      edit(original.draft.id, 1, { title: `  ${original.version.title}\r\n`, body: `${original.version.body.replace(/\n/g, "\r\n")}\n\n` }),
    );
    assert.ok(same.ok);
    if (!same.ok) return;
    assert.equal(same.created, false);
    assert.equal(same.saved.draft.currentVersion, 1);
    assert.deepEqual(same.saved.versions.map((version) => version.version), [1]);
    assert.equal(versions.length, 1);
    assert.deepEqual(calls, ["get", "list"]);
  });

  test("empty and oversized text is refused before anything is read", async () => {
    const { service, versions, calls, original } = await seeded();
    const cases: [{ title?: string; body?: string }, { reason: string; field: string }][] = [
      [{ body: "" }, { reason: "empty", field: "body" }],
      [{ body: "   \n\r\n " }, { reason: "empty", field: "body" }],
      [{ title: "" }, { reason: "empty", field: "title" }],
      [{ body: "x".repeat(MAX_DRAFT_BODY_LENGTH + 1) }, { reason: "too-long", field: "body" }],
      [{ title: "t".repeat(MAX_DRAFT_TITLE_LENGTH + 1) }, { reason: "too-long", field: "title" }],
    ];
    for (const [text, refusal] of cases) {
      const result = await service.saveVersion(edit(original.draft.id, 1, text));
      assert.deepEqual(result, { ok: false, reason: "text", refusal }, JSON.stringify(refusal));
    }
    // Exactly at the bounds is accepted.
    const atBound = await service.saveVersion(edit(original.draft.id, 1, { title: "t".repeat(MAX_DRAFT_TITLE_LENGTH), body: "x".repeat(MAX_DRAFT_BODY_LENGTH) }));
    assert.ok(atBound.ok && atBound.created);
    assert.equal(versions.length, 2);
    assert.deepEqual(calls, ["get", "save", "list"], "the refused edits read nothing");
  });

  test("an invalid operator id, draft id, project id or expected version is refused before anything is read", async () => {
    const { service, versions, calls, original } = await seeded();
    const base = edit(original.draft.id, 1);
    for (const request of [
      { ...base, operatorId: "operator" },
      { ...base, operatorId: "" },
      { ...base, draftId: "not-a-uuid" },
      { ...base, projectId: "Nexra Agency" },
      { ...base, expectedVersion: 0 },
      { ...base, expectedVersion: 1.5 },
      { ...base, expectedVersion: Number.NaN },
    ]) {
      assert.deepEqual(await service.saveVersion(request), { ok: false, reason: "invalid" }, JSON.stringify(request));
    }
    assert.deepEqual(calls, []);
    assert.equal(versions.length, 1);
  });

  test("a draft is not reachable through another project, and a draft that does not exist is not found", async () => {
    const { service, versions, original } = await seeded();
    assert.deepEqual(await service.saveVersion({ ...edit(original.draft.id, 1), projectId: "halcyon-fintech" }), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.saveVersion(edit("00000000-0000-4000-8000-000000000999", 1)), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.getHistory("halcyon-fintech", original.draft.id), { ok: true, saved: null });
    assert.equal(versions.length, 1);
  });

  test("an archived draft is not edited", async () => {
    const { service, drafts, versions, original } = await seeded();
    drafts[0] = { ...drafts[0], draft: { ...drafts[0].draft, status: "archived" } };
    assert.deepEqual(await service.saveVersion(edit(original.draft.id, 1)), { ok: false, reason: "archived" });
    assert.equal(versions.length, 1);
  });

  test("editing a fact-checked or approved draft returns it to drafting and keeps the approval record intact, without approving anything", async () => {
    const { service, drafts, versions, original } = await seeded();
    drafts[0] = {
      ...drafts[0],
      draft: { ...drafts[0].draft, status: "approved", approvedVersion: 1, approvedBy: OPERATOR_ID, approvedAt: "2026-09-22T12:05:00.000Z" },
    };
    const result = await service.saveVersion(edit(original.draft.id, 1));
    assert.ok(result.ok && result.created);
    if (!result.ok) return;
    assert.equal(result.saved.draft.status, "drafting");
    assert.equal(result.saved.draft.approvedVersion, 1, "the record of what was approved is kept");
    assert.equal(result.saved.draft.approvedBy, OPERATOR_ID);
    assert.equal(result.saved.draft.publishedVersion, null);
    assert.equal(versions.length, 2);
    assert.equal(versions[0].version, 1);
  });

  test("with no draft store, nothing is written and the answer says so", async () => {
    const service = createDraftService({ store: unavailableDraftStore, runs: runReader([]).reader });
    assert.deepEqual(await service.saveVersion(edit("00000000-0000-4000-8000-000000000001", 1)), { ok: false, reason: "unavailable" });
    assert.deepEqual(await service.getHistory("nexra-agency", "00000000-0000-4000-8000-000000000001"), { ok: false, reason: "unavailable" });
  });
});

describe("draftService.getHistory", () => {
  test("restores the draft with every version in ascending order and the current version last, and reading creates nothing", async () => {
    const { service, versions, calls, original } = await seeded();
    const draftId = original.draft.id;
    await service.saveVersion(edit(draftId, 1, { body: "Second text." }));
    await service.saveVersion(edit(draftId, 2, { body: "Third text." }));
    calls.length = 0;
    const history = await service.getHistory("nexra-agency", draftId.toUpperCase());
    assert.ok(history.ok && history.saved !== null);
    if (!history.ok || history.saved === null) return;
    assert.equal(history.saved.draft.currentVersion, 3);
    assert.equal(history.saved.version.version, 3);
    assert.deepEqual(history.saved.versions.map((version) => version.version), [1, 2, 3]);
    assert.deepEqual(history.saved.versions[0], versions[0]);
    assert.equal(history.saved.versions[0].origin, "writer");
    assert.deepEqual(history.saved.versions.at(-1), history.saved.version);
    assert.deepEqual(calls, ["get", "list"]);
    assert.equal(versions.length, 3);
    // The Writer-run lookup sees the same history.
    const byRun = await service.findForWriterRun("nexra-agency", WRITER_RUN_ID);
    assert.ok(byRun.ok && byRun.saved !== null);
    if (!byRun.ok || byRun.saved === null) return;
    assert.deepEqual(byRun.saved, history.saved);
    assert.deepEqual(await service.getHistory("nexra-agency", "nope"), { ok: false, reason: "invalid" });
  });

  test("saving the Writer run again after edits still creates nothing and returns the full history, not version 1 as current", async () => {
    const { service, versions, original } = await seeded();
    await service.saveVersion(edit(original.draft.id, 1, { body: "Second text." }));
    const again = await service.saveWriterRun(REQUEST);
    assert.ok(again.ok);
    if (!again.ok) return;
    assert.equal(again.created, false);
    assert.equal(again.saved.draft.currentVersion, 2);
    assert.equal(again.saved.version.version, 2);
    assert.deepEqual(again.saved.versions.map((version) => version.version), [1, 2]);
    assert.equal(versions.length, 2);
  });
});

/**
 * Stage 3: one completed Research & Evidence check recorded on the exact
 * version it checked. These tests read the store's own version log after
 * every recording to show that only that version's fact_check changed, that
 * no text moved, and that the parent's status moved only when the checked
 * version was still current and the check passed.
 */

const CHECK_RUN_ID = "11111111-0000-4000-8000-000000000080";

const CHECK_OUTPUT = [
  "SUPPORTED",
  '- "Nexra Agency\'s home page presents automated lead follow-up" [crawl /]',
  "PARTIAL",
  "none",
  "UNSUPPORTED",
  "none",
  "UNVERIFIABLE",
  "none",
  "EDITORIAL",
  "none",
  "SUMMARY",
  "One sentence: one supported; none partial, unsupported, unverifiable or editorial; none unchecked.",
  "This check compares the text with the records this product holds; it approves nothing and publishes nothing.",
].join("\n");

function factCheckRun(target: { draftId: string; version: number }, overrides: Partial<AgentRun> = {}, summary = CHECK_OUTPUT): AgentRun {
  return {
    ...writerRun(),
    id: CHECK_RUN_ID,
    agentId: "research-evidence",
    taskType: "draft-fact-check",
    input: { draftId: target.draftId, version: target.version },
    resultSummary: summary,
    resultMetadata: {
      simulated: false,
      grounded: true,
      taskType: "draft-fact-check",
      evidence: {
        source: "draft-version",
        projectId: "nexra-agency",
        projectHost: "nexraagency.com",
        draftId: target.draftId,
        version: target.version,
        versionOrigin: "operator",
        wasCurrent: true,
        crawlId: CRAWL_ID,
        searchWindow: "2026-08-19 to 2026-09-17",
        recordPaths: ["/", "/services"],
        textTruncated: false,
      },
      provider: "anthropic",
      model: "test-model",
    },
    finishedAt: "2026-09-22T14:00:00.000Z",
    ...overrides,
  };
}

/** A draft with version 1 (the Writer's) and version 2 (an edit), version 2 current, and a completed check run bound to version 2. */
async function checkable(options: { runs?: readonly AgentRun[] } = {}) {
  const memory = memoryStore();
  const runList: AgentRun[] = [writerRun()];
  const service = createDraftService({
    store: memory.store,
    runs: { async getById(id) { return runList.find((run) => run.id === id) ?? null; } },
  });
  const created = await service.saveWriterRun(REQUEST);
  assert.ok(created.ok);
  if (!created.ok) throw new Error("unreachable");
  const draftId = created.saved.draft.id;
  const edited = await service.saveVersion(edit(draftId, 1, { body: "Nexra Agency's home page presents automated lead follow-up. Clients love it." }));
  assert.ok(edited.ok && edited.created);
  runList.push(...(options.runs ?? [factCheckRun({ draftId, version: 2 })]));
  memory.calls.length = 0;
  const before = JSON.parse(JSON.stringify(memory.versions)) as ContentDraftVersion[];
  return { ...memory, service, draftId, runList, before };
}

const record = (draftId: string, version: number, runId = CHECK_RUN_ID, projectId = "nexra-agency") => ({
  projectId,
  draftId,
  version,
  runId,
  operatorId: OPERATOR_ID,
});

/** Every field of every version with fact_check blanked, for comparing before and after. */
function textOf(versions: readonly ContentDraftVersion[]) {
  return versions.map((version) => ({ ...version, factCheck: null }));
}

describe("draftService.recordFactCheck", () => {
  test("records the check on version 2 only: version 1 stays untouched, no text changes, no version is created, and only fact_check was written", async () => {
    const { service, versions, drafts, calls, draftId, before } = await checkable();
    const result = await service.recordFactCheck(record(draftId, 2));
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.recorded, true);
    assert.equal(result.factCheck.version, 2);
    assert.equal(result.factCheck.draftId, draftId);
    assert.equal(result.factCheck.checkedByRunId, CHECK_RUN_ID);
    assert.equal(result.factCheck.checkedAt, "2026-09-22T14:00:00.000Z");
    assert.equal(result.factCheck.recordedBy, OPERATOR_ID);
    assert.equal(result.factCheck.status, "passed");
    assert.deepEqual(result.factCheck.supported, [{ text: "Nexra Agency's home page presents automated lead follow-up", evidence: "crawl /", note: null }]);
    assert.equal(result.saved.version.version, 2);
    assert.deepEqual(result.saved.version.factCheck, result.factCheck);
    // The store's log: two versions, the same texts, version 1's fact_check still null.
    assert.equal(versions.length, 2);
    assert.deepEqual(textOf(versions), textOf(before));
    assert.equal(versions[0].version, 1);
    assert.equal(versions[0].factCheck, null);
    assert.deepEqual(versions[1].factCheck, result.factCheck);
    assert.deepEqual(calls, ["get", "get-version", "record", "mark", "get", "list"]);
    assert.ok(!calls.includes("save") && !calls.includes("create"), "a version was created by a fact-check");
    // The parent moved to fact-checked because the passed version was still current; nothing else moved.
    assert.equal(result.draftStatusAdvanced, true);
    assert.equal(drafts[0].draft.status, "fact-checked");
    assert.equal(drafts[0].draft.currentVersion, 2);
    assert.equal(drafts[0].draft.approvedVersion, null);
    assert.equal(drafts[0].draft.approvedBy, null);
    assert.equal(drafts[0].draft.publishedVersion, null);
    assert.equal(drafts[0].draft.remoteContentId, null);
    assert.deepEqual(result.saved.versions.map((version) => [version.version, version.factCheck === null]), [[1, true], [2, false]]);
  });

  test("a supported claim with a record in the evidence is supported; a missing or unknown record is unverifiable, partial support is kept apart, and editorial text is no claim", async () => {
    const output = [
      "SUPPORTED",
      '- "The home page presents automated lead follow-up" [crawl /]',
      '- "The about page names the founders" [crawl /about]',
      '- "The home page has one h1"',
      "PARTIAL",
      '- "The home page declares Organization and Service schema" — Organization is recorded [crawl /]',
      "UNSUPPORTED",
      "none",
      "UNVERIFIABLE",
      '- "Clients love it" — a client result the records cannot hold',
      "EDITORIAL",
      '- "Get in touch today"',
      "SUMMARY",
      "Six sentences placed; none unchecked.",
    ].join("\n");
    const { service, draftId, runList } = await checkable({ runs: [] });
    runList.push(factCheckRun({ draftId, version: 2 }, {}, output));
    const result = await service.recordFactCheck(record(draftId, 2));
    assert.ok(result.ok);
    if (!result.ok) return;
    const check = result.factCheck;
    assert.deepEqual(check.supported.map((item) => [item.text, item.evidence]), [["The home page presents automated lead follow-up", "crawl /"]]);
    assert.deepEqual(check.partial.map((item) => [item.text, item.evidence, item.note]), [["The home page declares Organization and Service schema", "crawl /", "Organization is recorded"]]);
    assert.deepEqual(check.unverifiable.map((item) => item.text), ["Clients love it", "The about page names the founders", "The home page has one h1"]);
    assert.deepEqual(check.unsupported, []);
    assert.deepEqual(check.editorial.map((item) => item.text), ["Get in touch today"]);
    assert.equal(check.status, "needs-review");
    assert.equal(result.draftStatusAdvanced, false, "a needs-review check moved the parent");
    assert.equal(result.saved.draft.status, "drafting");
  });

  test("a statement no record holds is recorded as unsupported in the check's own words, the check fails, and nothing is invented or approved", async () => {
    const output = CHECK_OUTPUT.replace("UNSUPPORTED\nnone", 'UNSUPPORTED\n- "The agency has fifty clients" — no record holds this');
    const { service, draftId, runList, drafts } = await checkable({ runs: [] });
    runList.push(factCheckRun({ draftId, version: 2 }, {}, output));
    const result = await service.recordFactCheck(record(draftId, 2));
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.factCheck.status, "failed");
    assert.deepEqual(result.factCheck.unsupported, [{ text: "The agency has fifty clients", evidence: null, note: "no record holds this" }]);
    assert.doesNotMatch(JSON.stringify(result.factCheck), /false|untrue/i);
    assert.equal(result.draftStatusAdvanced, false);
    assert.equal(drafts[0].draft.status, "drafting");
    assert.equal(drafts[0].draft.approvedVersion, null);
  });

  test("recording the same run twice writes once; a different run for the same version is refused because a version is checked once", async () => {
    const { service, versions, calls, draftId, runList } = await checkable();
    const first = await service.recordFactCheck(record(draftId, 2));
    assert.ok(first.ok && first.recorded);
    calls.length = 0;
    const again = await service.recordFactCheck(record(draftId, 2));
    assert.ok(again.ok);
    if (!again.ok) return;
    assert.equal(again.recorded, false);
    assert.deepEqual(again.factCheck, first.ok ? first.factCheck : null);
    assert.deepEqual(calls, ["get", "get-version", "list"], "a second recording reached the store's write");
    const other = "11111111-0000-4000-8000-000000000081";
    runList.push(factCheckRun({ draftId, version: 2 }, { id: other }));
    assert.deepEqual(await service.recordFactCheck(record(draftId, 2, other)), { ok: false, reason: "already-checked" });
    assert.equal(versions[1].factCheck !== null && (versions[1].factCheck as { checkedByRunId?: unknown }).checkedByRunId, CHECK_RUN_ID);
  });

  test("the check is bound to its version: a run that checked version 2 cannot be recorded on version 1 or version 3, and a draft of another project is not found", async () => {
    const { service, versions, calls, draftId } = await checkable();
    assert.deepEqual(await service.recordFactCheck(record(draftId, 1)), { ok: false, reason: "ineligible", refusal: "version-mismatch" });
    assert.deepEqual(await service.recordFactCheck(record(draftId, 3)), { ok: false, reason: "version-not-found" });
    assert.deepEqual(await service.recordFactCheck(record(draftId, 2, CHECK_RUN_ID, "halcyon-fintech")), { ok: false, reason: "not-found" });
    assert.deepEqual(await service.recordFactCheck(record("00000000-0000-4000-8000-000000000999", 2)), { ok: false, reason: "not-found" });
    assert.ok(versions.every((version) => version.factCheck === null));
    assert.ok(!calls.includes("record") && !calls.includes("mark"));
  });

  test("when version 3 becomes current before version 2's check is recorded, version 2 keeps its result and the parent's status is not advanced", async () => {
    const { service, versions, drafts, draftId } = await checkable();
    const third = await service.saveVersion(edit(draftId, 2, { body: "Third text, written while the check ran." }));
    assert.ok(third.ok && third.created && third.saved.draft.currentVersion === 3);
    const result = await service.recordFactCheck(record(draftId, 2));
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.recorded, true);
    assert.equal(result.factCheck.version, 2);
    assert.equal(result.factCheck.status, "passed");
    assert.equal(result.draftStatusAdvanced, false, "the parent advanced on a check of a version that is no longer current");
    assert.equal(drafts[0].draft.status, "drafting");
    assert.equal(drafts[0].draft.currentVersion, 3);
    assert.deepEqual(versions.map((version) => [version.version, version.factCheck === null]), [[1, true], [2, false], [3, true]]);
    // The historical version keeps its result, readable through the history.
    const history = await service.getHistory("nexra-agency", draftId);
    assert.ok(history.ok && history.saved !== null);
    if (!history.ok || history.saved === null) return;
    assert.deepEqual(history.saved.versions[1].factCheck, result.factCheck);
    assert.equal(history.saved.versions[2].factCheck, null);
  });

  test("an edit after a passed check returns the parent to drafting, and the new version carries no fact-check of its own", async () => {
    const { service, drafts, versions, draftId } = await checkable();
    const checked = await service.recordFactCheck(record(draftId, 2));
    assert.ok(checked.ok && checked.draftStatusAdvanced);
    assert.equal(drafts[0].draft.status, "fact-checked");
    const next = await service.saveVersion(edit(draftId, 2, { body: "Edited after the check." }));
    assert.ok(next.ok && next.created);
    if (!next.ok) return;
    assert.equal(next.saved.draft.status, "drafting");
    assert.equal(next.saved.version.factCheck, null);
    assert.deepEqual(versions[1].factCheck, checked.ok ? checked.factCheck : null, "version 2's result was lost");
  });

  test("a run that is another project's, another agent's, another task, unfinished, failed, simulated, ungrounded, without provenance, or malformed is refused before any write", async () => {
    const cases: [Partial<AgentRun>, string][] = [
      [{ projectId: "halcyon-fintech" }, "run-not-in-project"],
      [{ agentId: "writer" }, "wrong-agent"],
      [{ taskType: "evidence-pack-review", input: {} }, "wrong-task"],
      [{ status: "running" }, "run-unfinished"],
      [{ status: "failed" }, "run-not-completed"],
      [{ resultSummary: "" }, "run-no-result"],
      [{ executor: "mock", resultMetadata: { simulated: true, grounded: false } }, "run-simulated"],
      [{ resultMetadata: { simulated: false, grounded: false } }, "run-not-grounded"],
      [{ resultMetadata: { simulated: false, grounded: true } }, "provenance-missing"],
      [{ resultMetadata: { simulated: false, grounded: true, evidence: { source: "content-draft", planRunId: PLAN_ID, crawlId: CRAWL_ID } } }, "provenance-missing"],
      [{ resultSummary: "Simulated draft fact-check. Nothing was checked." }, "output-malformed"],
    ];
    for (const [overrides, refusal] of cases) {
      const { service, versions, calls, draftId, runList } = await checkable({ runs: [] });
      runList.push(factCheckRun({ draftId, version: 2 }, overrides));
      const result = await service.recordFactCheck(record(draftId, 2));
      assert.equal(result.ok, false, refusal);
      assert.equal(result.ok ? null : result.reason, "ineligible", refusal);
      assert.equal(result.ok || result.reason !== "ineligible" ? null : result.refusal, refusal);
      assert.ok(versions.every((version) => version.factCheck === null), `${refusal}: something was written`);
      assert.ok(!calls.includes("record") && !calls.includes("mark"), refusal);
    }
    const { service, draftId } = await checkable({ runs: [] });
    assert.deepEqual(await service.recordFactCheck(record(draftId, 2)), { ok: false, reason: "run-not-found" });
  });

  test("an invalid id or version is refused before anything is read, and with no draft store nothing is written", async () => {
    const { service, calls, draftId } = await checkable();
    const base = record(draftId, 2);
    for (const request of [
      { ...base, operatorId: "operator" },
      { ...base, runId: "not-a-uuid" },
      { ...base, draftId: "nope" },
      { ...base, projectId: "Nexra Agency" },
      { ...base, version: 0 },
      { ...base, version: 1.5 },
    ]) {
      assert.deepEqual(await service.recordFactCheck(request), { ok: false, reason: "invalid" }, JSON.stringify(request));
    }
    assert.deepEqual(calls, []);
    const unavailable = createDraftService({ store: unavailableDraftStore, runs: runReader([]).reader });
    assert.deepEqual(await unavailable.recordFactCheck(record("00000000-0000-4000-8000-000000000001", 1)), { ok: false, reason: "unavailable" });
  });
});
