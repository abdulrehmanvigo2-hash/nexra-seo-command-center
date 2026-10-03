-- M2: accepted content opportunities (docs/roadmap/M2-opportunities.md, PR 3 of 6; docs/roadmap/NEXT-FOUR-PLAN.md).
--
-- WHAT. Opportunities are scored on read, by fixed rules, from the project's approved topic map (M1), the stored
-- Search Console query x page rows and the crawl findings; nothing is stored for them until the owner accepts one.
-- Accepting records exactly what was scored and turns it into a task, in one transaction:
--   * `nexra_opportunities` — one immutable row per accepted opportunity: project, the approved map and the cluster it
--     scored, the action (write / expand / refresh / fix), the finding it fixes (fix only), the title, the score
--     (0-100), the rules version, the task priority, the scored lines ("signals": label, points, source, detail), the
--     Search Console window end and the crawl read (when read), the task it created, and who accepted it and when.
--   * `nexra_agent_tasks.source_kind` gains `opportunity`: the created task's source ref is the opportunity's id.
--     `nexra_agent_task_create` is unchanged and still refuses that kind — only the accept function creates such tasks.
--   * `nexra_opportunity_accept(p_project_id, p_opportunity, p_operator)` — the one write.
--
-- RULES IN THE DATABASE. The map must be the project's approved map and the cluster that map's; the action must fit
-- the cluster's coverage (write <-> gap, expand <-> partial, refresh <-> covered; fix on any cluster with an existing
-- page, naming a finding); the crawl, when named, must be the project's; the signals must be well formed and their
-- points must sum to the score (capped at 100). The database derives the task's priority (high at 60 or more, medium
-- at 30-59, low under 30) and owner (Content Strategist for write, expand and refresh; Technical SEO for fix) itself.
-- The same map, cluster, action and finding is accepted once: a repeat answers `exists`.
--
-- SECURITY. RLS on with no policies; guards refuse an insert outside the function and every update, delete and
-- truncate; service_role holds SELECT on the table and EXECUTE on the function only. The guards use the
-- transaction-local flag nexra.opportunity_write, as the topic-map tables use nexra.topic_map_write.
--
-- Nothing else changes: no existing row, function or grant; the task table gains one allowed source kind.

-- ---------------------------------------------------------------------------
-- Tasks: one more source kind.

alter table public.nexra_agent_tasks drop constraint nexra_agent_tasks_source_kind_valid;
alter table public.nexra_agent_tasks add constraint nexra_agent_tasks_source_kind_valid
  check (source_kind in ('director-run', 'keyword', 'opportunity'));

comment on table public.nexra_agent_tasks is
  'One operator-approved unit of work for one registry agent on one project, recorded from a completed SEO Director run, an observed Search Console query or an accepted opportunity (source_kind, source_ref). A record of an intention to act: nothing here dispatches an agent, queues a run or changes a page.';

-- ---------------------------------------------------------------------------
-- The scored lines of an opportunity: 1 to 20 objects, each with a label, points (0-30), a source and a detail.

create function public.nexra_opportunity_signals_valid(p_signals jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_signals) = 'array'
     and pg_catalog.jsonb_array_length(p_signals) between 1 and 20
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(p_signals) e
        where pg_catalog.jsonb_typeof(e) <> 'object'
           or pg_catalog.jsonb_typeof(e->'label') <> 'string' or pg_catalog.char_length(e->>'label') not between 1 and 120
           or pg_catalog.jsonb_typeof(e->'points') <> 'number' or (e->>'points') !~ '^[0-9]+$' or (e->>'points')::integer > 30
           or coalesce(e->>'source', '') not in ('observed', 'provider-estimate', 'derived')
           or pg_catalog.jsonb_typeof(e->'detail') <> 'string' or pg_catalog.char_length(e->>'detail') not between 1 and 300
           or (select count(*) from pg_catalog.jsonb_object_keys(e)) <> 4
     )
$$;

create function public.nexra_opportunity_signals_score(p_signals jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(100, coalesce(sum((e->>'points')::integer), 0))::integer from pg_catalog.jsonb_array_elements(p_signals) e
$$;

-- ---------------------------------------------------------------------------
-- The table.

create table public.nexra_opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id text not null
    constraint nexra_opportunities_project_fkey references public.projects (id) on delete restrict,
  map_id uuid not null
    constraint nexra_opportunities_map_fkey references public.nexra_topic_maps (id) on delete restrict,
  cluster_id uuid not null
    constraint nexra_opportunities_cluster_fkey references public.nexra_topic_clusters (id) on delete restrict,
  action text not null check (action in ('write', 'expand', 'refresh', 'fix')),
  finding_key text check (finding_key is null or pg_catalog.char_length(finding_key) between 1 and 200),
  title text not null check (pg_catalog.char_length(title) between 1 and 200 and title = pg_catalog.btrim(title)),
  score smallint not null check (score between 0 and 100),
  rules_version smallint not null check (rules_version >= 1),
  priority text not null check (priority in ('low', 'medium', 'high')),
  signals jsonb not null check (public.nexra_opportunity_signals_valid(signals)),
  gsc_end_date date,
  crawl_id uuid
    constraint nexra_opportunities_crawl_fkey references public.nexra_crawls (id) on delete restrict,
  task_id uuid not null unique
    constraint nexra_opportunities_task_fkey references public.nexra_agent_tasks (id) on delete restrict,
  accepted_by uuid not null,
  accepted_at timestamptz not null default clock_timestamp(),
  constraint nexra_opportunities_finding_for_fix check ((action = 'fix') = (finding_key is not null)),
  constraint nexra_opportunities_score_is_signals check (score = public.nexra_opportunity_signals_score(signals))
);

