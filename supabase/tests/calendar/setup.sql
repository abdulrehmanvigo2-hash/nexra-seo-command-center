-- M3 calendar (migration 20261022120000): helpers over c4, gsc and tasks setups (projects halcyon-fintech and
-- verdant-home, articles a...01 of halcyon and a...02 of verdant, t.ok, t.err, t.op, t.task). Part of the local
-- PostgreSQL test harness; run only through supabase/tests/run.sh. Never run against a hosted database.
\set ON_ERROR_STOP 1
create schema t22;
-- An archived article of halcyon, written as fixtures are (no article function archives in the harness).
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count) values
 ('10000000-0000-4000-8000-000000000003','halcyon-fintech','content-strategist','content-plan-review',repeat('3',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','plan',1);
insert into nexra_articles (id, project_id, source_plan_run_id, status, created_by) values
 ('a0000000-0000-4000-8000-000000000003','halcyon-fintech','10000000-0000-4000-8000-000000000003','archived','00000000-0000-4000-8000-0000000000aa');
set session_replication_role = origin;
create function t22.a(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-00000000000' || n)::uuid $$;
create function t22.tid(r jsonb) returns uuid language sql immutable as $$ select (r->'task'->>'id')::uuid $$;
create function t22.date(p_project text, p_task uuid, p_date date) returns jsonb language sql as $$
  select public.nexra_agent_task_set_plan_date(p_project, p_task, p_date, t.op()) $$;
create function t22.link(p_project text, p_task uuid, p_article uuid) returns jsonb language sql as $$
  select public.nexra_agent_task_link_article(p_project, p_task, p_article, t.op()) $$;
create function t22.events(p_task uuid) returns bigint language sql as $$ select count(*) from public.nexra_agent_task_events where task_id = p_task $$;
create function t22.status(p_task uuid, p_to text) returns jsonb language sql as $$
  select public.nexra_agent_task_set_status('halcyon-fintech', p_task, p_to, t.op()) $$;
grant usage on schema t22 to service_role;
grant execute on all functions in schema t22 to service_role;
