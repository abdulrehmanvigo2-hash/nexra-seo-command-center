-- The learning loop (Phase 6, checkpoint 6.7, migration 20261008120000): a priority change may cite a completed
-- project-priority-review of the same project. Sections A (schema and security), B (the function's outcomes: with a run,
-- without one, every refused run), C (the insert check for any writer, the shape check), D (history immutable), E (isolation,
-- the runs untouched). Runs over c4/setup.sql, gsc/setup.sql and tasks/setup.sql (runs d…01 halcyon completed
-- project-priority-review, d…02 completed priority-review, d…03 queued and d…04 failed project-priority-review, d…05 completed
-- crawl-review, d…06 verdant completed project-priority-review) on every migration. Part of the local PostgreSQL test harness;
-- run only through supabase/tests/run.sh, which creates and destroys its own disposable cluster. Never run against a hosted
-- database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create table t.runs_before as select id, project_id, agent_id, task_type, status, input, result_summary from agent_runs;

select t.ok((t.task()->>'outcome') = 'created', 'setup: halcyon task recorded (medium)');
select t.ok((t.task(p_project => 'verdant-home', p_kind => 'keyword', p_ref => 'garden sheds', p_agent => 'writer', p_priority => 'low')->>'outcome') = 'created', 'setup: verdant task recorded (low)');
select t.ok((t.task(p_title => 'Cancelled task', p_ref => 'd0000000-0000-4000-8000-000000000002', p_priority => 'high')->>'outcome') = 'created', 'setup: a third halcyon task recorded (high)');

create function t.task1() returns uuid language sql stable as $$ select id from nexra_agent_tasks where project_id = 'halcyon-fintech' and title <> 'Cancelled task' order by created_at, id limit 1 $$;
create function t.task2() returns uuid language sql stable as $$ select id from nexra_agent_tasks where project_id = 'verdant-home' order by created_at, id limit 1 $$;
create function t.task3() returns uuid language sql stable as $$ select id from nexra_agent_tasks where title = 'Cancelled task' $$;
create function t.run_id(n int) returns uuid language sql immutable as $$ select ('d0000000-0000-4000-8000-00000000000' || n)::uuid $$;
create function t.pri(p_priority text, p_run uuid default null, p_task uuid default null, p_project text default 'halcyon-fintech') returns jsonb language sql as $$
  select public.nexra_agent_task_set_priority(p_project, coalesce(p_task, t.task1()), p_priority, t.op(), p_run) $$;
create function t.events(p_task uuid default null) returns text language sql stable as $$
  select string_agg(event_type || coalesce(':' || from_priority || '>' || to_priority, '') || coalesce('@' || left(run_id::text, 1) || right(run_id::text, 2), ''), ',' order by seq)
    from nexra_agent_task_events where task_id = coalesce(p_task, t.task1()) $$;
grant execute on all functions in schema t to service_role;

-- A: the schema and its security.
do $$
begin
  perform t.ok((select count(*) from pg_proc where proname = 'nexra_agent_task_set_priority') = 1, 'A one set_priority function, not an overload');
  perform t.ok(to_regprocedure('public.nexra_agent_task_set_priority(text,uuid,text,uuid,uuid)') is not null
    and to_regprocedure('public.nexra_agent_task_set_priority(text,uuid,text,uuid)') is null, 'A the signature is (text,uuid,text,uuid,uuid); the four-parameter one is gone');
  perform t.ok((select pronargdefaults from pg_proc where proname = 'nexra_agent_task_set_priority') = 1, 'A the fifth parameter (the run) defaults');
  perform t.ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where proname = 'nexra_agent_task_set_priority'), 'A set_priority: security definer, empty search_path');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_agent_task_set_priority(text,uuid,text,uuid,uuid)', 'EXECUTE'), 'A service_role executes it');
  perform t.ok(not has_function_privilege('anon', 'public.nexra_agent_task_set_priority(text,uuid,text,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.nexra_agent_task_set_priority(text,uuid,text,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('public', 'public.nexra_agent_task_set_priority(text,uuid,text,uuid,uuid)', 'EXECUTE'), 'A anon, authenticated and PUBLIC cannot execute it');
  perform t.ok((select not prosecdef and proconfig = array['search_path=""'] from pg_proc where proname = 'nexra_agent_task_events_check_priority_run'), 'A the insert check: not security definer, empty search_path');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_agent_task_events_check_priority_run()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.nexra_agent_task_events_check_priority_run()', 'EXECUTE'), 'A no API role executes the insert check');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_agent_task_events'::regclass and not tgisinternal)
    = array['nexra_agent_task_events_check_priority_run','nexra_agent_task_events_guard_delete','nexra_agent_task_events_guard_truncate','nexra_agent_task_events_guard_update'], 'A events: the three guards and the new insert check');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_agent_task_events' and grantee = 'service_role') = array['SELECT']
    and (select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_agent_tasks' and grantee = 'service_role') = array['SELECT'], 'A service_role: still SELECT only on tasks and events');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_task_events_shape') like '%handoff-run-linked%run_id IS NOT NULL%', 'A the shape check still requires a run on handoff-run-linked');
