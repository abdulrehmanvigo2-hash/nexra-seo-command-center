-- M3 upgrade, first half (before migration 20261022120000): tasks with created, status, owner and priority events,
-- every task and event row kept aside. Part of the local PostgreSQL test harness; run only through
-- supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t22u;
do $$
declare k uuid;
begin
  k := (t.task()->'task'->>'id')::uuid;
  perform t.ok(public.nexra_agent_task_set_status('halcyon-fintech', k, 'ready', t.op())->>'outcome' = 'transitioned', 'U setup: a status change');
  perform t.ok(public.nexra_agent_task_set_owner('halcyon-fintech', k, 'writer', t.op())->>'outcome' = 'owner-changed', 'U setup: an owner change');
  perform t.ok(public.nexra_agent_task_set_priority('halcyon-fintech', k, 'high', t.op())->>'outcome' = 'priority-changed', 'U setup: a priority change');
  perform t.ok(not exists (select 1 from information_schema.columns where table_name = 'nexra_agent_tasks' and column_name = 'planned_for'), 'U before: no planned_for');
end $$;
create function t22u.tasks() returns jsonb language sql as $$ select jsonb_agg(to_jsonb(x) - 'planned_for' order by x.id) from public.nexra_agent_tasks x $$;
create function t22u.events() returns jsonb language sql as $$ select jsonb_agg(to_jsonb(x) - 'from_date' - 'to_date' - 'article_id' order by x.seq) from public.nexra_agent_task_events x $$;
create table t22u.before as select t22u.tasks() tasks, t22u.events() events;
