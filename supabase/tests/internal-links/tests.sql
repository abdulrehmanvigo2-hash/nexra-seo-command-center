-- M8 internal links (migration 20261027120000): sections A (schema and security), B (page texts: own-site, fetched,
-- computed, immutable, cascade), C (the task function). Over c4/setup.sql (projects, t.ok) and findings/setup.sql
-- (crawls c…01–c…05). Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh. Never run
-- against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t27;
create function t27.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'no error'; exception when others then return sqlstate; end $$;
grant usage on schema t27 to service_role;
grant execute on all functions in schema t27 to service_role;

-- Fixtures: pages for own-site crawl c…01 (halcyon) and a competitor crawl of halcyon's rival.
insert into nexra_crawls (id, project_id, start_url, host_scope, status, stop_reason, max_pages, max_depth, max_duration_ms, user_agent, robots_state, sitemap_state, pages_discovered, pages_fetched, pages_failed, created_by, started_at, finished_at) values
 ('c0000000-0000-4000-8000-000000000027', 'halcyon-fintech', 'https://rival.example/', 'rival.example', 'completed', 'completed', 50, 3, 60000, 'NexraBot/0.1', 'fetched', 'fetched', 1, 1, 0, '00000000-0000-4000-8000-00000000000a', now(), now());
insert into nexra_crawl_pages (crawl_id, url, fetch_state, http_status, depth) values
 ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'fetched', 200, 0),
 ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/pricing', 'fetched', 200, 1),
 ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/blog/a', 'fetched', 200, 1),
 ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/missing', 'http-error', 404, 1),
 ('c0000000-0000-4000-8000-000000000027', 'https://rival.example/', 'fetched', 200, 0);

do $$
declare fn text := 'public.nexra_link_suggestion_task_create(text,uuid,text,text,text,uuid)';
begin
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_crawl_page_texts'::regclass)
    and (select count(*) from pg_policy where polrelid = 'public.nexra_crawl_page_texts'::regclass) = 0, 'A page texts: RLS on, no policies');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type) from information_schema.table_privileges where table_name = 'nexra_crawl_page_texts' and grantee = 'service_role') = array['INSERT', 'SELECT'],
    'A page texts: service_role holds SELECT and INSERT only');
  perform t.ok((select count(*) from information_schema.table_privileges where table_name = 'nexra_crawl_page_texts' and grantee in ('anon', 'authenticated', 'PUBLIC')) = 0, 'A page texts: no other API role holds anything');
  perform t.ok((select count(*) from pg_trigger where tgrelid = 'public.nexra_crawl_page_texts'::regclass and not tgisinternal and tgenabled = 'O') = 3, 'A page texts: three guard triggers, enabled');
  perform t.ok((select prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = fn::regprocedure), 'A task function: security definer, empty search_path, owned by postgres');
  perform t.ok(has_function_privilege('service_role', fn, 'EXECUTE') and not has_function_privilege('anon', fn, 'EXECUTE')
    and not has_function_privilege('authenticated', fn, 'EXECUTE') and not has_function_privilege('public', fn, 'EXECUTE'), 'A task function: EXECUTE for service_role only');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_crawl_page_texts_guard_insert()', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.nexra_crawl_page_texts_guard_change()', 'EXECUTE'), 'A guard functions: executable by no API role');
  perform t.ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'nexra_agent_tasks_source_kind_valid')) like '%internal-link%', 'A task source kinds include internal-link');
end $$;

