-- Agent task workflow: sections A (events schema and security), B (status transitions: the map, every refused jump, terminal states),
-- C (owner changes), D (handoff request and link, duplicate protection, provenance), E (history immutability, guards, isolation, the runs untouched).
-- Runs over c4/setup.sql, gsc/setup.sql and tasks/setup.sql. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create table t.runs_before as select id, project_id, agent_id, task_type, status, input, result_summary from agent_runs;

-- Two tasks to work on: one halcyon (on-page-seo), one verdant (writer).
create function t.task1() returns uuid language sql stable as $$ select id from nexra_agent_tasks where project_id = 'halcyon-fintech' order by created_at, id limit 1 $$;
create function t.task2() returns uuid language sql stable as $$ select id from nexra_agent_tasks where project_id = 'verdant-home' order by created_at, id limit 1 $$;
select t.ok((t.task()->>'outcome') = 'created', 'setup: halcyon task recorded');
select t.ok((t.task(p_project => 'verdant-home', p_kind => 'keyword', p_ref => 'garden sheds', p_agent => 'writer')->>'outcome') = 'created', 'setup: verdant task recorded');

create function t.st(p_status text, p_task uuid default null, p_project text default 'halcyon-fintech', p_operator uuid default null) returns jsonb language sql as $$
  select public.nexra_agent_task_set_status(p_project, coalesce(p_task, t.task1()), p_status, coalesce(p_operator, t.op())) $$;
create function t.own(p_agent text, p_task uuid default null, p_project text default 'halcyon-fintech', p_operator uuid default null) returns jsonb language sql as $$
  select public.nexra_agent_task_set_owner(p_project, coalesce(p_task, t.task1()), p_agent, coalesce(p_operator, t.op())) $$;
create function t.hreq(p_task uuid default null, p_project text default 'halcyon-fintech') returns jsonb language sql as $$
  select public.nexra_agent_task_handoff_request(p_project, coalesce(p_task, t.task1()), t.op()) $$;
create function t.hlink(p_run uuid, p_task uuid default null, p_project text default 'halcyon-fintech') returns jsonb language sql as $$
  select public.nexra_agent_task_handoff_link(p_project, coalesce(p_task, t.task1()), p_run, t.op()) $$;
create function t.events(p_task uuid default null) returns text language sql stable as $$
  select string_agg(event_type || coalesce(':' || from_status || '>' || to_status, '') || coalesce(':' || from_agent || '>' || to_agent, '') || coalesce(':' || to_agent, '') , ',' order by seq)
    from nexra_agent_task_events where task_id = coalesce(p_task, t.task1()) $$;
grant execute on all functions in schema t to service_role;

