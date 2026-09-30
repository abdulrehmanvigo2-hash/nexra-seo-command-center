-- Shared helpers for the grants suites (fix F5, migration 20261012120000): the seven tables, their privileges, a
-- row fingerprint of every public table, and the application's own writes as service_role. Part of the local
-- PostgreSQL test harness; run only through supabase/tests/run.sh. Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema tg;

create function tg.seven() returns text[] language sql immutable as $$
  select array['projects','agent_runs','nexra_crawls','nexra_crawl_pages','nexra_crawl_links','nexra_content_drafts','nexra_content_draft_versions']
$$;

-- service_role's table privileges on one table, in a fixed order.
create function tg.privs(p_table text) returns text[] language sql stable as $$
  select array_agg(p order by p) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
   where has_table_privilege('service_role', ('public.' || p_table)::regclass, p)
$$;

-- Every row of every table in public, as jsonb, in a stable order.
create function tg.rows() returns jsonb language plpgsql stable as $$
declare r record; out jsonb := '{}'; v jsonb;
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), ''[]'') from public.%I x', r.tablename) into v;
    out := out || jsonb_build_object(r.tablename, v);
  end loop;
  return out;
end $$;

-- Every privilege and security setting that must not move: table ACLs (the seven excepted), RLS flags, policies,
-- triggers, function ACLs and attributes (rls_auto_enable excepted), column ACLs.
create function tg.security(p_skip_seven boolean) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'tables', (select jsonb_agg(jsonb_build_object('t', c.relname, 'acl', c.relacl::text[], 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity, 'owner', c.relowner::regrole::text) order by c.relname)
                 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S')
                  and not (p_skip_seven and c.relname = any (tg.seven()))),
    'columns', (select coalesce(jsonb_agg(jsonb_build_object('t', a.attrelid::regclass::text, 'c', a.attname, 'acl', a.attacl::text[]) order by 1, 2), '[]')
                  from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null),
    'policies', (select count(*) from pg_policies where schemaname = 'public'),
    'triggers', (select jsonb_agg(jsonb_build_object('t', tgrelid::regclass::text, 'n', tgname, 'e', tgenabled, 'f', tgfoid::regprocedure::text) order by tgrelid::regclass::text, tgname)
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not tgisinternal),
    'functions', (select jsonb_agg(jsonb_build_object('f', p.oid::regprocedure::text, 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig, 'owner', p.proowner::regrole::text, 'body', md5(p.prosrc)) order by p.oid::regprocedure::text)
                    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'rls_auto_enable'))
$$;

-- The application's own writes on the seven tables, as service_role: insert, read, update and delete where the
-- application does each. Answers 'none' or the first failing statement's SQLSTATE.
create function tg.app_writes(p_tag text) returns text language plpgsql as $$
declare
  p text := 'grants-' || p_tag;
  run uuid := gen_random_uuid(); crawl uuid := gen_random_uuid(); draft uuid := gen_random_uuid();
begin
  insert into public.projects (id, name, client, domain, initials, industry, type, goal, market, language, target_location)
    values (p, 'Grants', 'Grants', p || '.example', 'GR', 'retail', 'saas', 'leads', 'US', 'en', 'US');
  update public.projects set name = 'Grants renamed' where id = p;
  perform 1 from public.projects where id = p and name = 'Grants renamed';
  if not found then return 'project-not-updated'; end if;

  insert into public.agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by)
    values (run, p, 'technical-seo', 'crawl-review', md5(p) || md5(p), 'queued', '00000000-0000-4000-8000-0000000000aa');
  update public.agent_runs set status = 'cancelled', finished_at = now() where id = run;

  insert into public.nexra_crawls (id, project_id, start_url, host_scope, status, max_pages, max_depth, max_duration_ms, user_agent, robots_state, sitemap_state, created_by, started_at)
    values (crawl, p, 'https://' || p || '.example/', p || '.example', 'running', 5, 1, 60000, 'NexraBot/0.1', 'unavailable', 'unavailable', '00000000-0000-4000-8000-0000000000aa', now());
  insert into public.nexra_crawl_pages (crawl_id, url, fetch_state) values (crawl, 'https://' || p || '.example/', 'budget-skipped');
  insert into public.nexra_crawl_links (crawl_id, from_url, to_url, is_internal) values (crawl, 'https://' || p || '.example/', 'https://' || p || '.example/a', true);
  perform 1 from public.nexra_crawl_links where crawl_id = crawl;
  delete from public.nexra_crawls where id = crawl;
  if exists (select 1 from public.nexra_crawl_pages where crawl_id = crawl) or exists (select 1 from public.nexra_crawl_links where crawl_id = crawl) then
    return 'crawl-cascade-failed';
  end if;

  insert into public.nexra_content_drafts (id, project_id, source_writer_run_id, section_label, created_by)
    values (draft, 'halcyon-fintech', '9a000000-0000-4000-8000-000000000002', 'S', '00000000-0000-4000-8000-0000000000aa');
  delete from public.nexra_content_drafts where id = draft;
  perform 1 from public.nexra_content_draft_versions limit 1;
  return 'none';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- A trigger function service_role may execute, for the TRIGGER probe.
create function tg.noop() returns trigger language plpgsql as $$ begin return new; end $$;

grant usage, create on schema tg to service_role;
grant execute on all functions in schema tg to service_role;

-- Fixture: a completed writer run for the draft insert (written under replica role, as the guards suite does).
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count) values
 ('9a000000-0000-4000-8000-000000000002','halcyon-fintech','writer','section-draft',repeat('8',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','DRAFT …',1)
 on conflict do nothing;
set session_replication_role = origin;
