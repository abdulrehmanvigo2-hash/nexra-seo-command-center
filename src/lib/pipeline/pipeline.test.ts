import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runPipeline, stageOf, type PerformResult, type PipelineIo } from "@/lib/pipeline/driver";
import { MAX_REDRAFTS, planPipeline, type PipelineAction, type PipelineSnapshot, type RunState } from "@/lib/pipeline/plan";
import type { AgentRun } from "@/types/agent-run";

const EMPTY: PipelineSnapshot = {
  serp: "none",
  sources: [],
  sourcesPicked: false,
  brief: { state: "none" },
  gate1Approved: false,
  parts: [],
  redrafts: {},
  article: "none",
  checks: { state: "not-run" },
  gate2Approved: false,
  publication: "none",
};

const done = (runId: string): RunState => ({ state: "run", runId, status: "completed" });
const fetched = (url: string, extraction: RunState = done(`x-${url}`), unitsRecorded = true) => ({ url, fetch: "fetched" as const, extraction, unitsRecorded });
const pendingSource = (url: string) => ({ url, fetch: "pending" as const, extraction: { state: "none" as const }, unitsRecorded: false });
const refusedSource = (url: string) => ({ url, fetch: "refused" as const, extraction: { state: "none" as const }, unitsRecorded: false });

/** A snapshot with Stage A finished and the brief done. */
const BRIEFED: PipelineSnapshot = {
  ...EMPTY,
  serp: "completed",
  sourcesPicked: true,
  sources: [fetched("a"), fetched("b")],
  brief: done("brief"),
};
const APPROVED_1: PipelineSnapshot = { ...BRIEFED, gate1Approved: true, parts: [done("p0"), done("p1"), done("p2")] };
const CHECKED: PipelineSnapshot = { ...APPROVED_1, article: "current", checks: { state: "passed" } };

describe("planPipeline — Stage A", () => {
  test("an empty article starts with the SERP", () => {
    assert.deepEqual(planPipeline(EMPTY), { next: "act", action: { kind: "fetch-serp" } });
  });

  test("a running SERP is waited on; a failed one blocks and is never retried", () => {
    assert.deepEqual(planPipeline({ ...EMPTY, serp: "running" }), { next: "await-serp" });
    assert.deepEqual(planPipeline({ ...EMPTY, serp: "failed" }), { next: "blocked", block: { reason: "serp-failed" } });
  });

  test("sources are picked, then fetched one at a time in order", () => {
    assert.deepEqual(planPipeline({ ...EMPTY, serp: "completed" }), { next: "act", action: { kind: "pick-sources" } });
    const picked: PipelineSnapshot = {
      ...EMPTY,
      serp: "completed",
      sourcesPicked: true,
      sources: [fetched("a"), pendingSource("b"), pendingSource("c")],
    };
    assert.deepEqual(planPipeline(picked), { next: "act", action: { kind: "fetch-source", index: 1 } });
  });

  test("no fetched source blocks; a refused source is skipped", () => {
    const none: PipelineSnapshot = { ...EMPTY, serp: "completed", sourcesPicked: true, sources: [] };
    assert.deepEqual(planPipeline(none), { next: "blocked", block: { reason: "no-source" } });
    const refused: PipelineSnapshot = { ...none, sources: [refusedSource("a")] };
    assert.deepEqual(planPipeline(refused), { next: "blocked", block: { reason: "no-source" } });
    const mixed: PipelineSnapshot = { ...none, sources: [refusedSource("a"), fetched("b", { state: "none" }, false)] };
    assert.deepEqual(planPipeline(mixed), { next: "act", action: { kind: "extract", index: 1 } });
  });

  test("a pending extraction is awaited; a failed one is skipped and the brief follows", () => {
    const pending: PipelineSnapshot = { ...BRIEFED, brief: { state: "none" }, sources: [fetched("a", { state: "run", runId: "x1", status: "queued" })] };
    assert.deepEqual(planPipeline(pending), { next: "await-run", stage: "extraction", runId: "x1", status: "queued" });
    const failed: PipelineSnapshot = { ...pending, sources: [fetched("a", { state: "run", runId: "x1", status: "failed" })] };
    assert.deepEqual(planPipeline(failed), { next: "act", action: { kind: "draft-brief" } });
  });

  test("a completed extraction's units are recorded before the next source", () => {
    const s: PipelineSnapshot = { ...BRIEFED, brief: { state: "none" }, sources: [fetched("a", done("x1"), false), fetched("b", { state: "none" }, false)] };
    assert.deepEqual(planPipeline(s), { next: "act", action: { kind: "record-units", index: 0, runId: "x1" } });
  });

  test("the brief: awaited, blocked when failed or cancelled, then Gate 1", () => {
    assert.deepEqual(planPipeline({ ...BRIEFED, brief: { state: "run", runId: "b", status: "running" } }), {
      next: "await-run",
      stage: "brief",
      runId: "b",
      status: "running",
    });
    assert.deepEqual(planPipeline({ ...BRIEFED, brief: { state: "run", runId: "b", status: "failed" } }), {
      next: "blocked",
      block: { reason: "brief-failed", runId: "b" },
    });
    assert.deepEqual(planPipeline({ ...BRIEFED, brief: { state: "run", runId: "b", status: "cancelled" } }), {
      next: "blocked",
      block: { reason: "run-cancelled", stage: "brief", runId: "b" },
    });
    assert.deepEqual(planPipeline(BRIEFED), { next: "gate", gate: 1 });
  });
});

