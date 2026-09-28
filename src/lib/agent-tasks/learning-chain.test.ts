import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import type { AgentTaskEvent } from "./contract.ts";
import { citableDirectorRuns, citedPriorityUrl, describeCitation, directorRunsUrl, learningChain, performanceReviewsRead, type CitedChange } from "./learning-chain.ts";
import type { AgentRun } from "../../types/agent-run.ts";

/**
 * The learning loop (Phase 6, checkpoint 6.7, decision Q7): performance
 * review → Director run (its bundle names the review) → a priority change
 * citing that run. Every link is one a record names; nothing is inferred.
 */

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const PERF = "17623686-d956-4eb4-a96e-5563b50e0b4f";
const OTHER_PERF = "7711726c-77c9-4662-987a-94938de56fff";

function run(over: Partial<AgentRun> & { id: string }): AgentRun {
  return {
    projectId: "nexra-agency",
    agentId: "seo-director",
    taskType: "project-priority-review",
    status: "completed",
    createdAt: "2026-09-27T12:00:00Z",
    finishedAt: "2026-09-27T12:01:00Z",
    resultMetadata: { evidence: { source: "agent-runs", sources: [{ agentId: "analytics-learning", taskType: "performance-review", status: "selected", runId: PERF }] } },
    ...over,
  } as unknown as AgentRun;
}

function event(over: Partial<AgentTaskEvent>): AgentTaskEvent {
  return {
    id: "ev",
    seq: 1,
    taskId: "30e79092-0000-4000-8000-000000000001",
    projectId: "nexra-agency",
    type: "priority-changed",
    fromStatus: null,
    toStatus: null,
    fromAgent: null,
    toAgent: null,
    runId: null,
    fromPriority: "medium",
    toPriority: "high",
    actor: "op",
    createdAt: "2026-09-28T10:00:00Z",
    ...over,
  };
}

const DIRECTOR = run({ id: "288639f4-0000-4000-8000-000000000001" });
const OLDER = run({ id: "aaaaaaaa-0000-4000-8000-000000000001", finishedAt: "2026-09-26T04:53:00Z" });
const NO_PERF = run({ id: "bbbbbbbb-0000-4000-8000-000000000001", resultMetadata: { evidence: { sources: [{ taskType: "crawl-review", status: "selected", runId: "x" }] } } as never });

describe("the chooser and the chain", () => {
  test("citable: completed project Director reviews only, newest first", () => {
    const runs = [
      OLDER,
      DIRECTOR,
      run({ id: "c1", status: "queued" }),
      run({ id: "c2", status: "failed" }),
      run({ id: "c3", taskType: "priority-review" as never }),
      run({ id: "c4", agentId: "technical-seo" as never, taskType: "crawl-review" as never }),
    ];
    assert.deepEqual(citableDirectorRuns(runs).map((r) => r.id), [DIRECTOR.id, OLDER.id]);
    assert.equal(directorRunsUrl("nexra-agency"), "/api/agent-runs?project=nexra-agency&agent=seo-director&limit=25");
    assert.equal(citedPriorityUrl("nexra-agency"), "/api/agent-tasks?project=nexra-agency&view=cited-priority");
  });

  test("the performance reviews a Director run read: selected sources of that task only, from its own summary", () => {
    assert.deepEqual(performanceReviewsRead(DIRECTOR), [PERF]);
    assert.deepEqual(performanceReviewsRead(NO_PERF), []);
    assert.deepEqual(performanceReviewsRead(run({ id: "m", resultMetadata: { evidence: { sources: [{ taskType: "performance-review", status: "missing", runId: null }] } } as never })), []);
    assert.deepEqual(performanceReviewsRead(run({ id: "n", resultMetadata: null as never })), []);
  });

  test("the history's citation: the Director run and the review it read; a run not read back is named by id alone", () => {
    const cited = event({ runId: DIRECTOR.id });
    assert.equal(describeCitation(cited, [DIRECTOR]), "because of SEO Director project review 288639f4 · 2026-09-27, which read performance review 17623686");
    assert.equal(describeCitation(event({ runId: NO_PERF.id }), [NO_PERF]), "because of SEO Director project review bbbbbbbb · 2026-09-27, which read no performance review");
    assert.equal(describeCitation(cited, null), "because of SEO Director project review 288639f4");
    assert.equal(describeCitation(event({}), [DIRECTOR]), null, "an uncited change says nothing");
    assert.equal(describeCitation(event({ type: "handoff-run-linked", runId: DIRECTOR.id }), [DIRECTOR]), null, "a handoff's run is not a citation");
  });

  test("learnings: performance review → the Director runs that read it → the changes citing each; nothing else", () => {
    const changes: CitedChange[] = [
      { event: event({ id: "e1", seq: 15, runId: DIRECTOR.id }), taskTitle: "Fix /contact h1" },
      { event: event({ id: "e2", seq: 20, runId: DIRECTOR.id, fromPriority: "high", toPriority: "critical" }), taskTitle: null },
      { event: event({ id: "e3", seq: 21, runId: NO_PERF.id }), taskTitle: "Other" },
    ];
    const chain = learningChain(PERF, [OLDER, DIRECTOR, NO_PERF], changes);
    assert.deepEqual(chain.map((link) => link.directorRun.id), [DIRECTOR.id, OLDER.id], "both Director runs that read it, newest first; not the one that did not");
    assert.deepEqual(chain[0].changes.map((c) => c.event.id), ["e2", "e1"], "its citing changes, newest first");
    assert.deepEqual(chain[1].changes, [], "a Director run no change cites");
    assert.deepEqual(learningChain(OTHER_PERF, [OLDER, DIRECTOR], changes), [], "a review no Director run read has no chain");
  });
});

