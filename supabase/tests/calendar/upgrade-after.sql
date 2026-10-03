-- M3 upgrade, second half (after migration 20261022120000): every task and event row unchanged, the new columns null on
-- every existing row, and the earlier functions still work. Part of the local PostgreSQL test harness; run only through
-- supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record; k uuid;
begin
  select * into b from t22u.before;
  perform t.ok(t22u.tasks() = b.tasks and t22u.events() = b.events, 'U every task and event row is unchanged, byte for byte');
  perform t.ok(not exists (select 1 from public.nexra_agent_tasks where planned_for is not null)
    and not exists (select 1 from public.nexra_agent_task_events where from_date is not null or to_date is not null or article_id is not null), 'U the new columns are null on every existing row');
  k := (select id from public.nexra_agent_tasks limit 1);
  perform t.ok(public.nexra_agent_task_set_priority('halcyon-fintech', k, 'low', t.op())->>'outcome' = 'priority-changed', 'U the priority function still works');
  perform t.ok(public.nexra_agent_task_set_plan_date('halcyon-fintech', k, date '2026-10-12', t.op())->>'outcome' = 'plan-date-changed', 'U after: a date can be planned');
end $$;
