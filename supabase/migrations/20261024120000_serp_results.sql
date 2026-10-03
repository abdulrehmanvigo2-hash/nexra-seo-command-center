-- M4: Google results for an accepted opportunity (docs/roadmap/M4-research-evidence.md §1, PR 2 of 9).
--
-- WHAT. One DataForSEO call per accepted opportunity — `serp/google/organic/live/advanced`, top 10 — recorded with the
-- F0 provider records (20261016120000), so a SERP shares the keyword snapshot's mode, host rule, daily dollar cap (the
-- same UTC-day lock and the same $5.00 ceiling), the one-open-run-per-project rule, the request records and the guards.
--   * `nexra_provider_runs.kind` gains `serp`, and the table gains `opportunity_id` (required for a SERP run, null for a
--     keyword snapshot; immutable — the update guard is replaced to say so). A SERP run's `seeds` is its one keyword.
--   * `nexra_provider_requests.endpoint` gains the SERP endpoint.
--   * `nexra_serp_results` — one immutable row per result of one SERP request: organic results, People Also Ask
--     questions and related searches, each with its rank within its type, as the provider gave them, with the run's
--     provenance. A snippet is the provider's text, never evidence (M4 §10).
--   * `nexra_provider_serp_reserve(project, opportunity, location, language, mode, host, estimate, cap, operator)` —
--     the keyword is chosen HERE, from the accepted opportunity's cluster (its primary keyword), never by the caller:
--     reserve's outcomes plus `opportunity-not-found`.
--   * `nexra_provider_serp_record(run, request, rows)` — one set per succeeded SERP request.
--   * `nexra_provider_request_record` and `nexra_provider_run_finish` are replaced with the same signatures and bodies
--     except: the endpoint must belong to the run's kind (`endpoint-not-for-kind`, nothing written), and a SERP run
--     plans one call (seq 0) where a keyword snapshot plans 1 + one per seed.
--
-- NOTHING ELSE CHANGES: no existing row (every run is a keyword snapshot with no opportunity), the reserve, metrics and
-- resume functions, the cap, the grants on the existing objects. Calls no provider.
--
-- ACCESS. RLS on the new table, no policies; service_role SELECT on it and EXECUTE on the two new functions only. The
-- harness's whole-database security definer inventory (c5) names them.

-- ---------------------------------------------------------------------------
-- Runs: a second kind, and the opportunity a SERP run is for.

alter table public.nexra_provider_runs
  add column opportunity_id uuid
    constraint nexra_provider_runs_opportunity_fkey references public.nexra_opportunities (id) on delete restrict;

alter table public.nexra_provider_runs drop constraint nexra_provider_runs_kind_valid;
alter table public.nexra_provider_runs add constraint nexra_provider_runs_kind_valid
  check (kind in ('keyword-snapshot', 'serp'));
alter table public.nexra_provider_runs add constraint nexra_provider_runs_serp_has_opportunity
  check ((kind = 'serp') = (opportunity_id is not null));
alter table public.nexra_provider_runs add constraint nexra_provider_runs_serp_one_keyword
  check (kind <> 'serp' or cardinality(seeds) = 1);

create index nexra_provider_runs_opportunity_idx on public.nexra_provider_runs (opportunity_id, created_at desc) where opportunity_id is not null;

comment on column public.nexra_provider_runs.opportunity_id is
  'M4: the accepted opportunity a SERP run is for (its cluster''s primary keyword is the run''s one seed); null for a keyword snapshot.';

-- The update guard, as 20261016120000's with the opportunity added to what never changes.
create or replace function public.nexra_provider_runs_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.provider is distinct from old.provider
    or new.kind is distinct from old.kind
    or new.opportunity_id is distinct from old.opportunity_id
    or new.mode is distinct from old.mode
    or new.api_host is distinct from old.api_host
    or new.seeds is distinct from old.seeds
    or new.location_code is distinct from old.location_code
    or new.language_code is distinct from old.language_code
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_provider_runs: a run''s identity, request and provenance never change'
      using errcode = 'check_violation';
  end if;
  if coalesce(pg_catalog.current_setting('nexra.provider_write', true), '') <> old.id::text then
    raise exception 'nexra_provider_runs: a run changes only through nexra_provider_run_finish or nexra_provider_run_resume'
      using errcode = 'check_violation';
  end if;
  if not ((old.status = 'reserved' and new.status in ('completed', 'partial', 'failed'))
       or (old.status = 'partial' and new.status = 'reserved')) then
    raise exception 'nexra_provider_runs: a run moves only from reserved to completed, partial or failed, or from partial back to reserved'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Requests: the SERP endpoint.

