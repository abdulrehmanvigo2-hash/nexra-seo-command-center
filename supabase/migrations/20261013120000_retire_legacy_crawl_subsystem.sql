-- Retire the legacy, unprefixed crawl subsystem (fix F6; audit A0-02, A0-03,
-- A2-03).
--
-- WHY. Five tables and four functions in `public` belong to a crawl system this
-- repository never created or used: created by production-only history rows of
-- 19–21 Sep (`create_crawls`, `create_crawl_pages`, `create_crawl_page_signals`;
-- `crawl_links` by no recorded row), last written on 19 Sep 2026 at 15:28 UTC,
-- read by no file, cron, view or function of this product, and reached by no
-- foreign key from any other table. `anon` and `authenticated` still hold
-- TRUNCATE, TRIGGER and REFERENCES on `crawl_links` (A0-03). The operator
-- decided on 30 Sep: back up, then drop. The rows are in the encrypted backup
-- of GitHub Actions run 36740624220 (artifact nexra-backup-36740624220; 32
-- tables, 1,226 rows, the five below included).
--
-- WHAT IS DROPPED.
--   Tables (with their own indexes, constraints and triggers):
--     crawl_page_signals (40 rows), crawl_links (0), crawl_urls (43),
--     crawl_pages (43), crawls (9) — 135 rows.
--   Functions (used only by those tables):
--     crawl_pages_claim(uuid, integer, integer)
--     crawl_pages_recover_expired(uuid, integer)
--     crawl_pages_count_change()    -- trigger of crawl_pages
--     crawls_guard_update()         -- trigger of crawls
-- The shared `set_updated_at()` stays: this product's tables use it too.
--
-- FAIL CLOSED. Nothing is dropped unless all five tables exist and hold exactly
-- the rows the backup holds (a later write would mean someone still uses them);
-- otherwise the migration raises and the whole transaction rolls back. No drop
-- uses CASCADE: an object outside this list that depends on one of them makes
-- the drop fail instead of taking that object with it. Where none of the five
-- exists (a new project restored from this repository, the local test harness),
-- the migration does nothing.
--
-- This file names only the nine legacy objects above; every `nexra_` table,
-- every other function and every grant is untouched.

do $$
declare
  present int;
  counts text;
begin
  select count(*) into present from pg_catalog.pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname in ('crawls', 'crawl_pages', 'crawl_urls', 'crawl_page_signals', 'crawl_links');

  if present = 0 then
    return;
  end if;
  if present <> 5 then
    raise exception 'retire legacy crawl subsystem: % of the five tables exist; refusing', present;
  end if;

  execute 'select format(''crawls=%s crawl_pages=%s crawl_urls=%s crawl_page_signals=%s crawl_links=%s'',
      (select count(*) from public.crawls), (select count(*) from public.crawl_pages), (select count(*) from public.crawl_urls),
      (select count(*) from public.crawl_page_signals), (select count(*) from public.crawl_links))'
    into counts;
  if counts <> 'crawls=9 crawl_pages=43 crawl_urls=43 crawl_page_signals=40 crawl_links=0' then
    raise exception 'retire legacy crawl subsystem: rows differ from the backup (%); refusing', counts;
  end if;

  -- crawl_pages_claim returns setof crawl_pages, so it depends on that table's row type: the two callable
  -- functions go first, then the tables (their triggers with them), then the two trigger functions.
  drop function if exists public.crawl_pages_claim(uuid, integer, integer);
  drop function if exists public.crawl_pages_recover_expired(uuid, integer);

  drop table public.crawl_page_signals;
  drop table public.crawl_links;
  drop table public.crawl_urls;
  drop table public.crawl_pages;
  drop table public.crawls;

  drop function if exists public.crawl_pages_count_change();
  drop function if exists public.crawls_guard_update();
end
$$;
