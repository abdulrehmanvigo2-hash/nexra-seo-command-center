-- M2 crawl content signals: sections A (schema), B (behaviour of the new columns), C (privileges), D (T5 untouched).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- A: schema. Nine nullable page columns, prefixed constraints, nothing else new,
-- and the findings category set widened by exactly 'content'.
do $$
declare cols text[]; nn text[]; cons text[]; cats text;
begin
  select array_agg(column_name || ':' || data_type order by column_name) into cols from information_schema.columns
    where table_schema = 'public' and table_name = 'nexra_crawl_pages'
      and column_name in ('word_count', 'html_lang', 'hreflang_count', 'hreflang_malformed', 'og_tag_count', 'og_title', 'og_image', 'twitter_card', 'response_ms');
  perform t.ok(cols = array['hreflang_count:integer', 'hreflang_malformed:integer', 'html_lang:text', 'og_image:text', 'og_tag_count:integer', 'og_title:text', 'response_ms:integer', 'twitter_card:text', 'word_count:integer'],
    'A pages: the nine M2 columns with their types: ' || coalesce(cols::text, 'none'));
  select array_agg(column_name order by column_name) into nn from information_schema.columns
    where table_schema = 'public' and table_name = 'nexra_crawl_pages' and is_nullable = 'NO'
      and column_name in ('word_count', 'html_lang', 'hreflang_count', 'hreflang_malformed', 'og_tag_count', 'og_title', 'og_image', 'twitter_card', 'response_ms');
  perform t.ok(nn is null, 'A pages: every M2 column is nullable (null means not recorded)');
  perform t.ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'nexra_crawl_pages' and column_default is not null
      and column_name in ('word_count', 'html_lang', 'hreflang_count', 'hreflang_malformed', 'og_tag_count', 'og_title', 'og_image', 'twitter_card', 'response_ms')) = 0,
    'A pages: no M2 column has a default');
  select array_agg(conname order by conname) into cons from pg_constraint
    where conrelid = 'public.nexra_crawl_pages'::regclass and contype = 'c'
      and (conname like '%word_count%' or conname like '%html_lang%' or conname like '%hreflang%' or conname like '%og_%' or conname like '%twitter_card%' or conname like '%response_ms%' or conname like '%unreached_content%');
  perform t.ok(cons = array['nexra_crawl_pages_hreflang_count_positive', 'nexra_crawl_pages_hreflang_malformed_bounded', 'nexra_crawl_pages_hreflang_malformed_positive', 'nexra_crawl_pages_html_lang_length',
      'nexra_crawl_pages_og_image_length', 'nexra_crawl_pages_og_tag_count_positive', 'nexra_crawl_pages_og_title_length', 'nexra_crawl_pages_response_ms_positive', 'nexra_crawl_pages_twitter_card_length',
      'nexra_crawl_pages_unreached_content_signals_null', 'nexra_crawl_pages_word_count_positive'],
    'A pages: the eleven M2 check constraints, all prefixed: ' || coalesce(cons::text, 'none'));
  perform t.ok((select count(*) from pg_policies where schemaname = 'public' and tablename in ('nexra_crawl_pages', 'nexra_crawl_links', 'nexra_crawl_findings')) = 0,
    'A no policy on pages, links or findings');
  perform t.ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.nexra_crawl_pages'::regclass, 'public.nexra_crawl_links'::regclass, 'public.nexra_crawl_findings'::regclass)),
    'A RLS still enabled on pages, links and findings');
  perform t.ok((select count(*) from pg_trigger where tgrelid in ('public.nexra_crawl_pages'::regclass, 'public.nexra_crawl_links'::regclass) and not tgisinternal) = 0,
    'A no trigger added to pages or links');
  perform t.ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'nexra_crawl_links'
      and column_name in ('word_count', 'html_lang', 'hreflang_count', 'hreflang_malformed', 'og_tag_count', 'og_title', 'og_image', 'twitter_card', 'response_ms')) = 0
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'nexra_crawl_links' and column_name = 'anchor_text'),
    'A links: no M2 column added; the T5 anchor_text column stands');
  select pg_get_constraintdef(oid) into cats from pg_constraint where conrelid = 'public.nexra_crawl_findings'::regclass and conname = 'nexra_crawl_findings_category_valid';
  perform t.ok(cats like '%''content''%' and cats like '%''images''%' and cats like '%''metadata''%' and cats not like '%''vitals''%',
    'A findings: the category constraint admits content beside the T5 set: ' || coalesce(cats, 'none'));
  perform t.ok(t.frec(p_version => 3::smallint, p_findings => jsonb_build_array(t.finding(p_key => 'thin-page-candidate:0123456789abcdef', p_rule => 'thin-page-candidate', p_category => 'content', p_severity => 'low',
      p_observed => '{"wordCount": 40, "threshold": 150}', p_message => 'The page''s fetched HTML carries 40 visible word(s), under the 150-word review threshold: a thin-page candidate for review, not a verdict.')), p_counts => '{"thin-page-candidate": 1}')->>'outcome' = 'created',
    'A findings: a content finding records through the T3 function as rule version 3');
  perform t.ok(t.ferr($q$select t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000002', p_findings => jsonb_build_array(t.finding(p_category => 'vitals')))$q$) = '23514',
    'A findings: an unknown category is still refused (23514)');
end $$;

-- B: the columns behave. Null stays null; every refusal writes nothing.
do $$
declare v_id uuid; r record;
begin
  insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, http_status)
    values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/old', 'fetched', 200) returning id into v_id;
  select * into r from public.nexra_crawl_pages where id = v_id;
  perform t.ok(r.word_count is null and r.html_lang is null and r.hreflang_count is null and r.hreflang_malformed is null and r.og_tag_count is null and r.og_title is null and r.og_image is null and r.twitter_card is null and r.response_ms is null,
    'B a page written without the M2 columns (a pre-M2 writer) keeps them all null');
  v_id := t.cpage('https://halcyon.example/new', p_words => 640, p_lang => 'en-GB', p_hreflang => 3, p_malformed => 1, p_og => 4, p_og_title => 'Halcyon', p_og_image => 'https://halcyon.example/og.png', p_twitter => 'summary_large_image', p_ms => 312);
  select * into r from public.nexra_crawl_pages where id = v_id;
  perform t.ok(r.word_count = 640 and r.html_lang = 'en-GB' and r.hreflang_count = 3 and r.hreflang_malformed = 1 and r.og_tag_count = 4 and r.og_title = 'Halcyon' and r.og_image = 'https://halcyon.example/og.png' and r.twitter_card = 'summary_large_image' and r.response_ms = 312,
    'B a page written with the M2 signals reads them back exactly');
  v_id := t.cpage('https://halcyon.example/empty-lang', p_words => 0, p_lang => '', p_hreflang => 0, p_malformed => 0, p_og => 0, p_ms => 0);
  select * into r from public.nexra_crawl_pages where id = v_id;
  perform t.ok(r.word_count = 0 and r.html_lang = '' and r.hreflang_count = 0 and r.og_tag_count = 0 and r.response_ms = 0 and r.og_title is null and r.twitter_card is null,
    'B zero counts and an empty lang are stored as such, apart from null');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n1', p_words => -1)$q$) = '23514', 'B a negative word_count is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n2', p_hreflang => -1)$q$) = '23514', 'B a negative hreflang_count is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n3', p_malformed => -1)$q$) = '23514', 'B a negative hreflang_malformed is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n4', p_og => -1)$q$) = '23514', 'B a negative og_tag_count is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n5', p_ms => -1)$q$) = '23514', 'B a negative response_ms is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n6', p_hreflang => 2, p_malformed => 3)$q$) = '23514', 'B more malformed alternates than alternates is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n7', p_malformed => 3)$q$) = 'none', 'B hreflang_malformed beside an unknown hreflang_count is accepted');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n8', p_lang => repeat('x', 65))$q$) = '23514', 'B a 65-character html_lang is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n9', p_lang => repeat('x', 64))$q$) = 'none', 'B a 64-character html_lang is accepted');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n10', p_og_title => repeat('x', 1001))$q$) = '23514', 'B a 1,001-character og_title is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n11', p_og_image => repeat('x', 2049))$q$) = '23514', 'B a 2,049-character og_image is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n12', p_twitter => repeat('x', 65))$q$) = '23514', 'B a 65-character twitter_card is refused (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n13', p_state => 'budget-skipped', p_words => 0)$q$) = '23514', 'B a URL never reached cannot carry a word count, not even a zero (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n14', p_state => 'budget-skipped', p_ms => 1)$q$) = '23514', 'B a URL never reached cannot carry a response time (23514)');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/n15', p_state => 'budget-skipped')$q$) = 'none', 'B a URL never reached with every signal null is accepted');
  perform t.ok((select count(*) from public.nexra_crawl_pages where url ~ '^https://halcyon\.example/n[0-9]+$') = 3, 'B every refusal wrote nothing: only the three accepted rows exist');
  perform t.ok(t.ferr($q$select t.cpage('https://halcyon.example/pdf', p_state => 'non-html', p_ms => 90)$q$) = 'none', 'B a non-HTML response may carry a response time and no content signal');
