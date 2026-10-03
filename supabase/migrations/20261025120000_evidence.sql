-- M4: outside sources and evidence units (docs/roadmap/M4-research-evidence.md §2, PR 4 of 9).
--
-- WHAT. For an accepted opportunity the product fetches outside pages and records, from an `evidence-extract` run, the
-- claims each page makes with a quote copied from it. The owner admits or rejects each claim; only an admitted one may
-- later support an article statement (checker version 4). Nothing becomes a fact silently:
--   * `nexra_evidence_sources` — one fetched outside page: the opportunity, the SERP result it came from (or none when
--     the owner typed the URL), the URL asked and the final URL, the fetch state and HTTP status, the robots verdict, the
--     page title and its visible text CAPPED AT 20,000 CHARACTERS, the text's SHA-256 (computed here) and length. The
--     text is internal: it is never published and leaves the database only for the Evidence screen and the extraction.
--   * `nexra_evidence_units` — one claim of one source from one extraction run: claim, quote (at most 300 characters),
--     the run's own verdict, `quote_found` COMPUTED HERE (the quote, whitespace-collapsed, appears in the stored text,
--     whitespace-collapsed — word for word, case kept), the unit's status (`supported` only when the run said so AND the
--     quote was found; otherwise `needs-review`, or `unsupported` as the run said), and the owner's decision.
--   * `nexra_evidence_source_record(...)` — `recorded`, `project-not-found`, `opportunity-not-found`,
--     `serp-result-not-found` (not an organic result of that opportunity's SERP runs), `source-limit` (at most 5 a day per
--     opportunity, UTC).
--   * `nexra_evidence_units_record(project, source, run, units, operator)` — the run must be a completed, model-executed
--     (`executor = 'ai'`) Research & Evidence `evidence-extract` run of the project naming this source (`run-not-accepted`
--     otherwise); a fetched source with text (`source-not-fetched`); 1 to 8 well-formed units (`invalid-unit`); one set per
--     source and run (`exists`).
--   * `nexra_evidence_unit_decide(project, unit, decision, operator)` — `admitted` or `rejected`, once (`already-decided`);
--     `admitted` only for a `supported` unit whose quote was found (`not-admissible`); `unit-not-found`.
--
-- SECURITY. RLS on, no policies; guards (the transaction-local flag nexra.evidence_write) refuse an insert outside the
-- functions, any change but a pending unit's decision inside the decide function, and every delete and truncate.
-- service_role holds SELECT on the two tables and EXECUTE on the three functions only; the c5 inventory names them.
-- Nothing else changes.

-- ---------------------------------------------------------------------------
-- Whitespace-collapsed text, for the quote check. Internal: executable by no API role.

