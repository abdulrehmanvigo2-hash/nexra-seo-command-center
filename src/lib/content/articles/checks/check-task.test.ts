import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAiExecutor } from "../../../agent-runs/ai-executor.ts";
import { mockAgentExecutor } from "../../../agent-runs/mock-executor.ts";
import type { ModelProvider } from "../../../agent-runs/providers/contract.ts";
import { isUpstreamTaskType } from "../../../agent-runs/run-grounding.ts";
import { createTaskGrounding, type TaskGroundingReaders } from "../../../agent-runs/task-grounding.ts";
import { agentMayRun, getTaskType } from "../../../agent-runs/task-types.ts";
import { ARTICLE_CHECK_LIMITS_NOTE, ARTICLE_CHECK_UNIT_INSTRUCTIONS } from "../../article-check-prompt.ts";
import { FACT_CHECK_CLOSING, FACT_CHECK_INSTRUCTIONS, FACT_CHECK_SECTIONS } from "../../drafts/fact-check-grounding.ts";
import { articleCheckRequest, ARTICLE_CHECK_UNIT } from "../../../crawl/review-request.ts";
import type { AgentId } from "../../../../types/agent.ts";
import { readArticleCheckGrounding } from "./grounding.ts";
import {
  ARTICLE_ID,
  article,
  content,
  evidencePack,
  memoryCheckStore,
  OTHER_PROJECT_ID,
  PROJECT,
  PROJECT_ID,
  storedVersion,
  unitsOf,
} from "./test-support/fixtures.ts";
import { unitSha256 } from "./unit-hash.ts";

/**
 * Stage 5, milestone C4: the `article-check-unit` task — its input
 * contract, the reader that re-reads the version and regenerates its units
 * before any provider call, and the prompt the Research & Evidence agent
 * gets. No provider is reached except the recording fake below.
 */

const V1 = storedVersion(1, content());
const V2 = storedVersion(2, content((raw) => (raw.title = "A second title")));
const definition = getTaskType("article-check-unit");

function input(overrides: Record<string, unknown> = {}) {
  return { articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: 3, ...overrides };
}

function setup(options: { status?: "drafting" | "archived"; versions?: ReturnType<typeof storedVersion>[] } = {}) {
  const store = memoryCheckStore({ articles: [article({ status: options.status ?? "drafting", currentVersion: 2 })], versions: options.versions ?? [V1, V2], runs: [] });
  const calls: string[] = [];
  return { store, calls, readers: { checks: store, evidencePack: evidencePack(calls) } };
}

describe("the task type", () => {
  test("is registered for the Research & Evidence agent alone, read-only, over one article unit, and is not a hand-off source", () => {
    assert.ok(definition);
    assert.equal(definition.policy, "read-only");
    assert.equal(definition.evidence, "article-unit");
    assert.deepEqual(definition.agents, ["research-evidence"]);
    for (const agent of ["writer", "content-strategist", "seo-director", "on-page-seo"] as AgentId[]) assert.equal(agentMayRun(definition, agent), false, agent);
    assert.equal(isUpstreamTaskType("article-check-unit"), false);
    assert.equal(definition.instructions, ARTICLE_CHECK_UNIT_INSTRUCTIONS);
  });

  test("accepts exactly an article id, a version number, that version's row id and a unit index, lowercased", () => {
    const parsed = definition!.parseInput(input({ articleId: ARTICLE_ID.toUpperCase(), articleVersionId: V1.id.toUpperCase() }));
    assert.deepEqual(parsed, { ok: true, value: { articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: 3 } });
  });

  test("refuses a missing, negative, fractional or out-of-range unit index, and never defaults one", () => {
    const { unitIndex: _omit, ...missing } = input();
    void _omit;
    const refused = definition!.parseInput(missing);
    assert.ok(!refused.ok && /unitIndex is required/.test(refused.error));
    for (const bad of [-1, 1.5, "3", null, 150, Number.NaN]) {
      assert.equal(definition!.parseInput(input({ unitIndex: bad })).ok, false, String(bad));
    }
  });

  test("refuses text, hashes, a status or any other field a browser might send", () => {
    for (const extra of [{ unitText: "x" }, { unitSha256: "a".repeat(64) }, { status: "passed" }, { unitKey: "cta" }]) {
      assert.equal(definition!.parseInput(input(extra)).ok, false, JSON.stringify(extra));
    }
    assert.equal(definition!.parseInput(input({ articleId: "not-a-uuid" })).ok, false);
    assert.equal(definition!.parseInput(input({ articleVersion: 0 })).ok, false);
    assert.equal(definition!.parseInput(input({ articleVersionId: "v1" })).ok, false);
  });

  test("the mock executor checks nothing and says so", async () => {
    const out = await mockAgentExecutor.execute(
      { runId: "r", attempt: 1, agent: { id: "research-evidence", name: "Research & Evidence" }, project: { id: PROJECT_ID, name: "N", domain: PROJECT.domain }, taskType: "article-check-unit", input: input() },
      new AbortController().signal,
    );
    assert.equal(out.metadata?.simulated, true);
    assert.equal(out.metadata?.grounded, false);
    assert.match(out.summary, /checked nothing; this is placeholder output, not a fact-check/);
  });
});

