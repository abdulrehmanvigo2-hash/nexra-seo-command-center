-- M1: topical maps (docs/roadmap/M1-topical-map.md, PR 2 of 6; decisions Q1–Q5 of 3 Oct 2026).
--
-- WHAT. One map per build: the project's keyword clusters, derived by fixed
-- rules from the F0 provider rows (migration 20261016120000), the live
-- articles and the newest own-site crawl. Three tables in the F0 pattern:
--   * nexra_topic_maps — one row per build: what was read, the state
--     (proposed → approved; superseded), who built and who approved it, and
--     the counts the screen shows.
--   * nexra_topic_clusters — one row per cluster of a map: topic, cluster,
--     primary keyword, intent (the provider's label or null — never
--     guessed), demand ('estimated' or 'no-estimate'; never "no demand"),
--     coverage (covered / partial / gap), the existing page, the candidate
--     page, and the primary's volume and difficulty copied from its metric
--     row so the screen needs no join.
--   * nexra_topic_cluster_keywords — one row per keyword of a cluster:
--     role (primary / supporting / excluded), the metric row it came from
--     (null for a seed the provider returned nothing for), the exclusion
--     reason, volume and difficulty copied.
--
-- RULES. A map and its rows are written as one set by
-- nexra_topic_map_record, which validates every row and marks the project's
-- earlier proposed maps superseded. The one later change is
-- nexra_topic_map_approve: proposed → approved, with approver and time; the
-- project's earlier approved map becomes superseded. Nothing else ever
-- changes; no row is deleted or truncated. RLS on with no policies;
-- service_role holds SELECT on the tables and EXECUTE on the two functions
-- only. Every figure here is a provider's estimate or a derivation of fixed
-- rules; nothing is observed data, and no agent reads these tables in M1.
--
-- The guards use the transaction-local flag nexra.topic_map_write, set to
-- the map's id by the two functions around their writes, as the provider
-- tables do with nexra.provider_write.

-- ---------------------------------------------------------------------------
-- Tables.

create table public.nexra_topic_maps (
  id uuid primary key default gen_random_uuid(),
  project_id text not null
    constraint nexra_topic_maps_project_fkey references public.projects (id) on delete restrict,
  run_ids uuid[] not null check (cardinality(run_ids) between 1 and 10),
  crawl_id uuid
    constraint nexra_topic_maps_crawl_fkey references public.nexra_crawls (id) on delete restrict,
  live_articles_read_at timestamptz not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'superseded')),
  approved_by uuid,
  approved_at timestamptz,
  cluster_count smallint not null check (cluster_count between 1 and 200),
  covered_count smallint not null check (covered_count >= 0),
  partial_count smallint not null check (partial_count >= 0),
  gap_count smallint not null check (gap_count >= 0),
  no_estimate_count smallint not null check (no_estimate_count >= 0),
  excluded_count smallint not null check (excluded_count >= 0),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint nexra_topic_maps_approval_consistent check (
    (status = 'proposed' and approved_by is null and approved_at is null)
    or (status in ('approved', 'superseded') and ((approved_by is null) = (approved_at is null)))
  ),
  constraint nexra_topic_maps_counts_consistent check (covered_count + partial_count + gap_count = cluster_count)
);

create index nexra_topic_maps_project_idx on public.nexra_topic_maps (project_id, created_at desc);
create unique index nexra_topic_maps_one_approved_idx on public.nexra_topic_maps (project_id) where status = 'approved';
create unique index nexra_topic_maps_one_proposed_idx on public.nexra_topic_maps (project_id) where status = 'proposed';

