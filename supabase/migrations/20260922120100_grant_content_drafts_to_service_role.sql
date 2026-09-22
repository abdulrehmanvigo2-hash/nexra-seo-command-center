-- Give the server's role explicit access to this product's content draft
-- tables, and nothing else.
--
-- Every statement here names a `nexra_`-prefixed table. Supabase's API roles
-- reach a table only through ordinary Postgres privileges, and service_role
-- bypasses row level security but not privileges (see 20260913210000 and
-- 20260920120100 for the same lesson); stating the grant here avoids every
-- query answering "42501 permission denied".
--
-- service_role gets what the application does: insert a draft and its
-- versions, update a draft's state as later milestones add transitions, and
-- read both back. Deletes are included for maintenance and for the store's
-- own compensation when a version insert fails after its parent was written.
--
-- anon and authenticated get nothing: no browser-side role has any business
-- reading a client's draft. The role checks keep the migration runnable on a
-- plain Postgres without Supabase's roles; on Supabase every branch applies.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.nexra_content_drafts to service_role;
    grant select, insert, update, delete on table public.nexra_content_draft_versions to service_role;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.nexra_content_drafts from anon;
    revoke all on table public.nexra_content_draft_versions from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.nexra_content_drafts from authenticated;
    revoke all on table public.nexra_content_draft_versions from authenticated;
  end if;
end
$$;
