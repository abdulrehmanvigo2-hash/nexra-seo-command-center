-- M2 opportunities (migration 20261021120000): helpers over c4, gsc, tasks, provider and topic-maps setups
-- (t.ok, t.err, t.op, t.pop, t19.*). Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.
\set ON_ERROR_STOP 1
create schema t21;

-- An approved map on a project: cluster 1 a gap, cluster 2 partial on /blog/x, cluster 3 covered on /blog/y.
create function t21.map(p_project text default 'halcyon-fintech') returns uuid language plpgsql as $$
declare v uuid; m jsonb; r jsonb; id uuid;
begin
  v := t19.run(p_project);
  m := t19.map(v);
  m := t19.patch(m, 2, '{"coverage":"partial","existing_page":"/blog/x","candidate_page":null}');
  m := t19.patch(m, 3, '{"coverage":"covered","existing_page":"/blog/y","candidate_page":null}');
  r := t19.record(m, p_project);
  id := t19.id(r);
  if (t19.approve(id, p_project)->>'outcome') <> 'approved' then raise exception 't21.map: not approved'; end if;
  return id;
end $$;
create function t21.cid(p_map uuid, p_pos int) returns uuid language sql as $$
  select id from public.nexra_topic_clusters where map_id = p_map and position = p_pos $$;
-- Scored lines summing to 45 by default.
create function t21.signals(a int default 20, b int default 15, c int default 10) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('label', 'Demand', 'points', a, 'source', 'provider-estimate', 'detail', '210 searches a month (provider estimate)'),
    jsonb_build_object('label', 'Coverage', 'points', b, 'source', 'derived', 'detail', 'A gap in the approved map'),
    jsonb_build_object('label', 'Observed impressions', 'points', c, 'source', 'observed', 'detail', '7 impressions in the window ending 2026-09-29')) $$;
create function t21.opp(p_map uuid, p_cluster uuid, p_action text default 'write', p_score int default 45, p_finding text default null,
  p_signals jsonb default null, p_title text default 'Write: Seed 1') returns jsonb language sql as $$
  select jsonb_build_object('map_id', p_map, 'cluster_id', p_cluster, 'action', p_action, 'finding_key', p_finding, 'title', p_title,
    'score', p_score, 'rules_version', 1, 'signals', coalesce(p_signals, t21.signals()), 'gsc_end_date', '2026-09-29', 'crawl_id', null) $$;
create function t21.accept(p jsonb, p_project text default 'halcyon-fintech') returns jsonb language sql as $$
  select public.nexra_opportunity_accept(p_project, p, t.pop()) $$;
create function t21.n() returns text language sql as $$
  select (select count(*) from public.nexra_opportunities) || '/' || (select count(*) from public.nexra_agent_tasks) || '/' || (select count(*) from public.nexra_agent_task_events) $$;

grant usage on schema t21 to service_role;
grant execute on all functions in schema t21 to service_role;
