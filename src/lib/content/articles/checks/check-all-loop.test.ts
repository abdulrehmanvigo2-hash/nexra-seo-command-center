import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runCheckAll, type CheckAllIo, type CheckAllProgress } from "@/lib/content/articles/checks/check-all-loop";
import type { AgentRun } from "@/types/agent-run";
import type { ArticleCheckUnitRecord, ArticleCheckUnitView, ArticleVersionChecks } from "@/types/content-article-check";

/**
 * "Check all units", step 2: the loop over a fake table that settles after
 * each call, as the real one does. The fakes answer exactly what the
 * routes and actions answer; nothing is parallel, and every call is logged
 * in order so the tests can pin the sequence.
 */

type UnitState = "unchecked" | "carry" | "passed" | "needs-review" | "failed" | { readonly pending: string };

function view(index: number, state: UnitState): ArticleCheckUnitView {
  const base = { index, kind: "section", block: "b", key: `k:${index}`, part: 1, partCount: 1, label: `Unit ${index}`, sha256: "a".repeat(64), statementCount: 2, attestedStatementCount: 0, bytes: 10 } as const;
  if (typeof state === "object") return { ...base, record: { status: "pending", checkedByRunId: state.pending } as unknown as ArticleCheckUnitRecord };
  if (state === "unchecked") return { ...base, record: null };
  if (state === "carry") return { ...base, record: null, carryOffer: { available: true, sourceUnitId: "s", fromVersion: 1, runId: "r1", basis: "no-supported" } };
  return { ...base, record: { status: state, checkedByRunId: `run-${index}` } as unknown as ArticleCheckUnitRecord };
}

function run(id: string, status: AgentRun["status"], error: { code: string; message: string } | null = null): AgentRun {
  return { id, status, error, projectId: "nexra-agency", agentId: "research-evidence", taskType: "article-check-unit" } as unknown as AgentRun;
}

/** A fake of the server: the table, the runs, and what each call does to them. */
class Fake {
  states: UnitState[];
  runs = new Map<string, AgentRun>();
  log: string[] = [];
  events: CheckAllProgress[] = [];
  stop = false;
  /** What a unit's check answers when recorded: by default it passes. */
  verdicts: Record<number, ArticleCheckUnitRecord["status"]> = {};
  /** What executing a run does to it: by default it completes. */
  executes: Record<string, AgentRun["status"]> = {};
  /** Carries refused after all, with whether the unit is checked instead. */
  carryRefusals: Record<number, boolean> = {};
  queueRefusal: string | null = null;
  recordRefusal: string | null = null;
  unreadableChecksAfter = Infinity;
  private counter = 0;

  constructor(states: UnitState[]) {
    this.states = states;
  }

  checks(): ArticleVersionChecks {
    return {
      articleId: "a", articleStatus: "drafting", currentVersion: 2, version: 2, versionId: "v", contentSha256: "c".repeat(64), refusal: null,
      units: this.states.map((state, index) => view(index, state)), state: "unchecked",
      counts: { total: this.states.length, passed: 0, needsReview: 0, failed: 0, pending: 0, unchecked: 0 },
    };
  }

  io(): CheckAllIo {
    return {
      readChecks: async () => {
        this.log.push("readChecks");
        return this.log.filter((l) => l === "readChecks").length > this.unreadableChecksAfter ? null : this.checks();
      },
      carry: async (index) => {
        this.log.push(`carry:${index}`);
        if (index in this.carryRefusals) return { ok: false, checkInstead: this.carryRefusals[index]!, message: `carry refused ${index}` };
        this.states[index] = "passed";
        return { ok: true };
      },
      queue: async (index) => {
        this.log.push(`queue:${index}`);
        if (this.queueRefusal !== null) return { ok: false, message: this.queueRefusal };
        const id = `run-${index}-${++this.counter}`;
        const made = run(id, "queued");
        this.runs.set(id, made);
        this.states[index] = { pending: id };
        return { ok: true, run: made, duplicate: false };
      },
      execute: async (runId) => {
        this.log.push(`execute:${runId}`);
        const status = this.executes[runId] ?? "completed";
        this.runs.set(runId, run(runId, status, status === "failed" ? { code: "rejected-output", message: "The answer was refused." } : null));
        return { kind: "accepted" };
      },
      readRun: async (runId) => {
        this.log.push(`readRun:${runId}`);
        return this.runs.get(runId) ?? null;
      },
      record: async (index, runId) => {
        this.log.push(`record:${index}:${runId}`);
        if (this.recordRefusal !== null) return { ok: false, message: this.recordRefusal };
        const status = this.verdicts[index] ?? "passed";
        this.states[index] = status === "pending" ? { pending: runId } : status;
        return { ok: true, status };
      },
      sleep: async () => {
        this.log.push("sleep");
      },
      stopRequested: () => this.stop,
      onProgress: (event) => this.events.push(event),
    };
  }
}

const kinds = (fake: Fake) => fake.log.filter((l) => !l.startsWith("readChecks") && !l.startsWith("readRun"));

