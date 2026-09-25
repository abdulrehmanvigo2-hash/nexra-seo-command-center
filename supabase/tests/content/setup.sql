-- M2 crawl content signals: helpers over c4/setup.sql (projects, t.ok()) and findings/setup.sql (crawls, t.ferr(), t.frec(), t.finding()).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- One page row with the M2 columns as named arguments; a URL never reached carries no status.
create function t.cpage(
  p_url text,
  p_state text default 'fetched',
  p_words integer default null,
  p_lang text default null,
  p_hreflang integer default null,
  p_malformed integer default null,
  p_og integer default null,
  p_og_title text default null,
  p_og_image text default null,
  p_twitter text default null,
  p_ms integer default null,
  p_crawl uuid default 'c0000000-0000-4000-8000-000000000001'
) returns uuid language sql as $$
  insert into public.nexra_crawl_pages
    (crawl_id, url, fetch_state, http_status, word_count, html_lang, hreflang_count, hreflang_malformed, og_tag_count, og_title, og_image, twitter_card, response_ms)
  values
    (p_crawl, p_url, p_state, case when p_state = 'budget-skipped' then null else 200 end, p_words, p_lang, p_hreflang, p_malformed, p_og, p_og_title, p_og_image, p_twitter, p_ms)
  returning id
$$;

grant execute on all functions in schema t to service_role;
