-- F6, second half (after migration 20261013120000): the legacy subsystem gone, every other row and every other
-- object unchanged, the application's writes still working, and a re-run doing nothing. Part of the local PostgreSQL
-- test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record;
begin
  select * into b from tl.before;
  perform t.ok(tl.legacy_present() = '0 tables, 0 functions', 'L after: the five legacy tables and four functions are gone');
  perform t.ok(not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace
    and (relname like 'crawl\_%' escape '\' or relname = 'crawls' or relname like 'crawls\_%' escape '\')), 'L after: no legacy index, sequence or constraint relation is left');
  perform t.ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')),
    'L after: anon and authenticated hold nothing on any public table (A0-03 closed)');
  perform t.ok(tl.rows() = b.r, 'L every row of every other public table is unchanged, byte for byte');
  perform t.ok(tl.schema() = b.s, 'L every other relation, column, constraint, index, trigger, policy, function and grant is unchanged');
  perform t.ok(to_regprocedure('public.set_updated_at()') is not null, 'L the shared set_updated_at() stays');
end $$;

set role service_role;
do $$ begin perform t.ok(tg.app_writes('l') = 'none', 'L service_role: the application''s writes on its own tables still work'); end $$;
reset role;

\ir ../../migrations/20261013120000_retire_legacy_crawl_subsystem.sql
do $$ begin perform t.ok(tl.schema() = (select s from tl.before) and tl.legacy_present() = '0 tables, 0 functions', 'L a re-run finds nothing and changes nothing'); end $$;