create unique index nexra_opportunities_once_idx
  on public.nexra_opportunities (map_id, cluster_id, action, coalesce(finding_key, ''));
create index nexra_opportunities_project_idx on public.nexra_opportunities (project_id, accepted_at desc);

comment on table public.nexra_opportunities is
  'One accepted content opportunity (M2): what was scored from the approved topic map, Search Console and the crawl findings, with every scored line, and the task it created. Written only by nexra_opportunity_accept; immutable.';

alter table public.nexra_opportunities enable row level security;

-- ---------------------------------------------------------------------------
-- Guards, for every writer.

create function public.nexra_opportunities_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('nexra.opportunity_write', true), '') <> new.id::text then
    raise exception 'nexra_opportunities: rows are written only through nexra_opportunity_accept'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function public.nexra_opportunities_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_opportunities: an accepted opportunity is permanent history and is never changed or removed'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_opportunities_guard_insert
  before insert on public.nexra_opportunities
  for each row execute function public.nexra_opportunities_guard_insert();
create trigger nexra_opportunities_guard_update
  before update on public.nexra_opportunities
  for each row execute function public.nexra_opportunities_guard_immutable();
create trigger nexra_opportunities_guard_delete
  before delete on public.nexra_opportunities
  for each row execute function public.nexra_opportunities_guard_immutable();
create trigger nexra_opportunities_guard_truncate
  before truncate on public.nexra_opportunities
  for each statement execute function public.nexra_opportunities_guard_immutable();

-- ---------------------------------------------------------------------------
-- Accept one opportunity.
--
-- p_opportunity: { "map_id": uuid, "cluster_id": uuid, "action": text, "finding_key": text | null, "title": text,
--                  "score": int, "rules_version": int, "signals": [ ... ], "gsc_end_date": date | null,
--                  "crawl_id": uuid | null }
-- Answers 'accepted' (with the opportunity and task rows), 'exists' (with the earlier opportunity row),
-- 'project-not-found', 'map-not-approved', 'cluster-not-found', or 'invalid' with a short reason. A refusal writes
-- nothing.

