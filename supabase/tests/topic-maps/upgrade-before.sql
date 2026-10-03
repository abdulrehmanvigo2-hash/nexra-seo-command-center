-- M1 upgrade, first half (before migration 20261019120000): the F0 provider rows kept aside byte for byte, so the
-- migration can be shown to leave them unchanged. Part of the local PostgreSQL test harness; run only through
-- supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t19u;
create function t19u.rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'runs', (select jsonb_agg(to_jsonb(x) order by x.id) from public.nexra_provider_runs x),
    'requests', (select jsonb_agg(to_jsonb(x) order by x.id) from public.nexra_provider_requests x),
    'metrics', (select jsonb_agg(to_jsonb(x) order by x.id) from public.nexra_keyword_metrics x),
    'projects', (select jsonb_agg(to_jsonb(x) order by x.id) from public.projects x)) $$;
do $$
declare v uuid; q uuid;
begin
  v := t.rid(t.reserve('halcyon-fintech', 'live', 0.16, 1.00));
  q := t.qid(t.req(v, 0, 'succeeded'));
  perform t.metrics(v, q);
  perform t.req(v, 1, 'succeeded'); perform t.req(v, 2, 'succeeded'); perform t.req(v, 3, 'succeeded');
  perform t.ok(t.finish(v, 'completed')->>'outcome' = 'finished', 'U setup: the run finished completed');
  perform t.ok((select count(*) from public.nexra_keyword_metrics where run_id = v) = 9, 'U setup: a completed run with nine metric rows before the migration');
  perform t.ok(not exists (select 1 from pg_class where relname = 'nexra_topic_maps'), 'U before: no topic-map table');
end $$;
create table t19u.before as select t19u.rows() r;
