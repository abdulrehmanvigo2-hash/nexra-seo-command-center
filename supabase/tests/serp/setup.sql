-- M4 SERP results (migration 20261024120000): helpers over the c4, gsc, tasks, provider, topic-maps and opportunities
-- setups (t.ok, t.err, t.pop, t.req, t.finish, t19.*, t21.*). Part of the local PostgreSQL test harness; run only through
-- supabase/tests/run.sh, which creates and destroys its own disposable cluster. Never run against a hosted database.
\set ON_ERROR_STOP 1
create schema t24;

-- An accepted write opportunity on cluster 1 (primary keyword "seed 1") of a fresh approved map on the project.
create function t24.opp(p_project text default 'halcyon-fintech') returns uuid language plpgsql as $$
declare m uuid; r jsonb;
begin
  m := t21.map(p_project);
  r := t21.accept(t21.opp(m, t21.cid(m, 1)), p_project);
  if r->>'outcome' <> 'accepted' then raise exception 't24.opp: %', r; end if;
  return (r->'opportunity'->>'id')::uuid;
end $$;
create function t24.reserve(p_opp uuid, p_project text default 'halcyon-fintech', p_mode text default 'live', p_estimate numeric default 0.0024,
  p_cap numeric default 1.00, p_host text default null) returns jsonb language sql as $$
  select public.nexra_provider_serp_reserve(p_project, p_opp, 2840, 'en', p_mode, coalesce(p_host, t.host(p_mode)), p_estimate, p_cap, t.pop()) $$;
create function t24.params() returns jsonb language sql immutable as $$
  select jsonb_build_object('keyword', 'seed 1', 'location_code', 2840, 'language_code', 'en', 'depth', 10) $$;
create function t24.req(p_run uuid, p_seq int default 0, p_outcome text default 'succeeded', p_cost numeric default 0.002) returns jsonb language sql as $$
  select t.req(p_run, p_seq, p_outcome, p_cost, 'serp/google/organic/live/advanced', t24.params(), 12) $$;
-- Well-formed rows: n organic results, two questions (the second with its answer's URL), two related searches.
create function t24.rows(n int default 3) returns jsonb language sql immutable as $$
  select jsonb_agg(x) from (
    select jsonb_build_object('type', 'organic', 'rank', i, 'url', 'https://example' || i || '.com/page', 'domain', 'example' || i || '.com',
      'title', 'Result ' || i, 'snippet', 'Snippet ' || i) x from generate_series(1, n) i
    union all select jsonb_build_object('type', 'people-also-ask', 'rank', 1, 'title', 'What is seed 1?')
    union all select jsonb_build_object('type', 'people-also-ask', 'rank', 2, 'title', 'Why seed 1?', 'url', 'https://answers.example/why')
    union all select jsonb_build_object('type', 'related-search', 'rank', 1, 'title', 'seed 1 tools')
    union all select jsonb_build_object('type', 'related-search', 'rank', 2, 'title', 'seed 1 price')) s $$;
create function t24.record(p_run uuid, p_req uuid, p_rows jsonb default null) returns jsonb language sql as $$
  select public.nexra_provider_serp_record(p_run, p_req, coalesce(p_rows, t24.rows())) $$;

grant usage on schema t24 to service_role;
grant execute on all functions in schema t24 to service_role;
