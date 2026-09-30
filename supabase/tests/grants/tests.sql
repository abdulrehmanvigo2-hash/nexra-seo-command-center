-- Surplus grants revoked (fix F5; audit A2-02, A2-11; migration 20261012120000), on every migration: A (the seven
-- tables hold exactly what the migrations grant; no API role holds TRUNCATE, TRIGGER or REFERENCES on any public
-- table), B (the application's writes as service_role still work), C (TRUNCATE, CREATE TRIGGER and REFERENCES as
-- service_role are refused by privilege), D (the migration is idempotent and skips the platform function where it is
-- absent). Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: privileges.
do $$
declare t text;
begin
  foreach t in array tg.seven() loop
    perform t.ok(tg.privs(t) = array['DELETE','INSERT','SELECT','UPDATE'], format('A %s: service_role holds exactly SELECT, INSERT, UPDATE, DELETE', t));
  end loop;
  perform t.ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
    and grantee in ('service_role','anon','authenticated') and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')),
    'A no API role holds TRUNCATE, TRIGGER or REFERENCES on any public table');
  perform t.ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated')),
    'A anon and authenticated hold nothing on any public table');
end $$;

-- B: the application's own writes, as service_role.
set role service_role;
do $$ begin perform t.ok(tg.app_writes('b') = 'none', 'B service_role: insert, read, update and delete on the seven tables work as before (crawl cascade included)'); end $$;
reset role;

-- C: what is revoked is refused by privilege (42501), never reached.
create table tg.victim_count as select (select count(*) from public.nexra_content_drafts) drafts, (select count(*) from public.nexra_content_draft_versions) versions;
grant select on tg.victim_count to service_role;
set role service_role;
do $$
declare t text;
begin
  foreach t in array tg.seven() loop
    perform t.ok(t.err(format('truncate public.%I', t)) = '42501', format('C %s: TRUNCATE as service_role refused (42501)', t));
  end loop;
  perform t.ok(t.err($q$create trigger tg_probe before insert on public.projects for each row execute function tg.noop()$q$) = '42501',
    'C CREATE TRIGGER on projects as service_role refused (42501)');
  perform t.ok(t.err($q$create trigger tg_probe before insert on public.nexra_content_drafts for each row execute function tg.noop()$q$) = '42501',
    'C CREATE TRIGGER on nexra_content_drafts as service_role refused (42501)');
  perform t.ok(t.err($q$create table tg.fk_probe (p text references public.projects (id))$q$) = '42501',
    'C a foreign key to projects declared by service_role refused (42501)');
  perform t.ok((select drafts from tg.victim_count) = (select count(*) from public.nexra_content_drafts)
    and (select versions from tg.victim_count) = (select count(*) from public.nexra_content_draft_versions), 'C the draft tables kept every row');
end $$;
reset role;

-- D: idempotent; the platform function is absent here and is skipped without error.
\ir ../../migrations/20261012120000_revoke_surplus_grants.sql
do $$
declare t text;
begin
  perform t.ok(to_regprocedure('public.rls_auto_enable()') is null, 'D rls_auto_enable is not this repository''s: absent locally');
  foreach t in array tg.seven() loop
    if tg.privs(t) <> array['DELETE','INSERT','SELECT','UPDATE'] then perform t.ok(false, 'D re-run changed ' || t); end if;
  end loop;
  perform t.ok(true, 'D the migration re-runs cleanly and changes nothing');
end $$;
