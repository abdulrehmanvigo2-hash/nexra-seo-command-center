-- T5 crawl signals: sections A (schema), B (behaviour of the new columns), C (privileges).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- A: schema. Seven nullable page columns, one link column, prefixed constraints,
-- nothing else new, and the findings category set widened by exactly 'images'.
do $$
declare cols text[]; nn text[]; cons text[]; cats text;
begin
  select array_agg(column_name || ':' || data_type order by column_name) into cols from information_schema.columns
    where table_schema = 'public' and table_name = 'nexra_crawl_pages'
      and column_name in ('x_robots_tag', 'robots_noindex', 'robots_nofollow', 'h2_count', 'h3_count', 'image_count', 'images_without_alt');
  perform t.ok(cols = array['h2_count:smallint', 'h3_count:smallint', 'image_count:integer', 'images_without_alt:integer', 'robots_nofollow:boolean', 'robots_noindex:boolean', 'x_robots_tag:text'],
    'A pages: the seven T5 columns with their types: ' || coalesce(cols::text, 'none'));
  select array_agg(column_name order by column_name) into nn from information_schema.columns
    where table_schema = 'public' and table_name = 'nexra_crawl_pages' and is_nullable = 'NO'
      and column_name in ('x_robots_tag', 'robots_noindex', 'robots_nofollow', 'h2_count', 'h3_count', 'image_count', 'images_without_alt');
  perform t.ok(nn is null, 'A pages: every T5 column is nullable (null means not recorded)');
  perform t.ok((select data_type || '/' || is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'nexra_crawl_links' and column_name = 'anchor_text') = 'text/YES',
    'A links: anchor_text is text and nullable');
  select array_agg(conname order by conname) into cons from pg_constraint
    where conrelid = 'public.nexra_crawl_pages'::regclass and contype = 'c'
      and (conname like '%x_robots_tag%' or conname like '%h2_count%' or conname like '%h3_count%' or conname like '%image_count%' or conname like '%images_without_alt%' or conname like '%unreached_signals%');
  perform t.ok(cons = array['nexra_crawl_pages_h2_count_positive', 'nexra_crawl_pages_h3_count_positive', 'nexra_crawl_pages_image_count_positive',
      'nexra_crawl_pages_images_without_alt_bounded', 'nexra_crawl_pages_images_without_alt_positive', 'nexra_crawl_pages_unreached_signals_null', 'nexra_crawl_pages_x_robots_tag_length'],
    'A pages: the seven T5 check constraints, all prefixed: ' || coalesce(cons::text, 'none'));
  perform t.ok(exists (select 1 from pg_constraint where conrelid = 'public.nexra_crawl_links'::regclass and contype = 'c' and conname = 'nexra_crawl_links_anchor_text_length'),
    'A links: the anchor_text length constraint, prefixed');
  perform t.ok((select count(*) from pg_policies where schemaname = 'public' and tablename in ('nexra_crawl_pages', 'nexra_crawl_links', 'nexra_crawl_findings')) = 0,
    'A no policy on pages, links or findings');
  perform t.ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.nexra_crawl_pages'::regclass, 'public.nexra_crawl_links'::regclass, 'public.nexra_crawl_findings'::regclass)),
    'A RLS still enabled on pages, links and findings');
  perform t.ok((select count(*) from pg_trigger where tgrelid in ('public.nexra_crawl_pages'::regclass, 'public.nexra_crawl_links'::regclass) and not tgisinternal) = 0,
    'A no trigger added to pages or links');
  select pg_get_constraintdef(oid) into cats from pg_constraint where conrelid = 'public.nexra_crawl_findings'::regclass and conname = 'nexra_crawl_findings_category_valid';
  perform t.ok(cats like '%''images''%' and cats like '%''metadata''%' and cats like '%''schema''%' and cats not like '%''vitals''%',
    'A findings: the category constraint admits images beside the T3 set: ' || coalesce(cats, 'none'));
  perform t.ok(t.frec(p_findings => jsonb_build_array(t.finding(p_key => 'image-alt-missing:0123456789abcdef', p_rule => 'image-alt-missing', p_category => 'images', p_severity => 'low',
      p_observed => '{"imageCount": 3, "imagesWithoutAlt": 1}', p_message => '1 of 3 images on the page have no alt attribute.')), p_counts => '{"image-alt-missing": 1}')->>'outcome' = 'created',
    'A findings: an images finding records through the T3 function');
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
  perform t.ok(r.x_robots_tag is null and r.robots_noindex is null and r.robots_nofollow is null and r.h2_count is null and r.h3_count is null and r.image_count is null and r.images_without_alt is null,
    'B a page written without the T5 columns (a pre-T5 writer) keeps them all null');
  v_id := t.spage('https://halcyon.example/new', p_xrt => 'noindex, nofollow', p_noindex => true, p_nofollow => true, p_h2 => 4, p_h3 => 2, p_img => 6, p_noalt => 1);
  select * into r from public.nexra_crawl_pages where id = v_id;
  perform t.ok(r.x_robots_tag = 'noindex, nofollow' and r.robots_noindex and r.robots_nofollow and r.h2_count = 4 and r.h3_count = 2 and r.image_count = 6 and r.images_without_alt = 1,
    'B a page written with the T5 signals reads them back exactly');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n1', p_h2 => -1)$q$) = '23514', 'B a negative h2_count is refused (23514)');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n2', p_h3 => -1)$q$) = '23514', 'B a negative h3_count is refused (23514)');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n3', p_img => -1)$q$) = '23514', 'B a negative image_count is refused (23514)');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n4', p_noalt => -1)$q$) = '23514', 'B a negative images_without_alt is refused (23514)');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n5', p_img => 2, p_noalt => 3)$q$) = '23514', 'B more images without alt than images is refused (23514)');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n6', p_noalt => 3)$q$) = 'none', 'B images_without_alt beside an unknown image_count is accepted');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n7', p_xrt => repeat('x', 201))$q$) = '23514', 'B a 201-character X-Robots-Tag is refused (23514)');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n8', p_xrt => repeat('x', 200))$q$) = 'none', 'B a 200-character X-Robots-Tag is accepted');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n9', p_state => 'budget-skipped', p_h2 => 0)$q$) = '23514', 'B a URL never reached cannot carry a signal, not even a zero (23514)');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/n10', p_state => 'budget-skipped')$q$) = 'none', 'B a URL never reached with every signal null is accepted');
  perform t.ok((select count(*) from public.nexra_crawl_pages where url ~ '^https://halcyon\.example/n[0-9]+$') = 3, 'B every refusal wrote nothing: only the three accepted rows exist');
  perform t.ok(t.ferr($q$select t.spage('https://halcyon.example/f1', p_noindex => true, p_nofollow => false), t.spage('https://halcyon.example/f2', p_noindex => false), t.spage('https://halcyon.example/f3')$q$) = 'none',
    'B robots_noindex and robots_nofollow record true, false and null alike');
  perform t.slink('https://halcyon.example/new', 'https://halcyon.example/l1', '');
  perform t.ok((select anchor_text from public.nexra_crawl_links where to_url = 'https://halcyon.example/l1') = '', 'B an empty anchor text is stored as empty, not as null');
  perform t.slink('https://halcyon.example/new', 'https://halcyon.example/l2', null);
  perform t.ok((select anchor_text is null from public.nexra_crawl_links where to_url = 'https://halcyon.example/l2'), 'B a null anchor text (an edge from before T5) is stored as null');
  perform t.ok(t.ferr($q$select t.slink('https://halcyon.example/new', 'https://halcyon.example/l3', repeat('a', 201))$q$) = '23514', 'B a 201-character anchor text is refused (23514)');
  perform t.ok(t.ferr($q$select t.slink('https://halcyon.example/new', 'https://halcyon.example/l4', repeat('a', 200))$q$) = 'none', 'B a 200-character anchor text is accepted');
