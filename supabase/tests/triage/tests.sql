-- M3 crawl finding triage: sections A (schema), B (security), C (setting a decision: outcomes, refusals, one row per key), D (guards, binding, isolation, the findings untouched).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- The findings as recorded, before any decision: they must read the same at the end.
create table t.findings_before as
  select id, report_id, crawl_id, project_id, finding_key, rule, category, severity, urls, url_count, observed, message, ordinal from nexra_crawl_findings;
create table t.reports_before as select * from nexra_crawl_findings_reports;

-- A: schema.
do $$
declare cols text[];
begin
  perform t.ok(to_regclass('public.nexra_crawl_finding_triage') is not null, 'A triage table exists');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_crawl_finding_triage';
  perform t.ok(cols = array['id','project_id','finding_key','rule','finding_id','report_id','crawl_id','status','note','set_by','set_at','created_at'], 'A columns in order: ' || cols::text);
  perform t.ok((select array_agg(column_name::text order by column_name) from information_schema.columns where table_name = 'nexra_crawl_finding_triage' and is_nullable = 'YES') = array['note'], 'A the note is the only nullable column');
  perform t.ok((select array_agg(conname || ':' || confdeltype::text order by conname) from pg_constraint where conrelid = 'public.nexra_crawl_finding_triage'::regclass and contype = 'f')
    = array['nexra_crawl_finding_triage_crawl_fkey:c','nexra_crawl_finding_triage_finding_fkey:c','nexra_crawl_finding_triage_project_fkey:r','nexra_crawl_finding_triage_report_fkey:c'], 'A keys: finding, report and crawl cascade, project restricts');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_crawl_finding_triage_one_per_key') = 'UNIQUE (project_id, finding_key)', 'A one decision per project and finding key');
  perform t.ok((select count(*) from pg_constraint where conrelid = 'public.nexra_crawl_finding_triage'::regclass and contype = 'c') = 5, 'A five check constraints');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_crawl_finding_triage'::regclass and not tgisinternal)
    = array['nexra_crawl_finding_triage_check_insert','nexra_crawl_finding_triage_check_update','nexra_crawl_finding_triage_guard_delete','nexra_crawl_finding_triage_guard_truncate','nexra_crawl_finding_triage_guard_update'], 'A triggers: binding on insert and update, three guards');
  perform t.ok((select bool_and(tgenabled = 'O') from pg_trigger where tgrelid = 'public.nexra_crawl_finding_triage'::regclass and not tgisinternal), 'A all triggers enabled');
  perform t.ok((select count(*) from pg_indexes where tablename = 'nexra_crawl_finding_triage' and indexname = 'nexra_crawl_finding_triage_project_status_idx') = 1, 'A the project/status read index exists');
  perform t.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_name = 'nexra_crawl_findings')
    = (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_name = 'nexra_crawl_findings' and column_name in ('id','report_id','crawl_id','project_id','finding_key','rule','category','severity','urls','url_count','observed','message','ordinal')), 'A the findings table gained no column');
end $$;

-- B: security.
do $$
declare f text; fns text[] := array['nexra_crawl_finding_triage_set','nexra_crawl_finding_triage_check_binding','nexra_crawl_finding_triage_guard_update','nexra_crawl_finding_triage_guard_remove'];
begin
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_crawl_finding_triage'::regclass), 'B RLS enabled');
  perform t.ok((select count(*) from pg_policy where polrelid = 'public.nexra_crawl_finding_triage'::regclass) = 0, 'B no policies');
  perform t.ok((select tableowner = 'postgres' from pg_tables where tablename = 'nexra_crawl_finding_triage'), 'B table owned by postgres');
  perform t.ok((select count(*) from information_schema.table_privileges where table_name = 'nexra_crawl_finding_triage' and grantee in ('anon','authenticated')) = 0, 'B anon and authenticated hold nothing on the table');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_crawl_finding_triage' and grantee = 'service_role') = array['SELECT'], 'B service_role: SELECT only');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_crawl_finding_triage_set(text,uuid,text,text,text,uuid)', 'EXECUTE'), 'B service_role executes set');
  foreach f in array fns loop
    if f <> 'nexra_crawl_finding_triage_set' then
      perform t.ok(not has_function_privilege('service_role', (select oid from pg_proc where proname = f), 'EXECUTE'), 'B service_role cannot execute ' || f);
    end if;
    perform t.ok(not has_function_privilege('anon', (select oid from pg_proc where proname = f), 'EXECUTE') and not has_function_privilege('authenticated', (select oid from pg_proc where proname = f), 'EXECUTE'), 'B anon and authenticated cannot execute ' || f);
    perform t.ok((select proconfig = array['search_path=""'] from pg_proc where proname = f), 'B empty search_path: ' || f);
    perform t.ok((select pg_get_userbyid(proowner) from pg_proc where proname = f) = 'postgres', 'B owned by postgres: ' || f);
  end loop;
  perform t.ok((select array_agg(proname order by proname) from pg_proc where proname like 'nexra_crawl_finding_triage%' and prosecdef) = array['nexra_crawl_finding_triage_set']::name[], 'B only the set function is security definer');
  perform t.ok((select array_agg(proname order by proname) from pg_proc where proname like 'nexra_crawl_findings%' and prosecdef) = array['nexra_crawl_findings_record']::name[], 'B the findings functions are unchanged: only record is security definer');