alter table public.nexra_provider_requests drop constraint nexra_provider_requests_endpoint_valid;
alter table public.nexra_provider_requests add constraint nexra_provider_requests_endpoint_valid
  check (endpoint in (
    'dataforseo_labs/google/keyword_overview/live',
    'dataforseo_labs/google/related_keywords/live',
    'serp/google/organic/live/advanced'));

-- ---------------------------------------------------------------------------
-- The results table.

create table public.nexra_serp_results (
  id uuid primary key default gen_random_uuid(),

  run_id uuid not null
    constraint nexra_serp_results_run_fkey references public.nexra_provider_runs (id) on delete restrict,
  request_id uuid not null
    constraint nexra_serp_results_request_fkey references public.nexra_provider_requests (id) on delete restrict,
  project_id text not null
    constraint nexra_serp_results_project_fkey references public.projects (id) on delete restrict,
  opportunity_id uuid not null
    constraint nexra_serp_results_opportunity_fkey references public.nexra_opportunities (id) on delete restrict,
  keyword text not null
    constraint nexra_serp_results_keyword_length check (char_length(keyword) between 1 and 200),

  result_type text not null
    constraint nexra_serp_results_type_valid check (result_type in ('organic', 'people-also-ask', 'related-search')),
  -- The position within its type, 1 first, as the provider ordered it.
  rank smallint not null
    constraint nexra_serp_results_rank_range check (rank between 1 and 100),
  constraint nexra_serp_results_request_type_rank_unique unique (request_id, result_type, rank),

  -- organic: the page's URL, its domain and title (a snippet when given); people-also-ask: the question as title (the
  -- source URL of its answer when given); related-search: the query as title, nothing else.
  url text
    constraint nexra_serp_results_url_format check (url is null or (char_length(url) between 1 and 2000 and url ~ '^https?://')),
  domain text
    constraint nexra_serp_results_domain_length check (domain is null or char_length(domain) between 1 and 255),
  title text not null
    constraint nexra_serp_results_title_length check (char_length(title) between 1 and 500),
  snippet text
    constraint nexra_serp_results_snippet_length check (snippet is null or char_length(snippet) between 1 and 1000),
  constraint nexra_serp_results_shape check (
    (result_type = 'organic' and url is not null and domain is not null)
    or (result_type = 'people-also-ask' and domain is null and snippet is null)
    or (result_type = 'related-search' and url is null and domain is null and snippet is null)),

  -- Provenance, copied from the run and the request at record time.
  provider text not null
    constraint nexra_serp_results_provider_valid check (provider in ('dataforseo')),
  mode text not null
    constraint nexra_serp_results_mode_valid check (mode in ('sandbox', 'live')),
  location_code integer not null,
  language_code text not null,
  fetched_at timestamptz not null
);

create index nexra_serp_results_opportunity_idx on public.nexra_serp_results (opportunity_id, fetched_at desc);
create index nexra_serp_results_run_idx on public.nexra_serp_results (run_id);

comment on table public.nexra_serp_results is
  'M4: one result of one SERP request — organic result, People Also Ask question or related search — with its rank within its type, as the provider gave it, and the run''s provenance. Written once by nexra_provider_serp_record; never changed or deleted. A snippet is never evidence.';

alter table public.nexra_serp_results enable row level security;

create trigger nexra_serp_results_guard_insert
  before insert on public.nexra_serp_results
  for each row execute function public.nexra_provider_guard_insert();
create trigger nexra_serp_results_guard_update
  before update on public.nexra_serp_results
  for each row execute function public.nexra_provider_guard_immutable();
create trigger nexra_serp_results_guard_delete
  before delete on public.nexra_serp_results
  for each row execute function public.nexra_provider_guard_immutable();
create trigger nexra_serp_results_guard_truncate
  before truncate on public.nexra_serp_results
  for each statement execute function public.nexra_provider_guard_immutable();