describe("the reader", () => {
  test("a valid middle section unit: the exact unit of the exact version, quoted as data, beside the records", async () => {
    const { readers, calls } = setup();
    const result = await readArticleCheckGrounding(readers, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: 3 });
    assert.ok(result.ok, JSON.stringify(result));
    const unit = unitsOf(V1)[3];
    const { text, summary } = result.grounding;
    assert.equal(summary.unitKey, "section:where-it-stops:1");
    assert.equal(summary.unitBlock, "section:where-it-stops");
    assert.deepEqual([summary.part, summary.partCount, summary.unitCount], [1, 1, 6]);
    assert.equal(summary.unitIndex, 3);
    assert.equal(summary.unitSha256, unitSha256(unit));
    assert.equal(summary.articleVersion, 1);
    assert.equal(summary.articleVersionId, V1.id);
    assert.equal(summary.wasCurrent, false);
    assert.deepEqual(summary.recordPaths, ["/services"]);
    assert.ok(text.includes(unit.text), "the unit's exact canonical text is quoted");
    assert.match(text, /UNIT UNDER CHECK \(PART OF AN UNAPPROVED ARTICLE VERSION — NOT EVIDENCE/);
    assert.match(text, /unit index 3 \(zero-based\) of 6, key section:where-it-stops:1 — part 1 of 1 of block section:where-it-stops\. It holds \d+ numbered statements, S1 to S\d+/);
    assert.match(text, /Version 2 is current; this earlier version is checked as it was written/);
    assert.ok(text.endsWith(ARTICLE_CHECK_LIMITS_NOTE));
    for (const other of unitsOf(V1).filter((u) => u.index !== 3)) assert.equal(text.includes(other.text), false, `unit ${other.index} leaked`);
    assert.ok(calls.some((call) => call.startsWith("own:")), "the records were re-read");
  });

  test("refuses before reading any record: wrong project, archived, wrong version, wrong version id", async () => {
    const cases: [Record<string, unknown>, string, ("drafting" | "archived")?][] = [
      [{ projectId: OTHER_PROJECT_ID }, "article-not-found"],
      [{ articleId: "a0000000-0000-4000-8000-000000000009" }, "article-not-found"],
      [{}, "article-archived", "archived"],
      [{ articleVersion: 7 }, "version-not-found"],
      [{ articleVersionId: V2.id }, "version-id-mismatch"],
    ];
    for (const [change, reason, status] of cases) {
      const { readers, calls } = setup({ status });
      const result = await readArticleCheckGrounding(readers, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: 3, ...change } as never);
      assert.deepEqual(result, { ok: false, reason }, JSON.stringify(change));
      assert.deepEqual(calls, [], "no record was read");
    }
  });

  test("refuses a missing, negative or out-of-range unit index — never falls back to another unit", async () => {
    for (const [unitIndex, reason] of [
      [undefined, "unit-index-missing"],
      [null, "unit-index-missing"],
      [-1, "unit-index-invalid"],
      [2.5, "unit-index-invalid"],
      [6, "unit-out-of-range"],
      [149, "unit-out-of-range"],
      [150, "unit-index-invalid"],
    ] as const) {
      const { readers, calls } = setup();
      const result = await readArticleCheckGrounding(readers, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex });
      assert.deepEqual(result, { ok: false, reason }, String(unitIndex));
      assert.deepEqual(calls, []);
    }
  });

  test("refuses every unit of a version with a statement too large for a unit, or more than 150 units — nothing is truncated", async () => {
    const big = storedVersion(1, content((raw) => ((raw.sections as { paragraphs: string[] }[])[1].paragraphs = ["é".repeat(3_400)])));
    const one = setup({ versions: [big] });
    for (const unitIndex of [0, 3]) {
      assert.deepEqual(await readArticleCheckGrounding(one.readers, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: big.id, unitIndex }), { ok: false, reason: "article-statement-too-large" });
    }
    assert.deepEqual(one.calls, []);
    const huge = storedVersion(
      1,
      content((raw) => {
        raw.sections = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, heading: `Section ${i}`, paragraphs: Array.from({ length: 6 }, (_, p) => Array.from({ length: 10 }, (_, k) => `P${p} line ${k}.`).join(" ")), subsections: [] }));
        raw.internalLinks = [];
      }),
    );
    const two = setup({ versions: [huge] });
    assert.deepEqual(await readArticleCheckGrounding(two.readers, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: huge.id, unitIndex: 0 }), { ok: false, reason: "article-too-many-units" });
    assert.deepEqual(two.calls, []);
  });

  test("refuses a stored text that no longer verifies, and a unit already carrying a final result", async () => {
    const tampered = { ...V1, contentSha256: "0".repeat(64) };
    const one = setup({ versions: [tampered] });
    assert.deepEqual(await readArticleCheckGrounding(one.readers, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: 3 }), { ok: false, reason: "version-unreadable" });

    const two = setup();
    const unit = unitsOf(V1)[3];
    two.store.rows.push({
      id: "f0000000-0000-4000-8000-000000000001", articleId: ARTICLE_ID, articleVersionId: V1.id, articleVersion: 1, unitIndex: 3, unitKind: "section", unitKey: unit.key, unitSha256: unitSha256(unit),
      part: 1, partCount: 1, unitCount: 6,
      status: "passed", result: null, checkedByRunId: "c0000000-0000-4000-8000-000000000001", createdAt: "x", updatedAt: "x",
    });
    assert.deepEqual(await readArticleCheckGrounding(two.readers, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: 3 }), { ok: false, reason: "unit-already-checked" });
    two.store.rows[0] = { ...two.store.rows[0], status: "failed", unitSha256: "1".repeat(64) };
    assert.deepEqual(await readArticleCheckGrounding(two.readers, { projectId: PROJECT_ID, articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: 3 }), { ok: false, reason: "unit-hash-mismatch" });
  });

  test("through the runtime: a refusal stops the attempt before the provider is called; a valid unit reaches it grounded", async () => {
    const prompts: string[] = [];
    const provider: ModelProvider = {
      id: "anthropic",
      model: "test-model",
      async generate(request) {
        prompts.push(request.prompt);
        return { text: "ok", model: "test-model", inputTokens: 1, outputTokens: 1 };
      },
    };
    const { readers } = setup();
    const executor = createAiExecutor(provider, createTaskGrounding({ articleCheck: readers } as unknown as TaskGroundingReaders));
    const task = (unitIndex: unknown) => ({
      runId: "r",
      attempt: 1,
      agent: { id: "research-evidence" as const, name: "Research & Evidence" },
      project: { id: PROJECT_ID, name: "Nexra Agency", domain: PROJECT.domain },
      taskType: "article-check-unit" as const,
      input: { articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex } as never,
    });
    await assert.rejects(executor.execute(task(99), new AbortController().signal), /execution-failed/);
    await assert.rejects(executor.execute(task(undefined), new AbortController().signal), /execution-failed/);
    assert.equal(prompts.length, 0, "no provider call on a refusal");
    const out = await executor.execute(task(2), new AbortController().signal);
    assert.equal(prompts.length, 1);
    assert.equal(out.metadata?.grounded, true);
    assert.equal((out.metadata?.evidence as { unitKey: string }).unitKey, "section:what-it-does:1");
    assert.ok(prompts[0].includes(unitsOf(V1)[2].text));
  });
});

