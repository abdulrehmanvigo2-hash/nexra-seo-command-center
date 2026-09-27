-- Agent task priority (Phase 2, checkpoint 2.3b, migration 20261005120000): sections A (schema and security), B (the function's
-- outcomes and refusals), C (the update guard, the event shape, the status and owner functions unchanged), D (history immutability),
-- E (isolation, the runs untouched). Runs over c4/setup.sql, gsc/setup.sql and tasks/setup.sql on every migration. Part of the local
-- PostgreSQL test harness; run only through supabase/tests/run.sh, which creates and destroys its own disposable cluster. Never run
-- against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create table t.runs_before as select id, project_id, agent_id, task_type, status, input, result_summary from agent_runs;

select t.ok((t.task()->>'outcome') = 'created', 'setup: halcyon task recorded (medium)');
select t.ok((t.task(p_project => 'verdant-home', p_kind => 'keyword', p_ref => 'garden sheds', p_agent => 'writer', p_priority => 'low')->>'outcome') = 'created', 'setup: verdant task recorded (low)');
select t.ok((t.task(p_title => 'Cancelled task', p_ref => 'd0000000-0000-4000-8000-000000000002', p_priority => 'high')->>'outcome') = 'created', 'setup: a third halcyon task recorded (high)');

create function t.task1() returns uuid language sql stable as $$ select id from nexra_agent_tasks where project_id = 'halcyon-fintech' and title <> 'Cancelled task' order by created_at, id limit 1 $$;
create function t.task2() returns uuid language sql stable as $$ select id from nexra_agent_tasks where project_id = 'verdant-home' order by created_at, id limit 1 $$;
create function t.task3() returns uuid language sql stable as $$ select id from nexra_agent_tasks where title = 'Cancelled task' $$;
create function t.pri(p_priority text, p_task uuid default null, p_project text default 'halcyon-fintech', p_operator uuid default null) returns jsonb language sql as $$
  select public.nexra_agent_task_set_priority(p_project, coalesce(p_task, t.task1()), p_priority, coalesce(p_operator, t.op())) $$;
create function t.events(p_task uuid default null) returns text language sql stable as $$
  select string_agg(event_type || coalesce(':' || from_status || '>' || to_status, '') || coalesce(':' || from_agent || '>' || to_agent, '') || coalesce(':' || from_priority || '>' || to_priority, ''), ',' order by seq)
    from nexra_agent_task_events where task_id = coalesce(p_task, t.task1()) $$;
grant execute on all functions in schema t to service_role;

-- A: the schema and its security.
do $$
declare cols text[];
begin
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_agent_task_events';
  perform t.ok(cols = array['id','seq','task_id','project_id','event_type','from_status','to_status','from_agent','to_agent','run_id','actor','created_at','from_priority','to_priority'], 'A events gain from_priority and to_priority at the end: ' || cols::text);
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_task_events_type_valid') like '%created%status-changed%owner-changed%handoff-requested%handoff-run-linked%priority-changed%', 'A the six event types');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_task_events_from_priority_valid') like '%low%medium%high%critical%'
    and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_task_events_to_priority_valid') like '%low%medium%high%critical%', 'A both priority columns take only the four priorities');
  perform t.ok((select count(*) from pg_constraint where conname = 'nexra_agent_task_events_shape') = 1, 'A one shape check');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_agent_task_events'::regclass and not tgisinternal)
    = array['nexra_agent_task_events_guard_delete','nexra_agent_task_events_guard_truncate','nexra_agent_task_events_guard_update'], 'A events triggers unchanged: three guards');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_agent_tasks'::regclass and not tgisinternal)
    = array['nexra_agent_tasks_guard_delete','nexra_agent_tasks_guard_truncate','nexra_agent_tasks_guard_update','nexra_agent_tasks_record_created'], 'A task triggers unchanged');
  perform t.ok((select prosecdef from pg_proc where proname = 'nexra_agent_task_set_priority'), 'A set_priority is security definer');
  perform t.ok((select proconfig = array['search_path=""'] from pg_proc where proname = 'nexra_agent_task_set_priority'), 'A set_priority has an empty search_path');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_agent_task_set_priority(text,uuid,text,uuid)', 'EXECUTE'), 'A service_role executes set_priority');
  perform t.ok(not has_function_privilege('anon', 'public.nexra_agent_task_set_priority(text,uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.nexra_agent_task_set_priority(text,uuid,text,uuid)', 'EXECUTE'), 'A anon and authenticated cannot execute set_priority');
  perform t.ok(not has_function_privilege('public', 'public.nexra_agent_task_set_priority(text,uuid,text,uuid)', 'EXECUTE'), 'A PUBLIC cannot execute set_priority');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_agent_tasks' and grantee = 'service_role') = array['SELECT'], 'A service_role: still SELECT only on tasks, no UPDATE grant');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_agent_task_events' and grantee = 'service_role') = array['SELECT'], 'A service_role: still SELECT only on events');
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_agent_task_events'::regclass) and (select count(*) from pg_policy where polrelid = 'public.nexra_agent_task_events'::regclass) = 0, 'A RLS on events, no policies');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_agent_task_set_status(text,uuid,text,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.nexra_agent_task_set_owner(text,uuid,text,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.nexra_agent_task_handoff_request(text,uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.nexra_agent_task_handoff_link(text,uuid,uuid,uuid)', 'EXECUTE'), 'A the four 20261004120000 grants are intact');
  perform t.ok((select count(*) from nexra_agent_task_events where from_priority is not null or to_priority is not null) = 0, 'A no existing event gained a priority');
