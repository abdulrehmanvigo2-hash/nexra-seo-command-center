import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseBrief } from "@/lib/briefs/brief";
import { runWriting, writingCounts, writingNote, type WritingIo } from "@/lib/pipeline/write-parts";
import type { AgentRun } from "@/types/agent-run";

const BRIEF_RUN = "99999999-9999-4999-8999-999999999999";
const brief = parseBrief([
  "ANGLE: Show the approval gate most AI SDR pages skip.", "OUTLINE:", "H2: What an AI SDR does — Answer plainly.", "H2: Where a person approves — The gate.", "H2: What to measure — Replies and bookings.",
  "FAQ:", "Q: What does an AI SDR do?", "Q: Who approves a message?", "EVIDENCE:", "E: 1 — [evidence E1]", "E: 2 — opinion", "E: 3 — opinion",
  "EVIDENCE NEEDED: None.", "LINKS:", "LIMITS: One outside page.", "NEXT: Draft the first H2.",
].join("\n"))!;

const ANSWERS: Record<string, string> = {
  opening: ["TITLE: AI SDR with a person in the loop", "META TITLE: AI SDR with a person in the loop", "META DESCRIPTION: How an AI SDR replies to leads and where a person approves before anything is sent.", "SLUG: ai-sdr-approval", "EXCERPT: Where a person approves an AI SDR's message.", "LEAD: AI SDR tools reply to inbound leads within a minute. [evidence E1]", "P: This guide walks through the approval step. [connective]", "LIMITS: One outside page."].join("\n"),
  "section-1": ["P: An AI SDR replies to inbound leads within a minute. [evidence E1]", "LIMITS: None."].join("\n"),
  "section-2": ["P: We think a person should approve every first message. [opinion]", "LIMITS: None."].join("\n"),
  "section-3": ["P: Measure replies and bookings week by week. [connective]", "LIMITS: None."].join("\n"),
  closing: ["A1: It replies to inbound leads and books meetings. [evidence E1]", "A2: A person on your team approves it. [opinion]", "CTA TITLE: Talk to us", "CTA BODY: Book a short call to see the approval step.", "LIMITS: None."].join("\n"),
};
const PARTS = ["opening", "section-1", "section-2", "section-3", "closing"];

/** A small Writer: queued part runs that complete (or fail) when executed. */
function writer(options: { queued?: readonly string[]; fail?: string; refuse?: string; cancel?: string; never?: string; readFails?: boolean } = {}) {
  let n = 0;
  const runs = new Map<string, AgentRun>();
  const make = (part: string, status: AgentRun["status"]) => {
    n += 1;
    const run = { id: `r${n}-${part}`, taskType: "article-part-draft", input: { briefRunId: BRIEF_RUN, part }, status, executor: status === "completed" ? "ai" : null, resultSummary: status === "completed" ? ANSWERS[part] : null, error: null, createdAt: `2026-10-15T05:${String(n).padStart(2, "0")}:00Z` } as unknown as AgentRun;
    runs.set(run.id, run);
  };
  for (const part of options.queued ?? PARTS) make(part, "queued");
  let stop = false;
  const executed: string[] = [];
  const sleeps: number[] = [];
  const io: WritingIo = {
    readRuns: async () => (options.readFails ? null : [...runs.values()]),
    execute: async (id) => {
      const run = runs.get(id)!;
      const part = String(run.input.part);
      executed.push(part);
      if (options.refuse === part) return { kind: "refused", message: "Today's run limit is reached." };
      const status = options.never === part ? "running" : options.fail === part ? "failed" : options.cancel === part ? "cancelled" : "completed";
      runs.set(id, { ...run, status, executor: "ai", resultSummary: status === "completed" ? ANSWERS[part] : null, error: status === "failed" ? { code: "rejected-output", message: "Over the limit." } : null } as AgentRun);
      return { kind: "accepted" };
    },
    readRun: async (id) => runs.get(id) ?? null,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    stopRequested: () => stop,
  };
  return { io, executed, sleeps, requestStop: () => (stop = true), runs };
}

