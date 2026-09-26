import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { AGENT_REGISTRY } from "../mock/agents/registry.ts";

/**
 * The operator surface of the task core, checked as source: one route that
 * lists and records, one control that records after a confirmation, one
 * live panel that reads the store and no fixture, and a migration whose
 * access shape is what the harness verified. Nothing here can execute an
 * agent, and nothing creates a task on its own.
 */
const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("the migration", () => {
  test("declares RLS with no policy, service_role SELECT and EXECUTE on the one create function only, and restates the twelve agents", async () => {
    const sql = await read("../../../supabase/migrations/20261003120000_create_agent_tasks.sql");
    assert.match(sql, /alter table public\.nexra_agent_tasks enable row level security;/);
    assert.doesNotMatch(sql, /create policy/);
    assert.match(sql, /grant select on table public\.nexra_agent_tasks to service_role;/);
    assert.match(sql, /grant execute on function public\.nexra_agent_task_create\(text, text, text, text, text, text, uuid\) to service_role;/);
    assert.equal((sql.match(/^\s*grant /gm) ?? []).length, 2, "exactly two grant statements");
    assert.doesNotMatch(sql, /grant (insert|update|delete)/i);
    assert.equal((sql.match(/security definer/g) ?? []).length, 1, "one security definer function");
    assert.match(sql, /create function public\.nexra_agent_task_create\([\s\S]*?security definer\s+set search_path = ''/);
    for (const agent of AGENT_REGISTRY) assert.ok(sql.includes(`'${agent.id}'`), agent.id);
    assert.match(sql, /source_kind in \('director-run', 'keyword'\)/);
    assert.match(sql, /status in \('backlog', 'ready', 'in-progress', 'blocked', 'review', 'completed', 'cancelled'\)/);
    assert.match(sql, /priority in \('low', 'medium', 'high', 'critical'\)/);
    assert.doesNotMatch(sql, /unique \(project_id, source/, "no uniqueness that would collapse two operator-approved tasks");
    assert.match(sql, /v_run\.agent_id <> 'seo-director' or v_run\.task_type not in \('priority-review', 'project-priority-review'\)/);
    assert.match(sql, /q ->> 'key' = p_source_ref/);
    assert.match(sql, /p\.query = p_source_ref/);
    assert.doesNotMatch(sql, /insert into public\.agent_runs|update public\.agent_runs|nexra_agent_task_assign|pg_notify|dblink|http_/i, "no run is queued and no agent dispatched by the function");
  });
});

describe("the route", () => {
  test("lists for one project and records through the service only; no execute, no worker, no direct table write", async () => {
    const route = await read("../../app/api/agent-tasks/route.ts");
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function POST/);
    assert.match(route, /getOperator\(\)/);
    assert.match(route, /isSameOrigin\(request\)/);
    assert.match(route, /parseListTasksRequest\(/);
    assert.match(route, /parseCreateTaskRequest\(/);
    assert.match(route, /agentTaskService\(\)\.createTask\(/);
    assert.match(route, /operatorId: operator\.id/);
    assert.doesNotMatch(route, /executeRun|createRun|run-next|agent-runs\/worker|\.from\(|\.rpc\(/);
    assert.doesNotMatch(route, /CRON_SECRET|SERVICE_ROLE|Bearer/);
  });

  test("the store writes through the one function and reads one project, bounded and newest first", async () => {
    const store = await read("./supabase/store.ts");
    assert.match(store, /client\.rpc\("nexra_agent_task_create"/);
    assert.equal((store.match(/\.rpc\(/g) ?? []).length, 1);
    assert.doesNotMatch(store, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.match(store, /\.eq\("project_id", filter\.projectId\)/);
    assert.match(store, /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/);
    assert.match(store, /Math\.min\(requested, TASK_READ_LIMIT\)/);
  });
});

describe("the operator controls", () => {
  test("Record as task opens a form first, posts once to the tasks endpoint on confirmation, and never executes anything", async () => {
    const control = await read("../../components/agent-tasks/record-task-control.tsx");
    assert.match(control, /^"use client";/);
    assert.match(control, /if \(!open\) \{[\s\S]*?Record as task/);
    assert.match(control, /fetch\("\/api\/agent-tasks", \{\s*method: "POST"/);
    assert.equal((control.match(/fetch\(/g) ?? []).length, 1, "one request, the create");
    assert.match(control, /if \(sending\.current \|\| !checkedTitle\.ok\) return;/);
    assert.match(control, /Create task/);
    assert.match(control, /Nothing is recorded until you confirm, and no agent is run by recording a task\./);
    assert.match(control, /No agent was run/);
    assert.doesNotMatch(control, /agent-runs|action: "execute"|executeRun|@\/lib\/mock\/(?!agents\/registry)/);
    assert.doesNotMatch(control, /useEffect/, "nothing fires on mount: a task is created only by the operator's click");
  });

  test("a completed SEO Director review offers the control; a keyword row offers it with the exact query", async () => {
    const review = await read("../../components/agent-runs/queued-review.tsx");
    assert.match(review, /offersDirectorTask\(run\) && <RecordTaskControl key=\{run\.id\} projectId=\{projectId\} proposal=\{directorTaskProposal\(run\)\} \/>/);
    const keywords = await read("../../components/search-console/search-console-keywords.tsx");
    assert.match(keywords, /<RecordTaskControl projectId=\{projectId\} proposal=\{keywordTaskProposal\(row\.query\)\} compact \/>/);
    assert.match(keywords, /<TableHeaderCell>Task<\/TableHeaderCell>/);
  });
});

describe("the live tasks panel", () => {
  test("reads the tasks endpoint for one stored project, shows the six fields, offers no control, and imports no fixture", async () => {
    const panel = await read("../../components/agent-tasks/live-tasks-panel.tsx");
    assert.match(panel, /^"use client";/);
    assert.match(panel, /fetch\(agentTasksUrl\(projectId, \{ limit: TASK_READ_DEFAULT_LIMIT \}\)/);
    assert.equal((panel.match(/fetch\(/g) ?? []).length, 1);
    assert.doesNotMatch(panel, /method: "POST"|@\/lib\/mock\/(?!agents\/registry)|getAgentTasks|getAgentDetail|tasks\.ts/);
    for (const heading of ["Title", "Owning agent", "Status", "Priority", "Source", "Recorded"]) assert.ok(panel.includes(`<TableHeaderCell>${heading}</TableHeaderCell>`), heading);
    assert.match(panel, /eyebrow="Live · persisted"/);
    assert.match(panel, /title="Live tasks"/);
    assert.match(panel, /No live tasks yet/);
    assert.match(panel, /Tasks are not kept on this deployment/);
    assert.match(panel, /nothing on this screen assigns it, moves it or runs an agent/);
    assert.doesNotMatch(panel, /<RecordTaskControl|Record as task/);
  });

  test("is mounted once, on the Project Manager's Tasks tab only, above the board that stays labelled modelled", async () => {
    const workspace = await read("../../components/agents/agent-workspace.tsx");
    assert.equal((workspace.match(/<LiveTasksPanel projects=\{projects\} \/>/g) ?? []).length, 1);
    assert.match(workspace, /\{tab === "tasks" && agentId === "project-manager" && <LiveTasksPanel projects=\{projects\} \/>\}/);
    assert.ok(workspace.indexOf("<LiveTasksPanel") < workspace.indexOf('{tab === "tasks" && (\n          <AgentTasks'), "above the modelled board on the Tasks tab");
    assert.match(workspace, /description=\{`Modelled: every fixture task/);
    assert.match(workspace, /Modelled operating data|getAgentDetail/);
    const page = await read("../../app/(app)/agents/[agentId]/page.tsx");
    assert.match(page, /projectOptionsFrom\(await projectRepository\.listProjects\(\)\)/);
    assert.match(page, /<AgentWorkspace agentId=\{agentId\} projects=\{projects\} \/>/);
    const header = await read("../../components/agents/agent-detail-header.tsx");
    assert.match(header, /Modelled operating data\. Nothing on this page starts an agent run/);
  });

  test("no task is ever created outside the operator's control: the runtime, the keyword module and the Director bundle never write one", async () => {
    for (const path of ["../agent-runs/worker.ts", "../agent-runs/service.ts", "../agent-runs/process-job.ts", "../agent-runs/director-bundle.ts", "../search-console/keywords/inventory.ts", "../search-console/keywords/index.ts"]) {
      const source = await read(path);
      assert.doesNotMatch(source, /nexra_agent_task|agent-tasks|createTask\(/, path);
    }
  });
});
