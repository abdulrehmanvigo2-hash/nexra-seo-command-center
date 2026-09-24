-- T3 crawl findings: sections A (schema), B (security), C (validation), D (recording, duplicates, immutability, cascade, isolation).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema.
do $$
declare cols text[];
begin
  perform t.ok(to_regclass('public.nexra_crawl_findings_reports') is not null, 'A reports table exists');
  perform t.ok(to_regclass('public.nexra_crawl_findings') is not null, 'A findings table exists');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_crawl_findings_reports';
  perform t.ok(cols = array['id','crawl_id','project_id','rule_version','pages_total','pages_fetched','pages_not_fetched','pages_not_reached','links_read','links_cut','findings_total','counts','truncated_rules','recorded_at'], 'A report columns in order: ' || cols::text);
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_crawl_findings';
  perform t.ok(cols = array['id','report_id','crawl_id','project_id','finding_key','rule','category','severity','urls','url_count','observed','message','ordinal'], 'A finding columns in order: ' || cols::text);
  perform t.ok((select count(*) from information_schema.columns where table_name in ('nexra_crawl_findings_reports','nexra_crawl_findings') and is_nullable = 'YES') = 0, 'A no nullable column: null means unknown and a finding has no unknowns');
  perform t.ok((select array_agg(conname || ':' || confdeltype::text order by conname) from pg_constraint where conrelid = 'public.nexra_crawl_findings_reports'::regclass and contype = 'f')
    = array['nexra_crawl_findings_reports_crawl_fkey:c','nexra_crawl_findings_reports_project_fkey:r'], 'A report keys: crawl cascades, project restricts');
  perform t.ok((select array_agg(conname || ':' || confdeltype::text order by conname) from pg_constraint where conrelid = 'public.nexra_crawl_findings'::regclass and contype = 'f')
    = array['nexra_crawl_findings_crawl_fkey:c','nexra_crawl_findings_project_fkey:r','nexra_crawl_findings_report_fkey:c'], 'A finding keys: report and crawl cascade, project restricts');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_crawl_findings_reports_one_per_version') = 'UNIQUE (crawl_id, rule_version)', 'A one report per crawl and rule version');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_crawl_findings_one_per_key') = 'UNIQUE (report_id, finding_key)', 'A one finding per report and key');
  perform t.ok((select count(*) from pg_constraint where conrelid = 'public.nexra_crawl_findings_reports'::regclass and contype = 'c') = 10, 'A ten report check constraints');
  perform t.ok((select count(*) from pg_constraint where conrelid = 'public.nexra_crawl_findings'::regclass and contype = 'c') = 10, 'A ten finding check constraints');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_crawl_findings_reports'::regclass and not tgisinternal)
    = array['nexra_crawl_findings_reports_check_insert','nexra_crawl_findings_reports_guard_delete','nexra_crawl_findings_reports_guard_truncate','nexra_crawl_findings_reports_guard_update'], 'A report triggers: insert check and three guards');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_crawl_findings'::regclass and not tgisinternal)
    = array['nexra_crawl_findings_check_insert','nexra_crawl_findings_guard_delete','nexra_crawl_findings_guard_truncate','nexra_crawl_findings_guard_update'], 'A finding triggers: insert check and three guards');
  perform t.ok((select bool_and(tgenabled = 'O') from pg_trigger where tgrelid in ('public.nexra_crawl_findings_reports'::regclass, 'public.nexra_crawl_findings'::regclass) and not tgisinternal), 'A all triggers enabled');
  perform t.ok((select bool_and(provolatile = 'i') from pg_proc where proname in ('nexra_crawl_findings_scalars_valid','nexra_crawl_findings_counts_valid','nexra_crawl_findings_urls_valid')), 'A the three validators are immutable');
  perform t.ok((select count(*) from pg_indexes where tablename in ('nexra_crawl_findings_reports','nexra_crawl_findings') and indexname in ('nexra_crawl_findings_reports_project_idx','nexra_crawl_findings_report_idx','nexra_crawl_findings_project_rule_idx')) = 3, 'A three read indexes');
