-- T5 upgrade, part 2: after the T5 migration applied over those rows.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.

\set ON_ERROR_STOP 1

do $$
declare r record;
begin
  perform t.ok((select count(*) from public.nexra_crawl_pages where crawl_id = 'c0000000-0000-4000-8000-000000000001') = 2, 'U the two pre-T5 pages survive the migration');
  select * into r from public.nexra_crawl_pages where url = 'https://halcyon.example/';
  perform t.ok(r.title = 'Halcyon' and r.h1_count = 1 and r.x_robots_tag is null and r.robots_noindex is null and r.robots_nofollow is null
      and r.h2_count is null and r.h3_count is null and r.image_count is null and r.images_without_alt is null,
    'U a pre-T5 fetched page keeps its readings and has every T5 column null (not recorded, not zero)');
  select * into r from public.nexra_crawl_pages where url = 'https://halcyon.example/unreached';
  perform t.ok(r.fetch_state = 'budget-skipped' and r.h2_count is null and r.x_robots_tag is null, 'U a pre-T5 unreached page satisfies the new constraint untouched');
  perform t.ok((select anchor_text is null from public.nexra_crawl_links where to_url = 'https://halcyon.example/unreached'), 'U a pre-T5 edge has a null anchor text');
  perform t.ok((select count(*) from public.nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000001') = 1, 'U the T3 report recorded before the migration survives');
  perform t.ok(t.ferr($q$insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, http_status, h2_count, h3_count, image_count, images_without_alt, x_robots_tag, robots_noindex, robots_nofollow)
      values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/after', 'fetched', 200, 2, 0, 1, 1, 'noindex', true, false)$q$) = 'none',
    'U after the migration a page records the T5 signals');
  perform t.ok(t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000002', p_version => 2::smallint, p_findings => jsonb_build_array(t.finding(p_key => 'image-alt-missing:0123456789abcdef', p_rule => 'image-alt-missing', p_category => 'images', p_severity => 'low',
      p_observed => '{"imageCount": 1, "imagesWithoutAlt": 1}', p_message => '1 of 1 images on the page have no alt attribute.')), p_counts => '{"image-alt-missing": 1}')->>'outcome' = 'created',
    'U after the migration a rule-version-2 report with an images finding records');
end $$;