describe("planPipeline — Stage B and Gate 2", () => {
  test("nothing is written before Gate 1, whatever else is recorded", () => {
    assert.deepEqual(planPipeline({ ...APPROVED_1, gate1Approved: false }), { next: "gate", gate: 1 });
  });

  test("an approved brief without parts blocks", () => {
    assert.deepEqual(planPipeline({ ...BRIEFED, gate1Approved: true }), { next: "blocked", block: { reason: "brief-without-parts" } });
  });

  test("parts are drafted in order; a failed part blocks", () => {
    const parts: PipelineSnapshot = { ...APPROVED_1, parts: [done("p0"), { state: "none" }, { state: "none" }] };
    assert.deepEqual(planPipeline(parts), { next: "act", action: { kind: "draft-part", index: 1 } });
    const failed: PipelineSnapshot = { ...APPROVED_1, parts: [done("p0"), { state: "run", runId: "p1", status: "failed" }, { state: "none" }] };
    assert.deepEqual(planPipeline(failed), { next: "blocked", block: { reason: "part-failed", index: 1, runId: "p1" } });
  });

  test("a pending re-draft is awaited as a re-draft", () => {
    const s: PipelineSnapshot = { ...APPROVED_1, parts: [done("p0"), { state: "run", runId: "r1", status: "queued" }, done("p2")], redrafts: { 1: 1 } };
    assert.deepEqual(planPipeline(s), { next: "await-run", stage: "redraft", runId: "r1", status: "queued" });
  });

  test("import when there is no version or it is stale", () => {
    assert.deepEqual(planPipeline(APPROVED_1), { next: "act", action: { kind: "import" } });
    assert.deepEqual(planPipeline({ ...APPROVED_1, article: "stale" }), { next: "act", action: { kind: "import" } });
  });

  test("check all until passed", () => {
    assert.deepEqual(planPipeline({ ...APPROVED_1, article: "current" }), { next: "act", action: { kind: "check-all" } });
    assert.deepEqual(planPipeline({ ...APPROVED_1, article: "current", checks: { state: "incomplete" } }), { next: "act", action: { kind: "check-all" } });
  });

  test(`failing parts are re-drafted lowest first, at most ${MAX_REDRAFTS} times each`, () => {
    const failing: PipelineSnapshot = { ...APPROVED_1, article: "current", checks: { state: "failing", parts: [2, 0, 2] } };
    assert.deepEqual(planPipeline(failing), { next: "act", action: { kind: "redraft-part", index: 0, attempt: 1 } });
    assert.deepEqual(planPipeline({ ...failing, redrafts: { 0: MAX_REDRAFTS } }), { next: "act", action: { kind: "redraft-part", index: 2, attempt: 1 } });
    assert.deepEqual(planPipeline({ ...failing, redrafts: { 0: MAX_REDRAFTS, 2: MAX_REDRAFTS } }), {
      next: "blocked",
      block: { reason: "redraft-limit", parts: [0, 2] },
    });
  });

  test("Gate 2, then publish; a request not finished is continued; the end is the PR or the live page", () => {
    assert.deepEqual(planPipeline(CHECKED), { next: "gate", gate: 2 });
    const approved: PipelineSnapshot = { ...CHECKED, gate2Approved: true };
    assert.deepEqual(planPipeline(approved), { next: "act", action: { kind: "publish" } });
    assert.deepEqual(planPipeline({ ...approved, publication: "requested" }), { next: "act", action: { kind: "publish" } });
    assert.deepEqual(planPipeline({ ...approved, publication: "pr-open" }), { next: "done", publication: "pr-open" });
    assert.deepEqual(planPipeline({ ...approved, publication: "live" }), { next: "done", publication: "live" });
    assert.deepEqual(planPipeline({ ...approved, publication: "failed" }), { next: "blocked", block: { reason: "publish-failed" } });
  });

  test("publishing is never planned without Gate 2", () => {
    assert.deepEqual(planPipeline({ ...CHECKED, publication: "requested" }), { next: "gate", gate: 2 });
  });
});