-- A: the events table and its security.
do $$
declare cols text[]; f text; fns text[] := array['nexra_agent_task_set_status','nexra_agent_task_set_owner','nexra_agent_task_handoff_request','nexra_agent_task_handoff_link','nexra_agent_task_transition_allowed','nexra_agent_task_events_guard','nexra_agent_tasks_record_created','nexra_agent_tasks_guard_update'];
begin
  perform t.ok(to_regclass('public.nexra_agent_task_events') is not null, 'A events table exists');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_agent_task_events';
  perform t.ok(cols = array['id','seq','task_id','project_id','event_type','from_status','to_status','from_agent','to_agent','run_id','actor','created_at'], 'A columns in order: ' || cols::text);
  perform t.ok((select array_agg(conname || ':' || confdeltype::text order by conname) from pg_constraint where conrelid = 'public.nexra_agent_task_events'::regclass and contype = 'f')
    = array['nexra_agent_task_events_project_fkey:r','nexra_agent_task_events_run_fkey:r','nexra_agent_task_events_task_fkey:r'], 'A three foreign keys, all restricting: task, project, run');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_task_events_type_valid') like '%created%status-changed%owner-changed%handoff-requested%handoff-run-linked%', 'A the five event types');
  perform t.ok((select count(*) from pg_constraint where conname = 'nexra_agent_task_events_shape') = 1, 'A a shape check ties each type to its fields');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_agent_task_events'::regclass and not tgisinternal)
    = array['nexra_agent_task_events_guard_delete','nexra_agent_task_events_guard_truncate','nexra_agent_task_events_guard_update'], 'A events triggers: three guards');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_agent_tasks'::regclass and not tgisinternal)
    = array['nexra_agent_tasks_guard_delete','nexra_agent_tasks_guard_truncate','nexra_agent_tasks_guard_update','nexra_agent_tasks_record_created'], 'A task triggers: three guards and the created recorder');
  perform t.ok((select count(*) from pg_indexes where tablename = 'nexra_agent_task_events' and indexname = 'nexra_agent_task_events_task_seq_idx') = 1 and (select count(*) from pg_indexes where tablename = 'nexra_agent_task_events' and indexname = 'nexra_agent_task_events_seq_idx') = 1, 'A the task/seq read index and the unique seq index exist');
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_agent_task_events'::regclass), 'A RLS enabled on events');
  perform t.ok((select count(*) from pg_policy where polrelid = 'public.nexra_agent_task_events'::regclass) = 0, 'A no policies on events');
  perform t.ok((select count(*) from information_schema.table_privileges where table_name = 'nexra_agent_task_events' and grantee in ('anon','authenticated')) = 0, 'A anon and authenticated hold nothing on events');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_agent_task_events' and grantee = 'service_role') = array['SELECT'], 'A service_role: SELECT only on events');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_agent_tasks' and grantee = 'service_role') = array['SELECT'], 'A service_role: still SELECT only on tasks, no UPDATE grant');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_agent_task_set_status(text,uuid,text,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.nexra_agent_task_set_owner(text,uuid,text,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.nexra_agent_task_handoff_request(text,uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.nexra_agent_task_handoff_link(text,uuid,uuid,uuid)', 'EXECUTE'), 'A service_role executes the four write functions');
  foreach f in array fns loop
    if f not in ('nexra_agent_task_set_status','nexra_agent_task_set_owner','nexra_agent_task_handoff_request','nexra_agent_task_handoff_link') then
      perform t.ok(not has_function_privilege('service_role', (select oid from pg_proc where proname = f), 'EXECUTE'), 'A service_role cannot execute ' || f);
    end if;
    perform t.ok(not has_function_privilege('anon', (select oid from pg_proc where proname = f), 'EXECUTE') and not has_function_privilege('authenticated', (select oid from pg_proc where proname = f), 'EXECUTE'), 'A anon and authenticated cannot execute ' || f);
    perform t.ok((select proconfig = array['search_path=""'] from pg_proc where proname = f), 'A empty search_path: ' || f);
    perform t.ok((select pg_get_userbyid(proowner) from pg_proc where proname = f) = 'postgres', 'A owned by postgres: ' || f);
  end loop;
  perform t.ok((select array_agg(proname order by proname) from pg_proc where proname like 'nexra_agent_task%' and prosecdef)
    = array['nexra_agent_task_create','nexra_agent_task_handoff_link','nexra_agent_task_handoff_request','nexra_agent_task_set_owner','nexra_agent_task_set_status']::name[], 'A exactly the five write functions are security definer');
  perform t.ok((select count(*) from nexra_agent_task_events) = 2 and (select bool_and(event_type = 'created' and actor = t.op()) from nexra_agent_task_events), 'A each recorded task has one created event by its operator');
  perform t.ok((select e.created_at = k.created_at and e.project_id = k.project_id from nexra_agent_task_events e join nexra_agent_tasks k on k.id = e.task_id where e.task_id = t.task1()), 'A the created event carries the task''s own time and project');
end $$;

-- A, as service_role: no direct write to either table; the functions are the way in.
set role service_role;
do $$
begin
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, actor) values (t.task1(), 'halcyon-fintech', 'created', t.op())$q$) = '42501', 'A service_role cannot INSERT an event directly (42501)');
  perform t.ok(t.err($q$update public.nexra_agent_task_events set actor = t.op()$q$) = '42501', 'A service_role cannot UPDATE an event (42501)');
  perform t.ok(t.err($q$delete from public.nexra_agent_task_events$q$) = '42501', 'A service_role cannot DELETE an event (42501)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set status = 'ready'$q$) = '42501', 'A service_role still cannot UPDATE a task directly (42501)');
  perform t.ok(t.err($q$select set_config('nexra.agent_task_write', t.task1()::text, false)$q$) = 'none' and t.err($q$update public.nexra_agent_tasks set status = 'ready' where id = t.task1()$q$) = '42501', 'A setting the write flag by hand does not grant UPDATE (42501)');
  perform t.ok((t.st('ready')->>'outcome') = 'transitioned', 'A service_role transitions a task through the function');
  perform t.ok((select status from public.nexra_agent_tasks where id = t.task1()) = 'ready' and (select count(*) from public.nexra_agent_task_events where task_id = t.task1()) = 2, 'A and reads the task and its history back');
end $$;
reset role;
select set_config('nexra.agent_task_write', '', false);

-- B: status transitions.
do $$
declare r jsonb; f text; s text; allowed text[]; v_from text; v_to text; refused int := 0; expected_refused int := 0;
  all_states text[] := array['backlog','ready','in-progress','blocked','review','completed','cancelled'];
begin
  -- The map, one function.
  perform t.ok(nexra_agent_task_transition_allowed('backlog','ready') and nexra_agent_task_transition_allowed('backlog','blocked') and nexra_agent_task_transition_allowed('backlog','cancelled') and not nexra_agent_task_transition_allowed('backlog','in-progress') and not nexra_agent_task_transition_allowed('backlog','review') and not nexra_agent_task_transition_allowed('backlog','completed'), 'B backlog → ready, blocked, cancelled only');
  perform t.ok(nexra_agent_task_transition_allowed('ready','in-progress') and nexra_agent_task_transition_allowed('ready','blocked') and nexra_agent_task_transition_allowed('ready','cancelled') and not nexra_agent_task_transition_allowed('ready','backlog') and not nexra_agent_task_transition_allowed('ready','review') and not nexra_agent_task_transition_allowed('ready','completed'), 'B ready → in-progress, blocked, cancelled only');
  perform t.ok(nexra_agent_task_transition_allowed('in-progress','review') and nexra_agent_task_transition_allowed('in-progress','blocked') and nexra_agent_task_transition_allowed('in-progress','cancelled') and not nexra_agent_task_transition_allowed('in-progress','completed') and not nexra_agent_task_transition_allowed('in-progress','ready') and not nexra_agent_task_transition_allowed('in-progress','backlog'), 'B in-progress → review, blocked, cancelled only');
  perform t.ok(nexra_agent_task_transition_allowed('blocked','ready') and nexra_agent_task_transition_allowed('blocked','in-progress') and nexra_agent_task_transition_allowed('blocked','cancelled') and not nexra_agent_task_transition_allowed('blocked','review') and not nexra_agent_task_transition_allowed('blocked','completed') and not nexra_agent_task_transition_allowed('blocked','backlog'), 'B blocked → ready, in-progress, cancelled only');
  perform t.ok(nexra_agent_task_transition_allowed('review','in-progress') and nexra_agent_task_transition_allowed('review','completed') and nexra_agent_task_transition_allowed('review','blocked') and not nexra_agent_task_transition_allowed('review','cancelled') and not nexra_agent_task_transition_allowed('review','ready') and not nexra_agent_task_transition_allowed('review','backlog'), 'B review → in-progress, completed, blocked only');
  perform t.ok((select count(*) from unnest(all_states) x where nexra_agent_task_transition_allowed('completed', x) or nexra_agent_task_transition_allowed('cancelled', x)) = 0, 'B completed and cancelled allow nothing');
  perform t.ok((select count(*) from unnest(all_states) a, unnest(all_states) b where nexra_agent_task_transition_allowed(a, b)) = 15, 'B fifteen allowed transitions in all');

  -- Walk the task through: ready (done in A) → in-progress → review → in-progress → blocked → ready → in-progress → review → completed.
  foreach s in array array['in-progress','review','in-progress','blocked','ready','in-progress','review','completed'] loop
    r := t.st(s);
    perform t.ok(r->>'outcome' = 'transitioned' and r->'task'->>'status' = s and r->'event'->>'event_type' = 'status-changed' and r->'event'->>'to_status' = s, 'B transitioned to ' || s);
  end loop;
  perform t.ok(t.events() = 'created,status-changed:backlog>ready,status-changed:ready>in-progress,status-changed:in-progress>review,status-changed:review>in-progress,status-changed:in-progress>blocked,status-changed:blocked>ready,status-changed:ready>in-progress,status-changed:in-progress>review,status-changed:review>completed', 'B the history names every step, each from its true previous status');
  perform t.ok((select updated_at > created_at from nexra_agent_tasks where id = t.task1()), 'B updated_at moved; created_at did not');
  perform t.ok((select bool_and(actor = t.op()) from nexra_agent_task_events where task_id = t.task1()), 'B every event names the operator who made it');

  -- Terminal: completed refuses everything, including itself and cancelled.
  foreach s in array all_states loop
    r := t.st(s);
    perform t.ok(r->>'outcome' = case when s = 'completed' then 'same-status' else 'terminal' end, 'B completed refuses → ' || s || ' (' || (r->>'outcome') || ')');
  end loop;

  -- Every invalid jump from every non-terminal state, on the verdant task, which walks backlog → cancelled at the end.
  foreach v_from in array array['backlog','ready','in-progress','blocked','review'] loop
    -- Bring task2 to v_from along allowed steps.
    perform t.st('ready', t.task2(), 'verdant-home') where v_from in ('ready','in-progress','blocked','review') and (select status from nexra_agent_tasks where id = t.task2()) = 'backlog';
    perform t.st('in-progress', t.task2(), 'verdant-home') where v_from in ('in-progress','blocked','review') and (select status from nexra_agent_tasks where id = t.task2()) = 'ready';
    perform t.st('blocked', t.task2(), 'verdant-home') where v_from = 'blocked' and (select status from nexra_agent_tasks where id = t.task2()) = 'in-progress';
    perform t.st('review', t.task2(), 'verdant-home') where v_from = 'review' and (select status from nexra_agent_tasks where id = t.task2()) = 'in-progress';
    perform t.st('in-progress', t.task2(), 'verdant-home') where v_from = 'review' and (select status from nexra_agent_tasks where id = t.task2()) = 'blocked';
    perform t.st('review', t.task2(), 'verdant-home') where v_from = 'review' and (select status from nexra_agent_tasks where id = t.task2()) = 'in-progress';
    perform t.ok((select status from nexra_agent_tasks where id = t.task2()) = v_from, 'B verdant task brought to ' || v_from);
    foreach v_to in array all_states loop
      if v_to <> v_from and not nexra_agent_task_transition_allowed(v_from, v_to) then
        expected_refused := expected_refused + 1;
        r := t.st(v_to, t.task2(), 'verdant-home');
        if r->>'outcome' = 'transition-not-allowed' and r->'task'->>'status' = v_from then refused := refused + 1; end if;
      end if;
    end loop;
    perform t.ok((t.st(v_from, t.task2(), 'verdant-home')->>'outcome') = 'same-status', 'B ' || v_from || ' → ' || v_from || ' is same-status, no event');
  end loop;
  perform t.ok(refused = expected_refused and expected_refused = 15, 'B every invalid jump refused with transition-not-allowed and the unchanged task: ' || refused || ' of ' || expected_refused);
  perform t.ok((select count(*) from nexra_agent_task_events where task_id = t.task2() and event_type = 'status-changed') = 5, 'B refusals and same-status wrote no event: five real steps on the verdant task');
  perform t.ok((t.st('cancelled', t.task2(), 'verdant-home')->>'outcome') = 'transition-not-allowed', 'B review → cancelled is not in the map');
  perform t.ok((t.st('blocked', t.task2(), 'verdant-home')->>'outcome') = 'transitioned' and (t.st('cancelled', t.task2(), 'verdant-home')->>'outcome') = 'transitioned', 'B review → blocked → cancelled ends the verdant task');
  perform t.ok((t.st('ready', t.task2(), 'verdant-home')->>'outcome') = 'terminal', 'B cancelled is terminal');

  -- Cross-project and arguments.
  perform t.ok((t.st('ready', t.task2(), 'halcyon-fintech')->>'outcome') = 'task-not-found', 'B another project''s task answers task-not-found, never which');
  perform t.ok((t.st('ready', 'd0000000-0000-4000-8000-0000000000ff')->>'outcome') = 'task-not-found', 'B a task that does not exist');
  perform t.ok(t.err($q$select t.st('done')$q$) = '22023', 'B an unknown status raises 22023');
  perform t.ok(t.err($q$select public.nexra_agent_task_set_status('halcyon-fintech', t.task1(), 'ready', null)$q$) = '22023', 'B a missing operator raises 22023');
end $$;

-- C: owner changes, on a fresh halcyon task.
select t.ok((t.task(p_agent => 'technical-seo', p_title => 'Owner task')->>'outcome') = 'created', 'C setup: a third task, technical-seo');
create function t.task3() returns uuid language sql stable as $$ select id from nexra_agent_tasks where title = 'Owner task' $$;
do $$
declare r jsonb;
begin
  r := t.own('on-page-seo', t.task3());
  perform t.ok(r->>'outcome' = 'owner-changed' and r->'task'->>'owning_agent' = 'on-page-seo' and r->'event'->>'from_agent' = 'technical-seo' and r->'event'->>'to_agent' = 'on-page-seo', 'C the owner changes to a registry agent and the event names both');
  perform t.ok((t.own('on-page-seo', t.task3())->>'outcome') = 'same-owner', 'C the same owner is same-owner, no event');
  perform t.ok(t.err($q$select t.own('ghost-agent', t.task3())$q$) = '22023', 'C an agent outside the registry raises 22023');
  perform t.ok(t.err($q$select t.own('', t.task3())$q$) = '22023', 'C an empty agent raises 22023');
  perform t.ok((t.own('writer', t.task3(), 'verdant-home')->>'outcome') = 'task-not-found', 'C another project cannot reassign this task');
  perform t.ok((t.own('writer', t.task1())->>'outcome') = 'terminal', 'C a completed task keeps its owner');
  perform t.ok((t.own('technical-seo', t.task2(), 'verdant-home')->>'outcome') = 'terminal', 'C a cancelled task keeps its owner');
  perform t.ok((select status from nexra_agent_tasks where id = t.task3()) = 'backlog', 'C changing the owner did not move the status');
  perform t.ok(t.events(t.task3()) = 'created,owner-changed:technical-seo>on-page-seo:on-page-seo', 'C the history: created, one owner change');
  perform t.ok((select count(*) from agent_runs) = (select count(*) from t.runs_before), 'C changing the owner queued no run');
end $$;

-- D: handoff.
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input, input_hash, status, created_by, executor, attempt_count, started_at, finished_at, result_summary) values
 ('e0000000-0000-4000-8000-000000000001','halcyon-fintech','on-page-seo','on-page-review', jsonb_build_object('crawlId','c0000000-0000-4000-8000-000000000001','sourceTaskId',(select t.task3()::text)), repeat('1',64),'queued','00000000-0000-4000-8000-0000000000aa',null,0,null,null,null),
 ('e0000000-0000-4000-8000-000000000002','halcyon-fintech','technical-seo','crawl-review', jsonb_build_object('crawlId','c0000000-0000-4000-8000-000000000001','sourceTaskId',(select t.task3()::text)), repeat('2',64),'queued','00000000-0000-4000-8000-0000000000aa',null,0,null,null,null),
 ('e0000000-0000-4000-8000-000000000003','verdant-home','on-page-seo','on-page-review', jsonb_build_object('crawlId','c0000000-0000-4000-8000-000000000001','sourceTaskId',(select t.task3()::text)), repeat('3',64),'queued','00000000-0000-4000-8000-0000000000aa',null,0,null,null,null),
 ('e0000000-0000-4000-8000-000000000004','halcyon-fintech','on-page-seo','on-page-review', jsonb_build_object('crawlId','c0000000-0000-4000-8000-000000000001'), repeat('4',64),'queued','00000000-0000-4000-8000-0000000000aa',null,0,null,null,null),
 ('e0000000-0000-4000-8000-000000000005','halcyon-fintech','on-page-seo','on-page-review', jsonb_build_object('crawlId','c0000000-0000-4000-8000-000000000002','sourceTaskId',(select t.task3()::text)), repeat('5',64),'completed','00000000-0000-4000-8000-0000000000aa','ai',1,now(),now(),'OBSERVED …');