end $$;

-- C: privileges. service_role's existing table grants cover the new columns; the API roles get nothing.
do $$
begin
  perform t.ok(has_column_privilege('service_role', 'public.nexra_crawl_pages', 'x_robots_tag', 'SELECT') and has_column_privilege('service_role', 'public.nexra_crawl_pages', 'images_without_alt', 'INSERT'),
    'C service_role may read and write the T5 page columns');
  perform t.ok(has_column_privilege('service_role', 'public.nexra_crawl_links', 'anchor_text', 'INSERT'), 'C service_role may write anchor_text');
  perform t.ok(not has_table_privilege('anon', 'public.nexra_crawl_pages', 'SELECT') and not has_table_privilege('authenticated', 'public.nexra_crawl_pages', 'SELECT'),
    'C anon and authenticated cannot read pages');
  perform t.ok(not has_table_privilege('anon', 'public.nexra_crawl_links', 'SELECT') and not has_table_privilege('authenticated', 'public.nexra_crawl_links', 'INSERT'),
    'C anon and authenticated cannot read or write links');
end $$;

set role service_role;
do $$
declare v_id uuid;
begin
  insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, http_status, h2_count, image_count, images_without_alt, x_robots_tag)
    values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/svc', 'fetched', 200, 1, 2, 0, 'all') returning id into v_id;
  perform t.ok(v_id is not null, 'C as service_role: a page with the T5 columns inserts');
  perform t.ok((select h2_count || '/' || image_count || '/' || images_without_alt || '/' || x_robots_tag from public.nexra_crawl_pages where id = v_id) = '1/2/0/all',
    'C as service_role: the T5 columns read back');
  insert into public.nexra_crawl_links (crawl_id, from_url, to_url, rel, is_internal, anchor_text)
    values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/svc', 'https://halcyon.example/t', null, true, 'Services');
  perform t.ok((select anchor_text from public.nexra_crawl_links where to_url = 'https://halcyon.example/t') = 'Services', 'C as service_role: anchor_text writes and reads');
end $$;
reset role;