-- B: page texts, as service_role.
set role service_role;
do $$
declare v text := 'Business   banking for growing teams.' ;
begin
  insert into public.nexra_crawl_page_texts (crawl_id, url, visible_text, text_chars, text_sha256)
  values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', v, char_length(v), encode(sha256(convert_to(v, 'UTF8')), 'hex'));
  perform t.ok(true, 'B an own-site fetched page''s text is kept');
  perform t.ok(t27.err(format($q$insert into public.nexra_crawl_page_texts (crawl_id, url, visible_text, text_chars, text_sha256) values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/pricing', 'x', 2, %L)$q$, encode(sha256(convert_to('x', 'UTF8')), 'hex'))) = '23514', 'B a wrong length is refused (23514)');
  perform t.ok(t27.err($q$insert into public.nexra_crawl_page_texts (crawl_id, url, visible_text, text_chars, text_sha256) values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/pricing', 'x', 1, repeat('0', 64))$q$) = '23514', 'B a wrong SHA-256 is refused (23514)');
  perform t.ok(t27.err(format($q$insert into public.nexra_crawl_page_texts (crawl_id, url, visible_text, text_chars, text_sha256) values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/pricing', %L, 20001, %L)$q$, repeat('a', 20001), encode(sha256(convert_to(repeat('a', 20001), 'UTF8')), 'hex'))) = '23514', 'B more than 20,000 characters is refused (23514)');
  perform t.ok(t27.err(format($q$insert into public.nexra_crawl_page_texts (crawl_id, url, visible_text, text_chars, text_sha256) values ('c0000000-0000-4000-8000-000000000027', 'https://rival.example/', 'x', 1, %L)$q$, encode(sha256(convert_to('x', 'UTF8')), 'hex'))) = '23514', 'B a competitor crawl''s text is refused (23514)');
  perform t.ok(t27.err(format($q$insert into public.nexra_crawl_page_texts (crawl_id, url, visible_text, text_chars, text_sha256) values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/missing', 'x', 1, %L)$q$, encode(sha256(convert_to('x', 'UTF8')), 'hex'))) = '23514', 'B a page not fetched has no text (23514)');
  perform t.ok(t27.err(format($q$insert into public.nexra_crawl_page_texts (crawl_id, url, visible_text, text_chars, text_sha256) values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/unknown', 'x', 1, %L)$q$, encode(sha256(convert_to('x', 'UTF8')), 'hex'))) in ('23503', '23514'), 'B a URL that is no page of the crawl is refused');
  perform t.ok(t27.err($q$insert into public.nexra_crawl_page_texts (crawl_id, url, visible_text, text_chars, text_sha256) select crawl_id, url, visible_text, text_chars, text_sha256 from public.nexra_crawl_page_texts$q$) = '23505', 'B one text per page (23505)');
  perform t.ok(t27.err($q$update public.nexra_crawl_page_texts set visible_text = 'y'$q$) = '42501', 'B service_role cannot update (42501)');
  perform t.ok(t27.err($q$delete from public.nexra_crawl_page_texts$q$) = '42501', 'B service_role cannot delete (42501)');
  perform t.ok((select text_chars from public.nexra_crawl_page_texts) = 37, 'B the stored row is unchanged');
end $$;
reset role;
do $$
begin
  perform t.ok(t27.err($q$update public.nexra_crawl_page_texts set recorded_at = now()$q$) = '23514', 'B even the owner cannot update (the guard, 23514)');
  perform t.ok(t27.err($q$truncate public.nexra_crawl_page_texts$q$) = '23514', 'B even the owner cannot truncate (the guard, 23514)');
end $$;

-- C: the task function, as service_role.
set role service_role;
do $$
declare r jsonb; op uuid := '00000000-0000-4000-8000-0000000000aa'; tk record;
begin
  r := public.nexra_link_suggestion_task_create('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/blog/a', 'https://halcyon.example/pricing', 'business banking pricing', op);
  perform t.ok(r->>'outcome' = 'created', 'C a suggestion between two fetched own pages: created');
  select * into tk from public.nexra_agent_tasks where id = (r->'task'->>'id')::uuid;
  perform t.ok(tk.source_kind = 'internal-link' and tk.owning_agent = 'on-page-seo' and tk.status = 'backlog' and tk.priority = 'medium', 'C the task: internal-link, On-Page SEO, backlog, medium');
  perform t.ok(tk.title = 'Add an internal link: /blog/a → /pricing', 'C the title names both paths');
  perform t.ok(tk.source_ref = 'c0000000-0000-4000-8000-000000000001 https://halcyon.example/blog/a https://halcyon.example/pricing business banking pricing', 'C the source reference: crawl, from, to, anchor');
  perform t.ok((select count(*) from public.nexra_agent_task_events where task_id = tk.id and event_type = 'created') = 1, 'C the created event is recorded');
  perform t.ok(public.nexra_link_suggestion_task_create('no-such', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/pricing', 'a', op)->>'outcome' = 'project-not-found', 'C an unknown project: project-not-found');
  perform t.ok(public.nexra_link_suggestion_task_create('verdant-home', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/pricing', 'a', op)->>'outcome' = 'crawl-not-found', 'C another project''s crawl: crawl-not-found');
  perform t.ok(public.nexra_link_suggestion_task_create('halcyon-fintech', 'c0000000-0000-4000-8000-000000000027', 'https://rival.example/', 'https://rival.example/', 'a', op)->>'outcome' = 'crawl-not-found', 'C a competitor crawl: crawl-not-found');
  perform t.ok(public.nexra_link_suggestion_task_create('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/missing', 'a', op)->>'outcome' = 'page-not-found', 'C a page not fetched: page-not-found');
  perform t.ok(public.nexra_link_suggestion_task_create('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://other.example/', 'a', op)->>'outcome' = 'page-not-found', 'C a URL outside the crawl: page-not-found');
  perform t.ok(public.nexra_link_suggestion_task_create('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/', 'a', op)->>'outcome' = 'same-page', 'C a page to itself: same-page');
  perform t.ok(public.nexra_link_suggestion_task_create('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/pricing', '   ', op)->>'outcome' = 'invalid', 'C an empty anchor: invalid');
  perform t.ok(public.nexra_link_suggestion_task_create('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/pricing', repeat('a', 201), op)->>'outcome' = 'invalid', 'C an anchor over 200 characters: invalid');
  perform t.ok(public.nexra_link_suggestion_task_create('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/pricing', 'a', null)->>'outcome' = 'invalid', 'C no operator: invalid');
  perform t.ok(t27.err($q$select public.nexra_agent_task_create('halcyon-fintech', 'x', 'internal-link', 'ref', 'on-page-seo', 'medium', '00000000-0000-4000-8000-0000000000aa')$q$) <> 'no error',
    'C the general task create still refuses internal-link');
  perform t.ok((select count(*) from public.nexra_agent_tasks where source_kind = 'internal-link') = 1, 'C exactly one internal-link task exists');
end $$;
reset role;

-- B (cascade): deleting the crawl takes its pages and their texts with it (the housekeeping path).
do $$
begin
  delete from public.nexra_crawls where id = 'c0000000-0000-4000-8000-000000000001';
  perform t.ok((select count(*) from public.nexra_crawl_page_texts where crawl_id = 'c0000000-0000-4000-8000-000000000001') = 0, 'B a crawl delete takes its page texts with it');
end $$;
