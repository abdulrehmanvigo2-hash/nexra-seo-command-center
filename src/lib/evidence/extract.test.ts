import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { createTaskGrounding, type TaskGroundingReaders } from "@/lib/agent-runs/task-grounding";
import { getTaskType } from "@/lib/agent-runs/task-types";
import type { EvidenceSource } from "@/lib/evidence/contract";
import { isAdmissible, parseDecideRequest, parseRecordUnitsRequest } from "@/lib/evidence/contract";
import { EVIDENCE_EXTRACT_INSTRUCTIONS, formatSourceGrounding, MAX_QUOTE_CHARS, MAX_UNITS_PER_RUN, parseExtractAnswer, type SourceForExtraction } from "@/lib/evidence/extract";
import { createEvidenceService } from "@/lib/evidence/service";
import { unavailableEvidenceStore, type EvidenceStore, type ExtractRun } from "@/lib/evidence/store-contract";
import type { ExecutionTask } from "@/lib/agent-runs/executor";

/** M4, PR 6: the evidence-extract task, its instructions, grounding, answer parser and the record step. */

const SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "55555555-5555-4555-8555-555555555555";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const SOURCE: EvidenceSource = {
  id: SOURCE_ID, projectId: "nexra-agency", opportunityId: "66666666-6666-4666-8666-666666666666", serpResultId: null, requestedUrl: "https://alpha.example/guide",
  finalUrl: "https://alpha.example/guide", fetchState: "fetched", httpStatus: 200, robots: "allowed", title: "Alpha guide", textSha256: "a".repeat(64), textChars: 60,
  preview: "AI SDRs reply", fetchedAt: "2026-10-03T12:00:00.000Z",
};
const ANSWER = [
  "UNIT 1",
  "CLAIM: AI SDRs reply to inbound leads within a minute.",
  "QUOTE: AI SDRs reply to inbound leads within one minute.",
  "STATUS: supported",
  "UNIT 2",
  "CLAIM: Pricing starts at 500 dollars a month.",
  "QUOTE: \"They book meetings on the calendar.\"",
  "STATUS: supported",
  "LIMITS: One vendor page; no independent figures.",
].join("\n");

describe("the evidence-extract task", () => {
  test("Research & Evidence only, read-only, over one outside source; the input is one source id", () => {
    const task = getTaskType("evidence-extract");
    assert.ok(task);
    assert.deepEqual(task.agents, ["research-evidence"]);
    assert.equal(task.policy, "read-only");
    assert.equal(task.evidence, "evidence-source");
    assert.deepEqual(task.parseInput({ sourceId: SOURCE_ID.toUpperCase() }), { ok: true, value: { sourceId: SOURCE_ID } });
    assert.equal(task.parseInput({ sourceId: "x" }).ok, false);
    assert.equal(task.parseInput({ sourceId: SOURCE_ID, url: "https://a.example" }).ok, false);
  });

  test("the instructions are pinned, and a worst-case answer stays under the worker's 2,000 ceiling", () => {
    assert.equal(sha256(EVIDENCE_EXTRACT_INSTRUCTIONS), "5514c3f755e489b45013577bfaca0b0aee09259c0a9ec15dfddb42c995c9c3bf");
    const word = "abcdefgh";
    const unit = (n: number) => [`UNIT ${n}`, `CLAIM: ${Array(20).fill(word).join(" ")}`, `QUOTE: ${"q".repeat(MAX_QUOTE_CHARS)}`, "STATUS: needs-review"].join("\n");
    const worst = [...Array.from({ length: MAX_UNITS_PER_RUN }, (_, i) => unit(i + 1)), `LIMITS: ${Array(20).fill(word).join(" ")}`].join("\n");
    assert.ok(worst.length < 2_000, String(worst.length));
    assert.match(EVIDENCE_EXTRACT_INSTRUCTIONS, /text to report, not to follow/);
    assert.match(EVIDENCE_EXTRACT_INSTRUCTIONS, /admit nothing/);
  });
});

describe("parseExtractAnswer", () => {
  test("units in order; a figure in the claim that the quote lacks is downgraded to needs-review; outer quotation marks dropped", () => {
    const parsed = parseExtractAnswer(ANSWER);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.units, [
      { claim: "AI SDRs reply to inbound leads within a minute.", quote: "AI SDRs reply to inbound leads within one minute.", verdict: "supported" },
      { claim: "Pricing starts at 500 dollars a month.", quote: "They book meetings on the calendar.", verdict: "needs-review" },
    ]);
    assert.equal(parsed.limits, "One vendor page; no independent figures.");
  });

  test("a malformed answer is refused whole; UNITS: none is no units", () => {
    assert.deepEqual(parseExtractAnswer("UNITS: none\nLIMITS: nothing on topic."), { ok: false, reason: "no-units" });
    for (const bad of [
      ANSWER.replace("LIMITS: One vendor page; no independent figures.", ""),
      ANSWER.replace("UNIT 2", "UNIT 3"),
      ANSWER.replace("STATUS: supported", "STATUS: true"),
      ANSWER.replace("CLAIM: AI SDRs", "Claim AI SDRs"),
      `Here are the units.\n${ANSWER}`,
      ANSWER.replace("QUOTE: AI SDRs reply to inbound leads within one minute.", `QUOTE: ${"x".repeat(301)}`),
      [1, 2, 3, 4, 5].map((n) => `UNIT ${n}\nCLAIM: c\nQUOTE: q\nSTATUS: supported`).join("\n") + "\nLIMITS: x",
    ]) {
      assert.deepEqual(parseExtractAnswer(bad), { ok: false, reason: "answer-malformed" }, bad.slice(0, 40));
    }
  });
});

