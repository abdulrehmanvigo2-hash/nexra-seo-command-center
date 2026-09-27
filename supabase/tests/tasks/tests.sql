-- Agent tasks: sections A (schema), B (security), C (creating a task: outcomes, provenance, refusals), D (guards, isolation, the sources untouched).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create table t.runs_before as select id, project_id, agent_id, task_type, status, result_summary from agent_runs;
create table t.snaps_before as select id, project_id, property, end_date, queries from nexra_search_console_snapshots;

-- A: schema.
do $$
declare cols text[];
begin
  perform t.ok(to_regclass('public.nexra_agent_tasks') is not null, 'A tasks table exists');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_agent_tasks';
  perform t.ok(cols = array['id','project_id','title','source_kind','source_ref','owning_agent','status','priority','created_by','created_at','updated_at'], 'A columns in order: ' || cols::text);
  perform t.ok((select count(*) from information_schema.columns where table_name = 'nexra_agent_tasks' and is_nullable = 'YES') = 0, 'A no nullable column');
  perform t.ok((select array_agg(conname || ':' || confdeltype::text order by conname) from pg_constraint where conrelid = 'public.nexra_agent_tasks'::regclass and contype = 'f')
    = array['nexra_agent_tasks_project_fkey:r'], 'A one foreign key: the project, restricting');
  perform t.ok((select count(*) from pg_constraint where conrelid = 'public.nexra_agent_tasks'::regclass and contype = 'u') = 0, 'A no uniqueness: two operator-approved tasks are never collapsed');
  perform t.ok((select array_agg(conname::text order by conname) from pg_constraint where conrelid = 'public.nexra_agent_tasks'::regclass and contype = 'c')
    = array['nexra_agent_tasks_owning_agent_valid','nexra_agent_tasks_priority_valid','nexra_agent_tasks_source_kind_valid','nexra_agent_tasks_source_ref_length','nexra_agent_tasks_status_valid','nexra_agent_tasks_title_length','nexra_agent_tasks_title_trimmed','nexra_agent_tasks_updated_not_before_created'], 'A eight check constraints');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_tasks_status_valid') like '%backlog%ready%in-progress%blocked%review%completed%cancelled%', 'A the seven statuses');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_tasks_priority_valid') like '%low%medium%high%critical%', 'A the four priorities');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_tasks_source_kind_valid') like '%director-run%keyword%', 'A the two source kinds');
  perform t.ok((select column_default from information_schema.columns where table_name = 'nexra_agent_tasks' and column_name = 'status') = '''backlog''::text', 'A status defaults to backlog');
  perform t.ok((select column_default from information_schema.columns where table_name = 'nexra_agent_tasks' and column_name = 'priority') = '''medium''::text', 'A priority defaults to medium');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_agent_tasks'::regclass and not tgisinternal)
    = array['nexra_agent_tasks_guard_delete','nexra_agent_tasks_guard_truncate','nexra_agent_tasks_guard_update','nexra_agent_tasks_record_created'], 'A triggers: three guards and the created recorder (20261004120000)');
  perform t.ok((select bool_and(tgenabled = 'O') from pg_trigger where tgrelid = 'public.nexra_agent_tasks'::regclass and not tgisinternal), 'A all triggers enabled');
  perform t.ok((select count(*) from pg_indexes where tablename = 'nexra_agent_tasks' and indexname = 'nexra_agent_tasks_project_created_idx') = 1, 'A the project/created read index exists');
  perform t.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_name = 'agent_runs' and column_name in ('id','project_id','agent_id','task_type','status')) = array['id','project_id','agent_id','task_type','status'], 'A agent_runs is unchanged');
end $$;

-- B: security.
do $$
declare f text; fns text[] := array['nexra_agent_task_create','nexra_agent_tasks_guard_update','nexra_agent_tasks_guard_remove'];
begin
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_agent_tasks'::regclass), 'B RLS enabled');
  perform t.ok((select count(*) from pg_policy where polrelid = 'public.nexra_agent_tasks'::regclass) = 0, 'B no policies');
  perform t.ok((select tableowner = 'postgres' from pg_tables where tablename = 'nexra_agent_tasks'), 'B table owned by postgres');
  perform t.ok((select count(*) from information_schema.table_privileges where table_name = 'nexra_agent_tasks' and grantee in ('anon','authenticated')) = 0, 'B anon and authenticated hold nothing on the table');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_agent_tasks' and grantee = 'service_role') = array['SELECT'], 'B service_role: SELECT only');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_agent_task_create(text,text,text,text,text,text,uuid)', 'EXECUTE'), 'B service_role executes create');
  foreach f in array fns loop
    if f <> 'nexra_agent_task_create' then
      perform t.ok(not has_function_privilege('service_role', (select oid from pg_proc where proname = f), 'EXECUTE'), 'B service_role cannot execute ' || f);
    end if;
    perform t.ok(not has_function_privilege('anon', (select oid from pg_proc where proname = f), 'EXECUTE') and not has_function_privilege('authenticated', (select oid from pg_proc where proname = f), 'EXECUTE'), 'B anon and authenticated cannot execute ' || f);
    perform t.ok((select proconfig = array['search_path=""'] from pg_proc where proname = f), 'B empty search_path: ' || f);
    perform t.ok((select pg_get_userbyid(proowner) from pg_proc where proname = f) = 'postgres', 'B owned by postgres: ' || f);
  end loop;
  perform t.ok((select array_agg(proname order by proname) from pg_proc where proname like 'nexra_agent_task%' and prosecdef) = array['nexra_agent_task_create','nexra_agent_task_handoff_link','nexra_agent_task_handoff_request','nexra_agent_task_set_owner','nexra_agent_task_set_priority','nexra_agent_task_set_status']::name[], 'B the create function, the four workflow functions (20261004120000) and set_priority (20261005120000) are security definer, nothing else');