create table public.nexra_topic_clusters (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null
    constraint nexra_topic_clusters_map_fkey references public.nexra_topic_maps (id) on delete restrict,
  position smallint not null check (position between 1 and 200),
  topic text not null check (char_length(topic) between 1 and 120),
  cluster text not null check (char_length(cluster) between 1 and 120),
  primary_keyword text not null check (char_length(primary_keyword) between 1 and 200),
  intent text check (intent is null or intent in ('informational', 'commercial', 'transactional', 'navigational')),
  demand text not null check (demand in ('estimated', 'no-estimate')),
  coverage text not null check (coverage in ('covered', 'partial', 'gap')),
  existing_page text check (existing_page is null or (char_length(existing_page) between 1 and 500 and existing_page ~ '^/')),
  candidate_page text check (candidate_page is null or candidate_page ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  search_volume integer check (search_volume >= 0),
  keyword_difficulty smallint check (keyword_difficulty between 0 and 100),
  unique (map_id, cluster),
  unique (map_id, position),
  constraint nexra_topic_clusters_coverage_consistent check (
    (coverage in ('covered', 'partial') and existing_page is not null and candidate_page is null)
    or (coverage = 'gap' and existing_page is null)
  ),
  constraint nexra_topic_clusters_demand_consistent check (
    (demand = 'estimated' and search_volume is not null) or (demand = 'no-estimate' and search_volume is null)
  )
);

create table public.nexra_topic_cluster_keywords (
  cluster_id uuid not null
    constraint nexra_topic_cluster_keywords_cluster_fkey references public.nexra_topic_clusters (id) on delete restrict,
  keyword text not null check (char_length(keyword) between 1 and 200),
  role text not null check (role in ('primary', 'supporting', 'excluded')),
  metric_id uuid
    constraint nexra_topic_cluster_keywords_metric_fkey references public.nexra_keyword_metrics (id) on delete restrict,
  exclusion_reason text check (exclusion_reason is null or char_length(exclusion_reason) between 1 and 200),
  search_volume integer check (search_volume >= 0),
  keyword_difficulty smallint check (keyword_difficulty between 0 and 100),
  primary key (cluster_id, keyword),
  constraint nexra_topic_cluster_keywords_exclusion_consistent check ((role = 'excluded') = (exclusion_reason is not null))
);

create unique index nexra_topic_cluster_keywords_one_primary_idx on public.nexra_topic_cluster_keywords (cluster_id) where role = 'primary';

comment on table public.nexra_topic_maps is
  'One build of a project''s topical map (M1): what was read, its state and counts. Rows are written only by nexra_topic_map_record and change only by nexra_topic_map_approve; nothing here is observed data.';
comment on table public.nexra_topic_clusters is
  'The clusters of one topical map, derived by fixed rules from provider estimates, the live articles and a crawl. Immutable once recorded.';
comment on table public.nexra_topic_cluster_keywords is
  'The keywords of one cluster with their role and the metric row each came from. Immutable once recorded.';

alter table public.nexra_topic_maps enable row level security;
alter table public.nexra_topic_clusters enable row level security;
alter table public.nexra_topic_cluster_keywords enable row level security;

-- ---------------------------------------------------------------------------
-- Guards, for every writer.

create function public.nexra_topic_map_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map text;
begin
  v_map := case tg_table_name
    when 'nexra_topic_maps' then pg_catalog.to_jsonb(new)->>'id'
    when 'nexra_topic_clusters' then pg_catalog.to_jsonb(new)->>'map_id'
    else (select c.map_id::text from public.nexra_topic_clusters c where c.id = (pg_catalog.to_jsonb(new)->>'cluster_id')::uuid)
  end;
  if v_map is null or coalesce(pg_catalog.current_setting('nexra.topic_map_write', true), '') <> v_map then
    raise exception '%: rows are written only through nexra_topic_map_record', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_topic_maps_guard_insert
  before insert on public.nexra_topic_maps
  for each row execute function public.nexra_topic_map_guard_insert();
create trigger nexra_topic_clusters_guard_insert
  before insert on public.nexra_topic_clusters
  for each row execute function public.nexra_topic_map_guard_insert();
create trigger nexra_topic_cluster_keywords_guard_insert
  before insert on public.nexra_topic_cluster_keywords
  for each row execute function public.nexra_topic_map_guard_insert();

-- A map changes only its status, approver and approval time, under the flag, along the allowed transitions.
create function public.nexra_topic_maps_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.run_ids is distinct from old.run_ids
    or new.crawl_id is distinct from old.crawl_id
    or new.live_articles_read_at is distinct from old.live_articles_read_at
    or new.cluster_count is distinct from old.cluster_count
    or new.covered_count is distinct from old.covered_count
    or new.partial_count is distinct from old.partial_count
    or new.gap_count is distinct from old.gap_count
    or new.no_estimate_count is distinct from old.no_estimate_count
    or new.excluded_count is distinct from old.excluded_count
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_topic_maps: a map''s identity, sources and counts never change'
      using errcode = 'check_violation';
  end if;
  if coalesce(pg_catalog.current_setting('nexra.topic_map_write', true), '') <> old.id::text then
    raise exception 'nexra_topic_maps: a map changes only through nexra_topic_map_approve or nexra_topic_map_record'
      using errcode = 'check_violation';
  end if;
  if not ((old.status = 'proposed' and new.status in ('approved', 'superseded'))
       or (old.status = 'approved' and new.status = 'superseded')) then
    raise exception 'nexra_topic_maps: a map moves only from proposed to approved or superseded, or from approved to superseded'
      using errcode = 'check_violation';
  end if;
  if old.status = 'approved' and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
    raise exception 'nexra_topic_maps: an approval is never rewritten'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_topic_maps_guard_update
  before update on public.nexra_topic_maps
  for each row execute function public.nexra_topic_maps_guard_update();

create function public.nexra_topic_map_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: a recorded row is permanent history and is never changed or removed', tg_table_name
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_topic_clusters_guard_update
  before update on public.nexra_topic_clusters
  for each row execute function public.nexra_topic_map_guard_immutable();
create trigger nexra_topic_cluster_keywords_guard_update
  before update on public.nexra_topic_cluster_keywords
  for each row execute function public.nexra_topic_map_guard_immutable();
create trigger nexra_topic_maps_guard_delete
  before delete on public.nexra_topic_maps
  for each row execute function public.nexra_topic_map_guard_immutable();
create trigger nexra_topic_clusters_guard_delete
  before delete on public.nexra_topic_clusters
  for each row execute function public.nexra_topic_map_guard_immutable();
create trigger nexra_topic_cluster_keywords_guard_delete
  before delete on public.nexra_topic_cluster_keywords
  for each row execute function public.nexra_topic_map_guard_immutable();
create trigger nexra_topic_maps_guard_truncate
  before truncate on public.nexra_topic_maps
  for each statement execute function public.nexra_topic_map_guard_immutable();
create trigger nexra_topic_clusters_guard_truncate
  before truncate on public.nexra_topic_clusters
  for each statement execute function public.nexra_topic_map_guard_immutable();
create trigger nexra_topic_cluster_keywords_guard_truncate
  before truncate on public.nexra_topic_cluster_keywords
  for each statement execute function public.nexra_topic_map_guard_immutable();

-- ---------------------------------------------------------------------------
-- Record one map as one set.
--
-- p_map: {
--   "run_ids": [uuid, ...],              the provider runs read (the project's, 1–10)
--   "crawl_id": uuid | null,            the own-site crawl read (the project's), if any
--   "live_articles_read_at": timestamptz,
--   "clusters": [ {
--     "position": int, "topic": text, "cluster": text, "primary_keyword": text,
--     "intent": text | null, "demand": 'estimated' | 'no-estimate',
--     "coverage": 'covered' | 'partial' | 'gap', "existing_page": text | null, "candidate_page": text | null,
--     "search_volume": int | null, "keyword_difficulty": int | null,
--     "keywords": [ { "keyword": text, "role": 'primary' | 'supporting' | 'excluded', "metric_id": uuid | null,
--                     "exclusion_reason": text | null, "search_volume": int | null, "keyword_difficulty": int | null } ]
--   } ]
-- }
-- Answers 'recorded' (with the map row), 'project-not-found', or 'invalid-map' (with a short reason) when any row
-- would not hold: a run of another project, a crawl of another project, a cluster without exactly one primary
-- keyword equal to primary_keyword, a metric row from a run not read or naming another keyword, a duplicate
-- cluster, position or keyword. The table checks refuse the rest. Nothing is written on a refusal.

create function public.nexra_topic_map_record(
  p_project_id text,
  p_map jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.nexra_topic_maps;
  v_run_ids uuid[];
  v_crawl uuid;
  v_cluster jsonb;
  v_keyword jsonb;
  v_cluster_id uuid;
  v_prev uuid;
  v_reason text;
  v_n integer;
begin
  if p_project_id is null or p_map is null or p_created_by is null then
    raise exception 'nexra_topic_map_record: project, map and creator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.jsonb_typeof(p_map) <> 'object' or pg_catalog.jsonb_typeof(p_map->'clusters') <> 'array'
     or pg_catalog.jsonb_typeof(p_map->'run_ids') <> 'array' then
    raise exception 'nexra_topic_map_record: map is an object with run_ids and clusters arrays'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;

  -- The sources: the project's own runs and crawl.
  begin
    select array_agg(e::uuid) into v_run_ids from pg_catalog.jsonb_array_elements_text(p_map->'run_ids') e;
    v_crawl := case when pg_catalog.jsonb_typeof(p_map->'crawl_id') = 'string' then (p_map->>'crawl_id')::uuid end;
  exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'ids');
  end;
  if v_run_ids is null or cardinality(v_run_ids) not between 1 and 10
     or (select count(distinct r) from unnest(v_run_ids) r) <> cardinality(v_run_ids)
     or (select count(*) from public.nexra_provider_runs r where r.id = any (v_run_ids) and r.project_id = p_project_id) <> cardinality(v_run_ids) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'runs');
  end if;
  if v_crawl is not null and not exists (select 1 from public.nexra_crawls c where c.id = v_crawl and c.project_id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'crawl');
  end if;
  if pg_catalog.jsonb_typeof(p_map->'live_articles_read_at') <> 'string' then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'live-articles-read-at');
  end if;

  -- The clusters: well formed, each with exactly one primary keyword equal to its primary_keyword; no duplicates.
  v_n := pg_catalog.jsonb_array_length(p_map->'clusters');
  if v_n not between 1 and 200 then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'cluster-count');
  end if;
  if (select count(distinct c->>'cluster') from pg_catalog.jsonb_array_elements(p_map->'clusters') c) <> v_n
     or (select count(distinct c->>'position') from pg_catalog.jsonb_array_elements(p_map->'clusters') c) <> v_n then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'cluster-duplicate');
  end if;
  for v_cluster in select c from pg_catalog.jsonb_array_elements(p_map->'clusters') c loop
    if pg_catalog.jsonb_typeof(v_cluster) <> 'object' or pg_catalog.jsonb_typeof(v_cluster->'keywords') <> 'array' then
      return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'cluster-shape');
    end if;
    if (select count(*) from pg_catalog.jsonb_array_elements(v_cluster->'keywords') k where k->>'role' = 'primary' and k->>'keyword' = v_cluster->>'primary_keyword') <> 1
       or (select count(*) from pg_catalog.jsonb_array_elements(v_cluster->'keywords') k where k->>'role' = 'primary') <> 1 then
      return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'primary');
    end if;
    if (select count(*) from pg_catalog.jsonb_array_elements(v_cluster->'keywords') k)
       <> (select count(distinct k->>'keyword') from pg_catalog.jsonb_array_elements(v_cluster->'keywords') k) then
      return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'keyword-duplicate');
    end if;
    for v_keyword in select k from pg_catalog.jsonb_array_elements(v_cluster->'keywords') k loop
      if pg_catalog.jsonb_typeof(v_keyword->'metric_id') = 'string' then
        begin
          if not exists (
            select 1 from public.nexra_keyword_metrics m
             where m.id = (v_keyword->>'metric_id')::uuid and m.run_id = any (v_run_ids) and m.project_id = p_project_id
               and lower(m.keyword) = lower(v_keyword->>'keyword')) then
            return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'metric');
          end if;
        exception when invalid_text_representation then
          return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'metric');
        end;
      elsif pg_catalog.jsonb_typeof(v_keyword->'metric_id') not in ('null') and v_keyword ? 'metric_id' then
        return pg_catalog.jsonb_build_object('outcome', 'invalid-map', 'reason', 'metric');
      end if;
    end loop;
  end loop;

  -- Write, as one set; the table checks hold the rest and raise 23514 on any value out of shape.
  v_map.id := pg_catalog.gen_random_uuid();
  perform pg_catalog.set_config('nexra.topic_map_write', v_map.id::text, true);
  begin
    -- The project's earlier proposed map (at most one, by the partial unique index) gives way.
    select id into v_prev from public.nexra_topic_maps where project_id = p_project_id and status = 'proposed' for update;
    if v_prev is not null then
      perform pg_catalog.set_config('nexra.topic_map_write', v_prev::text, true);
      update public.nexra_topic_maps set status = 'superseded' where id = v_prev;
    end if;
    perform pg_catalog.set_config('nexra.topic_map_write', v_map.id::text, true);

    insert into public.nexra_topic_maps (id, project_id, run_ids, crawl_id, live_articles_read_at, status,
      cluster_count, covered_count, partial_count, gap_count, no_estimate_count, excluded_count, created_by)
    select v_map.id, p_project_id, v_run_ids, v_crawl, (p_map->>'live_articles_read_at')::timestamptz, 'proposed',
      v_n,
      (select count(*) from pg_catalog.jsonb_array_elements(p_map->'clusters') c where c->>'coverage' = 'covered'),
      (select count(*) from pg_catalog.jsonb_array_elements(p_map->'clusters') c where c->>'coverage' = 'partial'),
      (select count(*) from pg_catalog.jsonb_array_elements(p_map->'clusters') c where c->>'coverage' = 'gap'),
      (select count(*) from pg_catalog.jsonb_array_elements(p_map->'clusters') c where c->>'demand' = 'no-estimate'),
      (select count(*) from pg_catalog.jsonb_array_elements(p_map->'clusters') c, pg_catalog.jsonb_array_elements(c->'keywords') k where k->>'role' = 'excluded'),
      p_created_by
    returning * into v_map;

    for v_cluster in select c from pg_catalog.jsonb_array_elements(p_map->'clusters') c loop
      insert into public.nexra_topic_clusters (map_id, position, topic, cluster, primary_keyword, intent, demand, coverage,
        existing_page, candidate_page, search_volume, keyword_difficulty)
      values (v_map.id, (v_cluster->>'position')::smallint, v_cluster->>'topic', v_cluster->>'cluster', v_cluster->>'primary_keyword',
        v_cluster->>'intent', v_cluster->>'demand', v_cluster->>'coverage', v_cluster->>'existing_page', v_cluster->>'candidate_page',
        case when pg_catalog.jsonb_typeof(v_cluster->'search_volume') = 'number' then pg_catalog.floor((v_cluster->>'search_volume')::numeric)::integer end,
        case when pg_catalog.jsonb_typeof(v_cluster->'keyword_difficulty') = 'number' then pg_catalog.floor((v_cluster->>'keyword_difficulty')::numeric)::smallint end)
      returning id into v_cluster_id;
      insert into public.nexra_topic_cluster_keywords (cluster_id, keyword, role, metric_id, exclusion_reason, search_volume, keyword_difficulty)
      select v_cluster_id, k->>'keyword', k->>'role',
        case when pg_catalog.jsonb_typeof(k->'metric_id') = 'string' then (k->>'metric_id')::uuid end,
        k->>'exclusion_reason',
        case when pg_catalog.jsonb_typeof(k->'search_volume') = 'number' then pg_catalog.floor((k->>'search_volume')::numeric)::integer end,
        case when pg_catalog.jsonb_typeof(k->'keyword_difficulty') = 'number' then pg_catalog.floor((k->>'keyword_difficulty')::numeric)::smallint end
      from pg_catalog.jsonb_array_elements(v_cluster->'keywords') k;
    end loop;
  exception when check_violation or not_null_violation or string_data_right_truncation or invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    get stacked diagnostics v_reason = message_text;
    raise exception 'nexra_topic_map_record: a row is out of shape (%)', v_reason using errcode = 'check_violation';
  end;

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'map', pg_catalog.to_jsonb(v_map));
end;
$$;

