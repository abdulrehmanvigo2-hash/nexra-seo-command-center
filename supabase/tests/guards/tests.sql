-- Delete and truncate guards (Phase 5, checkpoint 5.4, migration 20261007120000): sections A (schema and security),
-- B (projects, agent_runs, agent_run_attempts refuse DELETE and TRUNCATE, for every caller), C (crawls, pages and links
-- refuse TRUNCATE; a crawl DELETE still works and still cascades), D (the draft store's compensating delete still works),
-- E (nothing was removed by a refused statement). Runs over c4/setup.sql, gsc/setup.sql and findings/setup.sql on every
-- migration. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh, which creates and destroys
-- its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- Fixtures: a run with one attempt, a crawl with a page and a link, and a writer run for a draft. Written under replica
-- role like c4/setup.sql: the runtime's lifecycle triggers are not what is under test here (the guards are not replica
-- triggers, so they are checked below with the role at origin).
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count) values
 ('9a000000-0000-4000-8000-000000000001','halcyon-fintech','technical-seo','crawl-review',repeat('9',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','OBSERVED …',1),
 ('9a000000-0000-4000-8000-000000000002','halcyon-fintech','writer','section-draft',repeat('8',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','DRAFT …',1);
insert into agent_run_attempts (id, run_id, attempt_number, executor, worker_id, lease_expires_at, outcome, finished_at, result_metadata) values
 ('9b000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',1,'ai','worker-1',now() + interval '5 minutes','completed',now(),'{}');
set session_replication_role = origin;
insert into projects (id, name, client, domain, initials, industry, type, goal, market, language, target_location) values
 ('lonely-project','Lonely','Lonely','lonely.example','LP','retail','saas','leads','US','en','US');
insert into nexra_crawl_pages (crawl_id, url, fetch_state) values
 ('c0000000-0000-4000-8000-000000000002', 'https://halcyon.example/skipped', 'budget-skipped'),
 ('c0000000-0000-4000-8000-000000000005', 'https://verdant.example/skipped', 'budget-skipped');
insert into nexra_crawl_links (crawl_id, from_url, to_url, is_internal) values
 ('c0000000-0000-4000-8000-000000000002', 'https://halcyon.example/', 'https://halcyon.example/skipped', true),
 ('c0000000-0000-4000-8000-000000000005', 'https://verdant.example/', 'https://verdant.example/skipped', true);

create table t.counts_before as select
  (select count(*) from projects) projects, (select count(*) from agent_runs) runs, (select count(*) from agent_run_attempts) attempts,
  (select count(*) from nexra_crawls) crawls, (select count(*) from nexra_crawl_pages) pages, (select count(*) from nexra_crawl_links) links;
grant select on t.counts_before to service_role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;

-- A: the schema and its security.
do $$
begin
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.projects'::regclass and tgname like 'nexra_projects_guard_%')
    = array['nexra_projects_guard_delete','nexra_projects_guard_truncate'], 'A projects: a delete and a truncate guard');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.agent_runs'::regclass and tgname like 'nexra_agent_runs_guard_%')
    = array['nexra_agent_runs_guard_delete','nexra_agent_runs_guard_truncate'], 'A agent_runs: a delete and a truncate guard');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.agent_run_attempts'::regclass and tgname like 'nexra_agent_run_attempts_guard_%')
    = array['nexra_agent_run_attempts_guard_delete','nexra_agent_run_attempts_guard_truncate'], 'A agent_run_attempts: a delete and a truncate guard');
  perform t.ok((select count(*) from pg_trigger where tgrelid in ('public.nexra_crawls'::regclass, 'public.nexra_crawl_pages'::regclass, 'public.nexra_crawl_links'::regclass) and tgname like 'nexra_crawl%_guard_truncate') = 3,
    'A crawls, pages and links: one truncate guard each');
  perform t.ok((select count(*) from pg_trigger where tgrelid in ('public.nexra_crawls'::regclass, 'public.nexra_crawl_pages'::regclass, 'public.nexra_crawl_links'::regclass) and tgname like '%guard_delete') = 0,
    'A crawls, pages and links: no delete guard (housekeeping delete stays)');
  perform t.ok((select count(*) from pg_trigger where tgrelid = 'public.nexra_content_drafts'::regclass and (tgname like '%guard_delete' or tgname like '%guard_truncate')) = 0,
    'A nexra_content_drafts: unchanged, no delete or truncate guard');
  perform t.ok((select bool_and(tgenabled = 'O') from pg_trigger where tgname in ('nexra_projects_guard_delete','nexra_projects_guard_truncate','nexra_agent_runs_guard_delete','nexra_agent_runs_guard_truncate',
    'nexra_agent_run_attempts_guard_delete','nexra_agent_run_attempts_guard_truncate','nexra_crawls_guard_truncate','nexra_crawl_pages_guard_truncate','nexra_crawl_links_guard_truncate')), 'A every guard trigger is enabled');
  perform t.ok((select bool_and(proconfig = array['search_path=""'] and not prosecdef) from pg_proc where proname in ('nexra_projects_guard_remove','nexra_agent_runs_guard_remove','nexra_agent_run_attempts_guard_remove','nexra_crawls_guard_truncate'))
    and (select count(*) from pg_proc where proname in ('nexra_projects_guard_remove','nexra_agent_runs_guard_remove','nexra_agent_run_attempts_guard_remove','nexra_crawls_guard_truncate')) = 4,
    'A four guard functions, empty search_path, not security definer');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_projects_guard_remove()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.nexra_agent_runs_guard_remove()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.nexra_crawls_guard_truncate()', 'EXECUTE')
    and not has_function_privilege('public', 'public.nexra_agent_run_attempts_guard_remove()', 'EXECUTE'), 'A no API role or PUBLIC executes a guard function');
  perform t.ok(has_table_privilege('service_role', 'public.projects', 'DELETE') and has_table_privilege('service_role', 'public.agent_runs', 'DELETE')
    and has_table_privilege('service_role', 'public.agent_run_attempts', 'DELETE') and has_table_privilege('service_role', 'public.nexra_crawls', 'DELETE')
    and has_table_privilege('service_role', 'public.nexra_content_drafts', 'DELETE'), 'A grants unchanged: service_role still holds DELETE (the guards, not grants, refuse)');