create function public.nexra_evidence_collapse(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Sources.

create table public.nexra_evidence_sources (
  id uuid primary key default gen_random_uuid(),
  project_id text not null
    constraint nexra_evidence_sources_project_fkey references public.projects (id) on delete restrict,
  opportunity_id uuid not null
    constraint nexra_evidence_sources_opportunity_fkey references public.nexra_opportunities (id) on delete restrict,
  serp_result_id uuid
    constraint nexra_evidence_sources_serp_result_fkey references public.nexra_serp_results (id) on delete restrict,

  requested_url text not null
    constraint nexra_evidence_sources_requested_url_format check (char_length(requested_url) between 1 and 2000 and requested_url ~ '^https?://'),
  final_url text
    constraint nexra_evidence_sources_final_url_format check (final_url is null or (char_length(final_url) between 1 and 2000 and final_url ~ '^https?://')),

  fetch_state text not null
    constraint nexra_evidence_sources_fetch_state_valid check (fetch_state in (
      'fetched', 'http-error', 'non-html', 'robots-disallowed', 'robots-unreachable', 'timeout', 'dns-error', 'connection-error',
      'too-large', 'redirect-loop', 'too-many-redirects', 'refused-unsafe', 'off-site', 'no-text')),
  http_status smallint
    constraint nexra_evidence_sources_http_status_range check (http_status is null or http_status between 100 and 599),
  robots text not null
    constraint nexra_evidence_sources_robots_valid check (robots in ('allowed', 'disallowed', 'unreachable')),
  constraint nexra_evidence_sources_robots_consistent check (
    (robots = 'disallowed') = (fetch_state = 'robots-disallowed')
    and (robots = 'unreachable') = (fetch_state = 'robots-unreachable')),

  title text
    constraint nexra_evidence_sources_title_length check (title is null or char_length(title) between 1 and 500),
  page_text text
    constraint nexra_evidence_sources_text_length check (page_text is null or char_length(page_text) between 1 and 20000),
  text_sha256 text
    constraint nexra_evidence_sources_text_sha256_format check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$'),
  text_chars integer
    constraint nexra_evidence_sources_text_chars_range check (text_chars is null or text_chars between 1 and 20000),
  constraint nexra_evidence_sources_text_only_when_fetched check (
    (fetch_state = 'fetched') = (page_text is not null)
    and (page_text is null) = (text_sha256 is null)
    and (page_text is null) = (text_chars is null)),

  fetched_by uuid not null,
  fetched_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index nexra_evidence_sources_opportunity_idx on public.nexra_evidence_sources (opportunity_id, fetched_at desc);
create index nexra_evidence_sources_project_idx on public.nexra_evidence_sources (project_id, fetched_at desc);

comment on table public.nexra_evidence_sources is
  'M4: one fetched outside page for an accepted opportunity — URL asked and final, fetch state, HTTP status, robots verdict, title and the visible text capped at 20,000 characters with its SHA-256 (computed in the database). Internal, never published. Written once by nexra_evidence_source_record; never changed or deleted.';

-- ---------------------------------------------------------------------------
-- Units.

create table public.nexra_evidence_units (
  id uuid primary key default gen_random_uuid(),
  project_id text not null
    constraint nexra_evidence_units_project_fkey references public.projects (id) on delete restrict,
  opportunity_id uuid not null
    constraint nexra_evidence_units_opportunity_fkey references public.nexra_opportunities (id) on delete restrict,
  source_id uuid not null
    constraint nexra_evidence_units_source_fkey references public.nexra_evidence_sources (id) on delete restrict,
  run_id uuid not null
    constraint nexra_evidence_units_run_fkey references public.agent_runs (id) on delete restrict,
  position smallint not null
    constraint nexra_evidence_units_position_range check (position between 1 and 8),
  constraint nexra_evidence_units_source_run_position_unique unique (source_id, run_id, position),

  claim text not null
    constraint nexra_evidence_units_claim_length check (char_length(claim) between 1 and 500),
  quote text not null
    constraint nexra_evidence_units_quote_length check (char_length(quote) between 1 and 300),
  run_verdict text not null
    constraint nexra_evidence_units_run_verdict_valid check (run_verdict in ('supported', 'needs-review', 'unsupported')),
  quote_found boolean not null,
  status text not null
    constraint nexra_evidence_units_status_valid check (status in ('supported', 'needs-review', 'unsupported')),
  constraint nexra_evidence_units_status_rule check (
    status = case when run_verdict = 'supported' and quote_found then 'supported'
                  when run_verdict = 'unsupported' then 'unsupported'
                  else 'needs-review' end),

  decision text not null default 'pending'
    constraint nexra_evidence_units_decision_valid check (decision in ('pending', 'admitted', 'rejected')),
  constraint nexra_evidence_units_admitted_is_supported check (decision <> 'admitted' or (status = 'supported' and quote_found)),
  decided_by uuid,
  decided_at timestamptz,
  constraint nexra_evidence_units_decided_consistent check ((decision = 'pending') = (decided_by is null) and (decided_by is null) = (decided_at is null)),

  recorded_by uuid not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

create index nexra_evidence_units_source_idx on public.nexra_evidence_units (source_id, run_id, position);
create index nexra_evidence_units_opportunity_idx on public.nexra_evidence_units (opportunity_id) where decision = 'admitted';

comment on table public.nexra_evidence_units is
  'M4: one claim of one outside source from one evidence-extract run — claim, quote (at most 300 characters), the run''s verdict, quote_found and status computed in the database, and the owner''s admit or reject. Only an admitted unit may support an article statement. Written by nexra_evidence_units_record; only the decision changes, once, through nexra_evidence_unit_decide; never deleted.';

alter table public.nexra_evidence_sources enable row level security;
alter table public.nexra_evidence_units enable row level security;

-- ---------------------------------------------------------------------------
-- Guards, for every writer.

create function public.nexra_evidence_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('nexra.evidence_write', true), '') <> 'on' then
    raise exception '%: rows are written only through the nexra_evidence_* functions', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function public.nexra_evidence_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: a recorded row is permanent history and is never changed or removed', tg_table_name
    using errcode = 'check_violation';
end;
$$;

-- A unit changes only its decision, once, from pending, inside the decide function.
create function public.nexra_evidence_units_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('nexra.evidence_write', true), '') <> 'decide'
    or old.decision <> 'pending' or new.decision = 'pending'
    or (pg_catalog.to_jsonb(new) - array['decision', 'decided_by', 'decided_at']) <> (pg_catalog.to_jsonb(old) - array['decision', 'decided_by', 'decided_at'])
  then
    raise exception 'nexra_evidence_units: only a pending unit''s decision changes, once, through nexra_evidence_unit_decide'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_evidence_sources_guard_insert before insert on public.nexra_evidence_sources
  for each row execute function public.nexra_evidence_guard_insert();
create trigger nexra_evidence_sources_guard_update before update on public.nexra_evidence_sources
  for each row execute function public.nexra_evidence_guard_immutable();
create trigger nexra_evidence_sources_guard_delete before delete on public.nexra_evidence_sources
  for each row execute function public.nexra_evidence_guard_immutable();
create trigger nexra_evidence_sources_guard_truncate before truncate on public.nexra_evidence_sources
  for each statement execute function public.nexra_evidence_guard_immutable();
create trigger nexra_evidence_units_guard_insert before insert on public.nexra_evidence_units
  for each row execute function public.nexra_evidence_guard_insert();
create trigger nexra_evidence_units_guard_update before update on public.nexra_evidence_units
  for each row execute function public.nexra_evidence_units_guard_update();
create trigger nexra_evidence_units_guard_delete before delete on public.nexra_evidence_units
  for each row execute function public.nexra_evidence_guard_immutable();
create trigger nexra_evidence_units_guard_truncate before truncate on public.nexra_evidence_units
  for each statement execute function public.nexra_evidence_guard_immutable();

-- ---------------------------------------------------------------------------
-- Recording one fetched source.

create function public.nexra_evidence_source_record(
  p_project_id text,
  p_opportunity_id uuid,
  p_serp_result_id uuid,
  p_requested_url text,
  p_final_url text,
  p_fetch_state text,
  p_http_status integer,
  p_robots text,
  p_title text,
  p_page_text text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.nexra_evidence_sources;
begin
  if p_project_id is null or p_opportunity_id is null or p_requested_url is null or p_fetch_state is null or p_robots is null or p_operator is null then
    raise exception 'nexra_evidence_source_record: project, opportunity, URL, fetch state, robots verdict and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;
  if not exists (select 1 from public.nexra_opportunities where id = p_opportunity_id and project_id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'opportunity-not-found');
  end if;
  if p_serp_result_id is not null and not exists (
    select 1 from public.nexra_serp_results r
     where r.id = p_serp_result_id and r.opportunity_id = p_opportunity_id and r.project_id = p_project_id and r.result_type = 'organic') then
    return pg_catalog.jsonb_build_object('outcome', 'serp-result-not-found');
  end if;

  -- At most five sources a UTC day per opportunity, counted under the opportunity's lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nexra-evidence-sources'), pg_catalog.hashtext(p_opportunity_id::text));
  if (select count(*) from public.nexra_evidence_sources
       where opportunity_id = p_opportunity_id
         and (fetched_at at time zone 'UTC')::date = (pg_catalog.clock_timestamp() at time zone 'UTC')::date) >= 5 then
    return pg_catalog.jsonb_build_object('outcome', 'source-limit');
  end if;

  perform pg_catalog.set_config('nexra.evidence_write', 'on', true);
  insert into public.nexra_evidence_sources (project_id, opportunity_id, serp_result_id, requested_url, final_url, fetch_state, http_status, robots,
    title, page_text, text_sha256, text_chars, fetched_by)
  values (p_project_id, p_opportunity_id, p_serp_result_id, p_requested_url, p_final_url, p_fetch_state, p_http_status, p_robots,
    p_title, p_page_text,
    case when p_page_text is null then null else pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_page_text, 'UTF8')), 'hex') end,
    case when p_page_text is null then null else char_length(p_page_text) end,
    p_operator)
  returning * into v_row;
  perform pg_catalog.set_config('nexra.evidence_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'source', pg_catalog.to_jsonb(v_row) - 'page_text');
end;
$$;

comment on function public.nexra_evidence_source_record(text, uuid, uuid, text, text, text, integer, text, text, text, uuid) is
  'M4: records one fetched outside page for an accepted opportunity (the text''s SHA-256 and length computed here): recorded, project-not-found, opportunity-not-found, serp-result-not-found or source-limit (5 a UTC day per opportunity). A malformed row raises check_violation.';

-- ---------------------------------------------------------------------------
-- Recording one extraction run's units for one source, as one set.

create function public.nexra_evidence_units_record(
  p_project_id text,
  p_source_id uuid,
  p_run_id uuid,
  p_units jsonb,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.nexra_evidence_sources;
  v_text text;
  v_count integer;
begin
  if p_project_id is null or p_source_id is null or p_run_id is null or p_units is null or p_operator is null then
    raise exception 'nexra_evidence_units_record: project, source, run, units and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_source from public.nexra_evidence_sources where id = p_source_id and project_id = p_project_id;
  if v_source.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'source-not-found');
  end if;
  if v_source.page_text is null then
    return pg_catalog.jsonb_build_object('outcome', 'source-not-fetched');
  end if;
  if not exists (
    select 1 from public.agent_runs r
     where r.id = p_run_id and r.project_id = p_project_id and r.agent_id = 'research-evidence' and r.task_type = 'evidence-extract'
       and r.status = 'completed' and r.executor = 'ai' and r.input->>'sourceId' = p_source_id::text) then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-accepted');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nexra-evidence-units'), pg_catalog.hashtext(p_source_id::text || p_run_id::text));
  if exists (select 1 from public.nexra_evidence_units where source_id = p_source_id and run_id = p_run_id) then
    return pg_catalog.jsonb_build_object('outcome', 'exists');
  end if;

  if pg_catalog.jsonb_typeof(p_units) <> 'array' or pg_catalog.jsonb_array_length(p_units) not between 1 and 8 or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_units) e
     where pg_catalog.jsonb_typeof(e) <> 'object'
        or (select count(*) from pg_catalog.jsonb_object_keys(e)) <> 3
        or pg_catalog.jsonb_typeof(e->'claim') <> 'string' or char_length(e->>'claim') not between 1 and 500 or pg_catalog.btrim(e->>'claim') = ''
        or pg_catalog.jsonb_typeof(e->'quote') <> 'string' or char_length(e->>'quote') not between 1 and 300 or pg_catalog.btrim(e->>'quote') = ''
        or coalesce(e->>'verdict', '') not in ('supported', 'needs-review', 'unsupported')) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-unit');
  end if;

  v_text := public.nexra_evidence_collapse(v_source.page_text);
  perform pg_catalog.set_config('nexra.evidence_write', 'on', true);
  insert into public.nexra_evidence_units (project_id, opportunity_id, source_id, run_id, position, claim, quote, run_verdict, quote_found, status, recorded_by)
  select p_project_id, v_source.opportunity_id, p_source_id, p_run_id, u.ord::smallint, u.e->>'claim', u.e->>'quote', u.e->>'verdict', u.found,
         case when u.e->>'verdict' = 'supported' and u.found then 'supported' when u.e->>'verdict' = 'unsupported' then 'unsupported' else 'needs-review' end,
         p_operator
    from (
      select e, ord, pg_catalog.strpos(v_text, public.nexra_evidence_collapse(e->>'quote')) > 0 as found
        from pg_catalog.jsonb_array_elements(p_units) with ordinality as x(e, ord)) u;
  get diagnostics v_count = row_count;
  perform pg_catalog.set_config('nexra.evidence_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'units', v_count,
    'found', (select count(*) from public.nexra_evidence_units where source_id = p_source_id and run_id = p_run_id and quote_found),
    'supported', (select count(*) from public.nexra_evidence_units where source_id = p_source_id and run_id = p_run_id and status = 'supported'));
