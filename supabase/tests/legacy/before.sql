-- F6, first half (before migration 20261013120000): the legacy subsystem present as in production, and every other
-- object's rows, privileges and definitions kept aside. Part of the local PostgreSQL test harness; run only through
-- supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema tl;

create function tl.legacy_tables() returns text[] language sql immutable as $$
  select array['crawls','crawl_pages','crawl_urls','crawl_page_signals','crawl_links'] $$;
create function tl.legacy_functions() returns text[] language sql immutable as $$
  select array['crawl_pages_claim','crawl_pages_recover_expired','crawl_pages_count_change','crawls_guard_update'] $$;

-- Every row of every other public table.
create function tl.rows() returns jsonb language plpgsql stable as $$
declare r record; out jsonb := '{}'; v jsonb;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename <> all (tl.legacy_tables()) order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), ''[]'') from public.%I x', r.tablename) into v;
    out := out || jsonb_build_object(r.tablename, v);
  end loop;
  return out;
end $$;

-- Every other object in public: relations (kind, ACL, RLS, owner), columns and their ACLs, constraints, indexes,
-- triggers, policies, functions (signature, ACL, security, config, owner, body), and event triggers.
create function tl.schema() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'relations', (select jsonb_agg(jsonb_build_object('n', c.relname, 'k', c.relkind, 'acl', c.relacl::text[], 'rls', c.relrowsecurity, 'o', c.relowner::regrole::text) order by c.relname)
                    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname <> all (tl.legacy_tables())
                     and not exists (select 1 from pg_index i join pg_class t on t.oid = i.indrelid where i.indexrelid = c.oid and t.relname = any (tl.legacy_tables()))
                     and not (c.relkind = 'S' and exists (select 1 from pg_depend d join pg_class t on t.oid = d.refobjid where d.objid = c.oid and t.relname = any (tl.legacy_tables())))),
    'columns', (select jsonb_agg(jsonb_build_object('t', c.relname, 'c', a.attname, 'ty', format_type(a.atttypid, a.atttypmod), 'nn', a.attnotnull, 'acl', a.attacl::text[]) order by c.relname, a.attnum)
                  from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and c.relname <> all (tl.legacy_tables())),
    'constraints', (select jsonb_agg(jsonb_build_object('t', conrelid::regclass::text, 'n', conname, 'd', pg_get_constraintdef(oid)) order by conrelid::regclass::text, conname)
                      from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
                       and conrelid::regclass::text <> all (select 'public.' || x from unnest(tl.legacy_tables()) x) and conrelid::regclass::text <> all (tl.legacy_tables())),
    'indexes', (select jsonb_agg(pg_get_indexdef(i.indexrelid) order by 1) from pg_index i join pg_class t on t.oid = i.indrelid where t.relnamespace = 'public'::regnamespace and t.relname <> all (tl.legacy_tables())),
    'triggers', (select jsonb_agg(jsonb_build_object('t', c.relname, 'n', t.tgname, 'e', t.tgenabled, 'd', pg_get_triggerdef(t.oid)) order by c.relname, t.tgname)
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and c.relname <> all (tl.legacy_tables())),
    'policies', (select count(*) from pg_policies where schemaname = 'public'),
    'functions', (select jsonb_agg(jsonb_build_object('f', p.oid::regprocedure::text, 'acl', p.proacl::text[], 'sd', p.prosecdef, 'cfg', p.proconfig, 'o', p.proowner::regrole::text, 'b', md5(p.prosrc)) order by p.oid::regprocedure::text)
                    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> all (tl.legacy_functions())),
    'event_triggers', (select coalesce(jsonb_agg(jsonb_build_object('n', evtname, 'e', evtenabled, 'f', evtfoid::regproc::text) order by evtname), '[]') from pg_event_trigger))
$$;

create function tl.legacy_present() returns text language sql stable as $$
  select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any (tl.legacy_tables()))
    || ' tables, ' || (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = any (tl.legacy_functions())) || ' functions' $$;

do $$
begin
  perform t.ok(tl.legacy_present() = '5 tables, 4 functions', 'L before: the five legacy tables and four functions exist, as in production');
  perform t.ok((select count(*) from public.crawls) + (select count(*) from public.crawl_pages) + (select count(*) from public.crawl_urls)
    + (select count(*) from public.crawl_page_signals) + (select count(*) from public.crawl_links) = 135, 'L before: 135 legacy rows (9, 43, 43, 40, 0)');
  perform t.ok(has_table_privilege('anon', 'public.crawl_links', 'TRUNCATE'), 'L before: anon holds TRUNCATE on crawl_links (A0-03)');
end $$;
create table tl.before as select tl.rows() r, tl.schema() s;
