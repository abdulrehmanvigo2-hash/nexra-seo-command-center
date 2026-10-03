-- M3 calendar (migration 20261022120000) on the full schema: the planned date and the article link, their events, every
-- refusal, the guards and the security. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema and security.
do $$
begin
  perform t.ok((select data_type from information_schema.columns where table_name = 'nexra_agent_tasks' and column_name = 'planned_for') = 'date', 'A tasks: planned_for is a date');
  perform t.ok((select count(*) from information_schema.columns where table_name = 'nexra_agent_task_events' and column_name in ('from_date', 'to_date', 'article_id')) = 3, 'A events: from_date, to_date and article_id');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_task_events_type_valid') like '%priority-changed%plan-date-changed%article-linked%', 'A events: the two new types');
  perform t.ok((select bool_and(prosecdef and proconfig = array['search_path=""']) from pg_proc where proname in ('nexra_agent_task_set_plan_date', 'nexra_agent_task_link_article'))
    and (select count(*) from pg_proc where proname in ('nexra_agent_task_set_plan_date', 'nexra_agent_task_link_article')) = 2, 'A two functions: security definer, empty search_path');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_agent_task_set_plan_date(text,uuid,date,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.nexra_agent_task_link_article(text,uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.nexra_agent_task_set_plan_date(text,uuid,date,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.nexra_agent_task_link_article(text,uuid,uuid,uuid)', 'execute'), 'A EXECUTE for service_role only');
  perform t.ok(not has_table_privilege('service_role', 'public.nexra_agent_tasks', 'update') and not has_table_privilege('service_role', 'public.nexra_agent_task_events', 'insert'), 'A still no UPDATE on tasks or INSERT on events for service_role');
end $$;

-- B: the planned date — set, move, clear; each an event; the refusals write nothing.
do $$
declare k uuid; r jsonb; n bigint;
begin
  k := t22.tid(t.task());
  r := t22.date('halcyon-fintech', k, date '2026-10-12');
  perform t.ok(r->>'outcome' = 'plan-date-changed' and r->'task'->>'planned_for' = '2026-10-12' and r->'event'->>'to_date' = '2026-10-12' and r->'event'->'from_date' = 'null'::jsonb, 'B set: plan-date-changed, from none to 12 Oct');
  r := t22.date('halcyon-fintech', k, date '2026-10-19');
  perform t.ok(r->>'outcome' = 'plan-date-changed' and r->'event'->>'from_date' = '2026-10-12' and r->'event'->>'to_date' = '2026-10-19', 'B move: from 12 to 19 Oct');
  n := t22.events(k);
  perform t.ok(t22.date('halcyon-fintech', k, date '2026-10-19')->>'outcome' = 'same-date' and t22.events(k) = n, 'B the same date: same-date, nothing written');
  perform t.ok(t22.date('verdant-home', k, date '2026-10-20')->>'outcome' = 'task-not-found' and t22.events(k) = n, 'B through another project: task-not-found');
  perform t.ok(t22.date('halcyon-fintech', '00000000-0000-4000-8000-000000000099', date '2026-10-20')->>'outcome' = 'task-not-found', 'B an unknown task: task-not-found');
  perform t.ok(t.err(format('select t22.date(%L, %L, date %L)', 'halcyon-fintech', k, '2101-01-01')) = '22023', 'B a date out of range raises 22023');
  perform t.ok(t.err(format('select public.nexra_agent_task_set_plan_date(%L, %L, null, null)', 'halcyon-fintech', k)) = '22023', 'B no operator raises 22023');
  r := t22.date('halcyon-fintech', k, null);
  perform t.ok(r->>'outcome' = 'plan-date-changed' and r->'task'->'planned_for' = 'null'::jsonb and r->'event'->>'from_date' = '2026-10-19' and r->'event'->'to_date' = 'null'::jsonb, 'B clear: from 19 Oct to none');
  perform t.ok(t22.date('halcyon-fintech', k, null)->>'outcome' = 'same-date', 'B clearing an empty date: same-date');
end $$;

-- C: the article link — the project's own, not archived; the newest link wins; the task row does not change.
do $$
declare k uuid; r jsonb; n bigint; before jsonb;
begin
  k := t22.tid(t.task(p_title => 'Write the comparison article'));
  before := (select to_jsonb(x) from public.nexra_agent_tasks x where id = k);
  r := t22.link('halcyon-fintech', k, t22.a(1));
  perform t.ok(r->>'outcome' = 'article-linked' and r->'event'->>'article_id' = t22.a(1)::text and r->'event'->>'event_type' = 'article-linked', 'C link: article-linked, naming the article');
  perform t.ok((select to_jsonb(x) from public.nexra_agent_tasks x where id = k) = before, 'C the task row is unchanged by a link');
  n := t22.events(k);
  perform t.ok(t22.link('halcyon-fintech', k, t22.a(1))->>'outcome' = 'same-article' and t22.events(k) = n, 'C the same article again: same-article, nothing written');
  perform t.ok(t22.link('halcyon-fintech', k, t22.a(2))->>'outcome' = 'article-not-found' and t22.events(k) = n, 'C another project''s article: article-not-found');
  perform t.ok(t22.link('halcyon-fintech', k, t22.a(3))->>'outcome' = 'article-not-found' and t22.events(k) = n, 'C an archived article: article-not-found');
  perform t.ok(t22.link('halcyon-fintech', k, '00000000-0000-4000-8000-000000000099')->>'outcome' = 'article-not-found', 'C an unknown article: article-not-found');
  perform t.ok(t22.link('verdant-home', k, t22.a(2))->>'outcome' = 'task-not-found', 'C through another project: task-not-found');
  perform t.ok(t.err(format('select public.nexra_agent_task_link_article(%L, %L, null, %L)', 'halcyon-fintech', k, t.op())) = '22023', 'C no article raises 22023');
end $$;

-- D: terminal tasks refuse both; the guards still hold for every writer.
do $$
declare k uuid;
begin
  k := t22.tid(t.task(p_title => 'A task to cancel'));
  perform t.ok(t22.status(k, 'cancelled')->>'outcome' = 'transitioned', 'D setup: the task cancelled');
  perform t.ok(t22.date('halcyon-fintech', k, date '2026-11-02')->>'outcome' = 'terminal', 'D set a date on a cancelled task: terminal');
  perform t.ok(t22.link('halcyon-fintech', k, t22.a(1))->>'outcome' = 'terminal', 'D link a cancelled task: terminal');
  perform t.ok(t.err(format('update public.nexra_agent_tasks set planned_for = %L where id = %L', '2026-11-02', k)) = '23514', 'D a direct planned_for update: refused (23514)');
  perform t.ok(t.err(format('insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_date, to_date, actor) values (%L, %L, %L, null, null, %L)', k, 'halcyon-fintech', 'plan-date-changed', t.op())) = '23514', 'D a plan-date-changed event with no date: refused by the shape check (23514)');
  perform t.ok(t.err(format('insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_date, to_date, actor) values (%L, %L, %L, %L, %L, %L)', k, 'halcyon-fintech', 'plan-date-changed', '2026-11-02', '2026-11-02', t.op())) = '23514', 'D a plan-date-changed event with equal dates: refused (23514)');
  perform t.ok(t.err(format('insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_status, to_status, article_id, actor) values (%L, %L, %L, %L, %L, %L, %L)', k, 'halcyon-fintech', 'status-changed', 'backlog', 'ready', t22.a(1), t.op())) = '23514', 'D an earlier type carrying an article: refused (23514)');
  perform t.ok(t.err('update public.nexra_agent_task_events set to_date = null') = '23514' and t.err('delete from public.nexra_agent_task_events') = '23514', 'D events stay append-only (23514)');
end $$;

-- E: service_role reaches the functions only.
set role service_role;
do $$
declare k uuid;
begin
  k := (select id from public.nexra_agent_tasks where title = 'Write the comparison article');
  perform t.ok(public.nexra_agent_task_set_plan_date('halcyon-fintech', k, date '2026-10-26', t.op())->>'outcome' = 'plan-date-changed', 'E service_role sets a date through the function');
  perform t.ok(t.err(format('update public.nexra_agent_tasks set planned_for = null where id = %L', k)) = '42501', 'E service_role cannot update the table (42501)');
end $$;
reset role;
