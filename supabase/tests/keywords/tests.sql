-- Curated keywords: sections A (schema), B (security), C (adding), D (the setters and their events),
-- E (guards, isolation, the sources untouched).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create table t.snaps_before as select id, project_id, queries from nexra_search_console_snapshots;

-- A: schema.
do $$
declare cols text[];
begin
  perform t.ok(to_regclass('public.nexra_keywords') is not null and to_regclass('public.nexra_keyword_events') is not null, 'A both tables exist');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_keywords';
  perform t.ok(cols = array['id','project_id','query','group_label','note','target_page','status','created_by','created_at','updated_at'], 'A keyword columns in order, and no figure of any kind: ' || cols::text);
  perform t.ok((select array_agg(column_name::text order by column_name) from information_schema.columns where table_name = 'nexra_keywords' and is_nullable = 'YES') = array['group_label','note','target_page'], 'A only group label, note and target page are optional');
  perform t.ok((select column_default from information_schema.columns where table_name = 'nexra_keywords' and column_name = 'status') = '''tracked''::text', 'A status defaults to tracked');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_keywords_status_valid') like '%tracked%paused%archived%', 'A the three statuses');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_keywords_project_query_key') = 'UNIQUE (project_id, query)', 'A unique on project and exact query');
  perform t.ok((select array_agg(conname || ':' || confdeltype::text order by conname) from pg_constraint where conrelid = 'public.nexra_keywords'::regclass and contype = 'f')
    = array['nexra_keywords_project_fkey:r'], 'A one foreign key: the project, restricting');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_keyword_events';
  perform t.ok(cols = array['id','seq','keyword_id','project_id','event_type','from_status','to_status','from_value','to_value','actor','created_at'], 'A event columns in order: ' || cols::text);
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_keyword_events_type_valid') like '%created%status-changed%group-changed%target-changed%note-changed%', 'A the five event types');
  perform t.ok((select attidentity from pg_attribute where attrelid = 'public.nexra_keyword_events'::regclass and attname = 'seq') = 'a', 'A seq is an identity column');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_keywords'::regclass and not tgisinternal)
    = array['nexra_keywords_guard_delete','nexra_keywords_guard_truncate','nexra_keywords_guard_update','nexra_keywords_record_created'], 'A keyword triggers: three guards and the created recorder');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_keyword_events'::regclass and not tgisinternal)
    = array['nexra_keyword_events_guard_delete','nexra_keyword_events_guard_truncate','nexra_keyword_events_guard_update'], 'A event triggers: three guards');
  perform t.ok((select bool_and(tgenabled = 'O') from pg_trigger where tgrelid in ('public.nexra_keywords'::regclass, 'public.nexra_keyword_events'::regclass) and not tgisinternal), 'A all triggers enabled');
  perform t.ok((select count(*) from pg_indexes where indexname in ('nexra_keywords_project_created_idx','nexra_keyword_events_seq_idx','nexra_keyword_events_keyword_seq_idx')) = 3, 'A the read indexes exist');
end $$;

-- B: security.
do $$
declare f text;
  writers text[] := array['nexra_keyword_add(text,text,text,text,text,uuid)','nexra_keyword_set_status(text,uuid,text,uuid)','nexra_keyword_set_group(text,uuid,text,uuid)','nexra_keyword_set_target(text,uuid,text,uuid)','nexra_keyword_set_note(text,uuid,text,uuid)'];
  helpers text[] := array['nexra_keywords_guard_update()','nexra_keywords_guard_remove()','nexra_keywords_record_created()','nexra_keyword_events_guard()','nexra_keyword_target_on_host(text,text)','nexra_keyword_clean_text(text)','nexra_keyword_check_fields(text,text,text)'];
begin
  perform t.ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.nexra_keywords'::regclass, 'public.nexra_keyword_events'::regclass)), 'B RLS enabled on both tables');
  perform t.ok((select count(*) from pg_policy where polrelid in ('public.nexra_keywords'::regclass, 'public.nexra_keyword_events'::regclass)) = 0, 'B no policies');
  perform t.ok((select count(*) from information_schema.table_privileges where table_name in ('nexra_keywords','nexra_keyword_events') and grantee in ('anon','authenticated')) = 0, 'B anon and authenticated hold nothing on either table');
  perform t.ok((select array_agg(table_name || ':' || privilege_type order by table_name) from information_schema.table_privileges where table_name in ('nexra_keywords','nexra_keyword_events') and grantee = 'service_role')
    = array['nexra_keyword_events:SELECT','nexra_keywords:SELECT'], 'B service_role: SELECT on both tables only');
  foreach f in array writers loop
    perform t.ok(has_function_privilege('service_role', 'public.' || f, 'EXECUTE'), 'B service_role executes ' || f);
    perform t.ok(not has_function_privilege('anon', 'public.' || f, 'EXECUTE') and not has_function_privilege('authenticated', 'public.' || f, 'EXECUTE'), 'B anon and authenticated cannot execute ' || f);
    perform t.ok((select prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = ('public.' || f)::regprocedure), 'B security definer, empty search_path, owned by postgres: ' || f);
  end loop;
  foreach f in array helpers loop
    perform t.ok(not has_function_privilege('service_role', 'public.' || f, 'EXECUTE') and not has_function_privilege('anon', 'public.' || f, 'EXECUTE'), 'B no API role executes ' || f);
    perform t.ok((select not prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = ('public.' || f)::regprocedure), 'B not security definer, empty search_path: ' || f);
  end loop;
  perform t.ok((select array_agg(proname::text order by proname) from pg_proc where proname like 'nexra_keyword%' and prosecdef)
    = array['nexra_keyword_add','nexra_keyword_set_group','nexra_keyword_set_note','nexra_keyword_set_status','nexra_keyword_set_target'], 'B exactly the five write functions are security definer');
end $$;

set role service_role;
do $$
begin
  perform t.ok(t.err($q$insert into public.nexra_keywords (project_id, query, created_by) values ('halcyon-fintech', 'x', t.kop())$q$) = '42501', 'B service_role cannot INSERT directly (42501)');
  perform t.ok(t.err($q$update public.nexra_keywords set status = 'paused'$q$) = '42501', 'B service_role cannot UPDATE directly (42501)');
  perform t.ok(t.err($q$delete from public.nexra_keywords$q$) = '42501', 'B service_role cannot DELETE directly (42501)');
  perform t.ok(t.err($q$truncate public.nexra_keyword_events$q$) = '42501', 'B service_role cannot TRUNCATE events (42501)');
  perform t.ok(t.err($q$insert into public.nexra_keyword_events (keyword_id, project_id, event_type, actor) values (gen_random_uuid(), 'halcyon-fintech', 'created', t.kop())$q$) = '42501', 'B service_role cannot write an event directly (42501)');
  perform t.ok((t.kadd()->>'outcome') = 'added', 'B service_role adds a keyword through the function');
  perform t.ok((select count(*) from public.nexra_keywords) = 1 and (select count(*) from public.nexra_keyword_events) = 1, 'B and reads it and its created event back');
end $$;
reset role;

-- C: adding.
do $$
declare r jsonb; k nexra_keywords; e nexra_keyword_events;
begin
  select * into k from nexra_keywords where query = 'business banking';
  perform t.ok(k.project_id = 'halcyon-fintech' and k.status = 'tracked' and k.group_label is null and k.note is null and k.target_page is null and k.created_by = t.kop() and k.updated_at = k.created_at, 'C a new keyword is tracked, with no group, note or target, and its operator');
  select * into e from nexra_keyword_events where keyword_id = k.id;
  perform t.ok(e.event_type = 'created' and e.actor = t.kop() and e.project_id = 'halcyon-fintech' and e.created_at = k.created_at, 'C the created event names the keyword, project, operator and time');

  r := t.kadd(p_group => 'changed', p_note => 'changed');
  perform t.ok(r->>'outcome' = 'exists' and (r->'keyword'->>'id')::uuid = k.id and r->'keyword'->>'group_label' is null, 'C the same exact query answers exists with the row, unchanged');
  perform t.ok((select count(*) from nexra_keyword_events where keyword_id = k.id) = 1, 'C exists writes no event');
  perform t.ok(t.kadd('Business banking')->>'outcome' = 'added', 'C exact text: another case is another keyword');
  perform t.ok(t.kadd(' business banking')->>'outcome' = 'added', 'C exact text: a leading space is another keyword');
  perform t.ok(exists (select 1 from nexra_keywords where query = ' business banking'), 'C exact text: stored as given, never trimmed');
  perform t.ok(t.kadd('business banking', p_project => 'verdant-home')->>'outcome' = 'added', 'C the same query on another project is its own keyword');
  perform t.ok(t.kadd('never reported by google')->>'outcome' = 'added', 'C an unobserved query may be curated (Q5)');
  perform t.ok(t.kadd('x', p_project => 'no-such-project')->>'outcome' = 'project-not-found', 'C an unstored project answers project-not-found');

  r := t.kadd('sme loans', p_group => '  Lending  ', p_note => '  Check the rates page.  ', p_target => 'https://halcyon.example/loans');
  perform t.ok(r->>'outcome' = 'added' and r->'keyword'->>'group_label' = 'Lending' and r->'keyword'->>'note' = 'Check the rates page.' and r->'keyword'->>'target_page' = 'https://halcyon.example/loans', 'C group and note trimmed; target on host kept');
  perform t.ok(t.kadd('blank fields', p_group => '   ', p_note => '') ->'keyword'->>'group_label' is null, 'C a blank group or note is none');
  perform t.ok(t.kadd('www target', p_target => 'https://www.halcyon.example/')->>'outcome' = 'added', 'C the www host is the project host');
  perform t.ok(t.kadd('http port target', p_target => 'http://halcyon.example:8080/a?b=c')->>'outcome' = 'added', 'C http and a port are accepted on the host');
  perform t.ok(t.kadd('upper host', p_target => 'https://HALCYON.example/x')->>'outcome' = 'added', 'C the host compares case-insensitively');
  perform t.ok(t.kadd('off host', p_target => 'https://verdant.example/')->>'outcome' = 'target-off-host', 'C another project''s host answers target-off-host');
  perform t.ok(t.kadd('sub host', p_target => 'https://blog.halcyon.example/')->>'outcome' = 'target-off-host', 'C a subdomain is not the project host');
  perform t.ok(t.kadd('suffix host', p_target => 'https://halcyon.example.evil.test/')->>'outcome' = 'target-off-host', 'C a host that merely starts with the project host is off host');
  perform t.ok(not exists (select 1 from nexra_keywords where query in ('off host', 'sub host', 'suffix host')), 'C a refused add writes nothing');

  perform t.ok(t.err($q$select public.nexra_keyword_add('halcyon-fintech', 'q', null, null, null, null)$q$) = '22023', 'C no operator raises 22023');
  perform t.ok(t.err($q$select t.kadd(E'tab\tquery')$q$) = '22023', 'C a control character in the query raises 22023');
  perform t.ok(t.err($q$select t.kadd('   ')$q$) = '22023', 'C a blank query raises 22023');
  perform t.ok(t.err($q$select t.kadd('')$q$) = '22023', 'C an empty query raises 22023');
  perform t.ok(t.err($q$select t.kadd(repeat('q', 2049))$q$) = '22023', 'C a query over 2048 characters raises 22023');
  perform t.ok(t.kadd(repeat('q', 2048))->>'outcome' = 'added', 'C a 2048-character query is accepted');
  perform t.ok(t.err($q$select t.kadd('g', p_group => repeat('g', 81))$q$) = '22023', 'C a group label over 80 characters raises 22023');
  perform t.ok(t.err($q$select t.kadd('n', p_note => repeat('n', 501))$q$) = '22023', 'C a note over 500 characters raises 22023');
  perform t.ok(t.kadd('multi-line note', p_note => E'line one\nline two')->>'outcome' = 'added', 'C a note may hold line breaks');
  perform t.ok(t.err($q$select t.kadd('t', p_target => '/relative/path')$q$) = '22023', 'C a relative target raises 22023');
  perform t.ok(t.err($q$select t.kadd('t', p_target => 'ftp://halcyon.example/')$q$) = '22023', 'C a non-http target raises 22023');
  perform t.ok(t.err($q$select t.kadd('t', p_target => 'https://user@halcyon.example/')$q$) = '22023', 'C a target with credentials raises 22023');
end $$;

-- D: the setters and their events.
do $$
declare r jsonb; kw uuid := t.kid(); other uuid := t.kid('business banking', 'verdant-home'); before timestamptz; n int;
begin
  select updated_at into before from nexra_keywords where id = t.kid();
  perform pg_sleep(0.01);
  r := public.nexra_keyword_set_status('halcyon-fintech', kw, 'paused', t.kop());
  perform t.ok(r->>'outcome' = 'status-changed' and r->'keyword'->>'status' = 'paused' and r->'event'->>'from_status' = 'tracked' and r->'event'->>'to_status' = 'paused', 'D status tracked → paused, with its event');
  perform t.ok((select updated_at > before from nexra_keywords where nexra_keywords.id = t.kid()), 'D updated_at moves on a change');
  perform t.ok(public.nexra_keyword_set_status('halcyon-fintech', kw, 'paused', t.kop())->>'outcome' = 'same-status', 'D the same status answers same-status');
  perform t.ok(public.nexra_keyword_set_status('halcyon-fintech', kw, 'archived', t.kop())->>'outcome' = 'status-changed', 'D paused → archived');
  perform t.ok(public.nexra_keyword_set_status('halcyon-fintech', kw, 'tracked', t.kop())->>'outcome' = 'status-changed', 'D archived → tracked: an archived keyword may be tracked again');
  perform t.ok(public.nexra_keyword_set_status('verdant-home', kw, 'paused', t.kop())->>'outcome' = 'keyword-not-found', 'D through another project: keyword-not-found');
  perform t.ok(public.nexra_keyword_set_status('halcyon-fintech', gen_random_uuid(), 'paused', t.kop())->>'outcome' = 'keyword-not-found', 'D an unknown keyword: keyword-not-found');
  perform t.ok(t.err(format($q$select public.nexra_keyword_set_status('halcyon-fintech', %L, 'deleted', t.kop())$q$, kw)) = '22023', 'D an unknown status raises 22023');

  r := public.nexra_keyword_set_group('halcyon-fintech', kw, '  Banking ', t.kop());
  perform t.ok(r->>'outcome' = 'group-changed' and r->'keyword'->>'group_label' = 'Banking' and r->'event'->>'from_value' is null and r->'event'->>'to_value' = 'Banking', 'D group set, trimmed, with its event');
  perform t.ok(public.nexra_keyword_set_group('halcyon-fintech', kw, 'Banking', t.kop())->>'outcome' = 'same-group', 'D the same group answers same-group');
  r := public.nexra_keyword_set_group('halcyon-fintech', kw, '', t.kop());
  perform t.ok(r->>'outcome' = 'group-changed' and r->'keyword'->>'group_label' is null and r->'event'->>'from_value' = 'Banking' and r->'event'->>'to_value' is null, 'D a blank group clears it');
  perform t.ok(public.nexra_keyword_set_group('halcyon-fintech', kw, null, t.kop())->>'outcome' = 'same-group', 'D clearing a cleared group is same-group');
  perform t.ok(t.err(format($q$select public.nexra_keyword_set_group('halcyon-fintech', %L, repeat('g', 81), t.kop())$q$, kw)) = '22023', 'D a long group raises 22023');

  r := public.nexra_keyword_set_target('halcyon-fintech', kw, 'https://halcyon.example/business', t.kop());
  perform t.ok(r->>'outcome' = 'target-changed' and r->'event'->>'to_value' = 'https://halcyon.example/business', 'D target set on host, with its event');
  r := public.nexra_keyword_set_target('halcyon-fintech', kw, 'https://verdant.example/', t.kop());
  perform t.ok(r->>'outcome' = 'target-off-host' and r->'keyword'->>'target_page' = 'https://halcyon.example/business', 'D an off-host target answers target-off-host and changes nothing');
  perform t.ok(public.nexra_keyword_set_target('halcyon-fintech', kw, 'https://halcyon.example/business', t.kop())->>'outcome' = 'same-target', 'D the same target answers same-target');
  perform t.ok(public.nexra_keyword_set_target('halcyon-fintech', kw, null, t.kop())->>'outcome' = 'target-changed', 'D a target may be cleared');
  perform t.ok(t.err(format($q$select public.nexra_keyword_set_target('halcyon-fintech', %L, 'not a url', t.kop())$q$, kw)) = '22023', 'D a malformed target raises 22023');

  perform t.ok(public.nexra_keyword_set_note('halcyon-fintech', kw, 'Priority for Q4.', t.kop())->>'outcome' = 'note-changed', 'D note set');
  perform t.ok(public.nexra_keyword_set_note('halcyon-fintech', kw, ' Priority for Q4. ', t.kop())->>'outcome' = 'same-note', 'D a note equal after trimming is same-note');
  perform t.ok(public.nexra_keyword_set_note('halcyon-fintech', other, 'x', t.kop())->>'outcome' = 'keyword-not-found', 'D another project''s keyword through this project: keyword-not-found');
  perform t.ok(public.nexra_keyword_set_note('verdant-home', other, 'Verdant note.', t.kop())->>'outcome' = 'note-changed', 'D and through its own project it changes');

  select count(*) into n from nexra_keyword_events where keyword_id = kw;
  perform t.ok(n = 9, 'D one event per change and none for a refusal or no-op: ' || n);
  perform t.ok((select array_agg(event_type order by seq) from nexra_keyword_events where keyword_id = kw)
    = array['created','status-changed','status-changed','status-changed','group-changed','group-changed','target-changed','target-changed','note-changed'], 'D events in seq order');
end $$;

-- E: guards and isolation.
do $$
declare kw uuid := t.kid();
begin
  perform t.ok(t.err(format($q$update nexra_keywords set note = 'direct' where id = %L$q$, kw)) = '23514', 'E a direct update outside the functions is refused (23514)');
  perform t.ok(t.err(format($q$update nexra_keywords set query = 'renamed' where id = %L$q$, kw)) = '23514', 'E the query never changes (23514)');
  perform t.ok(t.err(format($q$update nexra_keywords set project_id = 'verdant-home' where id = %L$q$, kw)) = '23514', 'E the project never changes (23514)');
  perform set_config('nexra.keyword_write', kw::text, true);
  perform t.ok(t.err(format($q$update nexra_keywords set query = 'x' where id = %L$q$, kw)) = '23514', 'E even under the flag, identity never changes (23514)');
  perform set_config('nexra.keyword_write', '', true);
  perform t.ok(t.err(format($q$delete from nexra_keywords where id = %L$q$, kw)) = '23514', 'E a keyword is never deleted (23514)');
  perform t.ok(t.err($q$truncate nexra_keywords cascade$q$) in ('23514', '0A000'), 'E a keyword table truncate is refused');
  perform t.ok(t.err($q$update nexra_keyword_events set actor = gen_random_uuid()$q$) = '23514', 'E an event is never updated (23514)');
  perform t.ok(t.err($q$delete from nexra_keyword_events$q$) = '23514', 'E an event is never deleted (23514)');
  perform t.ok(t.err($q$truncate nexra_keyword_events$q$) = '23514', 'E the events are never truncated (23514)');
  perform t.ok(t.err(format($q$insert into nexra_keyword_events (keyword_id, project_id, event_type, from_status, actor) values (%L, 'halcyon-fintech', 'created', 'tracked', t.kop())$q$, kw)) = '23514', 'E an event with fields its type does not carry is refused (23514)');
  perform t.ok(t.err(format($q$insert into nexra_keyword_events (keyword_id, project_id, event_type, from_status, to_status, actor) values (%L, 'halcyon-fintech', 'status-changed', 'paused', 'paused', t.kop())$q$, kw)) = '23514', 'E a status event that changes nothing is refused (23514)');
  perform t.ok(t.err(format($q$insert into nexra_keyword_events (keyword_id, project_id, event_type, from_value, to_value, actor) values (%L, 'halcyon-fintech', 'note-changed', 'a', 'a', t.kop())$q$, kw)) = '23514', 'E a value event that changes nothing is refused (23514)');
  perform t.ok(t.err($q$delete from projects where id = 'halcyon-fintech'$q$) = '23503', 'E a project with curated keywords is not deleted (23503)');
  perform t.ok((select count(*) from t.snaps_before) = (select count(*) from nexra_search_console_snapshots)
    and not exists (select 1 from t.snaps_before b join nexra_search_console_snapshots s using (id) where s.queries is distinct from b.queries), 'E the stored Search Console rows are untouched');
  perform t.ok((select count(*) from nexra_agent_tasks) = 0, 'E no task was created by curating');
end $$;