end;
$$;

comment on function public.nexra_evidence_units_record(text, uuid, uuid, jsonb, uuid) is
  'M4: records one evidence-extract run''s units for one source as one set, computing quote_found (word for word, whitespace collapsed) and status: recorded, source-not-found, source-not-fetched, run-not-accepted, exists or invalid-unit.';

-- ---------------------------------------------------------------------------
-- The owner's decision on one unit.

create function public.nexra_evidence_unit_decide(
  p_project_id text,
  p_unit_id uuid,
  p_decision text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.nexra_evidence_units;
begin
  if p_project_id is null or p_unit_id is null or p_decision is null or p_operator is null then
    raise exception 'nexra_evidence_unit_decide: project, unit, decision and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_decision not in ('admitted', 'rejected') then
    raise exception 'nexra_evidence_unit_decide: the decision is admitted or rejected'
      using errcode = 'invalid_parameter_value';
  end if;
  select * into v_unit from public.nexra_evidence_units where id = p_unit_id and project_id = p_project_id for update;
  if v_unit.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'unit-not-found');
  end if;
  if v_unit.decision <> 'pending' then
    return pg_catalog.jsonb_build_object('outcome', 'already-decided', 'unit', pg_catalog.to_jsonb(v_unit));
  end if;
  if p_decision = 'admitted' and not (v_unit.status = 'supported' and v_unit.quote_found) then
    return pg_catalog.jsonb_build_object('outcome', 'not-admissible');
  end if;

  perform pg_catalog.set_config('nexra.evidence_write', 'decide', true);
  update public.nexra_evidence_units
     set decision = p_decision, decided_by = p_operator, decided_at = pg_catalog.clock_timestamp()
   where id = p_unit_id
  returning * into v_unit;
  perform pg_catalog.set_config('nexra.evidence_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', p_decision, 'unit', pg_catalog.to_jsonb(v_unit));
