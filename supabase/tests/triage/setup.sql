-- M3 crawl finding triage: fixtures over c4/setup.sql (projects, t.ok()) and findings/setup.sql (crawls, t.frec()).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- Recorded findings to decide about: two h1-missing findings on halcyon's completed crawl (rule version 1),
-- the same two keys again on halcyon's partial crawl, and one on verdant's crawl.
select t.ok((t.frec()->>'outcome') = 'created', 'setup: halcyon crawl 1 recorded');
select t.ok((t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000002', p_pages_total => 60, p_pages_fetched => 50, p_pages_not_fetched => 1, p_pages_not_reached => 9)->>'outcome') = 'created', 'setup: halcyon crawl 2 recorded');
select t.ok((t.frec(p_project => 'verdant-home', p_crawl => 'c0000000-0000-4000-8000-000000000005', p_pages_total => 2, p_pages_fetched => 2,
  p_findings => jsonb_build_array(t.finding(p_key => 'title-missing:00000000000000aa', p_rule => 'title-missing', p_category => 'metadata', p_severity => 'high', p_urls => '["https://verdant.example/"]', p_observed => '{"title": null}', p_message => 'The page has no title.')),
  p_counts => '{"title-missing": 1}')->>'outcome') = 'created', 'setup: verdant crawl 5 recorded');

-- The first h1-missing key t.findings() numbers, and the operator who decides.
create function t.key1() returns text language sql immutable as $$ select 'h1-missing:' || lpad(to_hex(1), 16, '0') $$;
create function t.key2() returns text language sql immutable as $$ select 'h1-missing:' || lpad(to_hex(2), 16, '0') $$;
create function t.op() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000aa'::uuid $$;

-- Set with sensible defaults; every argument overridable.
create function t.tset(
  p_project text default 'halcyon-fintech',
  p_crawl uuid default 'c0000000-0000-4000-8000-000000000001',
  p_key text default null,
  p_status text default 'acknowledged',
  p_note text default null,
  p_operator uuid default null
) returns jsonb language sql as $$
  select public.nexra_crawl_finding_triage_set(p_project, p_crawl, coalesce(p_key, t.key1()), p_status, p_note, coalesce(p_operator, t.op()))
$$;

-- The SQLSTATE a statement raises, or 'none'.
create function t.tstate(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'none';
exception when others then
  return sqlstate;
end $$;

-- Section B runs one block as service_role: it may use the helpers, never a table directly.
grant execute on all functions in schema t to service_role;