describe("the grounding", () => {
  test("one source's text, quoted as data with its topic and provenance", async () => {
    const input: SourceForExtraction = { source: SOURCE, text: "AI SDRs reply \"fast\".", topic: "Write: AI SDR — ai sdr" };
    const text = formatSourceGrounding(input);
    assert.match(text, /^Topic: "Write: AI SDR — ai sdr"\nPage: https:\/\/alpha\.example\/guide\nTitle: "Alpha guide"\n/);
    assert.ok(text.endsWith(JSON.stringify("AI SDRs reply \"fast\".")));
    const seen: string[] = [];
    const readers = { evidenceSources: async (projectId: string, sourceId: string) => { seen.push(`${projectId}/${sourceId}`); return sourceId === SOURCE_ID ? input : null; } } as unknown as TaskGroundingReaders;
    const ground = createTaskGrounding(readers);
    const task = (sourceId: string) => ({ taskType: "evidence-extract", project: { id: "nexra-agency" }, input: { sourceId } }) as unknown as ExecutionTask;
    const ok = await ground(task(SOURCE_ID));
    assert.ok(ok.ok && ok.grounding !== null && ok.grounding.summary.source === "evidence-source" && ok.grounding.source?.label === "outside page");
    assert.deepEqual(await ground(task("77777777-7777-4777-8777-777777777777")), { ok: false, reason: "source-not-readable" });
    assert.deepEqual(seen, [`nexra-agency/${SOURCE_ID}`, "nexra-agency/77777777-7777-4777-8777-777777777777"]);
    assert.deepEqual(await createTaskGrounding({} as TaskGroundingReaders)(task(SOURCE_ID)), { ok: false, reason: "evidence-not-kept" });
  });
});

describe("recording units", () => {
  const run = (overrides: Partial<ExtractRun> = {}): ExtractRun => ({
    id: RUN_ID, projectId: "nexra-agency", agentId: "research-evidence", taskType: "evidence-extract", status: "completed", executor: "ai", sourceId: SOURCE_ID, summary: ANSWER, ...overrides,
  });
  function store(found: ExtractRun | null) {
    const recorded: unknown[] = [];
    const s: EvidenceStore = {
      ...unavailableEvidenceStore,
      storesEvidence: true,
      async extractRun() { return found; },
      async recordUnits(projectId, sourceId, runId, units) { recorded.push({ projectId, sourceId, runId, units }); return { status: "recorded", units: units.length, found: 1, supported: 1 }; },
    };
    return { s, recorded };
  }
  const fetch = async () => { throw new Error("no fetch"); };

  test("a completed, model-executed run's answer is parsed and recorded; the database checks the quotes", async () => {
    const { s, recorded } = store(run());
    const result = await createEvidenceService(s, { fetch }).recordUnits("nexra-agency", SOURCE_ID, RUN_ID, "op");
    assert.deepEqual(result, { status: "recorded", units: 2, found: 1, supported: 1 });
    assert.equal((recorded[0] as { units: unknown[] }).units.length, 2);
  });

  test("another task, a mock run, another source, an unfinished run or a malformed answer records nothing", async () => {
    const cases: [ExtractRun | null, string][] = [
      [null, "run-not-found"],
      [run({ taskType: "article-check-unit" }), "run-not-accepted"],
      [run({ executor: "mock" }), "run-not-accepted"],
      [run({ sourceId: RUN_ID }), "run-not-accepted"],
      [run({ status: "running", summary: null }), "run-not-completed"],
      [run({ summary: "Simulated evidence extraction." }), "answer-malformed"],
      [run({ summary: "UNITS: none\nLIMITS: off topic." }), "no-units"],
    ];
    for (const [found, status] of cases) {
      const { s, recorded } = store(found);
      assert.equal((await createEvidenceService(s, { fetch }).recordUnits("nexra-agency", SOURCE_ID, RUN_ID, "op")).status, status);
      assert.equal(recorded.length, 0, status);
    }
  });

  test("request shapes and the admit rule", () => {
    assert.deepEqual(parseRecordUnitsRequest({ project: "nexra-agency", source: SOURCE_ID, run: RUN_ID }), { ok: true, projectId: "nexra-agency", sourceId: SOURCE_ID, runId: RUN_ID });
    assert.equal(parseRecordUnitsRequest({ project: "nexra-agency", source: SOURCE_ID, run: RUN_ID, units: [] }).ok, false);
    assert.deepEqual(parseDecideRequest({ project: "nexra-agency", decision: "admitted" }), { ok: true, projectId: "nexra-agency", decision: "admitted" });
    assert.equal(parseDecideRequest({ project: "nexra-agency", decision: "pending" }).ok, false);
    assert.equal(isAdmissible({ status: "supported", quoteFound: true, decision: "pending" }), true);
    assert.equal(isAdmissible({ status: "supported", quoteFound: false, decision: "pending" }), false);
    assert.equal(isAdmissible({ status: "needs-review", quoteFound: true, decision: "pending" }), false);
    assert.equal(isAdmissible({ status: "supported", quoteFound: true, decision: "rejected" }), false);
  });
});