end $$;

-- B: the function, as service_role.
set role service_role;
do $$
declare r jsonb; n int;
begin
  -- Without a run: exactly as before (the four-argument call, the default).
  r := public.nexra_agent_task_set_priority('halcyon-fintech', t.task1(), 'high', t.op());
  perform t.ok(r->>'outcome' = 'priority-changed' and r->'event'->>'run_id' is null and r->'event'->>'from_priority' = 'medium' and r->'event'->>'to_priority' = 'high', 'B a four-argument call: priority-changed, no run on the event');
  r := t.pri('critical', null);
  perform t.ok(r->>'outcome' = 'priority-changed' and r->'event'->>'run_id' is null, 'B an explicit null run: priority-changed, no run');

  -- With the project's completed Director review.
  r := t.pri('medium', t.run_id(1));
  perform t.ok(r->>'outcome' = 'priority-changed', 'B citing a completed project-priority-review of the same project: priority-changed');
  perform t.ok((r->'event'->>'run_id')::uuid = t.run_id(1) and r->'event'->>'from_priority' = 'critical' and r->'event'->>'to_priority' = 'medium'
    and r->'event'->>'to_agent' is null and r->'event'->>'from_status' is null and (r->'event'->>'actor')::uuid = t.op(), 'B the event: critical > medium, citing the run, by the operator, nothing else');
  perform t.ok((select priority from nexra_agent_tasks where id = t.task1()) = 'medium', 'B the row says medium');

  -- Every run that is not accepted: answered alike, nothing written.
  n := (select count(*) from nexra_agent_task_events);
  perform t.ok(t.pri('low', t.run_id(2))->>'outcome' = 'run-not-accepted', 'B a completed single-run priority-review is not accepted');
  perform t.ok(t.pri('low', t.run_id(3))->>'outcome' = 'run-not-accepted', 'B a queued project-priority-review is not accepted');
  perform t.ok(t.pri('low', t.run_id(4))->>'outcome' = 'run-not-accepted', 'B a failed project-priority-review is not accepted');
  perform t.ok(t.pri('low', t.run_id(5))->>'outcome' = 'run-not-accepted', 'B a completed crawl-review is not accepted');
  perform t.ok(t.pri('low', t.run_id(6))->>'outcome' = 'run-not-accepted', 'B another project''s completed project-priority-review is not accepted');
  perform t.ok(t.pri('low', gen_random_uuid())->>'outcome' = 'run-not-accepted', 'B an unknown run is not accepted');
  r := t.pri('low', t.run_id(2));
  perform t.ok(r ? 'task' and not r ? 'event' and not r ? 'run' and not r ? 'reason', 'B the answer carries the task and never says why');
  perform t.ok((select count(*) from nexra_agent_task_events) = n and (select priority from nexra_agent_tasks where id = t.task1()) = 'medium', 'B run-not-accepted wrote nothing');

  -- Order: task-not-found first; the run before same-priority and terminal.
  perform t.ok(t.pri('low', t.run_id(6), t.task2(), 'halcyon-fintech')->>'outcome' = 'task-not-found', 'B another project''s task through this project: task-not-found, before the run is read');
  perform t.ok(t.pri('medium', t.run_id(2))->>'outcome' = 'run-not-accepted', 'B an unaccepted run with the same priority: run-not-accepted first');
  perform t.ok(t.pri('medium', t.run_id(1))->>'outcome' = 'same-priority', 'B an accepted run with the same priority: same-priority, nothing written');
  perform t.ok(public.nexra_agent_task_set_status('halcyon-fintech', t.task3(), 'cancelled', t.op())->>'outcome' = 'transitioned', 'B setup: the third task is cancelled');
  perform t.ok(t.pri('low', t.run_id(1), t.task3())->>'outcome' = 'terminal', 'B a cancelled task with an accepted run: terminal');
  perform t.ok(t.pri('low', t.run_id(4), t.task3())->>'outcome' = 'run-not-accepted', 'B a cancelled task with an unaccepted run: run-not-accepted');
  perform t.ok((select count(*) from nexra_agent_task_events) = n + 1, 'B only the cancellation was written');

  -- Refusals of the arguments are unchanged.
  perform t.ok(t.err($q$select t.pri('urgent', t.run_id(1))$q$) = '22023', 'B a priority outside the four still raises 22023, with a run');
  perform t.ok(t.err($q$select public.nexra_agent_task_set_priority('halcyon-fintech', t.task1(), 'low', null, t.run_id(1))$q$) = '22023', 'B a missing operator still raises 22023');

  -- The verdant task, through its own project, cites its own project's run.
  perform t.ok(t.pri('high', t.run_id(6), t.task2(), 'verdant-home')->>'outcome' = 'priority-changed', 'B verdant cites its own completed review: priority-changed');
  perform t.ok(t.pri('medium', t.run_id(1), t.task2(), 'verdant-home')->>'outcome' = 'run-not-accepted', 'B verdant cannot cite halcyon''s review');

  perform t.ok(t.events() = 'created,priority-changed:medium>high,priority-changed:high>critical,priority-changed:critical>medium@d01', 'B the halcyon history: two uncited changes, then one citing d…01');
  perform t.ok(t.events(t.task2()) = 'created,priority-changed:low>high@d06', 'B the verdant history: one change citing d…06');
