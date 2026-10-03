-- M4 SERP upgrade, second half (after migration 20261024120000): every existing provider row unchanged, the snapshot's
-- run with no opportunity, the untouched functions identical, the two replaced ones keeping owner, grants and settings.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b t24u.before;
begin
  select * into b from t24u.before;
  perform t.ok(t24u.rows() = b.r, 'U every run, request and metric row unchanged');
  perform t.ok(not exists (select 1 from public.nexra_provider_runs where opportunity_id is not null) and (select bool_and(kind = 'keyword-snapshot') from public.nexra_provider_runs), 'U the existing run is a keyword snapshot with no opportunity');
  perform t.ok(t24u.def('public.nexra_provider_run_reserve(text,text[],integer,text,text,text,numeric,numeric,uuid)'::regprocedure) = b.reserve, 'U reserve unchanged');
  perform t.ok(t24u.def('public.nexra_provider_metrics_record(uuid,uuid,jsonb)'::regprocedure) = b.metrics, 'U metrics_record unchanged');
  perform t.ok(t24u.def('public.nexra_provider_run_resume(uuid,numeric,numeric,uuid)'::regprocedure) = b.resume, 'U resume unchanged');
  perform t.ok((t24u.def('public.nexra_provider_request_record(uuid,smallint,text,jsonb,text,integer,text,numeric,integer,text,timestamptz,timestamptz)'::regprocedure) - 'src') = (b.request - 'src')
    and t24u.def('public.nexra_provider_request_record(uuid,smallint,text,jsonb,text,integer,text,numeric,integer,text,timestamptz,timestamptz)'::regprocedure)->>'src' <> b.request->>'src', 'U request_record replaced: body changed, owner, grants and settings kept');
  perform t.ok((t24u.def('public.nexra_provider_run_finish(uuid,text,numeric,numeric,text)'::regprocedure) - 'src') = (b.finish - 'src'), 'U run_finish replaced: owner, grants and settings kept');
  perform t.ok((select count(*) from public.nexra_serp_results) = 0, 'U the results table starts empty');
end $$;