describe("the prompt", () => {
  test("says the numbered statements are the thing checked, never evidence; context is not checked", () => {
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /Check only the numbered statements of the UNIT UNDER CHECK/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /"context" headings are for orientation only: do not check them/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /at most 10 statements, numbered S1 upward/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /opens with the statement's number and a colon/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /Never leave a statement out, never place one twice/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /The quoted unit is the thing being checked, never evidence/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /do not check or describe any other part of the article/);
    assert.match(ARTICLE_CHECK_LIMITS_NOTE, /Only the numbered statements of this one unit are checked/);
  });

  test("uses the five classifications and the draft check's fixed headings and closing, so the same parser reads it", () => {
    for (const heading of FACT_CHECK_SECTIONS) assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS.includes(heading), heading);
    for (const word of ["SUPPORTED", "PARTIAL", "UNSUPPORTED", "UNVERIFIABLE", "EDITORIAL"]) assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS.includes(`${word}:`) || ARTICLE_CHECK_UNIT_INSTRUCTIONS.includes(word));
    assert.ok(ARTICLE_CHECK_UNIT_INSTRUCTIONS.endsWith(`End with exactly this sentence: ${FACT_CHECK_CLOSING}`));
  });

  test("keeps the grounding rules: records only, absence is not falsehood, no approval, no publication, size bound", () => {
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /RECORDED PROJECT EVIDENCE, which is the only source of facts/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /Never write that a statement is false, untrue or wrong: absence from the records is not falsehood/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /Do not approve the content/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /nothing is published/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /Keep the whole answer under 1,800 characters/);
    assert.match(ARTICLE_CHECK_LIMITS_NOTE, /Absence from these records is never evidence that a statement is untrue/);
  });

  test("observations: only under EDITORIAL, unnumbered, prefixed Observation:, bounded, never a classification — no conflicting instruction", () => {
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /write it only under EDITORIAL/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /the word Observation and a colon, with no statement number and no quotation marks/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /Write at most 3 observations/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /an observation never classifies a statement and never replaces one/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /Write nothing else outside the six sections/);
    assert.match(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /under exactly one heading, once each, and nothing else apart from the observations described below/);
    assert.doesNotMatch(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /report it as an observation under EDITORIAL and carry on/);
    assert.doesNotMatch(ARTICLE_CHECK_UNIT_INSTRUCTIONS, /\$\{/, "the template is filled in");
  });

  test("the draft fact-check's own instructions are unchanged", () => {
    assert.equal(getTaskType("draft-fact-check")?.instructions, FACT_CHECK_INSTRUCTIONS);
    assert.doesNotMatch(FACT_CHECK_INSTRUCTIONS, /UNIT UNDER CHECK|article/i);
  });
});

