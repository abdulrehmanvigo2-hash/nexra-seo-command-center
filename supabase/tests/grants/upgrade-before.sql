-- F5 upgrade, first half (before migration 20261012120000): production's state rebuilt — Supabase's default ALL for
-- service_role on the seven tables, and a platform-shaped rls_auto_enable (security definer, event trigger, no ACL)
-- behind a live event trigger — then every row and every other privilege kept aside. Part of the local PostgreSQL test
-- harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$
declare t text;
begin
  foreach t in array tg.seven() loop execute format('grant all on table public.%I to service_role', t); end loop;
end $$;

create table tg.ddl_log (n bigserial primary key, tag text not null);
create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path = pg_catalog as $$
begin insert into tg.ddl_log (tag) values (tg_tag); end $$;
create event trigger tg_rls_auto_enable on ddl_command_end when tag in ('CREATE TABLE') execute function public.rls_auto_enable();

do $$
begin
  perform t.ok(tg.privs('nexra_content_drafts') = array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'], 'U before: service_role holds ALL on the draft table (production''s state)');
  perform t.ok(has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') and has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE'),
    'U before: anon and authenticated may execute rls_auto_enable (PUBLIC default)');
end $$;

create table tg.before as select tg.rows() r, tg.security(true) s,
  (select jsonb_agg(jsonb_build_object('t', c.relname, 'acl', (select array_agg(a order by a) from unnest(c.relacl::text[]) a where a not like 'service_role=%')) order by c.relname)
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any (tg.seven())) other_roles,
  (select count(*) from tg.ddl_log) ddl;
