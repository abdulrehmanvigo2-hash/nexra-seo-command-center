-- T3 crawl findings: fixtures and helpers over c4/setup.sql (projects, t.ok()).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- Crawls in every state a recording can meet. Fixed ids so the tests can name them.
insert into nexra_crawls (id, project_id, start_url, host_scope, status, stop_reason, max_pages, max_depth, max_duration_ms, user_agent, robots_state, sitemap_state, pages_discovered, pages_fetched, pages_failed, error_code, error_message, created_by, started_at, finished_at) values
 ('c0000000-0000-4000-8000-000000000001', 'halcyon-fintech', 'https://halcyon.example/', 'halcyon.example', 'completed', 'completed', 50, 3, 60000, 'NexraBot/0.1', 'fetched', 'absent', 3, 3, 0, null, null, '00000000-0000-4000-8000-00000000000a', now() - interval '10 minutes', now() - interval '9 minutes'),
 ('c0000000-0000-4000-8000-000000000002', 'halcyon-fintech', 'https://halcyon.example/', 'halcyon.example', 'partial', 'page-budget', 50, 3, 60000, 'NexraBot/0.1', 'fetched', 'fetched', 60, 50, 1, null, null, '00000000-0000-4000-8000-00000000000a', now() - interval '8 minutes', now() - interval '7 minutes'),
 ('c0000000-0000-4000-8000-000000000003', 'halcyon-fintech', 'https://halcyon.example/', 'halcyon.example', 'running', null, 50, 3, 60000, 'NexraBot/0.1', 'unavailable', 'unavailable', 0, 0, 0, null, null, '00000000-0000-4000-8000-00000000000a', now() - interval '1 minute', null),
 ('c0000000-0000-4000-8000-000000000004', 'halcyon-fintech', 'https://halcyon.example/', 'halcyon.example', 'failed', 'error', 50, 3, 60000, 'NexraBot/0.1', 'unavailable', 'unavailable', 0, 0, 0, 'crawl-failed', 'The crawl stopped unexpectedly.', '00000000-0000-4000-8000-00000000000a', now() - interval '6 minutes', now() - interval '6 minutes'),
 ('c0000000-0000-4000-8000-000000000005', 'verdant-home', 'https://verdant.example/', 'verdant.example', 'completed', 'completed', 50, 3, 60000, 'NexraBot/0.1', 'fetched', 'fetched', 2, 2, 0, null, null, '00000000-0000-4000-8000-00000000000a', now() - interval '5 minutes', now() - interval '4 minutes');

-- One well-formed finding, every field overridable.
create function t.finding(
  p_key text default 'h1-missing:0123456789abcdef',
  p_rule text default 'h1-missing',
  p_category text default 'headings',
  p_severity text default 'medium',
  p_urls jsonb default '["https://halcyon.example/a"]',
  p_url_count integer default 1,
  p_observed jsonb default '{"h1Count": 0}',
  p_message text default 'The page has no H1.'
) returns jsonb language sql immutable as $$
  select jsonb_build_object('key', p_key, 'rule', p_rule, 'category', p_category, 'severity', p_severity,
    'urls', p_urls, 'urlCount', p_url_count, 'observed', p_observed, 'message', p_message)
$$;

-- n distinct h1-missing findings, keys and URLs numbered.
create function t.findings(n int) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(t.finding(p_key => 'h1-missing:' || lpad(to_hex(i), 16, '0'), p_urls => jsonb_build_array('https://halcyon.example/p' || i)) order by i), '[]'::jsonb)
    from generate_series(1, n) i
$$;

-- Record with sensible defaults; every argument overridable.
create function t.frec(
  p_project text default 'halcyon-fintech',
  p_crawl uuid default 'c0000000-0000-4000-8000-000000000001',
  p_version smallint default 1,
  p_findings jsonb default null,
  p_counts jsonb default null,
  p_pages_total integer default 3,
  p_pages_fetched integer default 3,
  p_pages_not_fetched integer default 0,
  p_pages_not_reached integer default 0,
  p_links_read integer default 4,
  p_links_cut boolean default false,
  p_truncated text[] default '{}'
) returns jsonb language sql as $$
  select public.nexra_crawl_findings_record(
    p_project, p_crawl, p_version,
    p_pages_total, p_pages_fetched, p_pages_not_fetched, p_pages_not_reached,
    p_links_read, p_links_cut,
    coalesce(p_counts, jsonb_build_object('h1-missing', coalesce(jsonb_array_length(coalesce(p_findings, t.findings(2))), 0))),
    p_truncated,
    coalesce(p_findings, t.findings(2)))
$$;

-- The SQLSTATE a statement raises, or 'none'.
create function t.ferr(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'none';
exception when others then
  return sqlstate;
end $$;

-- Section B runs one block as service_role: it may use the helpers, never a table directly.
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