end $$;

-- B, as service_role: no direct write; the function is the way in.
set role service_role;
do $$
begin
  perform t.ok(t.tstate($q$insert into public.nexra_crawl_finding_triage (project_id, finding_key, rule, finding_id, report_id, crawl_id, status, set_by) select project_id, finding_key, rule, id, report_id, crawl_id, 'open', t.op() from public.nexra_crawl_findings limit 1$q$) = '42501', 'B service_role cannot INSERT directly (42501)');
  perform t.ok(t.tstate($q$update public.nexra_crawl_finding_triage set status = 'ignored'$q$) = '42501', 'B service_role cannot UPDATE directly (42501)');
  perform t.ok(t.tstate($q$delete from public.nexra_crawl_finding_triage$q$) = '42501', 'B service_role cannot DELETE directly (42501)');
  perform t.ok(t.tstate($q$update public.nexra_crawl_findings set severity = 'low'$q$) = '42501', 'B service_role still cannot write a finding (42501)');
  perform t.ok((t.tset(p_status => 'acknowledged', p_note => '  seen  ')->>'outcome') = 'set', 'B service_role sets a decision through the function');
  perform t.ok((select count(*) from public.nexra_crawl_finding_triage) = 1, 'B and can read it back');
end $$;
reset role;

-- C: setting a decision.
do $$
declare r jsonb; row1 nexra_crawl_finding_triage; row2 nexra_crawl_finding_triage; f nexra_crawl_findings;
begin
  select * into row1 from nexra_crawl_finding_triage where project_id = 'halcyon-fintech' and finding_key = t.key1();
  select * into f from nexra_crawl_findings where crawl_id = 'c0000000-0000-4000-8000-000000000001' and finding_key = t.key1();
  perform t.ok(row1.status = 'acknowledged' and row1.note = 'seen' and row1.set_by = t.op() and row1.rule = 'h1-missing', 'C the row carries the decision, the trimmed note, the operator and the rule');
  perform t.ok(row1.finding_id = f.id and row1.report_id = f.report_id and row1.crawl_id = f.crawl_id, 'C and names the exact finding, report and crawl it was made on');
  perform t.ok(row1.set_at >= row1.created_at, 'C set_at is not before created_at');

  r := t.tset(p_status => 'resolved', p_note => '');
  select * into row2 from nexra_crawl_finding_triage where project_id = 'halcyon-fintech' and finding_key = t.key1();
  perform t.ok(r->>'outcome' = 'set' and r->>'previous' = 'acknowledged', 'C a second decision answers set with the previous status');
  perform t.ok(row2.id = row1.id and row2.status = 'resolved' and row2.note is null and row2.created_at = row1.created_at and row2.set_at >= row1.set_at, 'C it updates the one row in place: same id, new status, blank note stored as null, created_at kept');
  perform t.ok((r -> 'triage' ->> 'id')::uuid = row1.id and r -> 'triage' ->> 'status' = 'resolved', 'C the answer returns the stored row');
  perform t.ok((select count(*) from nexra_crawl_finding_triage) = 1, 'C one row per project and key');

  r := t.tset(p_crawl => 'c0000000-0000-4000-8000-000000000002', p_status => 'ignored', p_note => 'template page');
  select * into row2 from nexra_crawl_finding_triage where project_id = 'halcyon-fintech' and finding_key = t.key1();
  perform t.ok(r->>'outcome' = 'set' and r->>'previous' = 'resolved' and (select count(*) from nexra_crawl_finding_triage) = 1, 'C the same key on a later crawl of the project updates the same decision, not a second row');
  perform t.ok(row2.crawl_id = 'c0000000-0000-4000-8000-000000000002' and row2.finding_id <> row1.finding_id and row2.status = 'ignored', 'C and now names the later crawl''s finding');

  r := t.tset(p_key => t.key2(), p_status => 'open');
  perform t.ok(r->>'outcome' = 'set' and r->>'previous' is null and (select count(*) from nexra_crawl_finding_triage) = 2, 'C a different key is its own decision; open is a status like any other, never a deletion');

  r := t.tset(p_project => 'verdant-home', p_crawl => 'c0000000-0000-4000-8000-000000000005', p_key => 'title-missing:00000000000000aa', p_status => 'acknowledged');
  perform t.ok(r->>'outcome' = 'set' and (select count(*) from nexra_crawl_finding_triage where project_id = 'verdant-home') = 1, 'C another project''s finding is decided under that project');

  -- Refusals through the function: nothing written.
  perform t.ok((t.tset(p_crawl => 'c0000000-0000-4000-8000-0000000000ff')->>'outcome') = 'not-found', 'C an unknown crawl answers not-found');
  perform t.ok((t.tset(p_crawl => 'c0000000-0000-4000-8000-000000000005')->>'outcome') = 'not-found', 'C another project''s crawl answers not-found, not which project it belongs to');
  perform t.ok((t.tset(p_key => 'h1-missing:ffffffffffffffff')->>'outcome') = 'not-recorded', 'C a key not recorded for the crawl answers not-recorded');
  perform t.ok((t.tset(p_crawl => 'c0000000-0000-4000-8000-000000000003')->>'outcome') = 'not-recorded', 'C a crawl of the project with nothing recorded answers not-recorded');
  perform t.ok(t.tstate($q$select t.tset(p_status => 'in-progress')$q$) = '22023', 'C a status outside the four is refused (22023)');
  perform t.ok(t.tstate($q$select t.tset(p_note => repeat('x', 501))$q$) = '22023', 'C a note over 500 characters is refused (22023)');
  perform t.ok((t.tset(p_note => repeat('y', 500))->>'outcome') = 'set', 'C a note of exactly 500 characters is kept');
  perform t.ok(t.tstate($q$select public.nexra_crawl_finding_triage_set('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', t.key1(), 'open', null, null)$q$) = '22023', 'C a missing operator is refused (22023)');
  perform t.ok(t.tstate($q$select public.nexra_crawl_finding_triage_set(null, 'c0000000-0000-4000-8000-000000000001', t.key1(), 'open', null, t.op())$q$) = '22023', 'C a missing project is refused (22023)');
  perform t.ok((select count(*) from nexra_crawl_finding_triage) = 3, 'C the refusals wrote nothing');