end $$;

-- B: projects, runs and attempts refuse DELETE and TRUNCATE, as the owner and as service_role.
do $$
begin
  perform t.ok(t.err($q$delete from projects where id = 'lonely-project'$q$) = '23514', 'B a project with no child rows is not deleted (23514)');
  perform t.ok(t.err($q$delete from projects where id = 'halcyon-fintech'$q$) = '23514', 'B a project with child rows is refused by the guard first (23514)');
  perform t.ok(t.err($q$truncate projects cascade$q$) = '23514', 'B TRUNCATE projects CASCADE refused (23514)');
  perform t.ok(t.err($q$delete from agent_runs where id = '9a000000-0000-4000-8000-000000000001'$q$) = '23514', 'B a run is not deleted (23514)');
  perform t.ok(t.err($q$delete from agent_runs$q$) = '23514', 'B a whole-table run delete is refused (23514)');
  perform t.ok(t.err($q$truncate agent_runs cascade$q$) = '23514', 'B TRUNCATE agent_runs CASCADE refused (23514)');
  perform t.ok(t.err($q$delete from agent_run_attempts where id = '9b000000-0000-4000-8000-000000000001'$q$) = '23514', 'B an attempt is not deleted (23514)');
  perform t.ok(t.err($q$truncate agent_run_attempts$q$) = '23514', 'B TRUNCATE agent_run_attempts refused (23514)');
end $$;