describe("the queue request", () => {
  const versionRef = { version: 1, versionId: V1.id, refusal: null };
  const unit = (overrides: Partial<{ index: number; record: { status: string } | null }> = {}) => ({ index: 3, record: null, ...overrides });

  test("names exactly the article, version, version id and the operator's unit — nothing else", () => {
    const request = articleCheckRequest(PROJECT_ID, { id: ARTICLE_ID, status: "drafting" }, versionRef, unit());
    assert.ok(request.ok);
    assert.deepEqual(request.payload, {
      projectId: PROJECT_ID,
      agentId: ARTICLE_CHECK_UNIT.agentId,
      taskType: "article-check-unit",
      input: { articleId: ARTICLE_ID, articleVersion: 1, articleVersionId: V1.id, unitIndex: 3 },
    });
    assert.ok(getTaskType("article-check-unit")!.parseInput(request.payload.input).ok);
  });

  test("is not offered with no unit chosen, for an archived article, a refused version, or a unit already final", () => {
    assert.equal(articleCheckRequest(PROJECT_ID, { id: ARTICLE_ID, status: "drafting" }, versionRef, null).ok, false);
    assert.equal(articleCheckRequest(PROJECT_ID, { id: ARTICLE_ID, status: "archived" }, versionRef, unit()).ok, false);
    assert.equal(articleCheckRequest(PROJECT_ID, { id: ARTICLE_ID, status: "drafting" }, { ...versionRef, refusal: "too-many-units" }, unit()).ok, false);
    assert.equal(articleCheckRequest(PROJECT_ID, { id: ARTICLE_ID, status: "drafting" }, { ...versionRef, refusal: "statement-too-large" }, unit()).ok, false);
    for (const status of ["passed", "needs-review"]) {
      assert.equal(articleCheckRequest(PROJECT_ID, { id: ARTICLE_ID, status: "drafting" }, versionRef, unit({ record: { status } })).ok, false, status);
    }
    assert.equal(articleCheckRequest(PROJECT_ID, { id: ARTICLE_ID, status: "drafting" }, versionRef, unit({ record: { status: "failed" } })).ok, true, "a failed check may be run again");
  });
});
