import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentRun, AgentRunStatus } from "../../../types/agent-run.ts";
import { offersSaveAsDraft, writerRunEligibility } from "./eligibility.ts";
import { CRAWL_ID, PLAN_ID, WRITER_OUTPUT, writerRun } from "./test-support/fixtures.ts";

describe("writerRunEligibility", () => {
  test("a completed, grounded Writer draft of this project is eligible, with its provenance read from the run", () => {
    const result = writerRunEligibility(writerRun(), "nexra-agency");
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.source.planRunId, PLAN_ID);
    assert.equal(result.source.crawlId, CRAWL_ID);
    assert.equal(result.source.sectionIndex, 1);
    assert.equal(result.source.output.sectionLabel, "What automated lead follow-up does [crawl /]");
    assert.equal(result.source.output.claims.length, 3);
  });

  test("is refused, in order, for every run the draft may not come from", () => {
    const cases: [Partial<AgentRun>, string, string][] = [
      [{ projectId: "halcyon-fintech" }, "nexra-agency", "run-not-in-project"],
      [{ agentId: "content-strategist" }, "nexra-agency", "wrong-agent"],
      [{ taskType: "content-plan-review", input: {} }, "nexra-agency", "wrong-task"],
      [{ status: "queued", resultSummary: null, resultMetadata: null, executor: null }, "nexra-agency", "run-unfinished"],
      [{ status: "running" }, "nexra-agency", "run-unfinished"],
      [{ status: "failed" }, "nexra-agency", "run-not-completed"],
      [{ status: "cancelled" }, "nexra-agency", "run-not-completed"],
      [{ resultSummary: "" }, "nexra-agency", "run-no-result"],
      [{ resultSummary: null }, "nexra-agency", "run-no-result"],
      [{ executor: "mock", resultMetadata: { simulated: true, grounded: false } }, "nexra-agency", "run-simulated"],
      [{ executor: "mock", resultMetadata: { simulated: false, grounded: true } }, "nexra-agency", "run-simulated"],
      [{ resultMetadata: { simulated: false, grounded: false } }, "nexra-agency", "run-not-grounded"],
      [{ resultMetadata: null }, "nexra-agency", "run-not-grounded"],
      [{ resultMetadata: { simulated: false, grounded: true } }, "nexra-agency", "provenance-missing"],
      [{ resultMetadata: { simulated: false, grounded: true, evidence: { source: "crawl", crawlId: CRAWL_ID } } }, "nexra-agency", "provenance-missing"],
      [{ resultMetadata: { simulated: false, grounded: true, evidence: { source: "content-draft", planRunId: PLAN_ID } } }, "nexra-agency", "provenance-missing"],
      [{ resultSummary: "Simulated section draft by Writer for nexraagency.com." }, "nexra-agency", "output-malformed"],
    ];
    for (const [overrides, projectId, reason] of cases) {
      const result = writerRunEligibility(writerRun(overrides), projectId);
      assert.equal(result.ok, false, JSON.stringify(overrides));
      assert.equal(result.ok ? null : result.reason, reason, JSON.stringify(overrides));
    }
  });

  test("the Writer's evidence-needed answer is ineligible, with the parser's reason carried", () => {
    const none = writerRun({
      resultSummary: WRITER_OUTPUT.replace("SECTION\nWhat automated lead follow-up does [crawl /]", "SECTION\nnone — no outline section carries a record tag"),
    });
    const result = writerRunEligibility(none, "nexra-agency");
    assert.deepEqual(result, { ok: false, reason: "output-malformed", detail: "section-none" });
  });

  test("a section index the run did not record is null, never invented", () => {
    const metadata = writerRun().resultMetadata as Record<string, unknown>;
    const evidence = { ...(metadata.evidence as Record<string, unknown>) };
    delete evidence.sectionIndex;
    const result = writerRunEligibility(writerRun({ resultMetadata: { ...metadata, evidence } as AgentRun["resultMetadata"] }), "nexra-agency");
    assert.ok(result.ok && result.source.sectionIndex === null);
  });
});

describe("offersSaveAsDraft", () => {
  test("offers the control for a completed grounded Writer draft and for nothing else", () => {
    assert.equal(offersSaveAsDraft(writerRun()), true);
    for (const status of ["queued", "running", "failed", "cancelled"] as AgentRunStatus[]) {
      assert.equal(offersSaveAsDraft(writerRun({ status })), false, status);
    }
    assert.equal(offersSaveAsDraft(writerRun({ agentId: "content-strategist", taskType: "content-plan-review" })), false);
    assert.equal(offersSaveAsDraft(writerRun({ taskType: "crawl-review", agentId: "technical-seo" })), false);
    assert.equal(offersSaveAsDraft(writerRun({ executor: "mock", resultMetadata: { simulated: true, grounded: false } })), false);
    assert.equal(offersSaveAsDraft(writerRun({ resultMetadata: { simulated: false, grounded: false } })), false);
    assert.equal(offersSaveAsDraft(writerRun({ resultSummary: "" })), false);
  });
});