end $$;

-- B: security.
do $$
declare f text; fns text[] := array['nexra_crawl_findings_record','nexra_crawl_findings_scalars_valid','nexra_crawl_findings_counts_valid','nexra_crawl_findings_urls_valid','nexra_crawl_findings_reports_check_insert','nexra_crawl_findings_check_insert','nexra_crawl_findings_guard_write'];
begin
  perform t.ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.nexra_crawl_findings_reports'::regclass, 'public.nexra_crawl_findings'::regclass)), 'B RLS enabled on both tables');
  perform t.ok((select count(*) from pg_policy where polrelid in ('public.nexra_crawl_findings_reports'::regclass, 'public.nexra_crawl_findings'::regclass)) = 0, 'B no policies');
  perform t.ok((select bool_and(tableowner = 'postgres') from pg_tables where tablename in ('nexra_crawl_findings_reports','nexra_crawl_findings')), 'B tables owned by postgres');
  perform t.ok((select count(*) from information_schema.table_privileges where table_name in ('nexra_crawl_findings_reports','nexra_crawl_findings') and grantee in ('anon','authenticated')) = 0, 'B anon and authenticated hold nothing on the tables');
  perform t.ok((select array_agg(table_name || ':' || privilege_type order by table_name) from information_schema.table_privileges where table_name in ('nexra_crawl_findings_reports','nexra_crawl_findings') and grantee = 'service_role')
    = array['nexra_crawl_findings:SELECT','nexra_crawl_findings_reports:SELECT'], 'B service_role: SELECT only, on both');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_crawl_findings_record(text,uuid,smallint,integer,integer,integer,integer,integer,boolean,jsonb,text[],jsonb)', 'EXECUTE'), 'B service_role executes record');
  foreach f in array fns loop
    if f <> 'nexra_crawl_findings_record' then
      perform t.ok(not has_function_privilege('service_role', (select oid from pg_proc where proname = f), 'EXECUTE'), 'B service_role cannot execute ' || f);
    end if;
    perform t.ok(not has_function_privilege('anon', (select oid from pg_proc where proname = f), 'EXECUTE') and not has_function_privilege('authenticated', (select oid from pg_proc where proname = f), 'EXECUTE'), 'B anon and authenticated cannot execute ' || f);
    perform t.ok((select proconfig = array['search_path=""'] from pg_proc where proname = f), 'B empty search_path: ' || f);
    perform t.ok((select pg_get_userbyid(proowner) from pg_proc where proname = f) = 'postgres', 'B owned by postgres: ' || f);
  end loop;
  perform t.ok((select array_agg(proname order by proname) from pg_proc where proname like 'nexra_crawl_findings%' and prosecdef) = array['nexra_crawl_findings_record']::name[], 'B only the record function is security definer');
end $$;

