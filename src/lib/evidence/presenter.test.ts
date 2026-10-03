import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { EvidenceUnit } from "@/lib/evidence/contract";
import {
  acceptedOpportunities,
  decideConfirmation,
  extractionRuns,
  latestCompletedSerp,
  readState,
  recordOffered,
  serpConfirmation,
  serpEstimateUsd,
  sourceConfirmation,
  unitBadge,
  writeOutcome,
} from "@/lib/evidence/presenter";
import type { AcceptedOpportunity, OpportunitiesView } from "@/lib/opportunities/contract";
import type { SerpView } from "@/lib/serp/contract";
import type { AgentRun } from "@/types/agent-run";

/** M4, PR 7: the Evidence tab's states, confirmations and words, and the component's shape. */

const root = new URL("../../../", import.meta.url);
const OPP = { id: "o1", title: "Write: AI SDR", score: 62, acceptedAt: "2026-10-03T11:40:00Z" } as AcceptedOpportunity;
const unit = (overrides: Partial<EvidenceUnit> = {}): EvidenceUnit => ({
  id: "u1", projectId: "p", opportunityId: "o1", sourceId: "s1", runId: "r1", position: 1, claim: "c", quote: "q", runVerdict: "supported", quoteFound: true,
  status: "supported", decision: "pending", decidedAt: null, recordedAt: "2026-10-03T12:00:00Z", ...overrides,
});

describe("states and words", () => {
  test("a read is not set up on 503, failed on any other non-2xx or shape, ready otherwise", () => {
    const pick = (body: Record<string, unknown>) => (Array.isArray(body.sources) ? body.sources : null);
    assert.deepEqual(readState(503, null, pick), { status: "not-set-up" });
    assert.deepEqual(readState(500, { sources: [] }, pick), { status: "failed" });
    assert.deepEqual(readState(200, { other: 1 }, pick), { status: "failed" });
    assert.deepEqual(readState(200, { sources: [] }, pick), { status: "ready", value: [] });
  });

  test("accepted opportunities only from an approved map; the newest completed SERP is listed", () => {
    assert.deepEqual(acceptedOpportunities({ projectId: "p", state: "no-approved-map" } as OpportunitiesView), []);
    assert.deepEqual(acceptedOpportunities({ projectId: "p", state: "scored", accepted: [OPP] } as unknown as OpportunitiesView), [OPP]);
    const view = { runs: [{ run: { status: "failed" } }, { run: { status: "completed", id: "b" } }, { run: { status: "completed", id: "c" } }] } as unknown as SerpView;
    assert.equal(latestCompletedSerp(view)?.run.id, "b");
  });

  test("the SERP confirmation names the cost by mode and is no daily-run count; the page fetch costs nothing", () => {
    const live = serpConfirmation("nexra-agency", OPP, "live");
    assert.equal(live.usage, null);
    assert.match(live.facts.find((f) => f.label === "Mode")?.value ?? "", /Live — about \$0\.0024/);
    assert.match(live.consequence, /one paid DataForSEO call/);
    assert.match(serpConfirmation("nexra-agency", OPP, "sandbox").facts.find((f) => f.label === "Mode")?.value ?? "", /no charge/);
    assert.equal(serpEstimateUsd("live"), 0.0024);
    assert.equal(serpEstimateUsd("sandbox"), 0);
    assert.match(sourceConfirmation("p", "https://a.example").consequence, /robots\.txt[\s\S]*No model is called/);
    assert.match(decideConfirmation(unit(), "admitted").consequence, /cannot be changed/);
    assert.equal(decideConfirmation(unit(), "rejected").tone, "danger");
  });

  test("a unit's badge says what the database found", () => {
    assert.equal(unitBadge(unit({ quoteFound: false, status: "needs-review" })).label, "Quote not found in the page — needs review");
    assert.equal(unitBadge(unit()).label, "Supported — awaiting your decision");
    assert.equal(unitBadge(unit({ decision: "admitted" })).label, "Admitted");
    assert.equal(unitBadge(unit({ status: "needs-review" })).label, "Needs review");
  });

  test("record is offered once, for a completed model run of the source", () => {
    const run = (overrides: Partial<AgentRun>) => ({ id: "r1", taskType: "evidence-extract", status: "completed", executor: "ai", input: { sourceId: "s1" }, ...overrides }) as AgentRun;
    assert.deepEqual(extractionRuns([run({}), run({ id: "r2", input: { sourceId: "s2" } }), run({ id: "r3", taskType: "evidence-pack-review" })], "s1").map((r) => r.id), ["r1"]);
    assert.equal(recordOffered(run({}), []), true);
    assert.equal(recordOffered(run({}), [unit()]), false);
    assert.equal(recordOffered(run({ executor: "mock" }), []), false);
    assert.equal(recordOffered(run({ status: "queued" }), []), false);
  });

  test("answers in words", () => {
    assert.deepEqual(writeOutcome(201, {}, "Done."), { text: "Done.", tone: "neutral" });
    assert.match(writeOutcome(429, { error: "cap-reached" }, "x").text, /provider cap/);
    assert.match(writeOutcome(409, { error: "not-admissible" }, "x").text, /quote was found/);
    assert.match(writeOutcome(422, { error: "answer-malformed" }, "x").text, /nothing was recorded/);
    assert.match(writeOutcome(0, null, "x").text, /could not be sent/);
  });
});

describe("the component", () => {
  const component = readFileSync(new URL("src/components/content/evidence-tab.tsx", root), "utf8");
  const studio = readFileSync(new URL("src/components/content/observed-content.tsx", root), "utf8");

  test("mounted as the Evidence tab on its own reads", () => {
    assert.match(studio, /if \(tab === "evidence"\) return <EvidenceTab projectId=\{projectId\} \/>;/);
    for (const read of ["opportunitiesUrl(projectId)", "serpUrl(projectId, opportunity.id)", "evidenceSourcesUrl(projectId, opportunity.id)", "evidenceUnitsUrl(projectId, source.id)"]) assert.ok(component.includes(read), read);
    assert.match(component, /NOT_SET_UP_TITLE/);
  });

  test("every paid or decisive write goes through a confirmation; the page text is never shown beyond its preview", () => {
    for (const url of ['"/api/serp"', '"/api/evidence/sources"', '"/api/agent-runs"', "`/api/evidence/units/${unit.id}`"]) assert.ok(component.includes(url), url);
    assert.equal((component.match(/<SpendConfirmDialog/g) ?? []).length, 2);
    assert.doesNotMatch(component, /pageText|page_text/);
    assert.match(component, /<ProviderUsageBlock projectId=\{projectId\} estimateUsd=\{serpEstimateUsd\(mode\)\} mode=\{mode\} \/>/);
    assert.match(component, /isAdmissible\(unit\) &&/);
  });
});