end;
$$;

comment on function public.nexra_evidence_unit_decide(text, uuid, text, uuid) is
  'M4: the owner admits or rejects one pending evidence unit, once: admitted, rejected, already-decided, not-admissible (only a supported unit whose quote was found may be admitted) or unit-not-found.';

-- ---------------------------------------------------------------------------
-- Access.

revoke all on table public.nexra_evidence_sources from public;
revoke all on table public.nexra_evidence_units from public;
revoke all on function public.nexra_evidence_collapse(text) from public;
revoke all on function public.nexra_evidence_guard_insert() from public;
revoke all on function public.nexra_evidence_guard_immutable() from public;
revoke all on function public.nexra_evidence_units_guard_update() from public;
revoke all on function public.nexra_evidence_source_record(text, uuid, uuid, text, text, text, integer, text, text, text, uuid) from public;
revoke all on function public.nexra_evidence_units_record(text, uuid, uuid, jsonb, uuid) from public;
revoke all on function public.nexra_evidence_unit_decide(text, uuid, text, uuid) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_evidence_sources from %I', v_role);
      execute format('revoke all on table public.nexra_evidence_units from %I', v_role);
      execute format('revoke all on function public.nexra_evidence_collapse(text) from %I', v_role);
      execute format('revoke all on function public.nexra_evidence_guard_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_evidence_guard_immutable() from %I', v_role);
      execute format('revoke all on function public.nexra_evidence_units_guard_update() from %I', v_role);
      execute format('revoke all on function public.nexra_evidence_source_record(text, uuid, uuid, text, text, text, integer, text, text, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_evidence_units_record(text, uuid, uuid, jsonb, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_evidence_unit_decide(text, uuid, text, uuid) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_evidence_sources to service_role;
    grant select on table public.nexra_evidence_units to service_role;
    grant execute on function public.nexra_evidence_source_record(text, uuid, uuid, text, text, text, integer, text, text, text, uuid) to service_role;
    grant execute on function public.nexra_evidence_units_record(text, uuid, uuid, jsonb, uuid) to service_role;
    grant execute on function public.nexra_evidence_unit_decide(text, uuid, text, uuid) to service_role;
  end if;
end
$$;
