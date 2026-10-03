import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { queueConfirmation } from "@/lib/agent-runs/spend-confirm";
import { BRIEF_REQUEST, briefRunLine, briefRuns, latestBrief, supportLabel } from "@/lib/briefs/presenter";
import type { AgentRun } from "@/types/agent-run";

/** M5, PR 3: the Brief panel on the Evidence tab. */

const root = new URL("../../../", import.meta.url);
const OPP = "11111111-1111-4111-8111-111111111111";
const BRIEF = [
  "ANGLE: Show the approval gate.", "OUTLINE:", "H2: What it does — Answer plainly.", "H2: Where a person approves — The gate.", "H2: What to measure — Replies.",
  "FAQ:", "Q: What does it do?", "Q: Who approves?", "EVIDENCE:", "E: 1 — [evidence E1]", "E: 2 — [crawl /ai-sdr]", "E: 3 — opinion",
  "EVIDENCE NEEDED: None.", "LINKS:", "L: /ai-sdr — 2", "LIMITS: One outside page.", "NEXT: Draft the first H2.",
].join("\n");

const run = (over: Partial<AgentRun>): AgentRun =>
  ({ id: "aaaaaaaa-0000-4000-8000-000000000000", projectId: "nexra-agency", agentId: "content-strategist", taskType: "opportunity-brief", input: { opportunityId: OPP }, status: "completed", executor: "ai", resultSummary: BRIEF, error: null, createdAt: "2026-10-03T13:00:00Z", finishedAt: "2026-10-03T13:01:00Z", ...over }) as AgentRun;

describe("the brief presenter", () => {
  test("only this opportunity's brief runs", () => {
    const runs = [run({ id: "a1" }), run({ id: "a2", input: { opportunityId: "22222222-2222-4222-8222-222222222222" } }), run({ id: "a3", taskType: "content-plan-review", input: {} }), run({ id: "a4", input: { opportunityId: OPP.toUpperCase() } })];
    assert.deepEqual(briefRuns(runs, OPP).map((r) => r.id), ["a1", "a4"]);
  });

  test("the newest completed model brief is read back; a simulated or failed run never is; an off-format answer is shown as stored", () => {
    assert.deepEqual(latestBrief([]), { state: "none" });
    assert.equal(latestBrief([run({ executor: "mock", resultSummary: "Simulated" }), run({ status: "failed", resultSummary: null })]).state, "none");
    const shown = latestBrief([run({ status: "queued", resultSummary: null }), run({ id: "newest" }), run({ id: "older", resultSummary: "x" })]);
    assert.ok(shown.state === "brief" && shown.run.id === "newest" && shown.brief.outline.length === 3);
    assert.deepEqual(latestBrief([run({ resultSummary: "Here is a brief." })]), { state: "unparsed", run: run({ resultSummary: "Here is a brief." }), text: "Here is a brief." });
  });

  test("run lines and support labels in words", () => {
    assert.equal(briefRunLine(run({ executor: "mock" })), "Brief aaaaaaaa · completed · simulated, never a brief · 2026-10-03 13:00 UTC");
    assert.equal(briefRunLine(run({ status: "failed", error: { code: "rejected-output", message: "m" } })), "Brief aaaaaaaa · failed · rejected-output · 2026-10-03 13:00 UTC");
    assert.equal(supportLabel("[crawl /ai-sdr]"), "Crawled page /ai-sdr");
    assert.equal(supportLabel("[evidence E2]"), "Admitted evidence E2");
    assert.equal(supportLabel("opinion"), "Opinion — would be an attested paragraph");
  });

  test("the queue confirmation names the task, project and opportunity, and counts toward the run limit", () => {
    const confirmation = queueConfirmation({ projectId: "nexra-agency", ...BRIEF_REQUEST, input: { opportunityId: OPP } });
    assert.equal(confirmation.usage, "created");
    assert.ok(confirmation.facts.some((f) => f.label === "Reads" && f.value.startsWith("Accepted opportunity 11111111")));
    assert.ok(confirmation.facts.some((f) => f.label === "Project" && f.value === "nexra-agency"));
  });
});

describe("the panel", () => {
  const panel = readFileSync(new URL("src/components/content/opportunity-brief.tsx", root), "utf8");
  const tab = readFileSync(new URL("src/components/content/evidence-tab.tsx", root), "utf8");

  test("mounted on the Evidence tab; Draft brief… opens the queue confirmation; Run Now only on a queued run", () => {
    assert.match(tab, /<OpportunityBriefPanel/);
    assert.match(tab, /confirmation: queueConfirmation\(briefRequest\), run: \(\) => void briefPost\.send\("\/api\/agent-runs", briefRequest/);
    assert.match(panel, /run\.status === "queued" && <RunNowButton/);
    assert.match(panel, /Model proposal/);
    const briefPanel = panel.slice(panel.indexOf("export function OpportunityBriefPanel"), panel.indexOf("function ArticleDraftSection"));
    assert.doesNotMatch(briefPanel, /fetch\(/, "the brief panel itself writes nothing; the parent owns its POST (M6's article draft section queues its own parts)");
  });
});