create function public.nexra_opportunity_accept(
  p_project_id text,
  p_opportunity jsonb,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map uuid;
  v_cluster uuid;
  v_action text;
  v_finding text;
  v_title text;
  v_score integer;
  v_rules integer;
  v_signals jsonb;
  v_gsc date;
  v_crawl uuid;
  v_coverage text;
  v_page text;
  v_priority text;
  v_agent text;
  v_existing public.nexra_opportunities;
  v_task public.nexra_agent_tasks;
  v_row public.nexra_opportunities;
  v_id uuid;
begin
  if p_project_id is null or p_opportunity is null or p_operator is null then
    raise exception 'nexra_opportunity_accept: project, opportunity and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.jsonb_typeof(p_opportunity) <> 'object' then
    raise exception 'nexra_opportunity_accept: the opportunity is an object'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;

  -- Shape.
  begin
    v_map := (p_opportunity->>'map_id')::uuid;
    v_cluster := (p_opportunity->>'cluster_id')::uuid;
    v_crawl := case when pg_catalog.jsonb_typeof(p_opportunity->'crawl_id') = 'string' then (p_opportunity->>'crawl_id')::uuid end;
    v_gsc := case when pg_catalog.jsonb_typeof(p_opportunity->'gsc_end_date') = 'string' then (p_opportunity->>'gsc_end_date')::date end;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'ids');
  end;
  if v_map is null or v_cluster is null then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'ids');
  end if;
  v_action := p_opportunity->>'action';
  if v_action is null or v_action not in ('write', 'expand', 'refresh', 'fix') then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'action');
  end if;
  v_finding := case when pg_catalog.jsonb_typeof(p_opportunity->'finding_key') = 'string' then p_opportunity->>'finding_key' end;
  if (v_action = 'fix') <> (v_finding is not null)
     or (v_finding is not null and pg_catalog.char_length(v_finding) not between 1 and 200) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'finding');
  end if;
  v_title := pg_catalog.btrim(coalesce(p_opportunity->>'title', ''));
  if pg_catalog.char_length(v_title) not between 1 and 200 or v_title ~ '[[:cntrl:]]' then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'title');
  end if;
  if pg_catalog.jsonb_typeof(p_opportunity->'score') <> 'number' or (p_opportunity->>'score') !~ '^[0-9]+$'
     or pg_catalog.jsonb_typeof(p_opportunity->'rules_version') <> 'number' or (p_opportunity->>'rules_version') !~ '^[0-9]+$' then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'score');
  end if;
  v_score := (p_opportunity->>'score')::integer;
  v_rules := (p_opportunity->>'rules_version')::integer;
  v_signals := p_opportunity->'signals';
  if v_rules < 1 or v_rules > 1000 or v_score > 100 then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'score');
  end if;
  if not public.nexra_opportunity_signals_valid(v_signals) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'signals');
  end if;
  if public.nexra_opportunity_signals_score(v_signals) <> v_score then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'score');
  end if;

  -- One accept at a time for this map, cluster, action and finding.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'nexra_opportunity:' || v_map::text || ':' || v_cluster::text || ':' || v_action || ':' || coalesce(v_finding, ''), 0));
  select * into v_existing from public.nexra_opportunities
   where map_id = v_map and cluster_id = v_cluster and action = v_action and coalesce(finding_key, '') = coalesce(v_finding, '');
  if v_existing.id is not null then
    if v_existing.project_id <> p_project_id then
      return pg_catalog.jsonb_build_object('outcome', 'map-not-approved');
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'exists', 'opportunity', pg_catalog.to_jsonb(v_existing));
  end if;

  -- The records: the project's approved map, that map's cluster, the project's crawl.
  if not exists (select 1 from public.nexra_topic_maps m where m.id = v_map and m.project_id = p_project_id and m.status = 'approved') then
    return pg_catalog.jsonb_build_object('outcome', 'map-not-approved');
  end if;
  select c.coverage, c.existing_page into v_coverage, v_page
    from public.nexra_topic_clusters c where c.id = v_cluster and c.map_id = v_map;
  if v_coverage is null then
    return pg_catalog.jsonb_build_object('outcome', 'cluster-not-found');
  end if;
  if (v_action = 'write' and v_coverage <> 'gap')
     or (v_action = 'expand' and v_coverage <> 'partial')
     or (v_action = 'refresh' and v_coverage <> 'covered')
     or (v_action = 'fix' and v_page is null) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'action-coverage');
  end if;
  if v_crawl is not null and not exists (select 1 from public.nexra_crawls c where c.id = v_crawl and c.project_id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'crawl');
  end if;

  -- Derived here, never taken from the caller.
  v_priority := case when v_score >= 60 then 'high' when v_score >= 30 then 'medium' else 'low' end;
  v_agent := case when v_action = 'fix' then 'technical-seo' else 'content-strategist' end;
  v_id := pg_catalog.gen_random_uuid();

  insert into public.nexra_agent_tasks (project_id, title, source_kind, source_ref, owning_agent, status, priority, created_by)
  values (p_project_id, v_title, 'opportunity', v_id::text, v_agent, 'backlog', v_priority, p_operator)
  returning * into v_task;

  perform pg_catalog.set_config('nexra.opportunity_write', v_id::text, true);
  insert into public.nexra_opportunities (id, project_id, map_id, cluster_id, action, finding_key, title, score, rules_version,
    priority, signals, gsc_end_date, crawl_id, task_id, accepted_by)
  values (v_id, p_project_id, v_map, v_cluster, v_action, v_finding, v_title, v_score, v_rules,
    v_priority, v_signals, v_gsc, v_crawl, v_task.id, p_operator)
  returning * into v_row;
  perform pg_catalog.set_config('nexra.opportunity_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'accepted', 'opportunity', pg_catalog.to_jsonb(v_row), 'task', pg_catalog.to_jsonb(v_task));
end;
$$;

comment on function public.nexra_opportunity_accept(text, jsonb, uuid) is
  'Accepts one scored opportunity of the project''s approved topic map (M2): checks the map, cluster, action, crawl and scored lines, derives the task''s priority and owner, and records the opportunity and its backlog task in one transaction. accepted, exists, project-not-found, map-not-approved, cluster-not-found or invalid.';

-- ---------------------------------------------------------------------------
-- Privileges: nothing for public, anon or authenticated; service_role reads the table and executes the one function.

revoke all on table public.nexra_opportunities from public;
revoke all on function public.nexra_opportunity_accept(text, jsonb, uuid) from public;
revoke all on function public.nexra_opportunity_signals_valid(jsonb) from public;
revoke all on function public.nexra_opportunity_signals_score(jsonb) from public;
revoke all on function public.nexra_opportunities_guard_insert() from public;
revoke all on function public.nexra_opportunities_guard_immutable() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_opportunities from %I', v_role);
      execute format('revoke all on function public.nexra_opportunity_accept(text, jsonb, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_opportunity_signals_valid(jsonb) from %I', v_role);
      execute format('revoke all on function public.nexra_opportunity_signals_score(jsonb) from %I', v_role);
      execute format('revoke all on function public.nexra_opportunities_guard_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_opportunities_guard_immutable() from %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_opportunities to service_role;
    grant execute on function public.nexra_opportunity_accept(text, jsonb, uuid) to service_role;
  end if;
end
$$;