end $$;

-- B, as service_role: no direct write; the function is the way in.
set role service_role;
do $$
begin
  perform t.ok(t.err($q$insert into public.nexra_agent_tasks (project_id, title, source_kind, source_ref, owning_agent, created_by) values ('halcyon-fintech', 'x', 'keyword', 'business banking', 'writer', t.op())$q$) = '42501', 'B service_role cannot INSERT directly (42501)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set status = 'ready'$q$) = '42501', 'B service_role cannot UPDATE directly (42501)');
  perform t.ok(t.err($q$delete from public.nexra_agent_tasks$q$) = '42501', 'B service_role cannot DELETE directly (42501)');
  perform t.ok(t.err($q$truncate public.nexra_agent_tasks$q$) = '42501', 'B service_role cannot TRUNCATE (42501)');
  perform t.ok((t.task()->>'outcome') = 'created', 'B service_role creates a task through the function');
  perform t.ok((select count(*) from public.nexra_agent_tasks) = 1, 'B and can read it back');
end $$;
reset role;

-- C: creating a task.
do $$
declare r jsonb; row1 nexra_agent_tasks;
begin
  select * into row1 from nexra_agent_tasks;
  perform t.ok(row1.project_id = 'halcyon-fintech' and row1.title = 'Write the missing /services meta description' and row1.source_kind = 'director-run'
    and row1.source_ref = 'd0000000-0000-4000-8000-000000000001' and row1.owning_agent = 'on-page-seo' and row1.priority = 'medium' and row1.created_by = t.op(), 'C the row carries the project, title, source, owning agent, priority and operator');
  perform t.ok(row1.status = 'backlog' and row1.updated_at = row1.created_at, 'C a new task is in backlog, updated when created');
  r := t.task();
  perform t.ok(r->>'outcome' = 'created' and (r->'task'->>'id')::uuid <> row1.id, 'C a second task from the same run is a second row, never collapsed');
  perform t.ok((select count(*) from nexra_agent_tasks where source_ref = 'd0000000-0000-4000-8000-000000000001') = 2, 'C two tasks from one Director run');

  r := t.task(p_title => '   Trim me   ', p_ref => 'd0000000-0000-4000-8000-000000000002', p_agent => 'technical-seo', p_priority => 'high');
  perform t.ok(r->>'outcome' = 'created' and r->'task'->>'title' = 'Trim me' and r->'task'->>'priority' = 'high' and r->'task'->>'owning_agent' = 'technical-seo', 'C the single-run priority-review is a Director source too; the title is trimmed');

  -- Keyword provenance: the exact stored query text of the same project.
  r := t.task(p_kind => 'keyword', p_ref => 'business banking', p_agent => 'keyword-intent', p_title => 'Review the /banking title against "business banking"');
  perform t.ok(r->>'outcome' = 'created' and r->'task'->>'source_kind' = 'keyword' and r->'task'->>'source_ref' = 'business banking', 'C a keyword task names a query this product stored for the project');
  perform t.ok((t.task(p_kind => 'keyword', p_ref => 'Business Banking')->>'outcome') = 'keyword-not-found', 'C the query text is exact: a different case is not the stored query');
  perform t.ok((t.task(p_kind => 'keyword', p_ref => 'garden sheds')->>'outcome') = 'keyword-not-found', 'C another project''s stored query is not this project''s');
  perform t.ok((t.task(p_kind => 'keyword', p_ref => 'never searched')->>'outcome') = 'keyword-not-found', 'C a query this product never stored is refused');
  perform t.ok((t.task(p_kind => 'keyword', p_ref => 'https://halcyon.example/')->>'outcome') = 'keyword-not-found', 'C a stored page key is not a query');
  perform t.ok((t.task(p_project => 'verdant-home', p_kind => 'keyword', p_ref => 'garden sheds', p_agent => 'writer')->>'outcome') = 'created', 'C the other project records its own stored query');

  -- Director-run provenance.
  perform t.ok((t.task(p_ref => 'd0000000-0000-4000-8000-000000000006')->>'outcome') = 'run-not-found', 'C another project''s Director run answers run-not-found, never which');
  perform t.ok((t.task(p_ref => 'd0000000-0000-4000-8000-0000000000ff')->>'outcome') = 'run-not-found', 'C a run that does not exist');
  perform t.ok((t.task(p_ref => 'not-a-uuid')->>'outcome') = 'run-not-found', 'C a source ref that is not a run id');
  perform t.ok((t.task(p_ref => 'd0000000-0000-4000-8000-000000000003')->>'outcome') = 'run-not-completed', 'C a queued Director run has no result to act on');
  perform t.ok((t.task(p_ref => 'd0000000-0000-4000-8000-000000000004')->>'outcome') = 'run-not-completed', 'C a failed Director run has no result to act on');
  perform t.ok((t.task(p_ref => 'd0000000-0000-4000-8000-000000000005')->>'outcome') = 'run-not-director', 'C a completed specialist run is not a Director run');
  perform t.ok((t.task(p_project => 'nobody')->>'outcome') = 'project-not-found', 'C a project that is not stored');

  -- Invalid arguments raise and write nothing.
  perform t.ok(t.err($q$select t.task(p_kind => 'crawl')$q$) = '22023', 'C an unknown source kind raises 22023');
  perform t.ok(t.err($q$select t.task(p_agent => 'ghost-agent')$q$) = '22023', 'C an agent outside the registry raises 22023');
  perform t.ok(t.err($q$select t.task(p_priority => 'urgent')$q$) = '22023', 'C a priority outside the four raises 22023');
  perform t.ok(t.err($q$select t.task(p_title => '   ')$q$) = '22023', 'C a blank title raises 22023');
  perform t.ok(t.err($q$select t.task(p_title => repeat('x', 201))$q$) = '22023', 'C a 201-character title raises 22023');
  perform t.ok(t.err($q$select t.task(p_title => E'line\nbreak')$q$) = '22023', 'C a title with a control character raises 22023');
  perform t.ok(t.err($q$select t.task(p_ref => '')$q$) = '22023', 'C an empty source ref raises 22023');
  perform t.ok(t.err($q$select public.nexra_agent_task_create('halcyon-fintech', 'x', 'keyword', 'business banking', 'writer', 'low', null)$q$) = '22023', 'C a missing operator raises 22023');
  perform t.ok((select count(*) from nexra_agent_tasks) = 5, 'C five tasks recorded; every refusal wrote nothing');
  perform t.ok((select bool_and(status = 'backlog') from nexra_agent_tasks), 'C every recorded task is in backlog');
end $$;

-- D: guards, isolation, the sources untouched.
do $$
begin
  perform t.ok(t.err($q$update public.nexra_agent_tasks set status = 'ready'$q$) = '23514', 'D even the owner cannot update a task in this checkpoint (23514)');
  perform t.ok(t.err($q$update public.nexra_agent_tasks set project_id = 'verdant-home'$q$) = '23514', 'D a task never moves to another project (23514)');
  perform t.ok(t.err($q$delete from public.nexra_agent_tasks$q$) = '23514', 'D a task is never deleted (23514)');
  perform t.ok(t.err($q$truncate public.nexra_agent_tasks$q$) in ('23514', '0A000'), 'D a task is never truncated (23514, or 0A000 once 20261004120000 references it from the events table)');
  perform t.ok(t.err($q$delete from public.projects where id = 'halcyon-fintech'$q$) = '23503', 'D a project with tasks is not deleted (23503)');
  perform t.ok((select count(*) from nexra_agent_tasks) = 5, 'D five tasks remain');
  perform t.ok((select count(*) from nexra_agent_tasks where project_id = 'verdant-home') = 1 and (select count(*) from nexra_agent_tasks where project_id = 'halcyon-fintech') = 4, 'D each task belongs to the project it was recorded for');
  perform t.ok((select array_agg(id order by created_at desc, id desc) from nexra_agent_tasks where project_id = 'halcyon-fintech') is not null, 'D the read order the index serves is defined');
  perform t.ok((select count(*) from (select id, project_id, agent_id, task_type, status, result_summary from agent_runs except select * from t.runs_before) d) = 0
    and (select count(*) from (select * from t.runs_before except select id, project_id, agent_id, task_type, status, result_summary from agent_runs) d) = 0, 'D the runs read the same as before: recording a task changes no run');
  perform t.ok((select count(*) from (select id, project_id, property, end_date, queries from nexra_search_console_snapshots except select * from t.snaps_before) d) = 0, 'D the snapshots read the same as before: recording a task changes no evidence');
  perform t.ok((select count(*) from agent_runs where created_at > now() - interval '1 minute' and id not in (select id from t.runs_before)) = 0, 'D recording a task queued no run');
end $$;