set session_replication_role = origin;
do $$
declare r jsonb; before int;
begin
  select count(*) into before from agent_runs;
  r := t.hreq(t.task3());
  perform t.ok(r->>'outcome' = 'requested' and r->'task'->>'owning_agent' = 'on-page-seo' and r->'event'->>'event_type' = 'handoff-requested' and r->'event'->>'to_agent' = 'on-page-seo', 'D a request is recorded for the owning agent');
  perform t.ok((select count(*) from agent_runs) = before, 'D a request creates no run');
  perform t.ok((t.hlink('e0000000-0000-4000-8000-000000000002', t.task3())->>'outcome') = 'run-not-found', 'D a run of another agent is not this task''s handoff');
  perform t.ok((t.hlink('e0000000-0000-4000-8000-000000000003', t.task3())->>'outcome') = 'run-not-found', 'D a run of another project is not this task''s handoff');
  perform t.ok((t.hlink('e0000000-0000-4000-8000-000000000004', t.task3())->>'outcome') = 'run-not-found', 'D a run without sourceTaskId is not this task''s handoff');
  perform t.ok((t.hlink('e0000000-0000-4000-8000-0000000000ff', t.task3())->>'outcome') = 'run-not-found', 'D a run that does not exist');
  perform t.ok((t.hlink('e0000000-0000-4000-8000-000000000001', t.task3(), 'verdant-home')->>'outcome') = 'task-not-found', 'D another project cannot link this task');
  r := t.hlink('e0000000-0000-4000-8000-000000000001', t.task3());
  perform t.ok(r->>'outcome' = 'linked' and r->>'run_id' = 'e0000000-0000-4000-8000-000000000001' and r->'event'->>'event_type' = 'handoff-run-linked' and r->'event'->>'run_id' = 'e0000000-0000-4000-8000-000000000001', 'D the run with the task''s id in its input, same project and agent, links');
  perform t.ok((t.hlink('e0000000-0000-4000-8000-000000000001', t.task3())->>'outcome') = 'already-linked', 'D linking the same run twice is already-linked, no second event');
  r := t.hreq(t.task3());
  perform t.ok(r->>'outcome' = 'handoff-active' and r->>'run_id' = 'e0000000-0000-4000-8000-000000000001', 'D a second request while the linked run is queued is refused: handoff-active names the run');
  perform t.ok((select count(*) from nexra_agent_task_events where task_id = t.task3() and event_type = 'handoff-requested') = 1, 'D the refused request wrote no event');
  perform t.ok((select status from agent_runs where id = 'e0000000-0000-4000-8000-000000000001') = 'queued', 'D the linked run is still queued: nothing executed it');
  -- The linked run finishes (as the worker would); a new handoff may be requested.
  set session_replication_role = replica;
  update agent_runs set status = 'cancelled', cancelled_by = '00000000-0000-4000-8000-0000000000aa', finished_at = now() where id = 'e0000000-0000-4000-8000-000000000001';
  set session_replication_role = origin;
  perform t.ok((t.hreq(t.task3())->>'outcome') = 'requested', 'D once the linked run is no longer queued or running, a new request is recorded');
  perform t.ok((t.hlink('e0000000-0000-4000-8000-000000000005', t.task3())->>'outcome') = 'linked', 'D a completed run with the provenance links too');
  perform t.ok((t.hreq(t.task1())->>'outcome') = 'terminal' and (t.hreq(t.task2(), 'verdant-home')->>'outcome') = 'terminal', 'D a completed or cancelled task is not handed off');
  perform t.ok((t.hreq(t.task3(), 'verdant-home')->>'outcome') = 'task-not-found', 'D another project cannot request a handoff of this task');
  perform t.ok(t.err($q$select public.nexra_agent_task_handoff_request('halcyon-fintech', t.task3(), null)$q$) = '22023' and t.err($q$select public.nexra_agent_task_handoff_link('halcyon-fintech', t.task3(), null, t.op())$q$) = '22023', 'D missing arguments raise 22023');
  perform t.ok(t.events(t.task3()) = 'created,owner-changed:technical-seo>on-page-seo:on-page-seo,handoff-requested:on-page-seo,handoff-run-linked:on-page-seo,handoff-requested:on-page-seo,handoff-run-linked:on-page-seo', 'D the history: request, link, request, link');
  perform t.ok((select status from nexra_agent_tasks where id = t.task3()) = 'backlog' and (select owning_agent from nexra_agent_tasks where id = t.task3()) = 'on-page-seo', 'D a handoff changes neither the status nor the owner');
