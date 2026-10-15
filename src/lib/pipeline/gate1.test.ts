import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DailyUsage } from "@/lib/agent-runs/daily-usage";
import type { ParsedBrief } from "@/lib/briefs/brief";
import { gate1Confirmation, gate1Requests, gate1State, partsEstimate, runGate1, writingConfirmation, type Gate1Io } from "@/lib/pipeline/gate1";
import type { Gate1Evidence } from "@/lib/pipeline/stage-a";
import type { AgentRun } from "@/types/agent-run";

const BRIEF = "b0000000-0000-4000-8000-000000000001";
const U1 = "a0000000-0000-4000-8000-000000000001";
const U2 = "a0000000-0000-4000-8000-000000000002";

function partRun(briefRunId: string, createdAt: string, createdBy = "op-1", taskType = "article-part-draft"): AgentRun {
  return { id: `r-${createdAt}`, taskType, input: { briefRunId, part: "opening" }, createdAt, createdBy } as unknown as AgentRun;
}
const brief = { angle: "What the top results leave out", outline: [{ heading: "One", purpose: "" }, { heading: "Two", purpose: "" }] } as unknown as ParsedBrief;
const offered: Gate1Evidence = { preTicked: [U1, U2], admitted: 0, quoteNotFound: 1, needsReview: 0, unsupported: 0, rejected: 0 };
const usage = (created: number, perProject = 40): DailyUsage => ({ caps: { perProject, global: 100 }, project: { created, started: 0 }, all: { created, started: 0 } }) as unknown as DailyUsage;

describe("gate1State", () => {
  test("not approved until a Writer part run names this brief", () => {
    assert.deepEqual(gate1State(BRIEF, []), { approved: false });
    assert.deepEqual(gate1State(BRIEF, [partRun("b0000000-0000-4000-8000-000000000009", "2026-10-15T01:00:00Z")]), { approved: false });
    assert.deepEqual(gate1State(BRIEF, [partRun(BRIEF, "2026-10-15T01:00:00Z", "op", "section-draft")]), { approved: false });
  });
  test("approved at the earliest part run, by its creator", () => {
    const state = gate1State(BRIEF.toUpperCase(), [partRun(BRIEF, "2026-10-15T03:00:00Z", "late"), partRun(BRIEF, "2026-10-15T01:00:00Z", "first")]);
    assert.deepEqual(state, { approved: true, at: "2026-10-15T01:00:00Z", by: "first", runs: 2 });
  });
});

describe("gate1Requests and confirmation", () => {
  test("admissions first, then one queue request per part, the same shape Draft article sends", () => {
    const requests = gate1Requests("nexra-agency", BRIEF, [U1], ["opening", "section-1", "closing"]);
    assert.deepEqual(requests.map((r) => [r.kind, r.url]), [
      ["admit", `/api/evidence/units/${U1}`],
      ["queue", "/api/agent-runs"],
      ["queue", "/api/agent-runs"],
      ["queue", "/api/agent-runs"],
    ]);
    assert.deepEqual(requests[0]?.body, { project: "nexra-agency", decision: "admitted" });
    assert.deepEqual(requests[1]?.body, { projectId: "nexra-agency", agentId: "writer", taskType: "article-part-draft", input: { briefRunId: BRIEF, part: "opening" } });
  });
  test("the estimate and the confirmation say what will happen", () => {
    assert.deepEqual(partsEstimate(8), { low: 0.4, high: 0.8 });
    const c = gate1Confirmation("nexra-agency", brief, ["opening", "section-1"], 1, offered);
    assert.equal(c.title, "Approve the plan and queue 2 article parts?");
    assert.ok(c.facts.some((f) => f.label === "Evidence to admit" && f.value === "1 claim (1 unticked, left pending)"));
    assert.ok(c.facts.some((f) => f.label === "Writing estimate" && f.value.startsWith("about $0.10–$0.20")));
    assert.match(c.consequence, /publishes nothing/);
    assert.match(c.consequence, /runs them one by one now — each a paid model call/);
    assert.equal(c.confirmLabel, "Approve & write 2");
    const w = writingConfirmation("nexra-agency", 3);
    assert.equal(w.usage, "started");
    assert.equal(w.confirmLabel, "Run 3");
    assert.equal(c.usage, "created");
  });
});