end $$;

-- B: the function, as service_role (the application's role): outcomes and refusals.
set role service_role;
do $$
declare r jsonb; before timestamptz; n int;
begin
  before := (select updated_at from nexra_agent_tasks where id = t.task1());
  perform pg_sleep(0.01);
  r := t.pri('high');
  perform t.ok(r->>'outcome' = 'priority-changed', 'B medium -> high: priority-changed');
  perform t.ok(r->'task'->>'priority' = 'high' and r->'task'->>'status' = 'backlog' and r->'task'->>'owning_agent' = 'on-page-seo', 'B the answer carries the task: priority high, status and owner unchanged');
  perform t.ok(r->'event'->>'event_type' = 'priority-changed' and r->'event'->>'from_priority' = 'medium' and r->'event'->>'to_priority' = 'high'
    and r->'event'->>'from_status' is null and r->'event'->>'to_agent' is null and r->'event'->>'run_id' is null and (r->'event'->>'actor')::uuid = t.op(), 'B the event: medium > high by the operator, nothing else');
  perform t.ok((select priority from nexra_agent_tasks where id = t.task1()) = 'high', 'B the row now says high');
  perform t.ok((select updated_at from nexra_agent_tasks where id = t.task1()) > before, 'B updated_at moved');

  n := (select count(*) from nexra_agent_task_events);
  r := t.pri('high');
  perform t.ok(r->>'outcome' = 'same-priority' and r->'task'->>'priority' = 'high', 'B the same priority again: same-priority');
  perform t.ok((select count(*) from nexra_agent_task_events) = n, 'B same-priority writes no event');

  perform t.ok(t.err($q$select t.pri('urgent')$q$) = '22023', 'B a priority outside the four raises 22023');
  perform t.ok(t.err($q$select t.pri('HIGH')$q$) = '22023', 'B the priorities are exact: HIGH raises 22023');
  perform t.ok(t.err($q$select public.nexra_agent_task_set_priority('halcyon-fintech', t.task1(), null, t.op())$q$) = '22023', 'B a missing priority raises 22023');
  perform t.ok(t.err($q$select public.nexra_agent_task_set_priority(null, t.task1(), 'low', t.op())$q$) = '22023'
    and t.err($q$select public.nexra_agent_task_set_priority('halcyon-fintech', null, 'low', t.op())$q$) = '22023'
    and t.err($q$select public.nexra_agent_task_set_priority('halcyon-fintech', t.task1(), 'low', null)$q$) = '22023', 'B a missing project, task or operator raises 22023');
  perform t.ok((select count(*) from nexra_agent_task_events) = n and (select priority from nexra_agent_tasks where id = t.task1()) = 'high', 'B the refusals wrote nothing');

  perform t.ok(t.pri('low', t.task1(), 'verdant-home')->>'outcome' = 'task-not-found', 'B another project''s task answers task-not-found');
  perform t.ok(t.pri('low', gen_random_uuid())->>'outcome' = 'task-not-found', 'B an unknown task answers task-not-found');
  perform t.ok((select priority from nexra_agent_tasks where id = t.task1()) = 'high' and (select count(*) from nexra_agent_task_events) = n, 'B task-not-found wrote nothing');

  perform t.ok(public.nexra_agent_task_set_status('halcyon-fintech', t.task3(), 'cancelled', t.op())->>'outcome' = 'transitioned', 'B setup: the third task is cancelled');
  n := (select count(*) from nexra_agent_task_events);
  r := t.pri('low', t.task3());
  perform t.ok(r->>'outcome' = 'terminal' and r->'task'->>'priority' = 'high', 'B a cancelled task answers terminal and keeps its priority');
  perform t.ok(t.pri('high', t.task3())->>'outcome' = 'same-priority', 'B the same priority on a terminal task answers same-priority first (as set_owner does)');
  perform t.ok((select count(*) from nexra_agent_task_events) = n, 'B terminal wrote nothing');

  perform t.ok(t.pri('critical')->>'outcome' = 'priority-changed' and t.pri('medium')->>'outcome' = 'priority-changed', 'B high -> critical -> medium');
  perform t.ok(t.events() = 'created,priority-changed:medium>high,priority-changed:high>critical,priority-changed:critical>medium', 'B the history: three priority changes in order');
end $$;
reset role;

-- C: the guard, the shape check, and the status and owner functions unchanged by the new guard.
do $$
begin
  perform t.ok(t.err($q$update public.nexra_agent_tasks set priority = 'low' where id = t.task1()$q$) = '23514', 'C a direct priority update is refused (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set status = 'ready' where id = t.task1()$q$) = '23514', 'C a direct status update is still refused (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set title = 'renamed' where id = t.task1()$q$) = '23514', 'C a title never changes (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set source_ref = 'x' where id = t.task1()$q$) = '23514', 'C provenance never changes (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set project_id = 'verdant-home' where id = t.task1()$q$) = '23514', 'C a task never moves to another project (23514)');
  perform set_config('nexra.agent_task_write', t.task1()::text, true);
  perform t.ok(t.err($q$update public.nexra_agent_tasks set title = 'x' where id = t.task1()$q$) = '23514', 'C even under the flag, identity never changes (23514)');
  perform set_config('nexra.agent_task_write', '', true);
  perform t.ok((select priority from nexra_agent_tasks where id = t.task1()) = 'medium', 'C the refused updates changed nothing');

  perform t.ok(public.nexra_agent_task_set_status('halcyon-fintech', t.task1(), 'ready', t.op())->>'outcome' = 'transitioned', 'C set_status still works under the new guard');
  perform t.ok(public.nexra_agent_task_set_owner('halcyon-fintech', t.task1(), 'technical-seo', t.op())->>'outcome' = 'owner-changed', 'C set_owner still works under the new guard');
  perform t.ok((select priority from nexra_agent_tasks where id = t.task1()) = 'medium', 'C a status or owner change leaves the priority alone');
  perform t.ok(public.nexra_agent_task_set_status('halcyon-fintech', t.task1(), 'completed', t.op())->>'outcome' = 'transition-not-allowed', 'C the transition map is unchanged');

  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, actor) values (t.task1(), 'halcyon-fintech', 'priority-changed', 'low', 'low', t.op())$q$) = '23514', 'C a priority change to the same priority is refused by the shape check (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, to_priority, actor) values (t.task1(), 'halcyon-fintech', 'priority-changed', 'low', t.op())$q$) = '23514', 'C a priority change without its from value is refused (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, from_status, to_status, actor) values (t.task1(), 'halcyon-fintech', 'priority-changed', 'low', 'high', 'ready', 'blocked', t.op())$q$) = '23514', 'C a priority change carrying a status is refused (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, actor) values (t.task1(), 'halcyon-fintech', 'created', 'low', 'high', t.op())$q$) = '23514', 'C a created event carrying priorities is refused (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_status, to_status, to_priority, actor) values (t.task1(), 'halcyon-fintech', 'status-changed', 'ready', 'blocked', 'high', t.op())$q$) = '23514', 'C a status change carrying a priority is refused (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, actor) values (t.task1(), 'halcyon-fintech', 'priority-changed', 'low', 'urgent', t.op())$q$) = '23514', 'C a priority outside the four is refused by the column check (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, actor) values (t.task1(), 'halcyon-fintech', 'priority-set', t.op())$q$) = '23514', 'C an unknown event type is refused (23514)');