-- ---------------------------------------------------------------------------
-- Reserving one SERP run against the cap. The cap rule, the locks and the outcomes are reserve's.

create function public.nexra_provider_serp_reserve(
  p_project_id text,
  p_opportunity_id uuid,
  p_location_code integer,
  p_language_code text,
  p_mode text,
  p_api_host text,
  p_estimate_usd numeric,
  p_cap_usd numeric,
  p_requested_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.nexra_provider_runs;
  v_keyword text;
  v_estimate numeric(10, 4);
  v_spent numeric(10, 4);
begin
  if p_project_id is null or p_opportunity_id is null or p_location_code is null or p_language_code is null
    or p_mode is null or p_api_host is null or p_estimate_usd is null or p_cap_usd is null or p_requested_by is null then
    raise exception 'nexra_provider_serp_reserve: project, opportunity, location, language, mode, host, estimate, cap and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_mode not in ('sandbox', 'live') then
    raise exception 'nexra_provider_serp_reserve: the mode is sandbox or live'
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_mode = 'live' and p_api_host <> 'api.dataforseo.com') or (p_mode = 'sandbox' and p_api_host <> 'sandbox.dataforseo.com') then
    raise exception 'nexra_provider_serp_reserve: the host must be the one the mode uses'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_location_code <= 0 or p_language_code !~ '^[a-z]{2}$' then
    raise exception 'nexra_provider_serp_reserve: the location is a positive code and the language a two-letter code'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_cap_usd < 0 or p_cap_usd > 5.00 then
    raise exception 'nexra_provider_serp_reserve: the daily cap is 0 to 5.00 US dollars'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_estimate_usd < 0 or p_estimate_usd > p_cap_usd then
    raise exception 'nexra_provider_serp_reserve: the estimate is 0 to the daily cap'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;

  -- The keyword: the accepted opportunity's cluster's primary keyword, trimmed. Another project's opportunity is not found.
  select pg_catalog.btrim(c.primary_keyword) into v_keyword
    from public.nexra_opportunities o
    join public.nexra_topic_clusters c on c.id = o.cluster_id
   where o.id = p_opportunity_id and o.project_id = p_project_id;
  if v_keyword is null or v_keyword = '' then
    return pg_catalog.jsonb_build_object('outcome', 'opportunity-not-found');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nexra-provider-project'), pg_catalog.hashtext(p_project_id));
  if exists (select 1 from public.nexra_provider_runs where project_id = p_project_id and status = 'reserved') then
    return pg_catalog.jsonb_build_object('outcome', 'run-active');
  end if;

  v_estimate := case when p_mode = 'live' then p_estimate_usd else 0 end;
  if p_mode = 'live' then
    perform public.nexra_provider_lock_day();
    v_spent := public.nexra_provider_live_spend_today(null);
    if v_spent + v_estimate > p_cap_usd then
      return pg_catalog.jsonb_build_object('outcome', 'cap-reached', 'spent_usd', v_spent, 'cap_usd', p_cap_usd, 'estimate_usd', v_estimate);
    end if;
  end if;

  v_row.id := gen_random_uuid();
  perform pg_catalog.set_config('nexra.provider_write', v_row.id::text, true);
  insert into public.nexra_provider_runs (id, project_id, provider, kind, opportunity_id, mode, api_host, seeds, location_code, language_code, estimate_usd, requested_by)
  values (v_row.id, p_project_id, 'dataforseo', 'serp', p_opportunity_id, p_mode, p_api_host, array[v_keyword], p_location_code, p_language_code, v_estimate, p_requested_by)
  returning * into v_row;
  perform pg_catalog.set_config('nexra.provider_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'reserved', 'run', pg_catalog.to_jsonb(v_row), 'spent_usd', coalesce(v_spent, 0));
end;
$$;

comment on function public.nexra_provider_serp_reserve(text, uuid, integer, text, text, text, numeric, numeric, uuid) is
  'M4: reserves one SERP run for an accepted opportunity against the shared daily dollar cap; the keyword is the opportunity''s cluster''s primary keyword, chosen here: reserved, cap-reached, run-active, opportunity-not-found or project-not-found. Calls no provider.';

-- ---------------------------------------------------------------------------
-- Recording one provider call: 20261016120000's body, with the endpoint list grown by one and the endpoint required to
-- belong to the run's kind.

create or replace function public.nexra_provider_request_record(
  p_run_id uuid,
  p_seq smallint,
  p_endpoint text,
  p_params jsonb,
  p_outcome text,
  p_provider_status_code integer,
  p_provider_task_id text,
  p_cost_usd numeric,
  p_items integer,
  p_response_sha256 text,
  p_sent_at timestamptz,
  p_received_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.nexra_provider_runs;
  v_row public.nexra_provider_requests;
begin
  if p_run_id is null or p_seq is null or p_endpoint is null or p_params is null or p_outcome is null or p_sent_at is null then
    raise exception 'nexra_provider_request_record: run, seq, endpoint, params, outcome and sent time are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_endpoint not in ('dataforseo_labs/google/keyword_overview/live', 'dataforseo_labs/google/related_keywords/live', 'serp/google/organic/live/advanced') then
    raise exception 'nexra_provider_request_record: unknown endpoint'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_outcome not in ('succeeded', 'failed', 'unknown') then
    raise exception 'nexra_provider_request_record: the outcome is succeeded, failed or unknown'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.jsonb_typeof(p_params) <> 'object' then
    raise exception 'nexra_provider_request_record: params is an object'
      using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(p_params) k
              where pg_catalog.lower(k) in ('login', 'password', 'authorization', 'auth', 'token', 'api_key', 'apikey', 'secret')) then
    raise exception 'nexra_provider_request_record: params never carry a credential'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_run from public.nexra_provider_runs where id = p_run_id for update;
  if v_run.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-found');
  end if;
  if v_run.status <> 'reserved' then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-open');
  end if;
  if (v_run.kind = 'serp') <> (p_endpoint = 'serp/google/organic/live/advanced') then
    return pg_catalog.jsonb_build_object('outcome', 'endpoint-not-for-kind');
  end if;
  select * into v_row from public.nexra_provider_requests where run_id = p_run_id and seq = p_seq;
  if v_row.id is not null then
    return pg_catalog.jsonb_build_object('outcome', 'exists', 'request', pg_catalog.to_jsonb(v_row));
  end if;

  perform pg_catalog.set_config('nexra.provider_write', v_run.id::text, true);
  insert into public.nexra_provider_requests (run_id, seq, endpoint, params, outcome, provider_status_code, provider_task_id, cost_usd, items, response_sha256, sent_at, received_at)
  values (p_run_id, p_seq, p_endpoint, p_params, p_outcome, p_provider_status_code, p_provider_task_id,
          case when v_run.mode = 'sandbox' and p_cost_usd is not null then 0 else p_cost_usd end,
          p_items, p_response_sha256, p_sent_at, p_received_at)
  returning * into v_row;
  perform pg_catalog.set_config('nexra.provider_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'request', pg_catalog.to_jsonb(v_row));
end;
$$;

comment on function public.nexra_provider_request_record(uuid, smallint, text, jsonb, text, integer, text, numeric, integer, text, timestamptz, timestamptz) is
  'Records one provider call of an open run, once per seq: recorded, exists (unchanged), run-not-found, run-not-open or endpoint-not-for-kind (M4: a SERP run takes only the SERP endpoint, a keyword snapshot only the Labs endpoints). A sandbox call is recorded at cost 0. Params holding a credential key raise invalid_parameter_value.';

-- ---------------------------------------------------------------------------
-- Finishing one run: 20261016120000's body, with a SERP run planning one call (seq 0).

create or replace function public.nexra_provider_run_finish(
  p_run_id uuid,
  p_status text,
  p_cost_usd numeric,
  p_unknown_cost_usd numeric,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.nexra_provider_runs;
  v_cost numeric(10, 4);
  v_requests integer;
  v_succeeded integer;
  v_planned_missing integer;
begin
  if p_run_id is null or p_status is null or p_cost_usd is null or p_unknown_cost_usd is null then
    raise exception 'nexra_provider_run_finish: run, status, cost and unknown cost are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_status not in ('completed', 'partial', 'failed') then
    raise exception 'nexra_provider_run_finish: the status is completed, partial or failed'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_cost_usd < 0 or p_unknown_cost_usd < 0 then
    raise exception 'nexra_provider_run_finish: costs are not negative'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_error_code is not null and char_length(p_error_code) not between 1 and 80 then
    raise exception 'nexra_provider_run_finish: the error code is 1 to 80 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_run from public.nexra_provider_runs where id = p_run_id for update;
  if v_run.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-found');
  end if;
  if v_run.status <> 'reserved' then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-open');
  end if;

  select count(*), count(*) filter (where outcome = 'succeeded'), coalesce(sum(cost_usd) filter (where outcome = 'succeeded'), 0)
    into v_requests, v_succeeded, v_cost
    from public.nexra_provider_requests where run_id = p_run_id;
  if v_run.mode = 'sandbox' and (p_cost_usd <> 0 or p_unknown_cost_usd <> 0) then
    return pg_catalog.jsonb_build_object('outcome', 'cost-mismatch', 'recorded_usd', 0);
  end if;
  if p_cost_usd <> v_cost then
    return pg_catalog.jsonb_build_object('outcome', 'cost-mismatch', 'recorded_usd', v_cost);
  end if;
  -- `completed` means every planned call has a succeeded request, directly or by a retry naming it in params.retry_of:
  -- a keyword snapshot plans seq 0 and one per seed, a SERP run seq 0 only. Earlier failed or unknown rows stay as
  -- history and are already in the figures.
  if p_status = 'completed' then
    select count(*) into v_planned_missing
      from pg_catalog.generate_series(0, case when v_run.kind = 'serp' then 0 else pg_catalog.cardinality(v_run.seeds) end) planned(n)
     where not exists (
       select 1 from public.nexra_provider_requests r
        where r.run_id = p_run_id and r.outcome = 'succeeded'
          and coalesce((r.params->>'retry_of')::integer, r.seq) = planned.n);
    if v_planned_missing > 0 then
      return pg_catalog.jsonb_build_object('outcome', 'status-not-consistent', 'requests', v_requests, 'succeeded', v_succeeded, 'planned_missing', v_planned_missing);
    end if;
  end if;

  perform pg_catalog.set_config('nexra.provider_write', v_run.id::text, true);
  update public.nexra_provider_runs
     set status = p_status,
         cost_usd = v_cost,
         unknown_cost_usd = case when v_run.mode = 'live' then p_unknown_cost_usd else 0 end,
         error_code = p_error_code,
         finished_at = pg_catalog.clock_timestamp()
   where id = p_run_id
  returning * into v_run;
  perform pg_catalog.set_config('nexra.provider_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'finished', 'run', pg_catalog.to_jsonb(v_run));
end;
$$;

comment on function public.nexra_provider_run_finish(uuid, text, numeric, numeric, text) is
  'Closes an open run as completed, partial or failed, recording its cost (which must equal the succeeded requests'' recorded sum) and the estimate of its timed-out calls: finished, run-not-found, run-not-open, cost-mismatch or status-not-consistent (completed needs a succeeded request for every planned call — a keyword snapshot''s overview and one per seed, a SERP run''s one call — a retry counting by its retry_of).';

-- ---------------------------------------------------------------------------
-- Recording one SERP request's results, as one set.

create function public.nexra_provider_serp_record(
  p_run_id uuid,
  p_request_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.nexra_provider_runs;
  v_req public.nexra_provider_requests;
  v_count integer;
begin
  if p_run_id is null or p_request_id is null or p_rows is null then
    raise exception 'nexra_provider_serp_record: run, request and rows are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'nexra_provider_serp_record: rows is an array'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_run from public.nexra_provider_runs where id = p_run_id for update;
  if v_run.id is null or v_run.kind <> 'serp' then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-found');
  end if;
  if v_run.status <> 'reserved' then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-open');
  end if;
  select * into v_req from public.nexra_provider_requests where id = p_request_id and run_id = p_run_id and outcome = 'succeeded';
  if v_req.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'request-not-found');
  end if;
  if exists (select 1 from public.nexra_serp_results where request_id = p_request_id) then
    return pg_catalog.jsonb_build_object('outcome', 'exists');
  end if;

  -- Every row well formed, at most 100 of them, and no (type, rank) twice.
  if pg_catalog.jsonb_array_length(p_rows) > 100 or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_rows) e
     where pg_catalog.jsonb_typeof(e) <> 'object'
        or coalesce(e->>'type', '') not in ('organic', 'people-also-ask', 'related-search')
        or pg_catalog.jsonb_typeof(e->'rank') <> 'number' or (e->>'rank') !~ '^[0-9]+$' or (e->>'rank')::integer not between 1 and 100
        or pg_catalog.jsonb_typeof(e->'title') <> 'string' or char_length(e->>'title') not between 1 and 500
        or (e ? 'url' and pg_catalog.jsonb_typeof(e->'url') not in ('string', 'null'))
        or (e ? 'domain' and pg_catalog.jsonb_typeof(e->'domain') not in ('string', 'null'))
        or (e ? 'snippet' and pg_catalog.jsonb_typeof(e->'snippet') not in ('string', 'null'))
        or (pg_catalog.jsonb_typeof(e->'url') = 'string' and (char_length(e->>'url') not between 1 and 2000 or (e->>'url') !~ '^https?://'))
        or (pg_catalog.jsonb_typeof(e->'domain') = 'string' and char_length(e->>'domain') not between 1 and 255)
        or (pg_catalog.jsonb_typeof(e->'snippet') = 'string' and char_length(e->>'snippet') not between 1 and 1000)
        or (e->>'type' = 'organic' and (pg_catalog.jsonb_typeof(e->'url') is distinct from 'string' or pg_catalog.jsonb_typeof(e->'domain') is distinct from 'string'))
        or (e->>'type' = 'people-also-ask' and (pg_catalog.jsonb_typeof(e->'domain') = 'string' or pg_catalog.jsonb_typeof(e->'snippet') = 'string'))
        or (e->>'type' = 'related-search' and (pg_catalog.jsonb_typeof(e->'url') = 'string' or pg_catalog.jsonb_typeof(e->'domain') = 'string' or pg_catalog.jsonb_typeof(e->'snippet') = 'string'))
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-row');
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_rows) e)
     <> (select count(distinct (e->>'type', (e->>'rank')::integer)) from pg_catalog.jsonb_array_elements(p_rows) e) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-row');
  end if;

  perform pg_catalog.set_config('nexra.provider_write', v_run.id::text, true);
  insert into public.nexra_serp_results (run_id, request_id, project_id, opportunity_id, keyword, result_type, rank, url, domain, title, snippet,
    provider, mode, location_code, language_code, fetched_at)
  select p_run_id, p_request_id, v_run.project_id, v_run.opportunity_id, v_run.seeds[1], e->>'type', (e->>'rank')::smallint,
         case when pg_catalog.jsonb_typeof(e->'url') = 'string' then e->>'url' end,
         case when pg_catalog.jsonb_typeof(e->'domain') = 'string' then e->>'domain' end,
         e->>'title',
         case when pg_catalog.jsonb_typeof(e->'snippet') = 'string' then e->>'snippet' end,
         v_run.provider, v_run.mode, v_run.location_code, v_run.language_code, coalesce(v_req.received_at, v_req.sent_at)
    from pg_catalog.jsonb_array_elements(p_rows) e;
  get diagnostics v_count = row_count;
  perform pg_catalog.set_config('nexra.provider_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'rows', v_count);
end;
$$;

comment on function public.nexra_provider_serp_record(uuid, uuid, jsonb) is
  'M4: records one succeeded SERP request''s results as one set, with the run''s opportunity, keyword and provenance on every row: recorded, exists, run-not-found (also a keyword-snapshot run), run-not-open, request-not-found or invalid-row.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the new table and executes the two new functions.

revoke all on table public.nexra_serp_results from public;
revoke all on function public.nexra_provider_serp_reserve(text, uuid, integer, text, text, text, numeric, numeric, uuid) from public;
revoke all on function public.nexra_provider_serp_record(uuid, uuid, jsonb) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_serp_results from %I', v_role);
      execute format('revoke all on function public.nexra_provider_serp_reserve(text, uuid, integer, text, text, text, numeric, numeric, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_provider_serp_record(uuid, uuid, jsonb) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_serp_results to service_role;
    grant execute on function public.nexra_provider_serp_reserve(text, uuid, integer, text, text, text, numeric, numeric, uuid) to service_role;
    grant execute on function public.nexra_provider_serp_record(uuid, uuid, jsonb) to service_role;
  end if;
end
$$;