/** A small simulated product: perform() changes it the way the real routes would; runs complete when executed. */
function world(options: { failChecksFor?: Record<number, number>; failRun?: (action: PipelineAction) => boolean; refuse?: PipelineAction["kind"]; refuseExecute?: boolean; never?: boolean } = {}) {
  let s: PipelineSnapshot = { ...EMPTY };
  const runs = new Map<string, AgentRun>();
  const runOutcome = new Map<string, "completed" | "failed">();
  const pendingStatus = new Map<string, (status: AgentRun["status"]) => void>();
  const failChecksLeft = { ...(options.failChecksFor ?? {}) };
  let n = 0;
  let stop = false;
  const sleeps: number[] = [];

  const makeRun = (action: PipelineAction, apply: (status: AgentRun["status"], runId: string) => void): AgentRun => {
    n += 1;
    const id = `run-${String(n).padStart(4, "0")}-0000-4000-8000-000000000000`;
    const run = { id, status: "queued", error: null } as unknown as AgentRun;
    runs.set(id, run);
    runOutcome.set(id, options.failRun?.(action) ? "failed" : "completed");
    pendingStatus.set(id, (status) => apply(status, id));
    apply("queued", id);
    return run;
  };
  const setRun = (id: string, status: AgentRun["status"]) => {
    const run = { ...(runs.get(id) as AgentRun), status, error: status === "failed" ? { code: "rejected-output", message: "Rejected." } : null } as AgentRun;
    runs.set(id, run);
    pendingStatus.get(id)?.(status);
  };

  const io: PipelineIo = {
    readSnapshot: async () => s,
    perform: async (action): Promise<PerformResult> => {
      if (options.refuse === action.kind) return { ok: false, message: "Today's run cap is reached." };
      switch (action.kind) {
        case "fetch-serp":
          s = { ...s, serp: "completed" };
          return { ok: true };
        case "pick-sources":
          s = { ...s, sourcesPicked: true, sources: ["a", "b", "c"].map(pendingSource) };
          return { ok: true };
        case "fetch-source":
          s = { ...s, sources: s.sources.map((src, i) => (i === action.index ? { ...src, fetch: i === 2 ? "refused" : "fetched" } : src)) };
          return { ok: true };
        case "extract":
          return {
            ok: true,
            run: makeRun(action, (status, runId) => {
              s = { ...s, sources: s.sources.map((src, i) => (i === action.index ? { ...src, extraction: { state: "run", runId, status } } : src)) };
            }),
          };
        case "record-units":
          s = { ...s, sources: s.sources.map((src, i) => (i === action.index ? { ...src, unitsRecorded: true } : src)) };
          return { ok: true };
        case "draft-brief":
          return {
            ok: true,
            run: makeRun(action, (status, runId) => {
              s = { ...s, brief: { state: "run", runId, status }, parts: status === "completed" ? [{ state: "none" }, { state: "none" }] : s.parts };
            }),
          };
        case "draft-part":
        case "redraft-part": {
          const isRedraft = action.kind === "redraft-part";
          if (isRedraft) s = { ...s, redrafts: { ...s.redrafts, [action.index]: (s.redrafts[action.index] ?? 0) + 1 } };
          return {
            ok: true,
            run: makeRun(action, (status, runId) => {
              s = { ...s, parts: s.parts.map((p, i) => (i === action.index ? { state: "run", runId, status } : p)), article: isRedraft && status === "completed" ? "stale" : s.article };
            }),
          };
        }
        case "import":
          s = { ...s, article: "current", checks: { state: "not-run" } };
          return { ok: true };
        case "check-all": {
          const failing = Object.entries(failChecksLeft)
            .filter(([, left]) => left > 0)
            .map(([index]) => Number(index));
          for (const index of failing) failChecksLeft[index] = (failChecksLeft[index] ?? 0) - 1;
          s = { ...s, checks: failing.length > 0 ? { state: "failing", parts: failing } : { state: "passed" } };
          return { ok: true };
        }
        case "publish":
          s = { ...s, publication: "pr-open" };
          return { ok: true };
      }
    },
    execute: async (runId) => {
      if (options.refuseExecute) return { kind: "refused", message: "Today's run cap is reached." };
      if (!options.never) setRun(runId, runOutcome.get(runId) ?? "completed");
      else setRun(runId, "running");
      return { kind: "accepted" };
    },
    readRun: async (runId) => runs.get(runId) ?? null,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    stopRequested: () => stop,
  };

  return {
    io,
    get snapshot() {
      return s;
    },
    approve: (gate: 1 | 2) => {
      s = gate === 1 ? { ...s, gate1Approved: true } : { ...s, gate2Approved: true };
    },
    requestStop: () => {
      stop = true;
    },
    sleeps,
  };
}