function io(answers: Record<string, { status: number; body?: unknown }>, used = 0): { io: Gate1Io; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    io: {
      usage: async () => usage(used),
      post: async (url, body) => {
        sent.push(`${url}${body.input ? `#${String((body.input as { part: string }).part)}` : ""}`);
        const key = Object.keys(answers).find((k) => sent.at(-1)!.includes(k));
        const answer = key === undefined ? { status: 201 } : answers[key]!;
        return { status: answer.status, body: answer.body ?? {} };
      },
    },
  };
}

describe("runGate1", () => {
  const requests = gate1Requests("nexra-agency", BRIEF, [U1, U2], ["opening", "closing"]);

  test("everything accepted: admitted and queued", async () => {
    const { io: x, sent } = io({});
    const out = await runGate1(x, requests);
    assert.deepEqual([out.admitted, out.queued, out.refusal, out.tone], [2, 2, null, "neutral"]);
    assert.equal(sent.length, 4);
    assert.match(out.text, /^Plan approved: 2 claims admitted, 2 parts queued/);
  });

  test("no room under today's cap: nothing is sent, nothing admitted", async () => {
    const { io: x, sent } = io({}, 39);
    const out = await runGate1(x, requests);
    assert.equal(sent.length, 0);
    assert.deepEqual([out.admitted, out.queued], [0, 0]);
    assert.match(out.refusal ?? "", /project limit has 1 of the 2 runs left/);
  });

  test("a unit decided meanwhile is skipped; the rest goes on", async () => {
    const { io: x } = io({ [U1]: { status: 409, body: { error: "already-decided" } } });
    const out = await runGate1(x, requests);
    assert.deepEqual([out.admitted, out.queued, out.refusal], [1, 2, null]);
  });

  test("any other refusal stops at once", async () => {
    const { io: x, sent } = io({ [U2]: { status: 409, body: { error: "not-admissible" } } });
    const out = await runGate1(x, requests);
    assert.deepEqual([out.admitted, out.queued], [1, 0]);
    assert.equal(sent.length, 2);
    assert.equal(out.tone, "warning");
    assert.match(out.text, /then refused: Only a supported claim/);
  });

  test("a refused part stops the rest of the parts", async () => {
    const { io: x, sent } = io({ "#closing": { status: 429, body: { error: "daily-cap" } } });
    const out = await runGate1(x, requests);
    assert.deepEqual([out.admitted, out.queued], [2, 1]);
    assert.equal(sent.length, 4);
    assert.match(out.text, /1 of 2 queued; then refused: Today's run limit/);
  });

  test("a failed connection is reported", async () => {
    const out = await runGate1({ usage: async () => usage(0), post: async () => { throw new Error("offline"); } }, requests);
    assert.equal(out.refusal, "The request could not be sent. Check your connection.");
  });
});

describe("the Gate 1 screen", async () => {
  const { readFileSync } = await import("node:fs");
  const panel = readFileSync("src/components/content/gate1-panel.tsx", "utf8");
  const tab = readFileSync("src/components/content/evidence-tab.tsx", "utf8");
  test("mounted on the Evidence tab beneath the brief, only for a parsed brief", () => {
    assert.match(tab, /<Gate1Panel[\s\S]*briefRun=\{shownBrief\.run\}/);
    assert.match(tab, /shownBrief\.state === "brief"/);
    assert.ok(tab.indexOf("<OpportunityBriefPanel") < tab.indexOf("<Gate1Panel"));
  });
  test("one confirmation, then the shared driver; no fixture", () => {
    assert.match(panel, /SpendConfirmDialog confirmation=\{gate1Confirmation\(/);
    assert.match(panel, /runGate1\(/);
    assert.match(panel, /confirmTicks\(offered, ticked\)/);
    assert.doesNotMatch(panel, /@\/lib\/mock/);
  });
});
