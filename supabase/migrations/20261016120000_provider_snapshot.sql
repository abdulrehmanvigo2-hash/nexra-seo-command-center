-- Provider keyword snapshot: provider runs, provider requests and keyword
-- metrics, append-only with provenance on every row (F0, PR 2; the design note
-- is docs/roadmap/F0-dataforseo-keyword-snapshot.md, §3 data model, §4 cap,
-- decisions Q3 and Q4).
--
-- WHY. F0 fetches one small batch of keyword metrics (search volume, CPC,
-- competition, difficulty, intent) from DataForSEO for ten approved seed
-- topics. A provider's figures are a model's estimates, never observed data,
-- so every row records where it came from (provider, endpoint, mode, host,
-- location, language, the request it came from and when), and the money it
-- costs is bounded here, in the database, by a daily dollar cap no variable
-- can raise above $5.00. Nothing here calls a provider: the application does,
-- and records what it did through the functions below.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000.
--
-- THREE TABLES, new:
--   `nexra_provider_runs`      one row per snapshot: project, provider, kind,
--                              mode (`sandbox` or `live`) and the host that mode
--                              used, the seeds asked, location and language,
--                              status, the estimate, the recorded cost, the
--                              estimate of timed-out calls, who asked, when.
--   `nexra_provider_requests`  one row per provider call: endpoint, parameters
--                              (never a credential), outcome, the provider's
--                              status code and task id, its reported cost, the
--                              item count, the SHA-256 of the raw response (the
--                              body is not stored), sent and received times.
--                              unique (run_id, seq): a repeated record is a no-op.
--   `nexra_keyword_metrics`    one immutable row per keyword per run, with the
--                              metrics as the provider gave them (a value it
--                              did not give stays null, never 0) and the full
--                              provenance copied from its run and request.
--
-- WRITES. Only through five `security definer` functions (empty `search_path`,
-- EXECUTE for `service_role` only). Guard triggers refuse every direct insert,
-- every delete and every truncate; a request or metric row never changes; a
-- run changes only its status, estimate_usd, cost_usd, unknown_cost_usd,
-- error_code and finished_at, only under the functions' transaction-local
-- flag, and only along reserved -> completed | partial | failed (finish) and
-- partial -> reserved (resume).
--   nexra_provider_run_reserve   reserves a run against the daily cap under an
--                                advisory lock on the UTC day, so two
--                                reservations at the same moment are
--                                serialised: `reserved`, `cap-reached`,
--                                `run-active` (the project already has a run in
--                                `reserved`), `project-not-found`. The cap is
--                                passed by the server; a cap above $5.00, below
--                                0, or an estimate above the cap raises
--                                invalid_parameter_value. Today's live spend is
--                                the sum over today's live runs of
--                                coalesce(cost_usd, estimate_usd) +
--                                unknown_cost_usd. A sandbox run is recorded
--                                with estimate 0 and is never counted.
--   nexra_provider_request_record  records one call: `recorded`, `exists` (the
--                                same seq, unchanged), `run-not-found`,
--                                `run-not-open`.
--   nexra_provider_metrics_record   records one request's rows as one set:
--                                `recorded`, `exists` (the request already has
--                                rows), `run-not-found`, `run-not-open`,
--                                `request-not-found`, `invalid-row`.
--   nexra_provider_run_finish    closes a run: `finished`, `run-not-found`,
--                                `run-not-open`, `cost-mismatch` (the cost given
--                                is not the sum of the succeeded requests'),
--                                `status-not-consistent` (`completed` while a
--                                planned call — seq 0, the overview, and seq
--                                1..n, one per seed — has no succeeded request,
--                                counting a retry by its `retry_of`; earlier
--                                failed or unknown rows stay as history and
--                                still count in the cost and unknown cost).
--   nexra_provider_run_resume    reopens a `partial` run for its missing calls
--                                (decision Q4: only ever reached through the
--                                confirmation dialog, never automatically):
--                                `reserved`, `cap-reached`, `run-active`,
--                                `run-not-partial`, `run-not-found`. The cap rule
--                                is reserve's; the run's estimate becomes its
--                                recorded cost so far plus the missing calls'
--                                estimate, and its cost is recomputed at finish.
--
-- ACCESS. Row level security on, no policies. service_role is granted SELECT
-- on the three tables and EXECUTE on the five functions, nothing else; no
-- INSERT, UPDATE or DELETE grant exists for any API role. The guard functions
-- are executable by no API role. The harness's whole-database security
-- definer inventory (c5) names the five functions.

-- ---------------------------------------------------------------------------
-- Tables.

create table public.nexra_provider_runs (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_provider_runs_project_fkey references public.projects (id) on delete restrict,

  provider text not null
    constraint nexra_provider_runs_provider_valid check (provider in ('dataforseo')),
  kind text not null
    constraint nexra_provider_runs_kind_valid check (kind in ('keyword-snapshot')),
  mode text not null
    constraint nexra_provider_runs_mode_valid check (mode in ('sandbox', 'live')),
  api_host text not null
    constraint nexra_provider_runs_api_host_valid check (api_host in ('api.dataforseo.com', 'sandbox.dataforseo.com')),
  constraint nexra_provider_runs_host_matches_mode
    check ((mode = 'live') = (api_host = 'api.dataforseo.com')),

  seeds text[] not null
    constraint nexra_provider_runs_seeds_count check (cardinality(seeds) between 1 and 10),
  location_code integer not null
    constraint nexra_provider_runs_location_positive check (location_code > 0),
  language_code text not null
    constraint nexra_provider_runs_language_format check (language_code ~ '^[a-z]{2}$'),

  status text not null default 'reserved'
    constraint nexra_provider_runs_status_valid check (status in ('reserved', 'completed', 'partial', 'failed')),

  -- Money, in US dollars. The estimate is what the reservation asked for; the cost
  -- is the sum of the provider's reported cost over the succeeded requests, known
  -- only once the run is finished; the unknown cost is the estimate of the calls
  -- that timed out, which the provider may have charged.
  estimate_usd numeric(10, 4) not null
    constraint nexra_provider_runs_estimate_range check (estimate_usd >= 0 and estimate_usd <= 5),
  cost_usd numeric(10, 4)
    constraint nexra_provider_runs_cost_range check (cost_usd is null or cost_usd >= 0),
  unknown_cost_usd numeric(10, 4) not null default 0
    constraint nexra_provider_runs_unknown_cost_range check (unknown_cost_usd >= 0),
  constraint nexra_provider_runs_sandbox_costs_nothing
    check (mode = 'live' or (estimate_usd = 0 and coalesce(cost_usd, 0) = 0 and unknown_cost_usd = 0)),

  error_code text
    constraint nexra_provider_runs_error_code_length check (error_code is null or char_length(error_code) between 1 and 80),
  constraint nexra_provider_runs_open_has_no_result
    check (status <> 'reserved' or (cost_usd is null and finished_at is null)),
  constraint nexra_provider_runs_closed_has_result
    check (status = 'reserved' or (cost_usd is not null and finished_at is not null)),

  -- The Supabase Auth user id of the operator who confirmed. No foreign key, as on the other records.
  requested_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);

create index nexra_provider_runs_project_idx on public.nexra_provider_runs (project_id, created_at desc);
create index nexra_provider_runs_day_idx on public.nexra_provider_runs (created_at) where mode = 'live';

comment on table public.nexra_provider_runs is
  'One provider snapshot run — project, provider, kind, mode and host, the seeds, location and language, status, estimate, recorded cost and the estimate of timed-out calls. Written by nexra_provider_run_reserve, changed only by _finish and _resume; never deleted.';

create table public.nexra_provider_requests (
  id uuid primary key default gen_random_uuid(),

  run_id uuid not null
    constraint nexra_provider_requests_run_fkey references public.nexra_provider_runs (id) on delete restrict,
  seq smallint not null
    constraint nexra_provider_requests_seq_range check (seq between 0 and 20),
  constraint nexra_provider_requests_run_seq_unique unique (run_id, seq),

  endpoint text not null
    constraint nexra_provider_requests_endpoint_valid check (endpoint in (
      'dataforseo_labs/google/keyword_overview/live',
      'dataforseo_labs/google/related_keywords/live')),
  -- The task parameters sent (keywords, location, language, limit, depth). Never a credential:
  -- the record function refuses an object holding a key that names one.
  params jsonb not null
    constraint nexra_provider_requests_params_object check (jsonb_typeof(params) = 'object'),

  outcome text not null
    constraint nexra_provider_requests_outcome_valid check (outcome in ('succeeded', 'failed', 'unknown')),
  provider_status_code integer,
  provider_task_id text
    constraint nexra_provider_requests_task_id_length check (provider_task_id is null or char_length(provider_task_id) between 1 and 120),
  cost_usd numeric(10, 4)
    constraint nexra_provider_requests_cost_range check (cost_usd is null or cost_usd >= 0),
  items integer
    constraint nexra_provider_requests_items_range check (items is null or items >= 0),
  response_sha256 text
    constraint nexra_provider_requests_sha256_format check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  constraint nexra_provider_requests_succeeded_is_complete
    check (outcome <> 'succeeded' or (cost_usd is not null and items is not null and response_sha256 is not null and received_at is not null)),
  constraint nexra_provider_requests_unknown_has_no_cost
    check (outcome <> 'unknown' or cost_usd is null),

  sent_at timestamptz not null,
  received_at timestamptz,
  constraint nexra_provider_requests_received_after_sent check (received_at is null or received_at >= sent_at)
);

comment on table public.nexra_provider_requests is
  'One provider call of a run — endpoint, parameters without secrets, outcome, the provider''s status code, task id and reported cost, the item count, the raw response''s SHA-256, sent and received times. Written once by nexra_provider_request_record; never changed or deleted.';

create table public.nexra_keyword_metrics (
  id uuid primary key default gen_random_uuid(),

  run_id uuid not null
    constraint nexra_keyword_metrics_run_fkey references public.nexra_provider_runs (id) on delete restrict,
  request_id uuid not null
    constraint nexra_keyword_metrics_request_fkey references public.nexra_provider_requests (id) on delete restrict,
  project_id text not null
    constraint nexra_keyword_metrics_project_fkey references public.projects (id) on delete restrict,

  seed text not null
    constraint nexra_keyword_metrics_seed_length check (char_length(seed) between 1 and 200),
  keyword text not null
    constraint nexra_keyword_metrics_keyword_length check (char_length(keyword) between 1 and 200),
  relation text not null
    constraint nexra_keyword_metrics_relation_valid check (relation in ('seed', 'related')),
  constraint nexra_keyword_metrics_seed_is_itself check (relation <> 'seed' or keyword = seed),
  constraint nexra_keyword_metrics_run_seed_keyword_unique unique (run_id, seed, keyword),

  -- The provider's figures, as given. Null is "not given", never 0.
  search_volume integer
    constraint nexra_keyword_metrics_volume_range check (search_volume is null or search_volume >= 0),
  cpc numeric(10, 2)
    constraint nexra_keyword_metrics_cpc_range check (cpc is null or cpc >= 0),
  competition numeric(5, 4)
    constraint nexra_keyword_metrics_competition_range check (competition is null or (competition >= 0 and competition <= 1)),
  keyword_difficulty smallint
    constraint nexra_keyword_metrics_difficulty_range check (keyword_difficulty is null or (keyword_difficulty between 0 and 100)),
  intent text
    constraint nexra_keyword_metrics_intent_length check (intent is null or char_length(intent) between 1 and 40),
  monthly_searches jsonb
    constraint nexra_keyword_metrics_monthly_array check (monthly_searches is null or jsonb_typeof(monthly_searches) = 'array'),
  provider_updated_at timestamptz,

  -- Provenance, copied from the run and the request at record time.
  provider text not null
    constraint nexra_keyword_metrics_provider_valid check (provider in ('dataforseo')),
  mode text not null
    constraint nexra_keyword_metrics_mode_valid check (mode in ('sandbox', 'live')),
  location_code integer not null,
  language_code text not null,
  fetched_at timestamptz not null
);

create index nexra_keyword_metrics_project_idx on public.nexra_keyword_metrics (project_id, fetched_at desc);
create index nexra_keyword_metrics_request_idx on public.nexra_keyword_metrics (request_id);

comment on table public.nexra_keyword_metrics is
  'One keyword''s provider estimates from one run — volume, CPC, competition, difficulty, intent, monthly searches as the provider gave them (null is not given, never 0) — with provider, mode, location, language, fetch time and the request it came from. Written once by nexra_provider_metrics_record; never changed or deleted.';

alter table public.nexra_provider_runs enable row level security;
alter table public.nexra_provider_requests enable row level security;
alter table public.nexra_keyword_metrics enable row level security;

-- ---------------------------------------------------------------------------
-- Guards, for every writer. The functions set the transaction-local flag
-- nexra.provider_write to the run's id around each write.

create function public.nexra_provider_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run text;
begin
  v_run := case tg_table_name when 'nexra_provider_runs' then pg_catalog.to_jsonb(new)->>'id' else pg_catalog.to_jsonb(new)->>'run_id' end;
  if coalesce(pg_catalog.current_setting('nexra.provider_write', true), '') <> v_run then
    raise exception '%: rows are written only through the nexra_provider_* functions', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_provider_runs_guard_insert
  before insert on public.nexra_provider_runs
  for each row execute function public.nexra_provider_guard_insert();
create trigger nexra_provider_requests_guard_insert
  before insert on public.nexra_provider_requests
  for each row execute function public.nexra_provider_guard_insert();
create trigger nexra_keyword_metrics_guard_insert
  before insert on public.nexra_keyword_metrics
  for each row execute function public.nexra_provider_guard_insert();

-- A run changes only its result columns, under the flag, along the two allowed transitions.
create function public.nexra_provider_runs_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.provider is distinct from old.provider
    or new.kind is distinct from old.kind
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

create trigger nexra_provider_runs_guard_update
  before update on public.nexra_provider_runs
  for each row execute function public.nexra_provider_runs_guard_update();

create function public.nexra_provider_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: a recorded row is permanent history and is never changed or removed', tg_table_name
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_provider_requests_guard_update
  before update on public.nexra_provider_requests
  for each row execute function public.nexra_provider_guard_immutable();
create trigger nexra_keyword_metrics_guard_update
  before update on public.nexra_keyword_metrics
  for each row execute function public.nexra_provider_guard_immutable();

create trigger nexra_provider_runs_guard_delete
  before delete on public.nexra_provider_runs
  for each row execute function public.nexra_provider_guard_immutable();
create trigger nexra_provider_requests_guard_delete
  before delete on public.nexra_provider_requests
  for each row execute function public.nexra_provider_guard_immutable();
create trigger nexra_keyword_metrics_guard_delete
  before delete on public.nexra_keyword_metrics
  for each row execute function public.nexra_provider_guard_immutable();

create trigger nexra_provider_runs_guard_truncate
  before truncate on public.nexra_provider_runs
  for each statement execute function public.nexra_provider_guard_immutable();
create trigger nexra_provider_requests_guard_truncate
  before truncate on public.nexra_provider_requests
  for each statement execute function public.nexra_provider_guard_immutable();
create trigger nexra_keyword_metrics_guard_truncate
  before truncate on public.nexra_keyword_metrics
  for each statement execute function public.nexra_provider_guard_immutable();

-- ---------------------------------------------------------------------------
-- The cap, shared by reserve and resume. Internal: executable by no API role.
-- Today's live spend in US dollars, counting every live run created on the
-- current UTC day except the one given: its recorded cost once finished, its
-- estimate while open, plus the estimate of its timed-out calls. Called under
-- the day's advisory lock.

create function public.nexra_provider_live_spend_today(p_except_run uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(coalesce(r.cost_usd, r.estimate_usd) + r.unknown_cost_usd), 0)
    from public.nexra_provider_runs r
   where r.mode = 'live'
     and (r.created_at at time zone 'UTC')::date = (pg_catalog.clock_timestamp() at time zone 'UTC')::date
     and (p_except_run is null or r.id <> p_except_run)
$$;

-- The day's lock key: a fixed class and the UTC day number.
create function public.nexra_provider_lock_day()
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('nexra-provider-cap-day'),
    ((pg_catalog.clock_timestamp() at time zone 'UTC')::date - date '2000-01-01')::integer)