describe("the surface", () => {
  test("the learning migration: the shape check, the insert check, one five-parameter function with a defaulted run, one grant", async () => {
    const sql = await read("../../../supabase/migrations/20261008120000_task_priority_director_run.sql");
    assert.match(sql, /drop function public\.nexra_agent_task_set_priority\(text, uuid, text, uuid\);/);
    assert.match(sql, /p_run_id uuid default null/);
    assert.equal((sql.match(/^security definer$/gm) ?? []).length, 1);
    assert.match(sql, /grant execute on function public\.nexra_agent_task_set_priority\(text, uuid, text, uuid, uuid\) to service_role;/);
    assert.equal((sql.match(/^\s*grant /gm) ?? []).length, 1, "one grant");
    assert.match(sql, /r\.task_type = 'project-priority-review'\s+and r\.status = 'completed'/);
    assert.match(sql, /'outcome', 'run-not-accepted'/);
    assert.match(sql, /create trigger nexra_agent_task_events_check_priority_run\s+before insert on public\.nexra_agent_task_events/);
    assert.doesNotMatch(sql, /grant (insert|update|delete)|create policy|drop table|insert into public\.agent_runs|update public\.agent_runs|pg_notify/i, "citing a run queues and changes nothing");
  });

  test("the store, service and routes: the run passed through, run-not-accepted a 409, the cited-priority read bounded and project-scoped", async () => {
    const store = await read("./supabase/store.ts");
    assert.match(store, /\.\.\.\(input\.directorRunId \? \{ p_run_id: input\.directorRunId \} : \{\}\),/, "p_run_id is named only when a run is cited, so an uncited change works before the migration");
    assert.match(store, /\.eq\("project_id", projectId\)\s*\.eq\("event_type", "priority-changed"\)\s*\.not\("run_id", "is", null\)\s*\.order\("seq", \{ ascending: false \}\)\s*\.limit\(CITED_PRIORITY_READ_LIMIT\)/);
    const service = await read("./service.ts");
    assert.match(service, /event\.projectId === projectId && event\.runId !== null/, "belt and braces: another project's row is dropped");
    const action = await read("../../app/api/agent-tasks/[taskId]/route.ts");
    assert.match(action, /case "run-not-accepted":\s*return json\(\{ error: result\.status, task: result\.task \}, 409\);/);
    const list = await read("../../app/api/agent-tasks/route.ts");
    assert.match(list, /if \(params\.get\("view"\) !== "cited-priority" \|\| keys\.length !== 2 \|\| !keys\.includes\("project"\)\) return errorResponse\("invalid", 400\);/);
    assert.match(list, /const operator = await getOperator\(\);\s*if \(!operator\) return errorResponse\("unauthorized", 401\);\s*const params = request\.nextUrl\.searchParams;\s*if \(params\.has\("view"\)\) return citedPriority/, "the operator first");
    assert.match(list, /agentTaskLimiter\("read"\)/);
  });

  test("the chooser starts with none, cites only on choice, and fails soft; the history and Learnings show the chain", async () => {
    const controls = await read("../../components/agent-tasks/task-row-controls.tsx");
    assert.match(controls, /setCitedRun\(""\);/, "every priority form starts with no run cited");
    assert.match(controls, /options=\{\[\{ value: "", label: "No Director run cited" \}, \.\.\.options\]\}/);
    assert.match(controls, /Because of Director run…/);
    assert.match(controls, /The Director reviews could not be read, so none can be cited\./);
    assert.match(controls, /describeCitation\(event, directorRuns\?\.status === "loaded" \? directorRuns\.runs : null\)/);
    const analytics = await read("../../components/analytics/observed-analytics.tsx");
    assert.match(analytics, /What followed, as recorded/);
    assert.match(analytics, /learningChain\(runId, chain\.directorRuns, chain\.changes\)/);
    assert.match(analytics, /This is a read failure, not an absent chain\./);
    assert.match(analytics, /fetch\(citedPriorityUrl\(projectId\)/);
  });
});