-- ---------------------------------------------------------------------------
-- Approve one proposed map: the one status change. The project's earlier approved map becomes superseded.
-- Answers 'approved' (with the map row), 'map-not-found' (no such map on this project) or 'not-proposed'.

create function public.nexra_topic_map_approve(
  p_project_id text,
  p_map_id uuid,
  p_approved_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.nexra_topic_maps;
  v_prev uuid;
begin
  if p_project_id is null or p_map_id is null or p_approved_by is null then
    raise exception 'nexra_topic_map_approve: project, map and approver are required'
      using errcode = 'invalid_parameter_value';
  end if;
  select * into v_map from public.nexra_topic_maps where id = p_map_id and project_id = p_project_id for update;
  if v_map.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'map-not-found');
  end if;
  if v_map.status <> 'proposed' then
    return pg_catalog.jsonb_build_object('outcome', 'not-proposed');
  end if;

  select id into v_prev from public.nexra_topic_maps where project_id = p_project_id and status = 'approved' for update;
  if v_prev is not null then
    perform pg_catalog.set_config('nexra.topic_map_write', v_prev::text, true);
    update public.nexra_topic_maps set status = 'superseded' where id = v_prev;
  end if;
  perform pg_catalog.set_config('nexra.topic_map_write', v_map.id::text, true);
  update public.nexra_topic_maps
     set status = 'approved', approved_by = p_approved_by, approved_at = pg_catalog.clock_timestamp()
   where id = v_map.id
  returning * into v_map;
  return pg_catalog.jsonb_build_object('outcome', 'approved', 'map', pg_catalog.to_jsonb(v_map));
