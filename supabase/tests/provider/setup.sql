-- F0 provider keyword snapshot (migration 20261016120000): helpers over c4/setup.sql and gsc/setup.sql (projects
-- halcyon-fintech and verdant-home, t.ok, t.err). Part of the local PostgreSQL test harness; run only through
-- supabase/tests/run.sh, which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

create function t.pop() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000aa'::uuid $$;
create function t.seeds(n int default 3) returns text[] language sql immutable as $$ select array_agg('seed ' || i order by i) from generate_series(1, n) i $$;
create function t.host(p_mode text) returns text language sql immutable as $$ select case when p_mode = 'live' then 'api.dataforseo.com' else 'sandbox.dataforseo.com' end $$;

-- Reserve a run; every argument overridable. The host follows the mode unless given.
create function t.reserve(p_project text default 'halcyon-fintech', p_mode text default 'live', p_estimate numeric default 0.16, p_cap numeric default 1.00,
  p_seeds text[] default null, p_host text default null, p_location int default 2840, p_language text default 'en', p_by uuid default null) returns jsonb language sql as $$
  select public.nexra_provider_run_reserve(p_project, coalesce(p_seeds, t.seeds()), p_location, p_language, p_mode, coalesce(p_host, t.host(p_mode)),
    p_estimate, p_cap, coalesce(p_by, t.pop())) $$;
create function t.rid(r jsonb) returns uuid language sql immutable as $$ select (r->'run'->>'id')::uuid $$;
create function t.run(p_id uuid) returns public.nexra_provider_runs language sql as $$ select * from public.nexra_provider_runs where id = p_id $$;

-- Record one call; a succeeded call carries cost, items, hash and received time by default.
create function t.req(p_run uuid, p_seq int default 0, p_outcome text default 'succeeded', p_cost numeric default 0.013, p_endpoint text default null,
  p_params jsonb default null, p_items int default 10, p_sha text default null, p_received timestamptz default null, p_status int default 20000, p_task text default 'task-1') returns jsonb language sql as $$
  select public.nexra_provider_request_record(p_run, p_seq::smallint,
    coalesce(p_endpoint, case when p_seq = 0 then 'dataforseo_labs/google/keyword_overview/live' else 'dataforseo_labs/google/related_keywords/live' end),
    coalesce(p_params, jsonb_build_object('keywords', t.seeds(), 'location_code', 2840, 'language_code', 'en', 'limit', 20, 'depth', 1)),
    p_outcome, p_status, p_task,
    case when p_outcome = 'unknown' then null else p_cost end,
    case when p_outcome = 'succeeded' then p_items end,
    case when p_outcome = 'succeeded' then coalesce(p_sha, repeat('c', 64)) end,
    now() - interval '2 seconds', case when p_outcome = 'unknown' then null else coalesce(p_received, now() - interval '1 second') end) $$;
create function t.qid(r jsonb) returns uuid language sql immutable as $$ select (r->'request'->>'id')::uuid $$;

-- Well-formed metric rows: the n seeds as seed rows, each with m related keywords.
create function t.mrows(n int default 3, m int default 2) returns jsonb language sql immutable as $$
  select jsonb_agg(row_ order by row_->>'seed', row_->>'keyword') from (
    select jsonb_build_object('seed', 'seed ' || i, 'keyword', 'seed ' || i, 'relation', 'seed', 'search_volume', 100 * i, 'cpc', 1.5, 'competition', 0.42,
      'keyword_difficulty', 30 + i, 'intent', 'informational', 'monthly_searches', '[{"year":2026,"month":8,"search_volume":90}]'::jsonb, 'provider_updated_at', '2026-09-30T00:00:00Z') row_
      from generate_series(1, n) i
    union all
    select jsonb_build_object('seed', 'seed ' || i, 'keyword', 'seed ' || i || ' related ' || j, 'relation', 'related', 'search_volume', 10 * j, 'cpc', null, 'competition', null, 'keyword_difficulty', null, 'intent', null)
      from generate_series(1, n) i, generate_series(1, m) j) s $$;
create function t.metrics(p_run uuid, p_req uuid, p_rows jsonb default null) returns jsonb language sql as $$
  select public.nexra_provider_metrics_record(p_run, p_req, coalesce(p_rows, t.mrows())) $$;

create function t.finish(p_run uuid, p_status text default 'completed', p_cost numeric default null, p_unknown numeric default 0, p_error text default null) returns jsonb language sql as $$
  select public.nexra_provider_run_finish(p_run, p_status,
    coalesce(p_cost, (select coalesce(sum(cost_usd) filter (where outcome = 'succeeded'), 0) from public.nexra_provider_requests where run_id = p_run)), p_unknown, p_error) $$;
create function t.resume(p_run uuid, p_estimate numeric default 0.1, p_cap numeric default 1.00) returns jsonb language sql as $$
  select public.nexra_provider_run_resume(p_run, p_estimate, p_cap, t.pop()) $$;

-- A finished live run on a project with a given recorded cost: reserve, one succeeded call at that cost, finish.
create function t.spent(p_project text, p_cost numeric, p_status text default 'completed', p_unknown numeric default 0) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := t.rid(t.reserve(p_project, 'live', p_cost + p_unknown));
  perform t.req(v, 0, 'succeeded', p_cost);
  if p_unknown > 0 then perform t.req(v, 1, 'unknown'); end if;
  perform t.finish(v, p_status, p_cost, p_unknown);
  return v;
end $$;

grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
