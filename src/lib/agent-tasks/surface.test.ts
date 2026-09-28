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

describe("the workflow migration", () => {
  test("adds the append-only events table, four security definer functions with empty search_path, the narrowed guard, and grants nothing but SELECT and EXECUTE", async () => {
    const sql = await read("../../../supabase/migrations/20261004120000_agent_task_workflow.sql");
    assert.match(sql, /create table public\.nexra_agent_task_events/);
    assert.match(sql, /seq bigint not null generated always as identity/);
    assert.match(sql, /alter table public\.nexra_agent_task_events enable row level security;/);
    assert.doesNotMatch(sql, /create policy/);
    assert.match(sql, /grant select on table public\.nexra_agent_task_events to service_role;/);
    assert.equal((sql.match(/^\s*grant /gm) ?? []).length, 5, "one table grant, four execute grants");
    assert.doesNotMatch(sql, /grant (insert|update|delete)/i);
    assert.equal((sql.match(/^security definer$/gm) ?? []).length, 4, "four security definer clauses; the header mentions the phrase once more");
    for (const fn of ["nexra_agent_task_set_status", "nexra_agent_task_set_owner", "nexra_agent_task_handoff_request", "nexra_agent_task_handoff_link"]) {
      assert.match(sql, new RegExp(`create function public\\.${fn}\\([\\s\\S]*?security definer\\s+set search_path = ''`), fn);
      assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`), fn);
    }
    assert.match(sql, /for update;/);
    assert.match(sql, /set_config\('nexra\.agent_task_write', v_task\.id::text, true\)/);
    assert.match(sql, /create or replace function public\.nexra_agent_tasks_guard_update\(\)/);
    assert.match(sql, /new\.title is distinct from old\.title/);
    assert.match(sql, /new\.priority is distinct from old\.priority/);
    assert.doesNotMatch(sql, /create or replace function public\.nexra_agent_task_create|alter table public\.nexra_agent_tasks (add|alter|drop)/, "the task table and the create function are unchanged");
    assert.match(sql, /event_type in \('created', 'status-changed', 'owner-changed', 'handoff-requested', 'handoff-run-linked'\)/);
    assert.match(sql, /r\.status in \('queued', 'running'\)/, "one active handoff at a time");
    assert.doesNotMatch(sql, /insert into public\.agent_runs|update public\.agent_runs|agent_run_claim|pg_notify|dblink|http_/i, "no run is created or executed by the functions");
    assert.doesNotMatch(sql, /crawls|crawl_pages|crawl_urls|crawl_page_signals/, "never names the unprefixed crawl subsystem");
  });
});

describe("the task route", () => {
  test("reads one task with its history and applies one of three actions, operator and same origin, through the service only", async () => {
    const route = await read("../../app/api/agent-tasks/[taskId]/route.ts");
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function POST/);
    assert.equal((route.match(/getOperator\(\)/g) ?? []).length, 2);
    assert.match(route, /isSameOrigin\(request\)/);
    assert.match(route, /parseTaskActionRequest\(/);
    assert.match(route, /agentTaskLimiter\("action"\)/);
    assert.match(route, /service\.changeStatus\(/);
    assert.match(route, /service\.changeOwner\(/);
    assert.match(route, /service\.handoff\(\{ \.\.\.base, record: parsed\.record \}\)/);
    assert.match(route, /operatorId: operator\.id/);
    assert.doesNotMatch(route, /executeRun|agentRunService|action: "execute"|\.from\(|\.rpc\(/);
    assert.doesNotMatch(route, /CRON_SECRET|SERVICE_ROLE|Bearer/);
  });

  test("the read adds the handoff outcome through the service, computed from the linked run and never written (cp 2.2)", async () => {
    const route = await read("../../app/api/agent-tasks/[taskId]/route.ts");
    assert.match(route, /outcome: await service\.readOutcome\(result\.task, result\.events\)/);
    const wiring = await read("./index.ts");
    assert.match(wiring, /const outcomeRuns: TaskRunReader = \{\s*getRun\(runId\) \{\s*return agentRunService\(\)\.getRun\(runId\);/);
    assert.doesNotMatch(wiring, /executeRun|executeNext|cancelRun|retryRun/, "the task wiring reads runs and creates handoff runs only");
    const service = await read("./service.ts");
    const readOutcome = service.slice(service.indexOf("async readOutcome("));
    assert.doesNotMatch(readOutcome, /store\.(create|setStatus|setOwner|handoffRequest|handoffLink)\(|runs\.createRun\(/, "the outcome read writes nothing");
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

  test("the store writes through the six functions only and reads one project, bounded and newest first", async () => {
    const store = await read("./supabase/store.ts");
    assert.match(store, /client\.rpc\("nexra_agent_task_create"/);
    for (const fn of ["nexra_agent_task_set_status", "nexra_agent_task_set_owner", "nexra_agent_task_set_priority", "nexra_agent_task_handoff_request", "nexra_agent_task_handoff_link"]) assert.match(store, new RegExp(`client\\.rpc\\("${fn}"`));
    assert.equal((store.match(/\.rpc\(/g) ?? []).length, 6, "create, the four workflow functions and set_priority (cp 2.3b)");
    assert.match(store, /\.eq\("project_id", projectId\)\.eq\("id", taskId\)\.maybeSingle\(\)/);
    assert.match(store, /\.eq\("project_id", projectId\)\s*\.eq\("task_id", taskId\)\s*\.order\("seq", \{ ascending: true \}\)\s*\.limit\(TASK_EVENT_READ_LIMIT\)/);
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
  test("reads the tasks endpoint for one stored project, shows the six fields plus the row controls, and imports no fixture", async () => {
    const panel = await read("../../components/agent-tasks/live-tasks-panel.tsx");
    assert.match(panel, /^"use client";/);
    assert.match(panel, /fetch\(agentTasksUrl\(projectId, \{ limit: TASK_READ_DEFAULT_LIMIT \}\)/);
    assert.equal((panel.match(/fetch\(/g) ?? []).length, 1, "the panel itself only reads; every write lives in the row controls");
    assert.doesNotMatch(panel, /method: "POST"|@\/lib\/mock\/(?!agents\/registry)|getAgentTasks|getAgentDetail|tasks\.ts/);
    for (const heading of ["Title", "Owning agent", "Status", "Priority", "Source", "Recorded", "Actions"]) assert.ok(panel.includes(`<TableHeaderCell>${heading}</TableHeaderCell>`), heading);
    assert.match(panel, /eyebrow="Live · persisted"/);
    assert.match(panel, /title="Live tasks"/);
    assert.match(panel, /No live tasks yet/);
    assert.match(panel, /Tasks are not kept on this deployment/);
    assert.match(panel, /a handoff queues one run\s*for the owning agent and executes nothing/);
    assert.match(panel, /<TaskRowControls task=\{task\} onChanged=\{onChanged\} \/>/);
    assert.doesNotMatch(panel, /<RecordTaskControl|Record as task/);
  });

  test("the row controls: status along the map, owner from the registry, a confirmed handoff that executes nothing, and the history read", async () => {
    const controls = await read("../../components/agent-tasks/task-row-controls.tsx");
    assert.match(controls, /^"use client";/);
    assert.match(controls, /fetch\(`\/api\/agent-tasks\/\$\{encodeURIComponent\(task\.id\)\}`, \{\s*method: "POST"/);
    assert.match(controls, /fetch\(agentTaskUrl\(task\.id, task\.projectId\), \{ cache: "no-store" \}\)/);
    assert.equal((controls.match(/fetch\(/g) ?? []).length, 3, "one write path, one history read, one handoff-choices read");
    assert.match(controls, /if \(sending\.current\) return;/);
    assert.match(controls, /const allowed = TASK_TRANSITIONS\[task\.status\];/);
    assert.match(controls, /options=\{allowed\.map/);
    assert.match(controls, /options=\{TASK_OWNING_AGENTS\.map/);
    assert.match(controls, /Confirm handoff/);
    assert.match(controls, /Nothing runs when you confirm\./);
    // cp 2.3c: Run Now lives on the project's review panels; the Agents run history has none.
    assert.match(controls, /or for Run Now on the project&apos;s review panel for that review\./);
    assert.doesNotMatch(controls, /run history\. Nothing runs|Run now" on the agent's run history|Run now on the agent/);
    assert.match(controls, /Handoff not supported yet for/);
    assert.match(controls, /disabled=\{terminal \|\| busy \|\| mapping === null\}/);
    assert.match(controls, /void post\(\{ action: "handoff", \.\.\.handoffRecordField\(mapping\.record, chosen\) \}/);
    assert.doesNotMatch(controls, /action: "execute"|agent-runs\/|executeRun|taskType:|agentId:/, "the browser names no agent, task type, input or execution");
    assert.doesNotMatch(controls, /useEffect/, "nothing fires on mount");
    assert.doesNotMatch(controls, /@\/lib\/mock\/(?!agents\/registry)/);
  });

  test("a record-reading handoff lists the server's choosable records, starts with none chosen, and cannot confirm without one (cp 2.3)", async () => {
    const controls = await read("../../components/agent-tasks/task-row-controls.tsx");
    assert.match(controls, /fetch\(`\$\{agentTaskUrl\(task\.id, task\.projectId\)\}&view=handoff-choices`, \{ cache: "no-store" \}\)/);
    assert.match(controls, /if \(mapping\?\.record\) void loadChoices\(\);/);
    assert.match(controls, /setChosen\(""\);/, "every confirmation starts with nothing chosen");
    assert.match(controls, /disabled=\{busy \|\| \(mapping\.record !== undefined && chosen === ""\)\}/);
    assert.match(controls, /options=\{\[\{ value: "", label: `Choose a \$\{noun\}…` \}, \.\.\.options\]\}/);
    assert.match(controls, /a competitor crawl cannot be handed off here/);
    const field = controls.slice(controls.indexOf("function handoffRecordField("), controls.indexOf("function RecordChoice("));
    assert.match(field, /if \(kind === undefined \|\| chosen === ""\) return \{\};/, "no record is sent unless the operator chose one");
    const route = await read("../../app/api/agent-tasks/[taskId]/route.ts");
    assert.match(route, /if \(view !== null && view !== "handoff-choices"\) return errorResponse\("invalid", 400\);/);
    assert.match(route, /service\.handoffChoices\(project, taskId\.toLowerCase\(\)\)/);
    const wiring = await read("./index.ts");
    assert.match(wiring, /isProjectSiteCrawl\(detail\.crawl, project\.domain\)/, "the own-site rule the crawl reviews use");
    assert.match(wiring, /detail\.crawl\.projectId === projectId/);
    assert.match(wiring, /resolveCompetitorTarget\(/);
    assert.doesNotMatch(wiring, /startCrawl\(|listCompetitorCrawls\(/, "the handoff reads records; it never crawls");
  });

  test("Change priority: one of the four, a confirmed POST with recorded feedback, and the history shows the event (cp 2.3b)", async () => {
    const controls = await read("../../components/agent-tasks/task-row-controls.tsx");
    assert.match(controls, /Change priority/);
    assert.match(controls, /void post\(\{ action: "priority", priority: nextPriority \}/);
    assert.match(controls, /options=\{TASK_PRIORITIES\.map/);
    assert.match(controls, /disabled=\{busy \|\| nextPriority === task\.priority\}/);
    assert.match(controls, /Priority recorded as \$\{TASK_PRIORITY_META\[nextPriority\]\.label\.toLowerCase\(\)\}\. No agent was told anything and no run was queued\./);
    assert.match(controls, /case "priority-changed":\s*return `\$\{event\.fromPriority/);
    const route = await read("../../app/api/agent-tasks/[taskId]/route.ts");
    assert.match(route, /service\.changePriority\(\{ \.\.\.base, priority: parsed\.priority \}\)/);
    assert.match(route, /agentTaskLimiter\("action"\)/, "the existing action limit covers it");
    const schema = await read("./supabase/schema.ts");
    assert.match(schema, /export const TASK_EVENT_READ_COLUMNS = "\*";/, "the history read works before and after the migration");
  });

  test("the priority migration: one security definer function, one grant, the event and guard changes, nothing else (cp 2.3b)", async () => {
    const sql = await read("../../../supabase/migrations/20261005120000_agent_task_priority.sql");
    assert.equal((sql.match(/^security definer$/gm) ?? []).length, 1);
    assert.match(sql, /create function public\.nexra_agent_task_set_priority\([\s\S]*?security definer\s+set search_path = ''/);
    assert.match(sql, /grant execute on function public\.nexra_agent_task_set_priority\(text, uuid, text, uuid\) to service_role;/);
    assert.equal((sql.match(/^\s*grant /gm) ?? []).length, 1, "one grant");
    assert.doesNotMatch(sql, /grant (insert|update|delete)|create policy|drop table|drop function/i);
    assert.match(sql, /'priority-changed'/);
    assert.match(sql, /create or replace function public\.nexra_agent_tasks_guard_update\(\)/);
    assert.doesNotMatch(sql.slice(sql.indexOf("create or replace function public.nexra_agent_tasks_guard_update")), /new\.priority is distinct from old\.priority/, "priority is no longer immutable");
    assert.match(sql, /for update;/);
    assert.match(sql, /set_config\('nexra\.agent_task_write', v_task\.id::text, true\)/);
    assert.doesNotMatch(sql, /insert into public\.agent_runs|update public\.agent_runs|pg_notify/i, "a priority change queues nothing");
  });

  test("the history view shows the handoff outcome the read returned, with no control of its own (cp 2.2)", async () => {
    const controls = await read("../../components/agent-tasks/task-row-controls.tsx");
    assert.match(controls, /<HandoffOutcome outcome=\{history\.outcome\} \/>/);
    assert.match(controls, /describeTaskRunOutcome\(outcome\)/);
    assert.match(controls, /The task&apos;s status is not changed by its run\./);
    assert.match(controls, /The handoff outcome could not be read\. Nothing here is estimated\./);
    const block = controls.slice(controls.indexOf("function HandoffOutcome("), controls.indexOf("function describeEvent("));
    assert.ok(block.length > 0);
    assert.doesNotMatch(block, /<Button|onClick|fetch\(|useEffect|useState/, "the outcome is shown, never acted on");
  });

  test("is mounted once, on the Project Manager's Tasks tab only, above the board that stays labelled modelled", async () => {
    const workspace = await read("../../components/agents/agent-workspace.tsx");
    assert.equal((workspace.match(/<LiveTasksPanel projects=\{projects\} \/>/g) ?? []).length, 1);
    assert.match(workspace, /\{tab === "tasks" && agentId === "project-manager" && <LiveTasksPanel projects=\{projects\} \/>\}/);
    assert.ok(workspace.indexOf("<LiveTasksPanel") < workspace.indexOf('{tab === "tasks" && (\n          <ModelledSection name="Assigned tasks">\n            <AgentTasks'), "above the modelled board on the Tasks tab");
    assert.match(workspace, /description=\{`Modelled: every fixture task/);
    assert.match(workspace, /Modelled operating data|getAgentDetail/);
    const page = await read("../../app/(app)/agents/[agentId]/page.tsx");
    assert.match(page, /projectOptionsFrom\(await projectRepository\.listProjects\(\)\)/);
    assert.match(page, /<AgentWorkspace agentId=\{agentId\} projects=\{projects\} \/>/);
    const header = await read("../../components/agents/agent-detail-header.tsx");
    // Checkpoint 6.2: the page carries a live Run History, so the header no longer calls the whole page modelled.
    assert.match(header, /Nothing on this page starts an agent run\. Run History lists this agent's stored runs; every section labelled Modelled is fixture data\./);
  });

  test("no task is ever created outside the operator's control: the runtime, the keyword module and the Director bundle never write one", async () => {
    for (const path of ["../agent-runs/worker.ts", "../agent-runs/service.ts", "../agent-runs/process-job.ts", "../agent-runs/director-bundle.ts", "../search-console/keywords/inventory.ts", "../search-console/keywords/index.ts"]) {
      const source = await read(path);
      assert.doesNotMatch(source, /nexra_agent_task|agent-tasks|createTask\(/, path);
    }
  });
});
