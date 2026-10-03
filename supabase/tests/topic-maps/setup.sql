-- M1 topical maps (migration 20261019120000): helpers over c4/setup.sql, gsc/setup.sql and provider/setup.sql
-- (projects halcyon-fintech and verdant-home, t.ok, t.pop, t.reserve, t.req, t.metrics, t.finish). Part of the local
-- PostgreSQL test harness; run only through supabase/tests/run.sh, which creates and destroys its own disposable
-- cluster. Never run against a hosted database.
\set ON_ERROR_STOP 1
create schema t19;

-- A completed live run on a project with n seeds, of which the first m have metric rows (each with two related keywords).
create function t19.run(p_project text default 'halcyon-fintech', p_seeds int default 3, p_with_data int default 3) returns uuid language plpgsql as $$
declare v uuid; q uuid;
begin
  v := t.rid(t.reserve(p_project, 'live', 0.16, 1.00, t.seeds(p_seeds)));
  q := t.qid(t.req(v, 0, 'succeeded', 0.013, null, jsonb_build_object('keywords', t.seeds(p_seeds), 'location_code', 2840, 'language_code', 'en')));
  perform t.metrics(v, q, t.mrows(p_with_data, 2));
  -- One succeeded related call per seed, so the run can finish `completed` (the finish function's consistency rule).
  for i in 1..p_seeds loop perform t.req(v, i, 'succeeded', 0.013, null, jsonb_build_object('keyword', 'seed ' || i, 'location_code', 2840, 'language_code', 'en', 'limit', 20, 'depth', 1), 2); end loop;
  if (t.finish(v, 'completed')->>'outcome') <> 'finished' then raise exception 't19.run: the run did not finish'; end if;
  return v;
end $$;
create function t19.mid(p_run uuid, p_keyword text) returns uuid language sql as $$
  select id from public.nexra_keyword_metrics where run_id = p_run and keyword = p_keyword $$;
create function t19.kw(p_run uuid, p_keyword text, p_role text default 'supporting') returns jsonb language sql as $$
  select jsonb_build_object('keyword', p_keyword, 'role', p_role, 'metric_id', t19.mid(p_run, p_keyword), 'exclusion_reason', null,
    'search_volume', (select search_volume from public.nexra_keyword_metrics where id = t19.mid(p_run, p_keyword)),
    'keyword_difficulty', (select keyword_difficulty from public.nexra_keyword_metrics where id = t19.mid(p_run, p_keyword))) $$;
-- One cluster for seed i: the seed as primary, its two related keywords supporting, a gap with a candidate slug.
create function t19.cluster(p_run uuid, i int) returns jsonb language sql as $$
  select jsonb_build_object('position', i, 'topic', 'Seed ' || i, 'cluster', 'seed ' || i, 'primary_keyword', 'seed ' || i,
    'intent', 'informational', 'demand', 'estimated', 'coverage', 'gap', 'existing_page', null, 'candidate_page', 'seed-' || i,
    'search_volume', 100 * i, 'keyword_difficulty', 30 + i,
    'keywords', jsonb_build_array(t19.kw(p_run, 'seed ' || i, 'primary'), t19.kw(p_run, 'seed ' || i || ' related 1'), t19.kw(p_run, 'seed ' || i || ' related 2'))) $$;
create function t19.clusters(p_run uuid, n int default 3) returns jsonb language sql as $$
  select jsonb_agg(t19.cluster(p_run, i) order by i) from generate_series(1, n) i $$;
create function t19.map(p_run uuid, p_clusters jsonb default null, p_crawl uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('run_ids', jsonb_build_array(p_run), 'crawl_id', p_crawl, 'live_articles_read_at', '2026-10-03T06:00:00Z',
    'clusters', coalesce(p_clusters, t19.clusters(p_run))) $$;
create function t19.record(p_map jsonb, p_project text default 'halcyon-fintech') returns jsonb language sql as $$
  select public.nexra_topic_map_record(p_project, p_map, t.pop()) $$;
create function t19.approve(p_map uuid, p_project text default 'halcyon-fintech') returns jsonb language sql as $$
  select public.nexra_topic_map_approve(p_project, p_map, t.pop()) $$;
create function t19.id(r jsonb) returns uuid language sql immutable as $$ select (r->'map'->>'id')::uuid $$;
create function t19.status(p_map uuid) returns text language sql as $$ select status from public.nexra_topic_maps where id = p_map $$;
create function t19.rows() returns text language sql as $$
  select (select count(*) from public.nexra_topic_maps) || '/' || (select count(*) from public.nexra_topic_clusters) || '/' || (select count(*) from public.nexra_topic_cluster_keywords) $$;
-- Edit one cluster of a map in place (by index) with a jsonb patch, or replace its keywords.
create function t19.patch(p_map jsonb, i int, p_patch jsonb) returns jsonb language sql as $$
  select jsonb_set(p_map, array['clusters', (i - 1)::text], (p_map->'clusters'->(i - 1)) || p_patch) $$;
-- Expect a raise with the given SQLSTATE; true when it raised so.
create function t19.raises(p_sql text, p_state text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_state;
end $$;

grant usage on schema t19 to service_role;
grant execute on all functions in schema t19 to service_role;