end $$;

-- C: privileges. service_role's existing table grants cover the new columns; the API roles get nothing.
do $$
begin
  perform t.ok(has_column_privilege('service_role', 'public.nexra_crawl_pages', 'word_count', 'SELECT') and has_column_privilege('service_role', 'public.nexra_crawl_pages', 'response_ms', 'INSERT'),
    'C service_role may read and write the M2 page columns');
  perform t.ok(not has_table_privilege('anon', 'public.nexra_crawl_pages', 'SELECT') and not has_table_privilege('authenticated', 'public.nexra_crawl_pages', 'SELECT'),
    'C anon and authenticated cannot read pages');
end $$;

set role service_role;
do $$
declare v_id uuid;
begin
  insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, http_status, word_count, html_lang, og_tag_count, response_ms)
    values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/svc', 'fetched', 200, 120, 'en', 0, 250) returning id into v_id;
  perform t.ok(v_id is not null, 'C as service_role: a page with the M2 columns inserts');
  perform t.ok((select word_count || '/' || html_lang || '/' || og_tag_count || '/' || response_ms from public.nexra_crawl_pages where id = v_id) = '120/en/0/250',
    'C as service_role: the M2 columns read back');
end $$;
reset role;

-- D: the T5 columns and constraints are exactly as before.
do $$
declare cons text[];
begin
  select array_agg(conname order by conname) into cons from pg_constraint
    where conrelid = 'public.nexra_crawl_pages'::regclass and contype = 'c'
      and (conname like '%x_robots_tag%' or conname like '%h2_count%' or conname like '%h3_count%' or conname like '%image_count%' or conname like '%images_without_alt%' or conname like '%unreached_signals%');
  perform t.ok(cons = array['nexra_crawl_pages_h2_count_positive', 'nexra_crawl_pages_h3_count_positive', 'nexra_crawl_pages_image_count_positive',
      'nexra_crawl_pages_images_without_alt_bounded', 'nexra_crawl_pages_images_without_alt_positive', 'nexra_crawl_pages_unreached_signals_null', 'nexra_crawl_pages_x_robots_tag_length'],
    'D the seven T5 constraints are untouched');
  perform t.ok(t.ferr($q$insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, http_status, h2_count, image_count, images_without_alt, x_robots_tag, word_count)
      values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/both', 'fetched', 200, 2, 1, 1, 'noindex', 300)$q$) = 'none',
    'D a page records T5 and M2 signals together');
  perform t.ok(t.ferr($q$insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, image_count, images_without_alt)
      values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/t5bad', 'fetched', 1, 2)$q$) = '23514',
    'D the T5 images bound still refuses (23514)');
end $$;
