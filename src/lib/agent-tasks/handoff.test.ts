import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { TASK_TYPES, agentMayRun, getTaskType } from "../agent-runs/task-types.ts";
import { mayRunAutomatically } from "../agent-runs/action-policy.ts";
import { INVENTORY_RANGE_ID } from "../projects/grounding.ts";
import { TASK_OWNING_AGENTS } from "./contract.ts";
import {
  HANDOFF_DEFERRED,
  HANDOFF_MAP,
  handoffFor,
  handoffInput,
  handoffRecordKind,
  handoffUnsupportedReason,
  taskActionFailure,
  type HandoffRecord,
  type HandoffRecordKind,
} from "./handoff.ts";

/**
 * The failure this file exists to prevent is a handoff that guesses: an
 * agent mapped to a task it may not run, an input its definition refuses,
 * a task that is not read-only, or an agent left out of both lists.
 */

describe("the handoff map", () => {
  const SAMPLE_RECORD: Record<HandoffRecordKind, HandoffRecord> = {
    crawl: { crawlId: "c0000000-0000-4000-8000-000000000001" },
    competitor: { competitorDomain: "rival.example" },
  };

  test("every mapped task exists, is the agent's to run, is read-only, and accepts the mapped input with the operator's record where it reads one", () => {
    for (const [agent, mapping] of Object.entries(HANDOFF_MAP)) {
      const definition = getTaskType(mapping.taskType);
      assert.ok(definition, `${agent}: ${mapping.taskType} exists`);
      assert.ok(agentMayRun(definition, agent as never), `${agent} may run ${mapping.taskType}`);
      assert.notEqual(definition.agents, "any", `${agent}: ${mapping.taskType} is that agent's own task, not the generic review`);
      assert.equal(definition.policy, "read-only", `${agent}: ${mapping.taskType} is read-only`);
      assert.ok(mayRunAutomatically(definition.policy));
      const input = handoffInput(mapping, mapping.record === undefined ? null : SAMPLE_RECORD[mapping.record]);
      const parsed = definition.parseInput(input);
      assert.ok(parsed.ok, `${agent}: the input parses (${parsed.ok ? "" : parsed.error})`);
      if (parsed.ok) assert.deepEqual(parsed.value, input);
      const keys = Object.keys(mapping.input);
      assert.ok(keys.length === 0 || (keys.length === 1 && mapping.input.range === INVENTORY_RANGE_ID), `${agent}: no fixed input, or the product's own window`);
      if (mapping.record !== undefined) {
        // The fixed input alone never parses: the operator's record is required, never filled in.
        assert.equal(definition.parseInput(mapping.input).ok, false, `${agent}: needs the operator's record`);
        assert.match(mapping.label, /chosen by the operator/);
      }
      assert.doesNotMatch(mapping.label, /will (rank|improve|index)|traffic|guarantee/i);
    }
  });

  test("the five record-reading agents (cp 2.3): four read an own-site crawl, one a recorded competitor domain", () => {
    const withRecord = Object.entries(HANDOFF_MAP).filter(([, mapping]) => mapping.record !== undefined).map(([agent, mapping]) => [agent, mapping.taskType, mapping.record]);
    assert.deepEqual(withRecord.sort(), [
      ["ai-visibility", "answer-readiness-review", "crawl"],
      ["authority-backlink", "outbound-link-review", "crawl"],
      ["market-intelligence", "competitor-comparison-review", "competitor"],
      ["on-page-seo", "on-page-review", "crawl"],
      ["technical-seo", "crawl-review", "crawl"],
    ]);
    assert.equal(handoffRecordKind({ crawlId: "x" }), "crawl");
    assert.equal(handoffRecordKind({ competitorDomain: "x" }), "competitor");
    assert.deepEqual(handoffInput(HANDOFF_MAP["seo-director"]!, SAMPLE_RECORD.crawl), {}, "a record never reaches a mapping that reads none");
  });

  test("the mapped and the deferred agents together are exactly the twelve; only the Writer is deferred, for its draft policy", () => {
    const mapped = Object.keys(HANDOFF_MAP).sort();
    const deferred = Object.keys(HANDOFF_DEFERRED).sort();
    assert.deepEqual([...mapped, ...deferred].sort(), [...TASK_OWNING_AGENTS].sort());
    assert.equal(new Set([...mapped, ...deferred]).size, 12);
    assert.equal(mapped.length, 11);
    assert.deepEqual(deferred, ["writer"]);
    const own = TASK_TYPES.filter((definition) => definition.agents !== "any" && definition.agents.includes("writer" as never));
    assert.ok(own.length > 0 && own.every((definition) => definition.policy !== "read-only"), "the Writer has no read-only task to hand off");
    assert.match(HANDOFF_DEFERRED.writer ?? "", /draft policy, not read-only/);
    assert.match(HANDOFF_DEFERRED.writer ?? "", /read-only drift test/);
  });

  test("handoffFor and handoffUnsupportedReason are the two sides of one decision", () => {
    for (const agent of TASK_OWNING_AGENTS) {
      const mapping = handoffFor(agent);
      const reason = handoffUnsupportedReason(agent);
      assert.ok((mapping === null) !== (reason === null), agent);
    }
    assert.equal(handoffFor("seo-director")?.taskType, "project-priority-review");
    assert.equal(handoffFor("project-manager")?.taskType, "intake-review");
    assert.equal(handoffFor("keyword-intent")?.taskType, "search-query-review");
    assert.equal(handoffFor("technical-seo")?.taskType, "crawl-review");
    assert.equal(handoffFor("market-intelligence")?.record, "competitor");
    assert.equal(handoffFor("writer"), null);
  });

  test("the SQL link check and the run path agree on the provenance field", async () => {
    const sql = await readFile(new URL("../../../supabase/migrations/20261004120000_agent_task_workflow.sql", import.meta.url), "utf8");
    assert.match(sql, /\(v_run\.input ->> 'sourceTaskId'\) is distinct from v_task\.id::text/);
    const service = await readFile(new URL("../agent-runs/service.ts", import.meta.url), "utf8");
    assert.match(service, /sourceTaskId: options\.sourceTaskId\.toLowerCase\(\)/);
  });
});

describe("the failure wording", () => {
  test("names each refusal in the operator's terms and never claims a run happened", () => {
    for (const error of ["unavailable", "task-not-found", "same-status", "same-owner", "terminal", "transition-not-allowed", "handoff-active", "handoff-unsupported", "run-refused", "record-required", "record-not-accepted", "record-invalid", "invalid", "rate-limited", "unauthorized"]) {
      const text = taskActionFailure(409, { error });
      assert.ok(text.length > 20, error);
      assert.doesNotMatch(text, /was run|executed|ran the/i, error);
    }
    assert.match(taskActionFailure(0, null), /may have been applied/);
    assert.match(taskActionFailure(500, { error: "failed" }), /not applied/);
  });
});
