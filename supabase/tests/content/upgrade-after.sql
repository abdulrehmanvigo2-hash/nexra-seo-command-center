-- M2 upgrade, part 2: after the M2 migration applied over those rows.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.

\set ON_ERROR_STOP 1

do $$
declare r record;
begin
  perform t.ok((select count(*) from public.nexra_crawl_pages where crawl_id = 'c0000000-0000-4000-8000-000000000001') = 2, 'U the two pre-M2 pages survive the migration');
  select * into r from public.nexra_crawl_pages where url = 'https://halcyon.example/';
  perform t.ok(r.title = 'Halcyon' and r.h1_count = 1 and r.h2_count = 2 and r.image_count = 3 and r.images_without_alt = 1 and r.x_robots_tag = 'all'
      and r.word_count is null and r.html_lang is null and r.hreflang_count is null and r.hreflang_malformed is null and r.og_tag_count is null and r.og_title is null and r.og_image is null and r.twitter_card is null and r.response_ms is null,
    'U a pre-M2 fetched page keeps its T1–T5 readings and has every M2 column null (not recorded, not zero)');
  select * into r from public.nexra_crawl_pages where url = 'https://halcyon.example/unreached';
  perform t.ok(r.fetch_state = 'budget-skipped' and r.word_count is null and r.response_ms is null, 'U a pre-M2 unreached page satisfies the new constraint untouched');
  perform t.ok((select anchor_text = 'Unreached' from public.nexra_crawl_links where to_url = 'https://halcyon.example/unreached'), 'U a T5 edge keeps its anchor text');
  perform t.ok((select count(*) from public.nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000001' and rule_version = 2) = 1, 'U the rule-version-2 report recorded before the migration survives');
  perform t.ok(t.ferr($q$insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, http_status, word_count, html_lang, hreflang_count, hreflang_malformed, og_tag_count, og_title, twitter_card, response_ms)
      values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/after', 'fetched', 200, 900, 'en', 2, 0, 3, 'After', 'summary', 180)$q$) = 'none',
    'U after the migration a page records the M2 signals');
  perform t.ok(t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000002', p_version => 3::smallint, p_findings => jsonb_build_array(t.finding(p_key => 'thin-page-candidate:0123456789abcdef', p_rule => 'thin-page-candidate', p_category => 'content', p_severity => 'low',
      p_observed => '{"wordCount": 12, "threshold": 150}', p_message => 'The page''s fetched HTML carries 12 visible word(s), under the 150-word review threshold: a thin-page candidate for review, not a verdict.')), p_counts => '{"thin-page-candidate": 1}')->>'outcome' = 'created',
    'U after the migration a rule-version-3 report with a content finding records');
end $$;