const kinds = (actions: readonly PipelineAction[]) => actions.map((a) => a.kind);

describe("runPipeline", () => {
  test("three presses: to Gate 1, to Gate 2, to the open pull request", async () => {
    const w = world();
    const first = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(first.ended, "gate-1");
    assert.deepEqual(kinds(first.performed), ["fetch-serp", "pick-sources", "fetch-source", "fetch-source", "fetch-source", "extract", "record-units", "extract", "record-units", "draft-brief"]);
    assert.equal(w.snapshot.parts.length, 2);

    // Pressing again before the gate does nothing.
    const again = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(again.ended, "gate-1");
    assert.deepEqual(again.performed, []);

    w.approve(1);
    const second = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(second.ended, "gate-2");
    assert.deepEqual(kinds(second.performed), ["draft-part", "draft-part", "import", "check-all"]);

    w.approve(2);
    const third = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(third.ended, "done");
    assert.deepEqual(kinds(third.performed), ["publish"]);
    assert.equal(w.snapshot.publication, "pr-open");
  });

  test("a failing part is re-drafted, re-imported and re-checked", async () => {
    const w = world({ failChecksFor: { 1: 1 } });
    await runPipeline(w.io, { pollMs: 0 });
    w.approve(1);
    const out = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(out.ended, "gate-2");
    assert.deepEqual(kinds(out.performed), ["draft-part", "draft-part", "import", "check-all", "redraft-part", "import", "check-all"]);
    assert.deepEqual(w.snapshot.redrafts, { 1: 1 });
  });

  test(`a part still failing after ${MAX_REDRAFTS} re-drafts stops the pipeline for the owner`, async () => {
    const w = world({ failChecksFor: { 0: 99 } });
    await runPipeline(w.io, { pollMs: 0 });
    w.approve(1);
    const out = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(out.ended, "halted");
    assert.deepEqual(out.halt, { kind: "blocked", block: { reason: "redraft-limit", parts: [0] } });
    assert.equal(out.performed.filter((a) => a.kind === "redraft-part").length, MAX_REDRAFTS);
  });

  test("a refused request halts and starts nothing more", async () => {
    const w = world({ refuse: "draft-brief" });
    const out = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(out.ended, "halted");
    assert.deepEqual(out.halt, { kind: "refused", action: "draft-brief", message: "Today's run cap is reached." });
    assert.equal(out.performed.at(-1)?.kind, "record-units");
  });

  test("a refused execute (the daily cap) halts with the run left queued", async () => {
    const w = world({ refuseExecute: true });
    const out = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(out.ended, "halted");
    assert.equal(out.halt?.kind, "refused");
    assert.equal(w.snapshot.sources[0]?.extraction.state === "run" && w.snapshot.sources[0].extraction.status, "queued");
    // A later press picks the queued run up instead of queueing another.
    const later = await runPipeline(w.io, { pollMs: 0 });
    assert.deepEqual(later.performed, []);
  });

  test("a failed extraction does not stop the article", async () => {
    const w = world({ failRun: (a) => a.kind === "extract" && a.index === 0 });
    const out = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(out.ended, "gate-1");
    assert.ok(kinds(out.performed).includes("draft-brief"));
  });

  test("a failed part run halts with its code", async () => {
    const w = world({ failRun: (a) => a.kind === "draft-part" && a.index === 1 });
    await runPipeline(w.io, { pollMs: 0 });
    w.approve(1);
    const out = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(out.ended, "halted");
    assert.equal(out.halt?.kind, "run-failed");
    assert.equal(out.halt?.kind === "run-failed" && out.halt.code, "rejected-output");
    // Pressing again reports the block; it never re-runs the failed part by itself.
    const again = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(again.halt?.kind === "blocked" && again.halt.block.reason, "part-failed");
    assert.deepEqual(again.performed, []);
  });

  test("a run that never settles times out after maxPolls", async () => {
    const w = world({ never: true });
    const out = await runPipeline(w.io, { pollMs: 1, maxPolls: 3 });
    assert.equal(out.ended, "halted");
    assert.equal(out.halt?.kind, "timed-out");
    assert.equal(w.sleeps.length, 3);
  });

  test("Stop takes effect before the next step", async () => {
    const w = world();
    w.requestStop();
    const out = await runPipeline(w.io, { pollMs: 0 });
    assert.equal(out.ended, "stopped");
    assert.deepEqual(out.performed, []);
  });

  test("an unreadable snapshot halts", async () => {
    const w = world();
    const out = await runPipeline({ ...w.io, readSnapshot: async () => null }, { pollMs: 0 });
    assert.equal(out.ended, "halted");
    assert.equal(out.halt?.kind, "unreadable");
  });

  test("a snapshot that never settles is bounded by maxSteps", async () => {
    const w = world();
    // perform succeeds but changes nothing: the same action would be planned forever.
    const out = await runPipeline({ ...w.io, perform: async () => ({ ok: true }) }, { pollMs: 0, maxSteps: 5 });
    assert.equal(out.ended, "halted");
    assert.equal(out.performed.length, 5);
  });

  test("every action maps to a stage", () => {
    assert.equal(stageOf({ kind: "extract", index: 0 }), "extraction");
    assert.equal(stageOf({ kind: "redraft-part", index: 0, attempt: 1 }), "redraft");
    assert.equal(stageOf({ kind: "publish" }), "publish");
  });
});