set role service_role;
do $$
begin
  perform t.ok(t.err($q$delete from public.projects where id = 'lonely-project'$q$) = '23514', 'B service_role: a project is not deleted (23514, not a privilege error)');
  perform t.ok(t.err($q$delete from public.agent_runs where id = '9a000000-0000-4000-8000-000000000001'$q$) = '23514', 'B service_role: a run is not deleted (23514)');
  perform t.ok(t.err($q$delete from public.agent_run_attempts where id = '9b000000-0000-4000-8000-000000000001'$q$) = '23514', 'B service_role: an attempt is not deleted (23514)');
  perform t.ok(t.err($q$truncate public.nexra_crawls$q$) in ('23514', '42501'), 'B service_role: TRUNCATE of crawls refused');
end $$;
reset role;

-- C: crawl records refuse TRUNCATE; a crawl DELETE still works and takes its pages, links and findings with it.
do $$
declare n int;
begin
  perform t.ok(t.err($q$truncate nexra_crawls cascade$q$) = '23514', 'C TRUNCATE nexra_crawls CASCADE refused (23514)');
  perform t.ok(t.err($q$truncate nexra_crawl_pages$q$) = '23514', 'C TRUNCATE nexra_crawl_pages refused (23514)');
  perform t.ok(t.err($q$truncate nexra_crawl_links$q$) = '23514', 'C TRUNCATE nexra_crawl_links refused (23514)');
  perform t.ok((t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000002')->>'outcome') = 'created', 'C setup: a findings report on crawl 2');
  perform t.ok(t.err($q$delete from nexra_crawl_pages where url = 'https://halcyon.example/skipped'$q$) = 'none', 'C one page row can still be deleted');
  perform t.ok(t.err($q$delete from nexra_crawls where id = 'c0000000-0000-4000-8000-000000000002'$q$) = 'none', 'C a crawl DELETE still works (housekeeping)');
  select count(*) into n from nexra_crawl_links where crawl_id = 'c0000000-0000-4000-8000-000000000002';
  perform t.ok(n = 0, 'C the deleted crawl''s links went with it');
  select count(*) into n from nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000002';
  perform t.ok(n = 0, 'C the deleted crawl''s findings report went with it (the documented cascade)');
  perform t.ok((select count(*) from nexra_crawl_pages where crawl_id = 'c0000000-0000-4000-8000-000000000005') = 1
    and (select count(*) from nexra_crawl_links where crawl_id = 'c0000000-0000-4000-8000-000000000005') = 1, 'C another crawl''s page and link untouched');
end $$;

-- D: the draft store's compensating delete (a parent removed when its version 1 insert fails) still works, as service_role.
set session_replication_role = replica;
insert into nexra_content_drafts (id, project_id, source_writer_run_id, section_label, created_by)
  values ('9d000000-0000-4000-8000-000000000001', 'halcyon-fintech', '9a000000-0000-4000-8000-000000000002', 'S', '00000000-0000-4000-8000-0000000000aa');
set session_replication_role = origin;
set role service_role;
do $$
begin
  perform t.ok(t.err($q$delete from public.nexra_content_drafts where id = '9d000000-0000-4000-8000-000000000001'$q$) = 'none', 'D service_role: the compensating delete of a draft with no version still works');
  perform t.ok((select count(*) from public.nexra_content_drafts where id = '9d000000-0000-4000-8000-000000000001') = 0, 'D the parent draft is gone');
end $$;
reset role;

-- E: nothing a refused statement named was removed.
do $$
declare b record;
begin
  select * into b from t.counts_before;
  perform t.ok((select count(*) from projects) = b.projects, 'E every project still present');
  perform t.ok((select count(*) from agent_runs) = b.runs + 0, 'E every run still present');
  perform t.ok((select count(*) from agent_run_attempts) = b.attempts, 'E every attempt still present');
  perform t.ok((select count(*) from nexra_crawls) = b.crawls - 1, 'E crawls: only the one deliberately deleted is gone');
  perform t.ok((select count(*) from nexra_crawl_pages) = b.pages - 1 and (select count(*) from nexra_crawl_links) = b.links - 1, 'E pages and links: only the deliberately deleted ones are gone');
end $$;