end $$;

-- E: history immutability, guards, isolation, the runs untouched.
do $$
begin
  perform t.ok(t.err($q$update public.nexra_agent_task_events set actor = gen_random_uuid()$q$) = '23514', 'E even the owner cannot update history (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (seq, task_id, project_id, event_type, actor) values (1, t.task3(), 'halcyon-fintech', 'created', t.op())$q$) in ('428C9', '23505'), 'E seq is always generated, never supplied');
  perform t.ok((select count(*) from nexra_agent_task_events) = (select count(distinct seq) from nexra_agent_task_events) and (select bool_and(e.seq > p.seq) from nexra_agent_task_events e join nexra_agent_task_events p on p.task_id = e.task_id and p.event_type = 'created' where e.event_type <> 'created'), 'E seq orders every event after its task''s created event');
  perform t.ok(t.err($q$delete from public.nexra_agent_task_events$q$) = '23514', 'E history is never deleted (23514)');
  perform t.ok(t.err($q$truncate public.nexra_agent_task_events$q$) = '23514', 'E history is never truncated (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_status, actor) values (t.task3(), 'halcyon-fintech', 'created', 'ready', t.op())$q$) = '23514', 'E a created event with a status is refused by the shape check (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_status, to_status, actor) values (t.task3(), 'halcyon-fintech', 'status-changed', 'ready', 'ready', t.op())$q$) = '23514', 'E a status change to the same status is refused (23514)');
  perform t.ok(t.err($q$insert into public.nexra_agent_task_events (task_id, project_id, event_type, to_agent, actor) values (t.task3(), 'halcyon-fintech', 'handoff-run-linked', 'on-page-seo', t.op())$q$) = '23514', 'E a link without a run is refused (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set status = 'ready' where id = t.task3()$q$) = '23514', 'E even the owner cannot update a task outside the functions (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set title = 'renamed' where id = t.task3()$q$) = '23514', 'E a title never changes (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set project_id = 'verdant-home' where id = t.task3()$q$) = '23514', 'E a task never moves to another project (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set priority = 'high' where id = t.task3()$q$) = '23514', 'E a priority never changes here (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set source_ref = 'x' where id = t.task3()$q$) = '23514', 'E provenance never changes (23514)');
  perform t.ok(t.err($q$delete from public.nexra_agent_tasks$q$) = '23514', 'E a task is never deleted (23514)');
  perform t.ok(t.err($q$delete from public.projects where id = 'halcyon-fintech'$q$) = '23503', 'E a project with history is not deleted (23503)');
  perform t.ok(t.err($q$delete from public.agent_runs where id = 'e0000000-0000-4000-8000-000000000005'$q$) in ('23503', '23514'), 'E a run linked to a task is not deleted');
  perform t.ok((select count(*) from nexra_agent_tasks) = 3, 'E three tasks; nothing created by the workflow');
  perform t.ok((select count(*) from nexra_agent_task_events where project_id <> (select project_id from nexra_agent_tasks k where k.id = task_id)) = 0, 'E every event belongs to its task''s project');
  perform t.ok((select count(*) from (select id, project_id, agent_id, task_type, status, input, result_summary from agent_runs where id::text not like 'e0000000-%' except select * from t.runs_before) d) = 0, 'E the pre-existing runs read the same as before');
  perform t.ok((select count(*) from agent_runs where id::text not like 'e0000000-%') = (select count(*) from t.runs_before), 'E the workflow queued no run of its own');
end $$;
