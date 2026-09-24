-- T5 crawl signals: helpers over c4/setup.sql (projects, t.ok()) and findings/setup.sql (crawls, t.ferr(), t.frec()).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- One page row with the T5 columns as named arguments; a URL never reached carries no status.
create function t.spage(
  p_url text,
  p_state text default 'fetched',
  p_xrt text default null,
  p_noindex boolean default null,
  p_nofollow boolean default null,
  p_h2 integer default null,
  p_h3 integer default null,
  p_img integer default null,
  p_noalt integer default null,
  p_crawl uuid default 'c0000000-0000-4000-8000-000000000001'
) returns uuid language sql as $$
  insert into public.nexra_crawl_pages
    (crawl_id, url, fetch_state, http_status, x_robots_tag, robots_noindex, robots_nofollow, h2_count, h3_count, image_count, images_without_alt)
  values
    (p_crawl, p_url, p_state, case when p_state = 'budget-skipped' then null else 200 end, p_xrt, p_noindex, p_nofollow, p_h2, p_h3, p_img, p_noalt)
  returning id
$$;

-- One internal link row with an anchor text (null: an edge recorded before T5).
create function t.slink(p_from text, p_to text, p_anchor text default null, p_crawl uuid default 'c0000000-0000-4000-8000-000000000001')
returns uuid language sql as $$
  insert into public.nexra_crawl_links (crawl_id, from_url, to_url, rel, is_internal, anchor_text)
  values (p_crawl, p_from, p_to, null, true, p_anchor)
  returning id
$$;

grant execute on all functions in schema t to service_role;
