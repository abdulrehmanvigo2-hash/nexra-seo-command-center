-- M2 upgrade, part 1: rows written before the M2 migration, on a database that stops at M1 P4c.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.

\set ON_ERROR_STOP 1

insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, http_status, title, title_length, h1_count, h2_count, image_count, images_without_alt, x_robots_tag)
  values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'fetched', 200, 'Halcyon', 7, 1, 2, 3, 1, 'all');
insert into public.nexra_crawl_pages (crawl_id, url, fetch_state)
  values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/unreached', 'budget-skipped');
insert into public.nexra_crawl_links (crawl_id, from_url, to_url, rel, is_internal, anchor_text)
  values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/unreached', null, true, 'Unreached');
select t.frec(p_version => 2::smallint, p_findings => jsonb_build_array(t.finding(p_key => 'image-alt-missing:0123456789abcdef', p_rule => 'image-alt-missing', p_category => 'images', p_severity => 'low',
  p_observed => '{"imageCount": 3, "imagesWithoutAlt": 1}', p_message => '1 of 3 images on the page have no alt attribute.')), p_counts => '{"image-alt-missing": 1}');