$$;

-- ---------------------------------------------------------------------------
-- Reserving one run against the cap.

create function public.nexra_provider_run_reserve(
  p_project_id text,
  p_seeds text[],
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
  v_estimate numeric(10, 4);
  v_spent numeric(10, 4);
  v_seed text;
begin
  if p_project_id is null or p_seeds is null or p_location_code is null or p_language_code is null
    or p_mode is null or p_api_host is null or p_estimate_usd is null or p_cap_usd is null or p_requested_by is null then
    raise exception 'nexra_provider_run_reserve: project, seeds, location, language, mode, host, estimate, cap and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_mode not in ('sandbox', 'live') then
    raise exception 'nexra_provider_run_reserve: the mode is sandbox or live'
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_mode = 'live' and p_api_host <> 'api.dataforseo.com') or (p_mode = 'sandbox' and p_api_host <> 'sandbox.dataforseo.com') then
    raise exception 'nexra_provider_run_reserve: the host must be the one the mode uses'
      using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(p_seeds) < 1 or cardinality(p_seeds) > 10 then
    raise exception 'nexra_provider_run_reserve: 1 to 10 seeds'
      using errcode = 'invalid_parameter_value';
  end if;
  foreach v_seed in array p_seeds loop
    if v_seed is null or pg_catalog.btrim(v_seed) = '' or char_length(v_seed) > 200 or v_seed <> pg_catalog.btrim(v_seed) then
      raise exception 'nexra_provider_run_reserve: each seed is trimmed text of 1 to 200 characters'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if (select count(distinct s) from unnest(p_seeds) s) <> cardinality(p_seeds) then
    raise exception 'nexra_provider_run_reserve: seeds are distinct'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_location_code <= 0 or p_language_code !~ '^[a-z]{2}$' then
    raise exception 'nexra_provider_run_reserve: the location is a positive code and the language a two-letter code'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_cap_usd < 0 or p_cap_usd > 5.00 then
    raise exception 'nexra_provider_run_reserve: the daily cap is 0 to 5.00 US dollars'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_estimate_usd < 0 or p_estimate_usd > p_cap_usd then
    raise exception 'nexra_provider_run_reserve: the estimate is 0 to the daily cap'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;

  -- One run at a time per project, and one reservation at a time against the day's cap.
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
  insert into public.nexra_provider_runs (id, project_id, provider, kind, mode, api_host, seeds, location_code, language_code, estimate_usd, requested_by)
  values (v_row.id, p_project_id, 'dataforseo', 'keyword-snapshot', p_mode, p_api_host, p_seeds, p_location_code, p_language_code, v_estimate, p_requested_by)
  returning * into v_row;
  perform pg_catalog.set_config('nexra.provider_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'reserved', 'run', pg_catalog.to_jsonb(v_row), 'spent_usd', coalesce(v_spent, 0));
end;
$$;

comment on function public.nexra_provider_run_reserve(text, text[], integer, text, text, text, numeric, numeric, uuid) is
  'Reserves one provider run against the daily dollar cap (under the UTC day''s lock; at most one open run per project): reserved, cap-reached, run-active or project-not-found. A sandbox run costs 0 and is never counted. Calls no provider.';

-- ---------------------------------------------------------------------------
-- Recording one provider call.

create function public.nexra_provider_request_record(
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
  if p_endpoint not in ('dataforseo_labs/google/keyword_overview/live', 'dataforseo_labs/google/related_keywords/live') then
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
  'Records one provider call of an open run, once per seq: recorded, exists (unchanged), run-not-found or run-not-open. A sandbox call is recorded at cost 0. Params holding a credential key raise invalid_parameter_value.';

-- ---------------------------------------------------------------------------
-- Recording one request's keyword rows, as one set.

create function public.nexra_provider_metrics_record(
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
    raise exception 'nexra_provider_metrics_record: run, request and rows are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'nexra_provider_metrics_record: rows is an array'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_run from public.nexra_provider_runs where id = p_run_id for update;
  if v_run.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-found');
  end if;
  if v_run.status <> 'reserved' then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-open');
  end if;
  select * into v_req from public.nexra_provider_requests where id = p_request_id and run_id = p_run_id;
  if v_req.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'request-not-found');
  end if;
  if exists (select 1 from public.nexra_keyword_metrics where request_id = p_request_id) then
    return pg_catalog.jsonb_build_object('outcome', 'exists');
  end if;

  -- Every row well formed, and no keyword twice within the set or against the run's earlier rows.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_rows) e
     where pg_catalog.jsonb_typeof(e) <> 'object'
        or pg_catalog.jsonb_typeof(e->'seed') <> 'string' or char_length(e->>'seed') not between 1 and 200
        or pg_catalog.jsonb_typeof(e->'keyword') <> 'string' or char_length(e->>'keyword') not between 1 and 200
        or coalesce(e->>'relation', '') not in ('seed', 'related')
        or (e->>'relation' = 'seed' and e->>'keyword' <> e->>'seed')
        or not (e->>'seed' = any (v_run.seeds))
        or (e ? 'search_volume' and pg_catalog.jsonb_typeof(e->'search_volume') not in ('number', 'null'))
        or (e ? 'cpc' and pg_catalog.jsonb_typeof(e->'cpc') not in ('number', 'null'))
        or (e ? 'competition' and pg_catalog.jsonb_typeof(e->'competition') not in ('number', 'null'))
        or (e ? 'keyword_difficulty' and pg_catalog.jsonb_typeof(e->'keyword_difficulty') not in ('number', 'null'))
        or (e ? 'intent' and pg_catalog.jsonb_typeof(e->'intent') not in ('string', 'null'))
        or (e ? 'monthly_searches' and pg_catalog.jsonb_typeof(e->'monthly_searches') not in ('array', 'null'))
        or (e ? 'provider_updated_at' and pg_catalog.jsonb_typeof(e->'provider_updated_at') not in ('string', 'null'))
        or (pg_catalog.jsonb_typeof(e->'search_volume') = 'number' and (e->>'search_volume')::numeric < 0)
        or (pg_catalog.jsonb_typeof(e->'cpc') = 'number' and (e->>'cpc')::numeric < 0)
        or (pg_catalog.jsonb_typeof(e->'competition') = 'number' and ((e->>'competition')::numeric < 0 or (e->>'competition')::numeric > 1))
        or (pg_catalog.jsonb_typeof(e->'keyword_difficulty') = 'number' and ((e->>'keyword_difficulty')::numeric < 0 or (e->>'keyword_difficulty')::numeric > 100))
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-row');
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(p_rows) e)
     <> (select count(distinct (e->>'seed', e->>'keyword')) from pg_catalog.jsonb_array_elements(p_rows) e)
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_rows) e
         join public.nexra_keyword_metrics m on m.run_id = p_run_id and m.seed = e->>'seed' and m.keyword = e->>'keyword') then
    return pg_catalog.jsonb_build_object('outcome', 'invalid-row');
  end if;

  perform pg_catalog.set_config('nexra.provider_write', v_run.id::text, true);
  insert into public.nexra_keyword_metrics (run_id, request_id, project_id, seed, keyword, relation,
    search_volume, cpc, competition, keyword_difficulty, intent, monthly_searches, provider_updated_at,
    provider, mode, location_code, language_code, fetched_at)
  select p_run_id, p_request_id, v_run.project_id, e->>'seed', e->>'keyword', e->>'relation',
         case when pg_catalog.jsonb_typeof(e->'search_volume') = 'number' then pg_catalog.floor((e->>'search_volume')::numeric)::integer end,
         case when pg_catalog.jsonb_typeof(e->'cpc') = 'number' then (e->>'cpc')::numeric(10, 2) end,
         case when pg_catalog.jsonb_typeof(e->'competition') = 'number' then (e->>'competition')::numeric(5, 4) end,
         case when pg_catalog.jsonb_typeof(e->'keyword_difficulty') = 'number' then pg_catalog.round((e->>'keyword_difficulty')::numeric)::smallint end,
         case when pg_catalog.jsonb_typeof(e->'intent') = 'string' then e->>'intent' end,
         case when pg_catalog.jsonb_typeof(e->'monthly_searches') = 'array' then e->'monthly_searches' end,
         case when pg_catalog.jsonb_typeof(e->'provider_updated_at') = 'string' then (e->>'provider_updated_at')::timestamptz end,
         v_run.provider, v_run.mode, v_run.location_code, v_run.language_code, coalesce(v_req.received_at, v_req.sent_at)
    from pg_catalog.jsonb_array_elements(p_rows) e;
  get diagnostics v_count = row_count;
  perform pg_catalog.set_config('nexra.provider_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'rows', v_count);
end;
$$;

comment on function public.nexra_provider_metrics_record(uuid, uuid, jsonb) is
  'Records one request''s keyword rows as one set, with the run''s provenance on every row: recorded, exists (the request already has rows), run-not-found, run-not-open, request-not-found or invalid-row. A value the provider did not give stays null.';

-- ---------------------------------------------------------------------------
-- Finishing one run.

create function public.nexra_provider_run_finish(
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
  -- `completed` means every planned call (seq 0 and one per seed) has a succeeded request, directly or by a retry
  -- naming it in params.retry_of. Earlier failed or unknown rows stay as history and are already in the figures.
  if p_status = 'completed' then
    select count(*) into v_planned_missing
      from pg_catalog.generate_series(0, pg_catalog.cardinality(v_run.seeds)) planned(n)
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
  'Closes an open run as completed, partial or failed, recording its cost (which must equal the succeeded requests'' recorded sum) and the estimate of its timed-out calls: finished, run-not-found, run-not-open, cost-mismatch or status-not-consistent (completed needs a succeeded request for every planned call, a retry counting by its retry_of).';

-- ---------------------------------------------------------------------------
-- Resuming one partial run for its missing calls (decision Q4).

create function public.nexra_provider_run_resume(
  p_run_id uuid,
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
  v_run public.nexra_provider_runs;
  v_estimate numeric(10, 4);
  v_spent numeric(10, 4);
begin
  if p_run_id is null or p_estimate_usd is null or p_cap_usd is null or p_requested_by is null then
    raise exception 'nexra_provider_run_resume: run, estimate, cap and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_cap_usd < 0 or p_cap_usd > 5.00 then
    raise exception 'nexra_provider_run_resume: the daily cap is 0 to 5.00 US dollars'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_estimate_usd < 0 or p_estimate_usd > p_cap_usd then
    raise exception 'nexra_provider_run_resume: the estimate is 0 to the daily cap'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_run from public.nexra_provider_runs where id = p_run_id for update;
  if v_run.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-found');
  end if;
  if v_run.status <> 'partial' then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-partial');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nexra-provider-project'), pg_catalog.hashtext(v_run.project_id));
  if exists (select 1 from public.nexra_provider_runs where project_id = v_run.project_id and status = 'reserved') then
    return pg_catalog.jsonb_build_object('outcome', 'run-active');
  end if;

  v_estimate := case when v_run.mode = 'live' then p_estimate_usd else 0 end;
  if v_run.mode = 'live' then
    perform public.nexra_provider_lock_day();
    -- The other runs today, plus this run's own recorded spend so far, plus the missing calls.
    v_spent := public.nexra_provider_live_spend_today(v_run.id) + coalesce(v_run.cost_usd, 0) + v_run.unknown_cost_usd;
    if v_spent + v_estimate > p_cap_usd then
      return pg_catalog.jsonb_build_object('outcome', 'cap-reached', 'spent_usd', v_spent, 'cap_usd', p_cap_usd, 'estimate_usd', v_estimate);
    end if;
  end if;

  perform pg_catalog.set_config('nexra.provider_write', v_run.id::text, true);
  update public.nexra_provider_runs
     set status = 'reserved',
         estimate_usd = coalesce(cost_usd, 0) + v_estimate,
         cost_usd = null,
         error_code = null,
         finished_at = null
   where id = p_run_id
  returning * into v_run;
  perform pg_catalog.set_config('nexra.provider_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'reserved', 'run', pg_catalog.to_jsonb(v_run), 'spent_usd', coalesce(v_spent, 0));
end;
$$;

comment on function public.nexra_provider_run_resume(uuid, numeric, numeric, uuid) is
  'Reopens a partial run for its missing calls under the same cap rule as reserve: reserved, cap-reached, run-active, run-not-partial or run-not-found. Never called by the system on its own (decision Q4).';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the three tables and executes the five functions.

revoke all on table public.nexra_provider_runs from public;
revoke all on table public.nexra_provider_requests from public;
revoke all on table public.nexra_keyword_metrics from public;
revoke all on function public.nexra_provider_run_reserve(text, text[], integer, text, text, text, numeric, numeric, uuid) from public;
revoke all on function public.nexra_provider_request_record(uuid, smallint, text, jsonb, text, integer, text, numeric, integer, text, timestamptz, timestamptz) from public;
revoke all on function public.nexra_provider_metrics_record(uuid, uuid, jsonb) from public;
revoke all on function public.nexra_provider_run_finish(uuid, text, numeric, numeric, text) from public;
revoke all on function public.nexra_provider_run_resume(uuid, numeric, numeric, uuid) from public;
revoke all on function public.nexra_provider_live_spend_today(uuid) from public;
revoke all on function public.nexra_provider_lock_day() from public;
revoke all on function public.nexra_provider_guard_insert() from public;
revoke all on function public.nexra_provider_runs_guard_update() from public;
revoke all on function public.nexra_provider_guard_immutable() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_provider_runs from %I', v_role);
      execute format('revoke all on table public.nexra_provider_requests from %I', v_role);
      execute format('revoke all on table public.nexra_keyword_metrics from %I', v_role);
      execute format('revoke all on function public.nexra_provider_run_reserve(text, text[], integer, text, text, text, numeric, numeric, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_provider_request_record(uuid, smallint, text, jsonb, text, integer, text, numeric, integer, text, timestamptz, timestamptz) from %I', v_role);
      execute format('revoke all on function public.nexra_provider_metrics_record(uuid, uuid, jsonb) from %I', v_role);
      execute format('revoke all on function public.nexra_provider_run_finish(uuid, text, numeric, numeric, text) from %I', v_role);
      execute format('revoke all on function public.nexra_provider_run_resume(uuid, numeric, numeric, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_provider_live_spend_today(uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_provider_lock_day() from %I', v_role);
      execute format('revoke all on function public.nexra_provider_guard_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_provider_runs_guard_update() from %I', v_role);
      execute format('revoke all on function public.nexra_provider_guard_immutable() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_provider_runs to service_role;
    grant select on table public.nexra_provider_requests to service_role;
    grant select on table public.nexra_keyword_metrics to service_role;
    grant execute on function public.nexra_provider_run_reserve(text, text[], integer, text, text, text, numeric, numeric, uuid) to service_role;
    grant execute on function public.nexra_provider_request_record(uuid, smallint, text, jsonb, text, integer, text, numeric, integer, text, timestamptz, timestamptz) to service_role;
    grant execute on function public.nexra_provider_metrics_record(uuid, uuid, jsonb) to service_role;
    grant execute on function public.nexra_provider_run_finish(uuid, text, numeric, numeric, text) to service_role;
    grant execute on function public.nexra_provider_run_resume(uuid, numeric, numeric, uuid) to service_role;
  end if;
end
$$;
