-- Curated keywords (Phase 3, checkpoint 3.5): fixtures over c4/setup.sql (projects halcyon.example and
-- verdant.example, t.ok()) and gsc/setup.sql (t.snap(), t.err()).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- Stored Search Console evidence, to show a curated keyword is never checked against it.
select t.ok((t.snap(p_queries => '[{"key":"business banking","clicks":40,"impressions":900,"ctr":0.0444,"position":8.2}]',
  p_pages => '[{"key":"https://halcyon.example/","clicks":50,"impressions":1200,"ctr":0.0417,"position":3.0}]')->>'outcome') = 'created', 'setup: halcyon snapshot recorded');

create function t.kop() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000bb'::uuid $$;

create function t.kadd(
  p_query text default 'business banking',
  p_project text default 'halcyon-fintech',
  p_group text default null,
  p_note text default null,
  p_target text default null,
  p_operator uuid default null
) returns jsonb language sql as $$
  select public.nexra_keyword_add(p_project, p_query, p_group, p_note, p_target, coalesce(p_operator, t.kop()))
$$;

create function t.kid(p_query text default 'business banking', p_project text default 'halcyon-fintech') returns uuid language sql stable as $$
  select id from public.nexra_keywords where project_id = p_project and query = p_query
$$;

grant execute on all functions in schema t to service_role;