end;
$$;

comment on function public.nexra_topic_map_record(text, jsonb, uuid) is
  'Records one topical map with its clusters and keywords as one set (M1). Validates every row; supersedes the project''s earlier proposed map. Writes nothing on a refusal.';
comment on function public.nexra_topic_map_approve(text, uuid, uuid) is
  'Approves one proposed topical map (M1): the one status change, with approver and time; the project''s earlier approved map becomes superseded.';

-- ---------------------------------------------------------------------------
-- Privileges: nothing for public, anon or authenticated; service_role reads the tables and executes the two functions.

revoke all on table public.nexra_topic_maps from public;
revoke all on table public.nexra_topic_clusters from public;
revoke all on table public.nexra_topic_cluster_keywords from public;
revoke all on function public.nexra_topic_map_record(text, jsonb, uuid) from public;
revoke all on function public.nexra_topic_map_approve(text, uuid, uuid) from public;
revoke all on function public.nexra_topic_map_guard_insert() from public;
revoke all on function public.nexra_topic_maps_guard_update() from public;
revoke all on function public.nexra_topic_map_guard_immutable() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_topic_maps from %I', v_role);
      execute format('revoke all on table public.nexra_topic_clusters from %I', v_role);
      execute format('revoke all on table public.nexra_topic_cluster_keywords from %I', v_role);
      execute format('revoke all on function public.nexra_topic_map_record(text, jsonb, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_topic_map_approve(text, uuid, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_topic_map_guard_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_topic_maps_guard_update() from %I', v_role);
      execute format('revoke all on function public.nexra_topic_map_guard_immutable() from %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_topic_maps to service_role;
    grant select on table public.nexra_topic_clusters to service_role;
    grant select on table public.nexra_topic_cluster_keywords to service_role;
    grant execute on function public.nexra_topic_map_record(text, jsonb, uuid) to service_role;
    grant execute on function public.nexra_topic_map_approve(text, uuid, uuid) to service_role;
  end if;
end
$$;