end $$;

-- D: history stays append-only.
do $$
begin
  perform t.ok(t.err($q$update public.nexra_agent_task_events set to_priority = 'low' where event_type = 'priority-changed'$q$) = '23514', 'D a priority event is never updated (23514)');
  perform t.ok(t.err($q$delete from public.nexra_agent_task_events where event_type = 'priority-changed'$q$) = '23514', 'D a priority event is never deleted (23514)');
  perform t.ok(t.err($q$truncate public.nexra_agent_task_events$q$) = '23514', 'D history is never truncated (23514)');
  perform t.ok((select count(*) from nexra_agent_task_events where event_type = 'priority-changed') = 3, 'D three priority events, all kept');
  perform t.ok((select bool_and(e.seq > p.seq) from nexra_agent_task_events e join nexra_agent_task_events p on p.task_id = e.task_id and p.event_type = 'created' where e.event_type <> 'created'), 'D every event follows its task''s created event');
end $$;

-- E: isolation, and nothing queued.
do $$
begin
  perform t.ok((select priority from nexra_agent_tasks where id = t.task2()) = 'low' and t.events(t.task2()) = 'created', 'E the verdant task is untouched');
  perform t.ok((select count(*) from nexra_agent_task_events where project_id <> (select project_id from nexra_agent_tasks k where k.id = task_id)) = 0, 'E every event belongs to its task''s project');
  perform t.ok((select count(*) from nexra_agent_tasks) = 3, 'E three tasks; nothing created by a priority change');
  perform t.ok((select count(*) from (select id, project_id, agent_id, task_type, status, input, result_summary from agent_runs except select * from t.runs_before) d) = 0
    and (select count(*) from agent_runs) = (select count(*) from t.runs_before), 'E no run was queued or changed');
end $$;
