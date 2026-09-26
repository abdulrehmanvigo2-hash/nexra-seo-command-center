import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { TASK_TYPES, agentMayRun, getTaskType } from "../agent-runs/task-types.ts";
import { mayRunAutomatically } from "../agent-runs/action-policy.ts";
import { INVENTORY_RANGE_ID } from "../projects/grounding.ts";
import { TASK_OWNING_AGENTS } from "./contract.ts";
import { HANDOFF_DEFERRED, HANDOFF_MAP, handoffFor, handoffUnsupportedReason, taskActionFailure } from "./handoff.ts";

/**
 * The failure this file exists to prevent is a handoff that guesses: an
 * agent mapped to a task it may not run, an input its definition refuses,
 * a task that is not read-only, or an agent left out of both lists.
 */

describe("the handoff map", () => {
  test("every mapped task exists, is the agent's to run, is read-only, and accepts the mapped input without a chosen record", () => {
    for (const [agent, mapping] of Object.entries(HANDOFF_MAP)) {
      const definition = getTaskType(mapping.taskType);
      assert.ok(definition, `${agent}: ${mapping.taskType} exists`);
      assert.ok(agentMayRun(definition, agent as never), `${agent} may run ${mapping.taskType}`);
      assert.notEqual(definition.agents, "any", `${agent}: ${mapping.taskType} is that agent's own task, not the generic review`);
      assert.equal(definition.policy, "read-only", `${agent}: ${mapping.taskType} is read-only`);
      assert.ok(mayRunAutomatically(definition.policy));
      const parsed = definition.parseInput(mapping.input);
      assert.ok(parsed.ok, `${agent}: the input parses (${parsed.ok ? "" : parsed.error})`);
      if (parsed.ok) assert.deepEqual(parsed.value, mapping.input);
      const keys = Object.keys(mapping.input);
      assert.ok(keys.length === 0 || (keys.length === 1 && mapping.input.range === INVENTORY_RANGE_ID), `${agent}: no input, or the product's own window`);
      assert.doesNotMatch(mapping.label, /will (rank|improve|index)|traffic|guarantee/i);
    }
  });

  test("the mapped and the deferred agents together are exactly the twelve, and no deferred agent has an own read-only task that needs no chosen record", () => {
    const mapped = Object.keys(HANDOFF_MAP).sort();
    const deferred = Object.keys(HANDOFF_DEFERRED).sort();
    assert.deepEqual([...mapped, ...deferred].sort(), [...TASK_OWNING_AGENTS].sort());
    assert.equal(new Set([...mapped, ...deferred]).size, 12);
    assert.deepEqual(mapped, ["analytics-learning", "content-strategist", "keyword-intent", "project-manager", "research-evidence", "seo-director"]);
    for (const agent of deferred) {
      const own = TASK_TYPES.filter((definition) => definition.agents !== "any" && definition.agents.includes(agent as never) && definition.policy === "read-only");
      for (const definition of own) {
        assert.equal(definition.parseInput({}).ok, false, `${agent}: ${definition.id} needs a record no task names`);
        assert.equal(definition.parseInput({ range: INVENTORY_RANGE_ID }).ok, false, `${agent}: ${definition.id} is not a window review`);
      }
      assert.match(HANDOFF_DEFERRED[agent as keyof typeof HANDOFF_DEFERRED], /needs a chosen/);
    }
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
    assert.equal(handoffFor("technical-seo"), null);
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
    for (const error of ["unavailable", "task-not-found", "same-status", "same-owner", "terminal", "transition-not-allowed", "handoff-active", "handoff-unsupported", "run-refused", "invalid", "rate-limited", "unauthorized"]) {
      const text = taskActionFailure(409, { error });
      assert.ok(text.length > 20, error);
      assert.doesNotMatch(text, /was run|executed|ran the/i, error);
    }
    assert.match(taskActionFailure(0, null), /may have been applied/);
    assert.match(taskActionFailure(500, { error: "failed" }), /not applied/);
  });
});
