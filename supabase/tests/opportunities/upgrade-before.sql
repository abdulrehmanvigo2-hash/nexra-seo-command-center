-- M2 opportunities upgrade, first half (before migration 20261021120000): tasks of both earlier kinds with their
-- events, and an approved topic map, kept aside byte for byte. Part of the local PostgreSQL test harness; run only
-- through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t21u;
do $$
begin
  perform t.ok(t.task()->>'outcome' = 'created', 'U setup: a director-run task before the migration');
  perform t.ok(t.task(p_kind => 'keyword', p_ref => 'business banking', p_title => 'Improve business banking')->>'outcome' = 'created', 'U setup: a keyword task before the migration');
  perform t.ok(not exists (select 1 from pg_class where relname = 'nexra_opportunities'), 'U before: no opportunity table');
end $$;
create function t21u.rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'tasks', (select jsonb_agg(to_jsonb(x) order by x.id) from public.nexra_agent_tasks x),
    'events', (select jsonb_agg(to_jsonb(x) order by x.seq) from public.nexra_agent_task_events x),
    'maps', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.nexra_topic_maps x),
    'clusters', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.nexra_topic_clusters x))
$$;
create function t21u.def(p regprocedure) returns jsonb language sql as $$
  select jsonb_build_object('owner', p.proowner, 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig, 'src', p.prosrc)
    from pg_proc p where p.oid = $1
$$;
create table t21u.before as select t21u.rows() r,
  t21u.def('public.nexra_agent_task_create(text,text,text,text,text,text,uuid)'::regprocedure) cd;
