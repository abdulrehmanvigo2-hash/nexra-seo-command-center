import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { OpportunitiesView } from "@/lib/opportunities/contract";
import {
  acceptConfirmation,
  acceptedFor,
  acceptOutcome,
  monitoredLine,
  NOT_SET_UP_TITLE,
  priorityBadge,
  readLine,
  sectionState,
  SOURCE_LABEL,
  targetLine,
} from "@/lib/opportunities/presenter";
import { scoreOpportunities } from "@/lib/opportunities/score";
import { approvedMap, CRAWL_ID, FINDINGS, PAIRS, PAIRS_END_DATE } from "@/lib/opportunities/test-support/production-shape";

/** M2, PR 6: what the Content opportunities section says for every answer, and where it is mounted. */

const root = new URL("../../../", import.meta.url);
const result = scoreOpportunities({ map: approvedMap(true), pairs: { endDate: PAIRS_END_DATE, rows: PAIRS }, findings: { crawlId: CRAWL_ID, rows: FINDINGS } });
const view: Extract<OpportunitiesView, { state: "scored" }> = {
  projectId: "nexra-agency",
  state: "scored",
  map: { id: approvedMap(true).map.id, approvedAt: "2026-10-03T11:29:04Z", clusters: 10 },
  result,
  accepted: [],
};

describe("the section's states", () => {
  test("503 is not set up; sign-in, limits and a malformed answer are failures in words; a good answer is ready", () => {
    assert.deepEqual(sectionState(503, { error: "not-set-up" }), { status: "not-set-up" });
    assert.equal(NOT_SET_UP_TITLE, "Not set up yet");
    assert.match((sectionState(401, null) as { message: string }).message, /Sign in again/);
    assert.match((sectionState(429, null) as { message: string }).message, /Too many reads/);
    assert.equal(sectionState(500, { error: "failed" }).status, "failed");
    assert.equal(sectionState(200, { view: { state: "scored" } }).status, "failed", "a scored view without a result is refused");
    assert.equal(sectionState(200, { view: { projectId: "x", state: "no-approved-map" } }).status, "ready");
    assert.equal(sectionState(200, { view }).status, "ready");
  });

  test("what was read, in one line; the monitored clusters named, not listed", () => {
    assert.equal(
      readLine(view),
      "Scored from topic map 2213a93d, approved 2026-10-03 (10 clusters), the Search Console window ending 2026-09-29 (15 stored query × page rows; 11 queries match no cluster), and 5 findings of crawl 75d1bfbe.",
    );
    const bare: typeof view = { ...view, result: scoreOpportunities({ map: approvedMap(true), pairs: null, findings: null }) };
    assert.match(readLine(bare), /no Search Console window stored, and no crawl findings recorded\.$/);
    assert.equal(monitoredLine(view), "3 covered clusters monitored, not listed: AI SDR, missed call text back, AI dead lead reactivation.");
  });

  test("targets, labels, priority tones and the accepted marker", () => {
    const write = result.opportunities.find((o) => o.action === "write")!;
    const expand = result.opportunities.find((o) => o.action === "expand")!;
    assert.equal(targetLine(write), "/blog/ai-receptionist-for-small-business · candidate — not created");
    assert.equal(targetLine(expand), "/blog/ai-lead-follow-up-automation");
    assert.deepEqual(SOURCE_LABEL, { observed: "Observed", "provider-estimate": "Provider estimate", derived: "Derived" });
    assert.deepEqual([priorityBadge("high").tone, priorityBadge("medium").tone, priorityBadge("low").tone], ["warning", "accent", "neutral"]);
    assert.equal(acceptedFor(view, expand), undefined);
    const accepted = { ...view, accepted: [{ id: "o", projectId: "nexra-agency", mapId: view.map.id, clusterId: expand.clusterId, action: expand.action, findingKey: null, title: expand.title, score: expand.score, rulesVersion: 1, priority: expand.priority, signals: expand.signals, gscEndDate: null, crawlId: null, taskId: "t-1", acceptedBy: "u", acceptedAt: "2026-10-03T12:00:00Z" }] };
    assert.equal(acceptedFor(accepted, expand)?.taskId, "t-1");
  });

  test("the confirmation names the task, score, owner and backlog status, and says it costs nothing and runs nothing", () => {
    const top = result.opportunities[0]!;
    const c = acceptConfirmation("nexra-agency", top);
    assert.deepEqual(c.facts.map((f) => f.label), ["Project", "Task", "Score", "Owner", "Status", "Cost"]);
    assert.equal(c.facts[2]!.value, "75 of 100 · High priority");
    assert.equal(c.facts[3]!.value, "Content Strategist");
    assert.equal(c.facts[5]!.value, "None: no provider call, no agent run");
    assert.match(c.consequence, /queues no run and publishes nothing/);
    assert.equal(c.usage, null);
  });

  test("every answer of the accept route has words", () => {
    assert.match(acceptOutcome(201, {}).text, /^Accepted/);
    assert.match(acceptOutcome(200, {}).text, /^Already accepted/);
    assert.match(acceptOutcome(503, {}).text, /migration 20261021120000/);
    for (const error of ["no-approved-map", "map-not-approved", "opportunity-not-found", "cluster-not-found", "invalid"]) assert.equal(acceptOutcome(409, { error }).tone, "warning");
    assert.match(acceptOutcome(0, null).text, /Nothing is known to have been recorded/);
  });
});

describe("the screen", () => {
  const component = readFileSync(new URL("src/components/keywords/content-opportunities.tsx", root), "utf8");
  const workspace = readFileSync(new URL("src/components/keywords/keywords-workspace.tsx", root), "utf8");

  test("mounted at the top of the Opportunities tab on its own read, outside the inventory's states", () => {
    const mount = workspace.indexOf('{tab === "opportunities" && <ContentOpportunitiesSection');
    assert.ok(mount > 0);
    assert.ok(mount < workspace.indexOf("The tabs over the observed inventory show its state until it is read"), "above the inventory states, so a missing Search Console read does not hide it");
    assert.match(component, /fetch\(opportunitiesUrl\(projectId\)/);
    assert.match(component, /NOT_SET_UP_TITLE/);
  });

  test("the only write is the accept POST, behind the confirmation; it sends no score or line", () => {
    assert.match(component, /<SpendConfirmDialog[\s\S]*acceptConfirmation\(projectId, dialog\)/);
    assert.match(component, /JSON\.stringify\(\{ project: projectId, clusterId: opportunity\.clusterId, action: opportunity\.action/);
    assert.doesNotMatch(component, /score:|signals:/);
    assert.equal((component.match(/method: "POST"/g) ?? []).length, 1);
  });
});