end $$;
reset role;

-- C: the insert check holds for any writer (the owner here), and the shape check.
do $$
begin
  perform t.ok(t.err(format($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, run_id, actor) values (%L, 'halcyon-fintech', 'priority-changed', 'medium', 'low', %L, t.op())$q$, t.task1(), t.run_id(2))) = '23514', 'C a direct event citing a priority-review is refused (23514)');
  perform t.ok(t.err(format($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, run_id, actor) values (%L, 'halcyon-fintech', 'priority-changed', 'medium', 'low', %L, t.op())$q$, t.task1(), t.run_id(3))) = '23514', 'C a direct event citing a queued review is refused (23514)');
  perform t.ok(t.err(format($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, run_id, actor) values (%L, 'halcyon-fintech', 'priority-changed', 'medium', 'low', %L, t.op())$q$, t.task1(), t.run_id(6))) = '23514', 'C a direct event citing another project''s review is refused (23514)');
  perform t.ok(t.err(format($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, run_id, actor) values (%L, 'halcyon-fintech', 'priority-changed', 'low', 'low', %L, t.op())$q$, t.task1(), t.run_id(1))) = '23514', 'C a cited change to the same priority is refused by the shape check (23514)');
  perform t.ok(t.err(format($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_status, to_status, run_id, actor) values (%L, 'halcyon-fintech', 'status-changed', 'backlog', 'ready', %L, t.op())$q$, t.task1(), t.run_id(1))) = '23514', 'C a status change still cannot carry a run (23514)');
  perform t.ok(t.err(format($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_agent, to_agent, run_id, actor) values (%L, 'halcyon-fintech', 'owner-changed', 'writer', 'on-page-seo', %L, t.op())$q$, t.task1(), t.run_id(1))) = '23514', 'C an owner change still cannot carry a run (23514)');
  perform t.ok(t.err(format($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, to_agent, actor) values (%L, 'halcyon-fintech', 'handoff-run-linked', 'on-page-seo', t.op())$q$, t.task1())) = '23514', 'C a handoff link still needs its run (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set priority = 'low' where id = t.task1()$q$) = '23514', 'C a direct priority update is still refused (23514)');
  perform t.ok(public.nexra_agent_task_handoff_request('halcyon-fintech', t.task1(), t.op())->>'outcome' = 'requested', 'C a cited completed run never reads as an active handoff');
end $$;

-- D: history stays append-only.
do $$
begin
  perform t.ok(t.err($q$update public.nexra_agent_task_events set run_id = null where run_id is not null and event_type = 'priority-changed'$q$) = '23514', 'D a cited run is never removed from its event (23514)');
  perform t.ok(t.err($q$delete from public.nexra_agent_task_events where event_type = 'priority-changed'$q$) = '23514', 'D a priority event is never deleted (23514)');
  perform t.ok(t.err($q$truncate public.nexra_agent_task_events$q$) = '23514', 'D history is never truncated (23514)');
  perform t.ok((select count(*) from nexra_agent_task_events where event_type = 'priority-changed' and run_id is not null) = 2, 'D two cited priority changes, both kept');
end $$;

-- E: isolation, and nothing queued or changed.
do $$
begin
  perform t.ok((select bool_and(r.project_id = e.project_id and r.task_type = 'project-priority-review' and r.status = 'completed')
    from nexra_agent_task_events e join agent_runs r on r.id = e.run_id where e.event_type = 'priority-changed'), 'E every cited run is a completed project Director review of its event''s project');
  perform t.ok((select count(*) from nexra_agent_task_events where project_id <> (select project_id from nexra_agent_tasks k where k.id = task_id)) = 0, 'E every event belongs to its task''s project');
  perform t.ok((select count(*) from (select id, project_id, agent_id, task_type, status, input, result_summary from agent_runs except select * from t.runs_before) d) = 0
    and (select count(*) from agent_runs) = (select count(*) from t.runs_before), 'E no run was queued or changed');
end $$;