end $$;

-- D: guards, binding, isolation, the findings untouched.
do $$
declare v_id uuid; other uuid; r jsonb;
begin
  select id into v_id from nexra_crawl_finding_triage where project_id = 'halcyon-fintech' and finding_key = t.key1();
  select id into other from nexra_crawl_findings where project_id = 'verdant-home';
  perform t.ok(t.tstate(format($q$update nexra_crawl_finding_triage set project_id = 'verdant-home' where id = %L$q$, v_id)) = '23514', 'D the project never changes (23514)');
  perform t.ok(t.tstate(format($q$update nexra_crawl_finding_triage set finding_key = t.key2() where id = %L$q$, v_id)) = '23514', 'D the finding key never changes (23514)');
  perform t.ok(t.tstate(format($q$update nexra_crawl_finding_triage set rule = 'title-missing' where id = %L$q$, v_id)) = '23514', 'D the rule never changes (23514)');
  perform t.ok(t.tstate(format($q$update nexra_crawl_finding_triage set created_at = now() - interval '1 day' where id = %L$q$, v_id)) = '23514', 'D created_at never changes (23514)');
  perform t.ok(t.tstate(format($q$update nexra_crawl_finding_triage set set_at = set_at - interval '1 hour' where id = %L$q$, v_id)) = '23514', 'D a decision is never re-dated earlier (23514)');
  perform t.ok(t.tstate(format($q$update nexra_crawl_finding_triage set finding_id = %L where id = %L$q$, other, v_id)) = '23514', 'D a decision cannot be moved onto another project''s finding (23514)');
  perform t.ok(t.tstate(format($q$update nexra_crawl_finding_triage set finding_id = (select id from nexra_crawl_findings where project_id = 'halcyon-fintech' and finding_key = t.key2() limit 1) where id = %L$q$, v_id)) = '23514', 'D nor onto a finding with a different key (23514)');
  perform t.ok(t.tstate(format($q$update nexra_crawl_finding_triage set status = 'open' where id = %L$q$, v_id)) = 'none', 'D the owner may still change the decision itself');
  perform t.ok(t.tstate($q$delete from nexra_crawl_finding_triage$q$) = '23514', 'D direct DELETE refused (23514)');
  perform t.ok(t.tstate($q$truncate nexra_crawl_finding_triage$q$) = '23514', 'D TRUNCATE refused (23514)');
  perform t.ok(t.tstate($q$delete from projects where id = 'halcyon-fintech'$q$) = '23503', 'D the project cannot be deleted under its decisions (23503)');
  perform t.ok(t.tstate($q$insert into nexra_crawl_finding_triage (project_id, finding_key, rule, finding_id, report_id, crawl_id, status, set_by) values ('halcyon-fintech', 'h1-missing:0000000000000009', 'h1-missing', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', 'c0000000-0000-4000-8000-000000000001', 'open', t.op())$q$) = '23503', 'D a privileged insert naming no recorded finding is refused (23503)');
  perform t.ok(t.tstate(format($q$insert into nexra_crawl_finding_triage (project_id, finding_key, rule, finding_id, report_id, crawl_id, status, set_by) select 'halcyon-fintech', finding_key, rule, id, report_id, crawl_id, 'open', t.op() from nexra_crawl_findings where id = %L$q$, other)) = '23514', 'D a privileged insert binding another project''s finding to this project is refused (23514)');

  perform t.ok((select count(*) from nexra_crawl_finding_triage where project_id = 'halcyon-fintech') = 2 and (select count(*) from nexra_crawl_finding_triage where project_id = 'verdant-home') = 1, 'D each project holds only its own decisions');
  perform t.ok((select count(*) from nexra_crawl_finding_triage t2 join nexra_crawl_findings f on f.id = t2.finding_id where f.project_id <> t2.project_id) = 0, 'D no decision names another project''s finding');

  perform t.ok((select count(*) from (select id, report_id, crawl_id, project_id, finding_key, rule, category, severity, urls, url_count, observed, message, ordinal from nexra_crawl_findings except select * from t.findings_before) d) = 0
    and (select count(*) from nexra_crawl_findings) = (select count(*) from t.findings_before), 'D every recorded finding reads exactly as before any decision');
  perform t.ok((select count(*) from (select * from nexra_crawl_findings_reports except select * from t.reports_before) d) = 0
    and (select count(*) from nexra_crawl_findings_reports) = (select count(*) from t.reports_before), 'D every report reads exactly as before');

  -- The cascade a finding's own removal runs (with its crawl) is the one permitted removal.
  r := t.tset(p_key => t.key2(), p_crawl => 'c0000000-0000-4000-8000-000000000002', p_status => 'acknowledged');
  perform t.ok(r->>'outcome' = 'set'
    and (select crawl_id from nexra_crawl_finding_triage where finding_key = t.key2() and project_id = 'halcyon-fintech') = 'c0000000-0000-4000-8000-000000000002', 'D a decision is moved onto the later crawl''s finding: ' || r::text);
  perform t.ok(t.tstate($q$delete from nexra_crawls where id = 'c0000000-0000-4000-8000-000000000002'$q$) = 'none', 'D deleting a crawl cascades through its findings to the decisions last made on them');
  perform t.ok((select count(*) from nexra_crawl_finding_triage where finding_key = t.key2() and project_id = 'halcyon-fintech') = 0, 'D the decision last made on that crawl went with it');
  perform t.ok((select count(*) from nexra_crawl_finding_triage where finding_key = t.key1() and project_id = 'halcyon-fintech') = 1, 'D a decision made on another crawl''s finding stays');
end $$;
