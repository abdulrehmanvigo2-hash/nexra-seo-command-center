-- T5 upgrade, part 1: rows written before the T5 migration, on a database that stops at T3.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.

\set ON_ERROR_STOP 1

insert into public.nexra_crawl_pages (crawl_id, url, fetch_state, http_status, title, title_length, h1_count)
  values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'fetched', 200, 'Halcyon', 7, 1);
insert into public.nexra_crawl_pages (crawl_id, url, fetch_state)
  values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/unreached', 'budget-skipped');
insert into public.nexra_crawl_links (crawl_id, from_url, to_url, rel, is_internal)
  values ('c0000000-0000-4000-8000-000000000001', 'https://halcyon.example/', 'https://halcyon.example/unreached', null, true);
select t.frec();
