-- Revoke privileges the repository never granted (fix F5; audit A2-02, A2-11).
--
-- WHY (A2-02). Supabase's default privileges hand ALL on a new table in
-- `public` to service_role. The migrations that created this product's first
-- seven tables granted service_role only SELECT, INSERT, UPDATE and DELETE,
-- but never revoked the rest, so production still carries REFERENCES, TRIGGER
-- and TRUNCATE for service_role on:
--   projects, agent_runs, nexra_crawls, nexra_crawl_pages, nexra_crawl_links,
--   nexra_content_drafts, nexra_content_draft_versions.
-- The nineteen later tables already match their migrations. The application
-- never truncates a table, creates a trigger or declares a foreign key as
-- service_role: schema changes are made by migrations, as the owner. TRUNCATE
-- of the two draft tables was not covered by the 5.4 guards.
--
-- WHY (A2-11). The platform's `public.rls_auto_enable()` is a security definer
-- event-trigger function with no ACL, so PUBLIC (and so anon and
-- authenticated) may EXECUTE it, and PostgREST exposes it at
-- /rest/v1/rpc/rls_auto_enable. A direct call fails (an event-trigger function
-- cannot be called), so nothing results, but the surface is needless. The
-- event trigger that uses it keeps running: event triggers call their function
-- as the system, without an EXECUTE check. The function is not this
-- repository's; it exists only on Supabase, so the revoke runs only when it is
-- there.
--
-- WHAT CHANGES. Privileges only. No table, row, column, function body,
-- trigger, policy or RLS setting changes; SELECT, INSERT, UPDATE and DELETE
-- stay exactly as the earlier migrations granted them.
--
-- NOT HERE. The legacy, unprefixed crawl tables (crawls, crawl_pages,
-- crawl_page_signals, crawl_links; audit A0-02, A0-03, A2-03) are another
-- system's and are left untouched: their retirement is fix F6.
--
-- On a plain Postgres without Supabase's roles (the local test harness) the
-- role checks skip what cannot apply; on Supabase every branch runs. Each
-- revoke is idempotent.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke references, trigger, truncate on table public.projects from service_role;
    revoke references, trigger, truncate on table public.agent_runs from service_role;
    revoke references, trigger, truncate on table public.nexra_crawls from service_role;
    revoke references, trigger, truncate on table public.nexra_crawl_pages from service_role;
    revoke references, trigger, truncate on table public.nexra_crawl_links from service_role;
    revoke references, trigger, truncate on table public.nexra_content_drafts from service_role;
    revoke references, trigger, truncate on table public.nexra_content_draft_versions from service_role;
  end if;

  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke execute on function public.rls_auto_enable() from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      revoke execute on function public.rls_auto_enable() from authenticated;
    end if;
  end if;
end
$$;