-- B, as service_role: no direct write; the function is the way in.
set role service_role;
do $$
begin
  perform t.ok(t.ferr($q$insert into public.nexra_crawl_findings_reports (crawl_id, project_id, rule_version, pages_total, pages_fetched, pages_not_fetched, pages_not_reached, links_read, findings_total) values ('c0000000-0000-4000-8000-000000000001', 'halcyon-fintech', 1, 0, 0, 0, 0, 0, 0)$q$) = '42501', 'B direct report INSERT as service_role refused (42501)');
  perform t.ok(t.ferr($q$insert into public.nexra_crawl_findings (report_id, crawl_id, project_id, finding_key, rule, category, severity, urls, url_count, observed, message, ordinal) values (gen_random_uuid(), 'c0000000-0000-4000-8000-000000000001', 'halcyon-fintech', 'h1-missing:0123456789abcdef', 'h1-missing', 'headings', 'medium', array['https://halcyon.example/'], 1, '{}', 'x', 0)$q$) = '42501', 'B direct finding INSERT as service_role refused (42501)');
  perform t.ok(t.ferr($q$delete from public.nexra_crawl_findings$q$) = '42501', 'B DELETE as service_role refused (42501)');
  perform t.ok(t.ferr($q$update public.nexra_crawl_findings_reports set links_cut = true$q$) = '42501', 'B UPDATE as service_role refused (42501)');
  perform t.ok((t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000002') ->> 'outcome') = 'created', 'B service_role records through the function');
  perform t.ok((select count(*) from public.nexra_crawl_findings where crawl_id = 'c0000000-0000-4000-8000-000000000002') = 2, 'B and may read what it recorded');
end $$;
reset role;

-- C: validation, through the function (every refusal writes nothing).
do $$
declare before_reports bigint; before_findings bigint;
begin
  select count(*) into before_reports from nexra_crawl_findings_reports;
  select count(*) into before_findings from nexra_crawl_findings;
  perform t.ok(t.ferr($q$select public.nexra_crawl_findings_record('halcyon-fintech', 'c0000000-0000-4000-8000-000000000001', 1::smallint, 3, 3, 0, 0, 4, false, '{}', '{}', null)$q$) = '22023', 'C a null argument is refused (22023)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => '{"not": "an array"}')$q$) = '22023', 'C findings must be an array (22023)');
  perform t.ok((t.frec(p_crawl => 'c0000000-0000-4000-8000-0000000000ff') ->> 'outcome') = 'not-found', 'C unknown crawl: not-found');
  perform t.ok((t.frec(p_project => 'verdant-home') ->> 'outcome') = 'wrong-project', 'C another project''s crawl: wrong-project');
  perform t.ok((t.frec(p_project => 'no-such-project') ->> 'outcome') = 'wrong-project', 'C an unknown project against a real crawl: wrong-project');
  perform t.ok((t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000003') ->> 'outcome') = 'not-reviewable', 'C a running crawl: not-reviewable');
  perform t.ok((t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000004') ->> 'outcome') = 'not-reviewable', 'C a failed crawl: not-reviewable');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_key => 'bad key')))$q$) = '23514', 'C a malformed key is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_key => 'title-missing:0123456789abcdef')))$q$) = '23514', 'C a key naming another rule is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_category => 'vitals')))$q$) = '23514', 'C an unknown category is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_severity => 'blocker')))$q$) = '23514', 'C an unknown severity is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_urls => '[]', p_url_count => 0)))$q$) = '23514', 'C no URL is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_urls => (select jsonb_agg('https://halcyon.example/u' || i) from generate_series(1, 26) i), p_url_count => 26)))$q$) = '23514', 'C 26 URLs are refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_urls => '["https://halcyon.example/a", "https://halcyon.example/a"]', p_url_count => 2)))$q$) = '23514', 'C a repeated URL is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_urls => '["ftp://halcyon.example/a"]')))$q$) = '23514', 'C a non-http URL is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_urls => '["https://halcyon.example/a", "https://halcyon.example/b"]', p_url_count => 1)))$q$) = '23514', 'C a URL count below the list is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_observed => '[1]')))$q$) = '23514', 'C observed must be an object (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_observed => '{"nested": {"a": 1}}')))$q$) = '23514', 'C a nested observed value is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_observed => jsonb_build_object('title', repeat('x', 4097)))))$q$) = '23514', 'C an observed string over 4096 characters is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(p_message => repeat('m', 501))))$q$) = '23514', 'C a message over 500 characters is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_findings => jsonb_build_array(t.finding(), t.finding()))$q$) = '23505', 'C the same key twice in one recording is refused (23505)');
  perform t.ok(t.ferr($q$select t.frec(p_counts => '{"h1-missing": 1.5}')$q$) = '23514', 'C a fractional count is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_counts => '{"h1-missing": 0}')$q$) = '23514', 'C a zero count is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_pages_fetched => 2)$q$) = '23514', 'C coverage that does not add up is refused (23514)');
  perform t.ok(t.ferr($q$select t.frec(p_version => 0::smallint)$q$) = '23514', 'C rule version 0 is refused (23514)');
  perform t.ok((select count(*) from nexra_crawl_findings_reports) = before_reports and (select count(*) from nexra_crawl_findings) = before_findings, 'C every refusal wrote nothing');
