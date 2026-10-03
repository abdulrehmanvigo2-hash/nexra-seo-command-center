-- M1 topical maps (migration 20261019120000): the shape and security of the three tables, record as one set with its
-- validation, superseding, approve, and the guards for every writer. Part of the local PostgreSQL test harness; run
-- only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: shape and security.
do $$
begin
  perform t.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname in ('nexra_topic_maps', 'nexra_topic_clusters', 'nexra_topic_cluster_keywords') and c.relrowsecurity) = 3,
    'A the three tables exist with RLS on');
  perform t.ok((select count(*) from pg_policies where tablename in ('nexra_topic_maps', 'nexra_topic_clusters', 'nexra_topic_cluster_keywords')) = 0, 'A no policies');
  perform t.ok((select count(*) from pg_proc where proname in ('nexra_topic_map_record', 'nexra_topic_map_approve') and prosecdef and proconfig = array['search_path=""']) = 2,
    'A the two write functions: security definer, empty search_path');
  perform t.ok((select count(*) from pg_proc where proname in ('nexra_topic_map_guard_insert', 'nexra_topic_maps_guard_update', 'nexra_topic_map_guard_immutable') and not prosecdef and proconfig = array['search_path=""']) = 3,
    'A the three guard functions: not security definer, empty search_path');
  perform t.ok(has_table_privilege('service_role', 'public.nexra_topic_maps', 'select') and has_table_privilege('service_role', 'public.nexra_topic_clusters', 'select')
    and has_table_privilege('service_role', 'public.nexra_topic_cluster_keywords', 'select')
    and not has_table_privilege('service_role', 'public.nexra_topic_maps', 'insert') and not has_table_privilege('service_role', 'public.nexra_topic_maps', 'update')
    and not has_table_privilege('service_role', 'public.nexra_topic_clusters', 'delete') and not has_table_privilege('service_role', 'public.nexra_topic_cluster_keywords', 'insert')
    and not has_table_privilege('anon', 'public.nexra_topic_maps', 'select') and not has_table_privilege('authenticated', 'public.nexra_topic_clusters', 'select'),
    'A service_role reads the tables and writes none; anon and authenticated nothing');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_topic_map_record(text,jsonb,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.nexra_topic_map_approve(text,uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.nexra_topic_map_record(text,jsonb,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.nexra_topic_map_approve(text,uuid,uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.nexra_topic_map_guard_insert()', 'execute')
    and not has_function_privilege('service_role', 'public.nexra_topic_maps_guard_update()', 'execute')
    and not has_function_privilege('service_role', 'public.nexra_topic_map_guard_immutable()', 'execute'),
    'A service_role executes the two write functions only; the guards no API role');
  perform t.ok((select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
                 where c.relname in ('nexra_topic_maps', 'nexra_topic_clusters', 'nexra_topic_cluster_keywords') and not g.tgisinternal and g.tgenabled = 'O') = 12,
    'A twelve guard triggers, all enabled');
  perform t.ok((select count(*) from pg_indexes where tablename = 'nexra_topic_maps' and indexname in ('nexra_topic_maps_one_approved_idx', 'nexra_topic_maps_one_proposed_idx')) = 2,
    'A at most one proposed and one approved map per project (partial unique indexes)');
end $$;

-- B: record as one set, with its validation.
do $$
declare r uuid; r2 uuid; o uuid; m jsonb; res jsonb; before text; unknown uuid := '00000000-0000-4000-8000-00000000dead';
begin
  r := t19.run();
  o := t19.run('verdant-home');
  res := t19.record(t19.map(r));
  perform t.ok(res->>'outcome' = 'recorded' and res->'map'->>'status' = 'proposed' and res->'map'->>'project_id' = 'halcyon-fintech', 'B a valid map: recorded, proposed');
  perform t.ok((res->'map'->>'cluster_count')::int = 3 and (res->'map'->>'gap_count')::int = 3 and (res->'map'->>'covered_count')::int = 0
    and (res->'map'->>'no_estimate_count')::int = 0 and (res->'map'->>'excluded_count')::int = 0, 'B the counts are computed from the set');
  perform t.ok(t19.rows() = '1/3/9', 'B one map, three clusters, nine keywords');
  perform t.ok((select count(*) from public.nexra_topic_cluster_keywords k join public.nexra_topic_clusters c on c.id = k.cluster_id
                 where c.map_id = t19.id(res) and k.metric_id is not null) = 9, 'B every keyword names its metric row');
  perform t.ok((select primary_keyword || '|' || coalesce(search_volume::text, '-') || '|' || coalesce(keyword_difficulty::text, '-') from public.nexra_topic_clusters where map_id = t19.id(res) and position = 2) = 'seed 2|200|32',
    'B the primary''s volume and difficulty are copied onto the cluster');
  before := t19.rows();
  perform t.ok(t19.record(t19.map(r), 'no-such-project')->>'outcome' = 'project-not-found', 'B an unknown project: project-not-found');
  perform t.ok(t19.record(jsonb_set(t19.map(r), '{run_ids}', jsonb_build_array(o)))->>'outcome' = 'invalid-map', 'B a run of another project: invalid-map');
  perform t.ok(t19.record(jsonb_set(t19.map(r), '{run_ids}', jsonb_build_array(unknown)))->>'outcome' = 'invalid-map', 'B an unknown run: invalid-map');
  perform t.ok(t19.record(jsonb_set(t19.map(r), '{run_ids}', '[]'::jsonb))->>'outcome' = 'invalid-map', 'B no run at all: invalid-map');
  perform t.ok(t19.record(jsonb_set(t19.map(r), '{crawl_id}', to_jsonb(unknown::text)))->>'outcome' = 'invalid-map', 'B an unknown crawl: invalid-map');
  perform t.ok(t19.record(t19.patch(t19.map(r), 2, jsonb_build_object('cluster', 'seed 1')))->>'outcome' = 'invalid-map', 'B two clusters with one name: invalid-map');
  perform t.ok(t19.record(t19.patch(t19.map(r), 2, jsonb_build_object('position', 1)))->>'outcome' = 'invalid-map', 'B two clusters at one position: invalid-map');
  perform t.ok(t19.record(t19.patch(t19.map(r), 1, jsonb_build_object('primary_keyword', 'seed 1 related 1')))->>'outcome' = 'invalid-map', 'B the primary keyword not the one primary row: invalid-map');
  m := t19.patch(t19.map(r), 1, jsonb_build_object('keywords', jsonb_build_array(t19.kw(r, 'seed 1', 'primary'), t19.kw(r, 'seed 1 related 1', 'primary'))));
  perform t.ok(t19.record(m)->>'outcome' = 'invalid-map', 'B two primary rows: invalid-map');
  m := t19.patch(t19.map(r), 1, jsonb_build_object('keywords', jsonb_build_array(t19.kw(r, 'seed 1', 'primary'), t19.kw(r, 'seed 1 related 1'), t19.kw(r, 'seed 1 related 1'))));
  perform t.ok(t19.record(m)->>'outcome' = 'invalid-map', 'B one keyword twice in a cluster: invalid-map');
  m := t19.patch(t19.map(r), 1, jsonb_build_object('keywords', jsonb_build_array(t19.kw(r, 'seed 1', 'primary'), t19.kw(o, 'seed 1 related 1'))));
  perform t.ok(t19.record(m)->>'outcome' = 'invalid-map', 'B a metric row of a run not read: invalid-map');
  m := t19.patch(t19.map(r), 1, jsonb_build_object('keywords', jsonb_build_array(t19.kw(r, 'seed 1', 'primary'), t19.kw(r, 'seed 1 related 1') || jsonb_build_object('keyword', 'another text'))));
  perform t.ok(t19.record(m)->>'outcome' = 'invalid-map', 'B a metric row naming another keyword: invalid-map');
  perform t.ok(t19.raises(format('select t19.record(t19.patch(t19.map(%L), 1, %L))', r, '{"coverage":"maybe"}'), '23514'), 'B a coverage outside the three: the table check refuses (23514)');
  perform t.ok(t19.raises(format('select t19.record(t19.patch(t19.map(%L), 1, %L))', r, '{"coverage":"covered"}'), '23514'), 'B covered without an existing page: refused (23514)');
  perform t.ok(t19.raises(format('select t19.record(t19.patch(t19.map(%L), 1, %L))', r, '{"demand":"no-estimate"}'), '23514'), 'B no-estimate with a volume: refused (23514)');
  perform t.ok(t19.raises(format('select t19.record(t19.patch(t19.map(%L), 1, %L))', r, '{"candidate_page":"Not A Slug"}'), '23514'), 'B a candidate page that is not a slug: refused (23514)');
  perform t.ok(t19.raises(format('select t19.record(t19.patch(t19.map(%L), 1, %L))', r, '{"intent":"curious"}'), '23514'), 'B an intent outside the provider''s four: refused (23514)');
  perform t.ok(t19.rows() = before, 'B every refusal wrote nothing');
end $$;

-- C: a mixed map — an excluded term, a seed with no provider data, a covered and a partial cluster — and superseding.
do $$
declare r uuid; m jsonb; res jsonb; first uuid; second uuid;
begin
  first := (select id from public.nexra_topic_maps where project_id = 'halcyon-fintech' and status = 'proposed');
  r := t19.run('halcyon-fintech', 4, 3);
  m := t19.map(r, jsonb_build_array(
    t19.cluster(r, 1) || jsonb_build_object('coverage', 'covered', 'existing_page', '/blog/seed-1', 'candidate_page', null,
      'keywords', jsonb_build_array(t19.kw(r, 'seed 1', 'primary'), t19.kw(r, 'seed 1 related 1'),
        jsonb_build_object('keyword', 'seed 1 ghl', 'role', 'excluded', 'metric_id', null, 'exclusion_reason', 'vendor term: ghl', 'search_volume', 10, 'keyword_difficulty', null))),
    t19.cluster(r, 2) || jsonb_build_object('coverage', 'partial', 'existing_page', '/about', 'candidate_page', null),
    t19.cluster(r, 3),
    jsonb_build_object('position', 4, 'topic', 'Seed 4', 'cluster', 'seed 4', 'primary_keyword', 'seed 4', 'intent', null, 'demand', 'no-estimate', 'coverage', 'gap',
      'existing_page', null, 'candidate_page', 'seed-4', 'search_volume', null, 'keyword_difficulty', null,
      'keywords', jsonb_build_array(jsonb_build_object('keyword', 'seed 4', 'role', 'primary', 'metric_id', null, 'exclusion_reason', null, 'search_volume', null, 'keyword_difficulty', null)))));
  res := t19.record(m);
  perform t.ok(res->>'outcome' = 'recorded', 'C a mixed map records');
  second := t19.id(res);
  perform t.ok((res->'map'->>'cluster_count')::int = 4 and (res->'map'->>'covered_count')::int = 1 and (res->'map'->>'partial_count')::int = 1
    and (res->'map'->>'gap_count')::int = 2 and (res->'map'->>'no_estimate_count')::int = 1 and (res->'map'->>'excluded_count')::int = 1,
    'C its counts: 4 clusters, 1 covered, 1 partial, 2 gaps, 1 with no estimate, 1 excluded term');
  perform t.ok((select demand || '|' || coalesce(intent, 'null') || '|' || coalesce(search_volume::text, 'null') from public.nexra_topic_clusters where map_id = second and position = 4) = 'no-estimate|null|null',
    'C the seed with no provider data: no estimate, unknown intent, no figure — never zero');
  perform t.ok((select role || '|' || exclusion_reason || '|' || coalesce(metric_id::text, 'null') from public.nexra_topic_cluster_keywords k join public.nexra_topic_clusters c on c.id = k.cluster_id
                 where c.map_id = second and k.keyword = 'seed 1 ghl') = 'excluded|vendor term: ghl|null', 'C the excluded term is kept with its reason');
  perform t.ok(t19.status(first) = 'superseded' and t19.status(second) = 'proposed', 'C recording a new map supersedes the project''s proposed one');
  perform t.ok((select count(*) from public.nexra_topic_maps where project_id = 'halcyon-fintech' and status = 'proposed') = 1, 'C exactly one proposed map');
  perform t.ok(t19.raises(format('select t19.record(t19.map(%L, jsonb_build_array(t19.cluster(%L, 1) || %L)))', r, r,
    '{"keywords":[{"keyword":"seed 1","role":"primary","metric_id":null,"exclusion_reason":null,"search_volume":null,"keyword_difficulty":null},{"keyword":"x","role":"excluded","metric_id":null,"exclusion_reason":null,"search_volume":null,"keyword_difficulty":null}]}'), '23514'),
    'C an excluded keyword without a reason: refused (23514)');
end $$;

-- D: approve.
do $$
declare p uuid; s uuid; res jsonb; r uuid; third uuid;
begin
  s := (select id from public.nexra_topic_maps where project_id = 'halcyon-fintech' and status = 'superseded');
  p := (select id from public.nexra_topic_maps where project_id = 'halcyon-fintech' and status = 'proposed');
  perform t.ok(t19.approve(p, 'verdant-home')->>'outcome' = 'map-not-found', 'D a map through another project: map-not-found');
  perform t.ok(t19.approve('00000000-0000-4000-8000-00000000dead')->>'outcome' = 'map-not-found', 'D an unknown map: map-not-found');
  perform t.ok(t19.approve(s)->>'outcome' = 'not-proposed', 'D a superseded map: not-proposed');
  res := t19.approve(p);
  perform t.ok(res->>'outcome' = 'approved' and res->'map'->>'status' = 'approved' and res->'map'->>'approved_by' = t.pop()::text and (res->'map'->>'approved_at') is not null,
    'D the proposed map: approved, with approver and time');
  perform t.ok(t19.approve(p)->>'outcome' = 'not-proposed', 'D approving again: not-proposed');
  r := (select (run_ids)[1] from public.nexra_topic_maps where id = p);
  third := t19.id(t19.record(t19.map(r)));
  perform t.ok(t19.status(p) = 'approved' and t19.status(third) = 'proposed', 'D a new build leaves the approved map in place and proposes beside it');
  perform t.ok(t19.approve(third)->>'outcome' = 'approved' and t19.status(p) = 'superseded' and t19.status(third) = 'approved',
    'D approving the new map supersedes the earlier approved one');
  perform t.ok((select count(*) from public.nexra_topic_maps where project_id = 'halcyon-fintech' and status = 'approved') = 1, 'D exactly one approved map');
  perform t.ok((select approved_by is null and approved_at is null from public.nexra_topic_maps where id = s), 'D a map superseded while proposed keeps no approval');
  perform t.ok((select approved_by is not null and approved_at is not null from public.nexra_topic_maps where id = p), 'D a map superseded after approval keeps its approval');
end $$;

-- E: guards, as the owner and as service_role.
do $$
declare a uuid; c uuid; before text;
begin
  a := (select id from public.nexra_topic_maps where status = 'approved' limit 1);
  c := (select id from public.nexra_topic_clusters where map_id = a limit 1);
  before := t19.rows();
  perform t.ok(t19.raises(format('insert into public.nexra_topic_maps (project_id, run_ids, live_articles_read_at, cluster_count, covered_count, partial_count, gap_count, no_estimate_count, excluded_count, created_by) values (%L, (select run_ids from public.nexra_topic_maps where id = %L), now(), 1, 0, 0, 1, 0, 0, %L)', 'halcyon-fintech', a, t.pop()), '23514'), 'E a direct map insert: refused (23514)');
  perform t.ok(t19.raises(format('insert into public.nexra_topic_clusters (map_id, position, topic, cluster, primary_keyword, demand, coverage, candidate_page, search_volume) values (%L, 99, ''t'', ''c99'', ''k'', ''estimated'', ''gap'', ''k'', 1)', a), '23514'), 'E a direct cluster insert: refused (23514)');
  perform t.ok(t19.raises(format('insert into public.nexra_topic_cluster_keywords (cluster_id, keyword, role) values (%L, ''new word'', ''supporting'')', c), '23514'), 'E a direct keyword insert: refused (23514)');
  perform t.ok(t19.raises(format('update public.nexra_topic_maps set status = ''superseded'' where id = %L', a), '23514'), 'E a direct status change: refused (23514)');
  perform t.ok(t19.raises(format('update public.nexra_topic_maps set cluster_count = 1 where id = %L', a), '23514'), 'E a map''s counts never change (23514)');
  perform t.ok(t19.raises(format('update public.nexra_topic_clusters set coverage = ''covered'', existing_page = ''/x'' where id = %L', c), '23514'), 'E a cluster is immutable (23514)');
  perform t.ok(t19.raises(format('update public.nexra_topic_cluster_keywords set role = ''supporting'' where cluster_id = %L', c), '23514'), 'E a keyword row is immutable (23514)');
  perform t.ok(t19.raises(format('delete from public.nexra_topic_cluster_keywords where cluster_id = %L', c), '23514'), 'E delete refused (23514)');
  perform t.ok(t19.raises('truncate public.nexra_topic_cluster_keywords', '23514'), 'E truncate refused (23514)');
  perform t.ok(t19.rows() = before, 'E nothing changed');
  -- The flag alone does not open the door: the guards also need the row to belong to the flagged map.
  perform t.ok(t19.raises(format('select set_config(''nexra.topic_map_write'', %L, true); update public.nexra_topic_maps set status = ''superseded'', approved_by = null, approved_at = null where id = %L', a, a), '23514'),
    'E under the flag, an approval is never rewritten (23514)');
  set role service_role;
  perform t.ok((select count(*) from public.nexra_topic_maps) >= 1, 'E service_role reads the maps');
  perform t.ok(t19.raises(format('update public.nexra_topic_maps set status = ''superseded'' where id = %L', a), '42501'), 'E service_role has no UPDATE (42501)');
  perform t.ok(t19.raises(format('delete from public.nexra_topic_clusters where id = %L', c), '42501'), 'E service_role has no DELETE (42501)');
  perform t.ok(t19.raises('insert into public.nexra_topic_maps (project_id, run_ids, live_articles_read_at, cluster_count, covered_count, partial_count, gap_count, no_estimate_count, excluded_count, created_by) values (''x'', ''{}'', now(), 1, 0, 0, 1, 0, 0, t.pop())', '42501'), 'E service_role has no INSERT (42501)');
  perform t.ok(t19.approve(a)->>'outcome' = 'not-proposed', 'E service_role reaches the functions');
  reset role;
end $$;
