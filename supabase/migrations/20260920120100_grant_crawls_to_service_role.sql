-- Give the server's role explicit access to the crawl tables.
--
-- Supabase's API roles reach a table only through ordinary Postgres
-- privileges, and service_role bypasses row level security but not privileges
-- (see 20260913210000 for the same lesson learned on public.projects). Stating
-- the grant here avoids every query answering "42501 permission denied".
--
-- service_role gets what the application does: insert a crawl, update it when
-- it finishes, insert its pages and links, and read all three back. Deletes
-- are included for maintenance — removing an old crawl is a housekeeping job,
-- and removing the crawl takes its pages and links with it by cascade.
--
-- anon and authenticated get nothing. No browser-side role has any business
-- reading a client's crawl record.
--
-- The role checks keep the migration runnable on a plain Postgres without
-- Supabase's roles (for local testing); on Supabase every branch applies.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.crawls to service_role;
    grant select, insert, update, delete on table public.crawl_pages to service_role;
    grant select, insert, update, delete on table public.crawl_links to service_role;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.crawls from anon;
    revoke all on table public.crawl_pages from anon;
    revoke all on table public.crawl_links from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.crawls from authenticated;
    revoke all on table public.crawl_pages from authenticated;
    revoke all on table public.crawl_links from authenticated;
  end if;
end
$$;