describe("the sequence: carries first, then one unit at a time, each queued, run, read back and recorded", () => {
  test("article 2's shape: 9 carries then 4 checks in table order, every unit its own run and record; done with no needs-review", async () => {
    const fake = new Fake(["carry", "carry", "unchecked", "unchecked", "carry", "unchecked", "carry", "carry", "carry", "carry", "carry", "carry", "unchecked"]);
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.equal(outcome.ended, "done");
    assert.equal(outcome.halt, null);
    assert.deepEqual(outcome.carried, [0, 1, 4, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual(outcome.checked, [2, 3, 5, 12]);
    assert.deepEqual(outcome.needsReview, []);
    assert.deepEqual(kinds(fake), [
      "carry:0", "carry:1", "carry:4", "carry:6", "carry:7", "carry:8", "carry:9", "carry:10", "carry:11",
      "queue:2", "execute:run-2-1", "record:2:run-2-1",
      "queue:3", "execute:run-3-2", "record:3:run-3-2",
      "queue:5", "execute:run-5-3", "record:5:run-5-3",
      "queue:12", "execute:run-12-4", "record:12:run-12-4",
    ]);
    // Never parallel: a queue is always followed by its own execute and record before the next queue.
    const q = fake.log.filter((l) => l.startsWith("queue:")).length;
    assert.equal(q, 4);
    assert.equal(fake.runs.size, 4, "one run per checked unit");
    assert.deepEqual(fake.states, Array(13).fill("passed"));
  });

  test("needs-review does not stop it (decision Q5): the unit is recorded, the next follows, and the summary lists every needs-review unit", async () => {
    const fake = new Fake(["needs-review", "unchecked", "unchecked", "unchecked"]);
    fake.verdicts = { 2: "needs-review" };
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.equal(outcome.ended, "done");
    assert.deepEqual(outcome.checked, [1, 2, 3]);
    assert.deepEqual(outcome.needsReview, [0, 2], "the earlier needs-review unit and the one this press recorded");
    assert.deepEqual(fake.events.filter((e) => e.type === "recorded").map((e) => (e.type === "recorded" ? `${e.index}:${e.status}` : "")), ["1:passed", "2:needs-review", "3:passed"]);
  });

  test("a repeat press resumes: recorded units are skipped, a pending unit's run is recorded first, then the unchecked rows", async () => {
    const fake = new Fake(["passed", { pending: "run-1-old" }, "needs-review", "unchecked"]);
    fake.runs.set("run-1-old", run("run-1-old", "completed"));
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.equal(outcome.ended, "done");
    assert.deepEqual(kinds(fake), ["record:1:run-1-old", "queue:3", "execute:run-3-1", "record:3:run-3-1"]);
    assert.deepEqual(outcome.checked, [1, 3]);
    assert.deepEqual(outcome.needsReview, [2]);
  });

  test("a pending unit whose run is still queued is run now; one still running is waited on", async () => {
    const fake = new Fake([{ pending: "run-0-q" }, { pending: "run-1-r" }]);
    fake.runs.set("run-0-q", run("run-0-q", "queued"));
    fake.runs.set("run-1-r", run("run-1-r", "running"));
    let reads = 0;
    const io = fake.io();
    const patched: CheckAllIo = {
      ...io,
      readRun: async (runId) => {
        const value = await io.readRun(runId);
        if (runId === "run-1-r" && ++reads >= 3) fake.runs.set("run-1-r", run("run-1-r", "completed"));
        return value;
      },
    };
    const outcome = await runCheckAll(patched, { pollMs: 1 });
    assert.equal(outcome.ended, "done");
    assert.deepEqual(kinds(fake), ["execute:run-0-q", "record:0:run-0-q", "sleep", "sleep", "record:1:run-1-r"]);
  });

  test("a carry refused after all (the evidence changed) turns that unit into a check, once, and the rest carries on", async () => {
    const fake = new Fake(["carry", "carry"]);
    fake.carryRefusals = { 0: true };
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.equal(outcome.ended, "done");
    assert.deepEqual(kinds(fake), ["carry:0", "carry:1", "queue:0", "execute:run-0-1", "record:0:run-0-1"]);
    assert.deepEqual(outcome.carried, [1]);
    assert.deepEqual(outcome.checked, [0]);
  });
});

describe("stops (decisions Q2 and Q5)", () => {
  test("a run that failed stops it at that unit, with the code and message; nothing after it is started", async () => {
    const fake = new Fake(["unchecked", "unchecked", "unchecked"]);
    fake.executes = { "run-1-2": "failed" };
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.equal(outcome.ended, "halted");
    assert.deepEqual(outcome.halt, { kind: "run-failed", index: 1, runId: "run-1-2", code: "rejected-output", message: "The answer was refused." });
    assert.deepEqual(outcome.checked, [0]);
    assert.ok(!fake.log.includes("queue:2"), "unit 2 was never started");
    assert.ok(!fake.log.some((l) => l.startsWith("record:1")), "a failed run is never recorded by the loop");
  });

  test("a malformed answer recorded `failed` stops it after the record", async () => {
    const fake = new Fake(["unchecked", "unchecked"]);
    fake.verdicts = { 0: "failed" };
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.deepEqual(outcome.halt, { kind: "check-failed", index: 0, runId: "run-0-1" });
    assert.deepEqual(outcome.checked, []);
    assert.ok(!fake.log.includes("queue:1"));
  });

  test("a refused queue (the cap, a rate limit, the session) stops it with the server's wording", async () => {
    const fake = new Fake(["carry", "unchecked"]);
    fake.queueRefusal = "The daily run limit is reached.";
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.deepEqual(outcome.halt, { kind: "refused", index: 1, step: "check", message: "The daily run limit is reached." });
    assert.deepEqual(outcome.carried, [0], "the free carry before it went through");
  });

  test("a refused execute stops it; the queued run stays queued for the worker or a later press", async () => {
    const fake = new Fake(["unchecked"]);
    const io = fake.io();
    const outcome = await runCheckAll({ ...io, execute: async () => ({ kind: "refused", message: "held by the cap" }) }, { pollMs: 1 });
    assert.deepEqual(outcome.halt, { kind: "refused", index: 0, step: "check", message: "held by the cap" });
    assert.equal(fake.runs.get("run-0-1")?.status, "queued");
  });

  test("a refused record stops it; a refused carry that is not 'check instead' stops it", async () => {
    const a = new Fake(["unchecked", "unchecked"]);
    a.recordRefusal = "Your session has ended.";
    assert.deepEqual((await runCheckAll(a.io(), { pollMs: 1 })).halt, { kind: "refused", index: 0, step: "check", message: "Your session has ended." });
    const b = new Fake(["carry", "unchecked"]);
    b.carryRefusals = { 0: false };
    const outcome = await runCheckAll(b.io(), { pollMs: 1 });
    assert.deepEqual(outcome.halt, { kind: "refused", index: 0, step: "carry", message: "carry refused 0" });
    assert.ok(!b.log.includes("queue:1"));
  });

  test("Stop takes effect after the unit in flight settles: that unit is recorded, the next is never started", async () => {
    const fake = new Fake(["unchecked", "unchecked", "unchecked"]);
    const io = fake.io();
    const patched: CheckAllIo = { ...io, execute: async (runId) => { fake.stop = runId === "run-1-2"; return io.execute(runId); } };
    const outcome = await runCheckAll(patched, { pollMs: 1 });
    assert.equal(outcome.ended, "stopped");
    assert.equal(outcome.halt, null);
    assert.deepEqual(outcome.checked, [0, 1]);
    assert.ok(fake.log.includes("record:1:run-1-2"), "the in-flight unit was recorded");
    assert.ok(!fake.log.includes("queue:2"));
  });

  test("Stop pressed before the first step does nothing at all", async () => {
    const fake = new Fake(["carry", "unchecked"]);
    fake.stop = true;
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.equal(outcome.ended, "stopped");
    assert.deepEqual(kinds(fake), []);
  });

  test("a run that never settles within the wait is given up on, nothing else started; a table that cannot be read halts", async () => {
    const fake = new Fake(["unchecked", "unchecked"]);
    fake.executes = { "run-0-1": "running" };
    const outcome = await runCheckAll(fake.io(), { pollMs: 1, maxPolls: 2 });
    assert.deepEqual(outcome.halt, { kind: "timed-out", index: 0, runId: "run-0-1" });
    assert.equal(fake.log.filter((l) => l === "sleep").length, 2);
    assert.ok(!fake.log.includes("queue:1"));
    const unread = new Fake(["unchecked"]);
    unread.unreadableChecksAfter = 0;
    assert.deepEqual((await runCheckAll(unread.io(), { pollMs: 1 })).halt, { kind: "unreadable", index: null, message: "The check units could not be read." });
  });

  test("a cancelled pending run is left to the operator (Record as failed by hand), with the message naming it", async () => {
    const fake = new Fake([{ pending: "run-0-c" }, "unchecked"]);
    fake.runs.set("run-0-c", run("run-0-c", "cancelled"));
    const outcome = await runCheckAll(fake.io(), { pollMs: 1 });
    assert.equal(outcome.halt?.kind, "refused");
    assert.match(outcome.halt?.kind === "refused" ? outcome.halt.message : "", /was cancelled\. Record its outcome by hand/);
  });

  test("nothing to do ends at once; the step bound ends a table that never settles", async () => {
    const done = new Fake(["passed", "needs-review"]);
    const outcome = await runCheckAll(done.io(), { pollMs: 1 });
    assert.equal(outcome.ended, "done");
    assert.deepEqual(outcome.needsReview, [1]);
    const stuck = new Fake(["unchecked"]);
    const io = stuck.io();
    const never: CheckAllIo = { ...io, record: async () => ({ ok: true, status: "passed" }) /* never writes the table */ };
    const bounded = await runCheckAll(never, { pollMs: 1, maxSteps: 3 });
    assert.equal(bounded.ended, "halted");
    assert.equal(bounded.halt?.kind, "unreadable");
  });
});