describe("runWriting", () => {
  test("runs every queued part, in article order, then done", async () => {
    const w = writer();
    const progress: string[] = [];
    const out = await runWriting({ ...w.io, onProgress: (e) => progress.push(`${e.type}:${e.part}:${e.done}/${e.total}`) }, brief, BRIEF_RUN, { pollMs: 0 });
    assert.equal(out.ended, "done");
    assert.deepEqual(w.executed, PARTS);
    assert.deepEqual(out.ran, PARTS);
    assert.deepEqual(writingCounts(out.states!), { drafted: 5, waiting: 0, total: 5 });
    assert.equal(progress[0], "running:opening:0/5");
    assert.equal(progress.at(-1), "drafted:closing:5/5");
  });

  test("a failed part stops it; a repeat press runs the rest and never re-runs the failed one", async () => {
    const w = writer({ fail: "section-1" });
    const out = await runWriting(w.io, brief, BRIEF_RUN, { pollMs: 0 });
    assert.equal(out.ended, "halted");
    assert.equal(out.halt?.kind, "run-failed");
    assert.deepEqual(out.ran, ["opening"]);
    const again = await runWriting(w.io, brief, BRIEF_RUN, { pollMs: 0 });
    assert.equal(again.halt?.kind, "not-queued");
    assert.deepEqual(again.halt?.kind === "not-queued" && again.halt.parts, ["section-1"]);
    assert.deepEqual(again.ran, ["section-2", "section-3", "closing"]);
    assert.deepEqual(w.executed, ["opening", "section-1", "section-2", "section-3", "closing"]);
  });

  test("a refusal (the daily cap) stops it with the run left queued", async () => {
    const w = writer({ refuse: "section-2" });
    const out = await runWriting(w.io, brief, BRIEF_RUN, { pollMs: 0 });
    assert.deepEqual([out.ended, out.halt?.kind], ["halted", "refused"]);
    assert.equal([...w.runs.values()].find((r) => r.input.part === "section-2")?.status, "queued");
  });

  test("a cancelled run, a timeout and an unreadable list each stop it", async () => {
    assert.equal((await runWriting(writer({ cancel: "opening" }).io, brief, BRIEF_RUN, { pollMs: 0 })).halt?.kind, "cancelled");
    const slow = writer({ never: "opening" });
    const timed = await runWriting(slow.io, brief, BRIEF_RUN, { pollMs: 1, maxPolls: 2 });
    assert.equal(timed.halt?.kind, "timed-out");
    assert.equal(slow.sleeps.length, 2);
    assert.equal((await runWriting(writer({ readFails: true }).io, brief, BRIEF_RUN)).halt?.kind, "unreadable");
  });

  test("a part never queued is named, nothing is queued for it", async () => {
    const w = writer({ queued: ["opening", "section-1", "section-3", "closing"] });
    const out = await runWriting(w.io, brief, BRIEF_RUN, { pollMs: 0 });
    assert.deepEqual(out.ran, ["opening", "section-1", "section-3", "closing"]);
    assert.deepEqual(out.halt?.kind === "not-queued" && out.halt.parts, ["section-2"]);
  });

  test("Stop takes effect before the next part", async () => {
    const w = writer();
    let n = 0;
    const out = await runWriting({ ...w.io, onProgress: (e) => { if (e.type === "drafted" && (n += 1) === 1) w.requestStop(); } }, brief, BRIEF_RUN, { pollMs: 0 });
    assert.equal(out.ended, "stopped");
    assert.deepEqual(out.ran, ["opening"]);
  });

  test("runs of another brief or task are ignored", async () => {
    const w = writer({ queued: [] });
    w.runs.set("x", { id: "x", taskType: "article-part-draft", input: { briefRunId: "other", part: "opening" }, status: "queued", createdAt: "2026-10-15T05:00:00Z" } as unknown as AgentRun);
    const out = await runWriting(w.io, brief, BRIEF_RUN, { pollMs: 0 });
    assert.deepEqual(w.executed, []);
    assert.equal(out.halt?.kind, "not-queued");
  });
});

describe("writingNote", () => {
  const label = (part: string) => `Part ${part}`;
  test("done, stopped and halted in words", () => {
    assert.match(writingNote({ ended: "done", halt: null, ran: ["opening"], states: [] }, label).text, /^1 part written\. Every part is drafted/);
    assert.match(writingNote({ ended: "stopped", halt: null, ran: [], states: [] }, label).text, /Continue writing/);
    const failed = writingNote({ ended: "halted", halt: { kind: "run-failed", part: "section-1", runId: "r", code: "rejected-output", message: "Over." }, ran: [], states: [] }, label);
    assert.equal(failed.tone, "warning");
    assert.match(failed.text, /Part section-1 failed \(rejected-output\)/);
  });
});

describe("the writing on the Gate 1 panel", async () => {
  const { readFileSync } = await import("node:fs");
  const panel = readFileSync("src/components/content/gate1-panel.tsx", "utf8");
  test("approval runs the writing right after queueing, and Continue writing opens its own confirmation", () => {
    assert.match(panel, /if \(result\.refusal === null && result\.queued > 0\) await write\(\);/);
    assert.match(panel, /writingConfirmation\(projectId, counts\.waiting\)/);
    assert.match(panel, /runWriting\(writingIo\(/);
  });
  test("the execute request is Run now's own, and Stop is offered while writing", () => {
    // Moved to the shared Writer calls in PR 6c, which the re-draft uses too.
    assert.match(panel, /import \{ writingIo \} from "@\/components\/content\/writer-io";/);
    assert.match(readFileSync("src/components/content/writer-io.ts", "utf8"), /JSON\.stringify\(\{ action: "execute" \}\)/);
    assert.match(panel, /Stop after this part/);
  });
});
