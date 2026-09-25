-- M1 P4c Search Console query × page rows: fixtures and helpers over c4/setup.sql and gsc/setup.sql (projects, t.ok(), t.err(), t.win_end()).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- A well-formed pair list of n entries: queries q1..qn over pages /p1../pn (each query on its own page), realistic metrics.
create function t.pairs(n int, page_prefix text default 'https://halcyon.example/p') returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('query', 'q' || i, 'page', page_prefix || i, 'clicks', i, 'impressions', i * 10, 'ctr', 0.1, 'position', 3.5 + i) order by i), '[]'::jsonb)
    from generate_series(1, n) i
$$;

-- One pair.
create function t.pair(q text, p text, clicks int default 1, impressions int default 10, ctr numeric default 0.1, pos numeric default 4.0) returns jsonb language sql immutable as $$
  select jsonb_build_object('query', q, 'page', p, 'clicks', clicks, 'impressions', impressions, 'ctr', ctr, 'position', pos)
$$;

-- Record a window's pairs with sensible defaults; every argument overridable.
create function t.qp(
  p_project text default 'halcyon-fintech',
  p_property text default 'sc-domain:halcyon.example',
  p_end date default null,
  p_start date default null,
  p_pairs jsonb default null,
  p_range text default '30d',
  p_fetched timestamptz default null
) returns jsonb language sql as $$
  select public.nexra_search_console_query_pages_record(
    p_project, p_property, p_range,
    coalesce(p_start, coalesce(p_end, t.win_end()) - 29), coalesce(p_end, t.win_end()),
    coalesce(p_pairs, t.pairs(3)), coalesce(p_fetched, now() - interval '1 minute'))
$$;

grant execute on all functions in schema t to service_role;
