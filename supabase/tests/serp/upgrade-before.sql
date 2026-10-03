-- M4 SERP upgrade, first half (before migration 20261024120000): a completed keyword snapshot with its requests and
-- metrics, and the provider functions' definitions, kept aside. Part of the local PostgreSQL test harness; run only
-- through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t24u;
do $$
declare v uuid;
begin
  v := t19.run();
  perform t.ok((t.run(v)).status = 'completed', 'U setup: a completed keyword snapshot before the migration');
  perform t.ok(not exists (select 1 from pg_class where relname = 'nexra_serp_results'), 'U before: no SERP table');
end $$;
create function t24u.rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'runs', (select jsonb_agg(to_jsonb(x) - 'opportunity_id' order by x.id) from public.nexra_provider_runs x),
    'requests', (select jsonb_agg(to_jsonb(x) order by x.id) from public.nexra_provider_requests x),
    'metrics', (select jsonb_agg(to_jsonb(x) order by x.id) from public.nexra_keyword_metrics x))
$$;
create function t24u.def(p regprocedure) returns jsonb language sql as $$
  select jsonb_build_object('owner', p.proowner, 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig, 'src', p.prosrc)
    from pg_proc p where p.oid = $1
$$;
create table t24u.before as select t24u.rows() r,
  t24u.def('public.nexra_provider_run_reserve(text,text[],integer,text,text,text,numeric,numeric,uuid)'::regprocedure) reserve,
  t24u.def('public.nexra_provider_metrics_record(uuid,uuid,jsonb)'::regprocedure) metrics,
  t24u.def('public.nexra_provider_run_resume(uuid,numeric,numeric,uuid)'::regprocedure) resume,
  t24u.def('public.nexra_provider_request_record(uuid,smallint,text,jsonb,text,integer,text,numeric,integer,text,timestamptz,timestamptz)'::regprocedure) request,
  t24u.def('public.nexra_provider_run_finish(uuid,text,numeric,numeric,text)'::regprocedure) finish;
