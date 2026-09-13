-- Give the server's role explicit access to public.projects.
--
-- Supabase's API roles reach a table only through ordinary Postgres
-- privileges. Projects that do not grant them automatically on new tables
-- answer every query from the server with "42501 permission denied for table
-- projects", even with the secret key — the key authenticates as
-- service_role, and service_role bypasses row level security but not
-- privileges. The first migration assumed the automatic grant; this states it.
--
-- service_role gets what the application does with the table: read the
-- roster and a project, create a project, and — for settings and maintenance —
-- update and delete. anon and authenticated get nothing: until authentication
-- exists no client role should touch this table, and revoking says so in
-- privileges as well as in row level security.
--
-- The role checks keep the migration runnable on a plain Postgres without
-- Supabase's roles (for local testing); on Supabase every branch applies.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.projects to service_role;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.projects from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.projects from authenticated;
  end if;
end
$$;
