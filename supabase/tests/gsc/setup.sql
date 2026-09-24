-- M1 CP1a Search Console snapshots: fixtures and helpers over c4/setup.sql (projects, t.ok()).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- A well-formed row list of n entries, keys k1..kn (or a given key), realistic metrics.
create function t.rows(n int, key_prefix text default 'q') returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key_prefix || i, 'clicks', i, 'impressions', i * 10, 'ctr', 0.1, 'position', 3.5 + i) order by i), '[]'::jsonb)
    from generate_series(1, n) i
$$;

-- The 30-day window ending d days before today (default 3, as the application computes it).
create function t.win_end(d int default 3) returns date language sql stable as $$ select current_date - d $$;
create function t.win_start(d int default 3) returns date language sql stable as $$ select current_date - d - 29 $$;

-- Record a connected snapshot with sensible defaults; every argument overridable.
create function t.snap(
  p_project text default 'halcyon-fintech',
  p_property text default 'sc-domain:halcyon.example',
  p_end date default null,
  p_start date default null,
  p_state text default 'connected',
  p_clicks bigint default 120,
  p_impressions bigint default 4000,
  p_ctr numeric default 0.03,
  p_position numeric default 12.4,
  p_queries jsonb default null,
  p_pages jsonb default null,
  p_partial text[] default '{}',
  p_range text default '30d',
  p_fetched timestamptz default null
) returns jsonb language sql as $$
  select public.nexra_search_console_snapshot_record(
    p_project, p_property, p_range,
    coalesce(p_start, coalesce(p_end, t.win_end()) - 29), coalesce(p_end, t.win_end()),
    p_state, p_clicks, p_impressions, p_ctr, p_position,
    coalesce(p_queries, t.rows(25, 'q')), coalesce(p_pages, t.rows(25, 'https://halcyon.example/p')),
    p_partial, coalesce(p_fetched, now() - interval '1 minute'))
$$;

-- A no-data snapshot: every total null, empty lists.
create function t.snap_nodata(p_project text default 'halcyon-fintech', p_end date default null) returns jsonb language sql as $$
  select t.snap(p_project => p_project, p_end => p_end, p_state => 'no-data', p_clicks => null, p_impressions => null, p_ctr => null, p_position => null, p_queries => '[]', p_pages => '[]')
$$;

-- The SQLSTATE a call raises, or 'none'.
create function t.err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'none';
exception when others then
  return sqlstate;
end $$;

-- Section B runs one block as service_role: it may use the test helpers (t.ok, t.snap, t.err), never a table directly.
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
