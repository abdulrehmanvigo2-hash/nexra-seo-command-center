-- F5 upgrade, second half (after migration 20261012120000): every row unchanged, every other privilege and security
-- setting unchanged, the seven tables back to exactly what the migrations grant, rls_auto_enable no longer executable
-- by PUBLIC, anon or authenticated while its event trigger still runs, and the application's writes still working.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record; t text; bad text := '';
begin
  select * into b from tg.before;
  perform t.ok(tg.rows() = b.r, 'U every row of every public table is unchanged, byte for byte');
  perform t.ok(tg.security(true) = b.s, 'U every other table ACL, RLS flag, policy, trigger, column ACL and function ACL is unchanged');
  perform t.ok((select jsonb_agg(jsonb_build_object('t', c.relname, 'acl', (select array_agg(a order by a) from unnest(c.relacl::text[]) a where a not like 'service_role=%')) order by c.relname)
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any (tg.seven())) = b.other_roles, 'U the seven tables: every other role''s privileges unchanged');
  foreach t in array tg.seven() loop
    if tg.privs(t) <> array['DELETE','INSERT','SELECT','UPDATE'] then bad := bad || ' ' || t; end if;
  end loop;
  perform t.ok(bad = '', 'U the seven tables: service_role holds exactly SELECT, INSERT, UPDATE, DELETE' || bad);
  perform t.ok(not has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.rls_auto_enable()', 'EXECUTE'), 'U rls_auto_enable: no API role may execute it (PUBLIC revoked)');
  perform t.ok((select prosecdef and proowner = 'postgres'::regrole from pg_proc where oid = 'public.rls_auto_enable()'::regprocedure), 'U rls_auto_enable keeps its owner and security definer');
end $$;

-- The event trigger still runs its function for a role that may not execute it.
create role tg_ddl nologin;
grant usage, create on schema tg to tg_ddl;
set role tg_ddl;
create table tg.after_revoke (x int);
reset role;
do $$
begin
  perform t.ok((select count(*) from tg.ddl_log where tag = 'CREATE TABLE') > (select ddl from tg.before), 'U the event trigger still runs rls_auto_enable after the revoke (DDL by a role without EXECUTE)');
end $$;

set role service_role;
do $$ begin perform t.ok(tg.app_writes('u') = 'none', 'U service_role: the application''s writes on the seven tables still work'); end $$;
do $$ begin perform t.ok(t.err('truncate public.nexra_content_drafts') = '42501', 'U service_role: TRUNCATE of the draft table now refused (42501)'); end $$;
reset role;
