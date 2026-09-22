import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun } from "../../../types/agent-run.ts";
import type { ContentDraftVersion, CreateDraftFromWriterInput, DraftWithCurrentVersion } from "../../../types/content-draft.ts";
import type { ContentDraftStore } from "./contract.ts";
import { unavailableDraftStore } from "./contract.ts";
import { CRAWL_ID, OPERATOR_ID, PLAN_ID, WRITER_RUN_ID, writerRun } from "./test-support/fixtures.ts";
import { createDraftService } from "./service.ts";

/**
 * The service over an in-memory store and an in-memory run reader, recording
 * every call: what is written, when, and — for every refusal — that nothing
 * was.
 */

function memoryStore(options: { storesDrafts?: boolean; raceOnce?: boolean } = {}) {
  const drafts: DraftWithCurrentVersion[] = [];
  const calls: string[] = [];
  let raced = options.raceOnce ?? false;
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
        drafts.push(saved(input, "00000000-0000-4000-8000-00000000cafe"));
        return { status: "exists" };
      }
      if (drafts.some((entry) => entry.draft.sourceWriterRunId === input.sourceWriterRunId)) return { status: "exists" };
      const entry = saved(input, `00000000-0000-4000-8000-${String(drafts.length + 1).padStart(12, "0")}`);
      drafts.push(entry);
      return { status: "created", saved: entry };
    },
    async getCurrentVersion(draftId) {
      calls.push("version");
      return drafts.find((entry) => entry.draft.id === draftId)?.version ?? null;
    },
  };
  return { store, drafts, calls };
}

function saved(input: CreateDraftFromWriterInput, id: string): DraftWithCurrentVersion {
  const version: ContentDraftVersion = {
    id: `${id.slice(0, -1)}f`,
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
    assert.equal(drafts.length, 1);
    assert.deepEqual(calls, ["find", "create", "find"]);
    assert.equal(runs.reads(), 1);
  });

  test("a concurrent save that loses the unique key re-reads the winner and reports created: false", async () => {
    const { store, drafts } = memoryStore({ raceOnce: true });
    const result = await createDraftService({ store, runs: runReader([writerRun()]).reader }).saveWriterRun(REQUEST);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.created, false);
    assert.equal(result.saved.draft.id, "00000000-0000-4000-8000-00000000cafe");
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
    assert.deepEqual(Object.keys(service).sort(), ["findForWriterRun", "saveWriterRun"]);
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
    assert.deepEqual(await service.findForWriterRun("halcyon-fintech", WRITER_RUN_ID), { ok: true, saved: null });
    assert.deepEqual(await service.findForWriterRun("nexra-agency", "nope"), { ok: false, reason: "invalid" });
    assert.deepEqual(await createDraftService({ store: unavailableDraftStore, runs: runReader([]).reader }).findForWriterRun("nexra-agency", WRITER_RUN_ID), { ok: false, reason: "unavailable" });
  });
});