end $$;

-- D: recording, duplicates, immutability, cascade, isolation.
do $$
declare r jsonb; rep nexra_crawl_findings_reports; keys text[];
begin
  r := t.frec(p_findings => jsonb_build_array(
    t.finding(p_key => 'http-server-error:aaaaaaaaaaaaaaaa', p_rule => 'http-server-error', p_category => 'http', p_severity => 'critical', p_urls => '["https://halcyon.example/e"]', p_observed => '{"httpStatus": 503, "fetchState": "http-error"}', p_message => 'The page answered 503.'),
    t.finding(p_key => 'title-duplicate:bbbbbbbbbbbbbbbb', p_rule => 'title-duplicate', p_category => 'metadata', p_urls => '["https://halcyon.example/a", "https://halcyon.example/b"]', p_url_count => 30, p_observed => '{"title": "Same", "pages": 30}', p_message => '30 fetched pages share the same title.'),
    t.finding()), p_counts => '{"http-server-error": 1, "title-duplicate": 1, "h1-missing": 1}', p_truncated => array['title-duplicate']);
  perform t.ok(r ->> 'outcome' = 'created' and (r ->> 'findings')::int = 3, 'D created with three findings');
  select * into rep from nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000001' and rule_version = 1;
  perform t.ok(rep.project_id = 'halcyon-fintech' and rep.findings_total = 3 and rep.pages_total = 3 and rep.links_read = 4 and rep.truncated_rules = array['title-duplicate'] and rep.counts = '{"h1-missing": 1, "title-duplicate": 1, "http-server-error": 1}'::jsonb, 'D the report carries coverage, totals, counts and cuts');
  perform t.ok((r -> 'report' ->> 'id')::uuid = rep.id, 'D the answer returns the stored report');
  select array_agg(finding_key order by ordinal) into keys from nexra_crawl_findings where report_id = rep.id;
  perform t.ok(keys = array['http-server-error:aaaaaaaaaaaaaaaa','title-duplicate:bbbbbbbbbbbbbbbb','h1-missing:0123456789abcdef'], 'D findings keep the recorded order');
  perform t.ok((select url_count = 30 and cardinality(urls) = 2 and observed = '{"title": "Same", "pages": 30}'::jsonb from nexra_crawl_findings where finding_key = 'title-duplicate:bbbbbbbbbbbbbbbb'), 'D a finding keeps its true URL count and exact observed values');

  r := t.frec(p_findings => t.findings(5), p_counts => '{"h1-missing": 5}');
  perform t.ok(r ->> 'outcome' = 'exists' and (r -> 'report' ->> 'id')::uuid = rep.id, 'D a repeated recording answers exists with the stored report');
  perform t.ok((select count(*) from nexra_crawl_findings where crawl_id = 'c0000000-0000-4000-8000-000000000001') = 3, 'D and writes nothing');
  r := t.frec(p_version => 2::smallint, p_findings => jsonb_build_array(t.finding()), p_counts => '{"h1-missing": 1}');
  perform t.ok(r ->> 'outcome' = 'created', 'D a new rule version records beside the old report, with the same finding key');
  perform t.ok((select count(*) from nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000001') = 2, 'D two reports for the crawl, one per version');
  r := t.frec(p_findings => '[]', p_counts => '{}', p_crawl => 'c0000000-0000-4000-8000-000000000002', p_version => 3::smallint);
  perform t.ok(r ->> 'outcome' = 'created' and (r ->> 'findings')::int = 0 and (r -> 'report' ->> 'findings_total')::int = 0, 'D an empty recording is a report with zero findings, not an absence');

  perform t.ok(t.ferr($q$update nexra_crawl_findings_reports set links_cut = true where crawl_id = 'c0000000-0000-4000-8000-000000000001'$q$) = '23514', 'D UPDATE of a report refused (23514)');
  perform t.ok(t.ferr($q$update nexra_crawl_findings set severity = 'low' where crawl_id = 'c0000000-0000-4000-8000-000000000001'$q$) = '23514', 'D UPDATE of a finding refused (23514)');
  perform t.ok(t.ferr($q$delete from nexra_crawl_findings where crawl_id = 'c0000000-0000-4000-8000-000000000001'$q$) = '23514', 'D direct DELETE of a finding refused (23514)');
  perform t.ok(t.ferr($q$delete from nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000001'$q$) = '23514', 'D direct DELETE of a report refused (23514)');
  perform t.ok(t.ferr($q$truncate nexra_crawl_findings$q$) = '23514', 'D TRUNCATE refused (23514)');
  perform t.ok(t.ferr($q$delete from projects where id = 'halcyon-fintech'$q$) = '23503', 'D the project cannot be deleted under its findings (23503)');
  perform t.ok((select count(*) from nexra_crawl_findings where crawl_id = 'c0000000-0000-4000-8000-000000000001') = 4, 'D nothing above removed anything');

  -- The cascade a crawl's own deletion runs is the one permitted removal.
  perform t.ok(t.ferr($q$delete from nexra_crawls where id = 'c0000000-0000-4000-8000-000000000002'$q$) = 'none', 'D deleting a crawl cascades through its reports and findings');
  perform t.ok((select count(*) from nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000002') = 0 and (select count(*) from nexra_crawl_findings where crawl_id = 'c0000000-0000-4000-8000-000000000002') = 0, 'D and they are gone with it');
  perform t.ok((select count(*) from nexra_crawl_findings where crawl_id = 'c0000000-0000-4000-8000-000000000001') = 4, 'D another crawl''s findings are untouched');

  -- Isolation: each project reads only its own rows, and a crawl is recorded only under its own project.
  r := t.frec(p_project => 'verdant-home', p_crawl => 'c0000000-0000-4000-8000-000000000005', p_findings => t.findings(1), p_counts => '{"h1-missing": 1}');
  perform t.ok(r ->> 'outcome' = 'created', 'D the other project records its own crawl');
  perform t.ok((select count(*) from nexra_crawl_findings where project_id = 'verdant-home') = 1 and (select count(*) from nexra_crawl_findings where project_id = 'halcyon-fintech') = 4, 'D rows are project-scoped: verdant 1, halcyon 4');
  perform t.ok((select bool_and(project_id = 'halcyon-fintech') from nexra_crawl_findings where crawl_id = 'c0000000-0000-4000-8000-000000000001'), 'D every halcyon finding names halcyon');
  perform t.ok(t.ferr($q$insert into nexra_crawl_findings_reports (crawl_id, project_id, rule_version, pages_total, pages_fetched, pages_not_fetched, pages_not_reached, links_read, findings_total) values ('c0000000-0000-4000-8000-000000000005', 'halcyon-fintech', 9, 0, 0, 0, 0, 0, 0)$q$) = '23514', 'D even the owner cannot bind a crawl to another project (23514)');
  perform t.ok(t.ferr($q$insert into nexra_crawl_findings_reports (crawl_id, project_id, rule_version, pages_total, pages_fetched, pages_not_fetched, pages_not_reached, links_read, findings_total) values ('c0000000-0000-4000-8000-000000000003', 'halcyon-fintech', 9, 0, 0, 0, 0, 0, 0)$q$) = '23514', 'D even the owner cannot record a running crawl (23514)');
  perform t.ok((select count(*) from information_schema.columns where table_name in ('nexra_crawl_findings_reports','nexra_crawl_findings') and column_name ~* 'index|vital|rank|traffic|volume') = 0, 'D no column for indexation, vitals, rankings, traffic or volume');
end $$;
