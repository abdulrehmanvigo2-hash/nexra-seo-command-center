-- M1 upgrade, second half (after migration 20261019120000): every provider and project row unchanged, the new tables
-- empty, and a map recordable over the run that already existed. Part of the local PostgreSQL test harness; run
-- only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b jsonb; v uuid; res jsonb;
begin
  select r into b from t19u.before;
  perform t.ok(t19u.rows() = b, 'U every project, run, request and metric row is unchanged, byte for byte');
  perform t.ok((select count(*) from public.nexra_topic_maps) = 0 and (select count(*) from public.nexra_topic_clusters) = 0 and (select count(*) from public.nexra_topic_cluster_keywords) = 0,
    'U the new tables are empty');
  v := (select id from public.nexra_provider_runs where status = 'completed' limit 1);
  res := public.nexra_topic_map_record('halcyon-fintech', jsonb_build_object('run_ids', jsonb_build_array(v), 'crawl_id', null, 'live_articles_read_at', '2026-10-03T06:00:00Z',
    'clusters', jsonb_build_array(jsonb_build_object('position', 1, 'topic', 'Seed 1', 'cluster', 'seed 1', 'primary_keyword', 'seed 1', 'intent', 'informational', 'demand', 'estimated',
      'coverage', 'gap', 'existing_page', null, 'candidate_page', 'seed-1', 'search_volume', 100, 'keyword_difficulty', 31,
      'keywords', jsonb_build_array(jsonb_build_object('keyword', 'seed 1', 'role', 'primary', 'metric_id', (select id from public.nexra_keyword_metrics where run_id = v and keyword = 'seed 1'),
        'exclusion_reason', null, 'search_volume', 100, 'keyword_difficulty', 31))))), t.pop());
  perform t.ok(res->>'outcome' = 'recorded', 'U a map records over the run that existed before the migration');
  perform t.ok(t19u.rows() = b, 'U recording a map changes no provider row');
end $$;
