-- M1 P4c Search Console query × page rows: sections A (schema), B (security), C (validation), D (recording, exists, immutability, isolation).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema.
do $$
declare cols text[];
begin
  perform t.ok(to_regclass('public.nexra_search_console_query_pages') is not null, 'A table exists');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_search_console_query_pages';
  perform t.ok(cols = array['id','project_id','property','range_id','days','start_date','end_date','query','page','clicks','impressions','ctr','position','source','fetched_at','captured_at'], 'A columns in order: ' || cols::text);
  perform t.ok((select count(*) from information_schema.columns where table_name = 'nexra_search_console_query_pages' and is_nullable = 'YES') = 0, 'A no nullable column');
  perform t.ok((select array_agg(conname::text order by conname) from pg_constraint where conrelid = 'public.nexra_search_console_query_pages'::regclass and contype = 'f') = array['nexra_search_console_query_pages_project_fkey'], 'A one foreign key, to projects');
  perform t.ok((select confdeltype from pg_constraint where conname = 'nexra_search_console_query_pages_project_fkey') = 'r', 'A the foreign key is on delete restrict');
  perform t.ok((select count(*) from pg_constraint where conrelid = 'public.nexra_search_console_query_pages'::regclass and contype = 'c') = 9, 'A nine check constraints');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_search_console_query_pages_one_per_pair') = 'UNIQUE (project_id, property, range_id, end_date, query, page)', 'A one row per project, property, range, window end, query and page');
  perform t.ok((select indexdef from pg_indexes where indexname = 'nexra_search_console_query_pages_window_idx') like '%(project_id, range_id, end_date DESC, property)', 'A window index');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_search_console_query_pages'::regclass and not tgisinternal)
    = array['nexra_search_console_query_pages_guard_delete','nexra_search_console_query_pages_guard_truncate','nexra_search_console_query_pages_guard_update'], 'A three guard triggers, no insert trigger');
  perform t.ok((select bool_and(tgenabled = 'O') from pg_trigger where tgrelid = 'public.nexra_search_console_query_pages'::regclass and not tgisinternal), 'A guards enabled');
  perform t.ok((select provolatile from pg_proc where oid = 'public.nexra_search_console_pairs_valid(jsonb,integer,integer)'::regprocedure) = 'i', 'A the pair validator is immutable');
  perform t.ok((select count(*) from pg_class where relname = 'nexra_search_console_snapshots') = 1 and (select count(*) from pg_constraint where conrelid = 'public.nexra_search_console_snapshots'::regclass and contype = 'c') = 13, 'A the snapshot table is unchanged');
end $$;

-- B: security.
do $$
declare f text; fns text[] := array[
  'public.nexra_search_console_query_pages_record(text,text,text,date,date,jsonb,timestamptz)',
  'public.nexra_search_console_pairs_valid(jsonb,integer,integer)',
  'public.nexra_search_console_query_pages_guard_write()'];
begin
  if not exists (select 1 from pg_roles where rolname = 'tg_nobody') then create role tg_nobody nologin; end if;
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_search_console_query_pages'::regclass), 'B RLS enabled');
  perform t.ok((select count(*) from pg_policy where polrelid = 'public.nexra_search_console_query_pages'::regclass) = 0, 'B no policies');
  perform t.ok((select pg_get_userbyid(relowner) from pg_class where oid = 'public.nexra_search_console_query_pages'::regclass) = 'postgres', 'B table owned by the migration owner');
  foreach f in array array['anon','authenticated','tg_nobody'] loop
    perform t.ok(not has_table_privilege(f, 'public.nexra_search_console_query_pages', 'select,insert,update,delete,truncate,references,trigger'), 'B ' || f || ': no table privilege');
  end loop;
  perform t.ok(has_table_privilege('service_role', 'public.nexra_search_console_query_pages', 'select'), 'B service_role: select');
  perform t.ok(not has_table_privilege('service_role', 'public.nexra_search_console_query_pages', 'insert,update,delete,truncate,references,trigger'), 'B service_role: no direct write');
  foreach f in array fns loop
    perform t.ok(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('tg_nobody', f, 'execute'), 'B no public/anon/authenticated execute: ' || f);
    perform t.ok((select proconfig = array['search_path=""'] from pg_proc where oid = f::regprocedure), 'B empty search_path: ' || f);
    perform t.ok((select pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = f::regprocedure), 'B owner: ' || f);
  end loop;
  perform t.ok(has_function_privilege('service_role', fns[1], 'execute'), 'B service_role executes record');
  perform t.ok(not has_function_privilege('service_role', fns[2], 'execute') and not has_function_privilege('service_role', fns[3], 'execute'), 'B service_role executes no helper or trigger function');
  perform t.ok((select prosecdef from pg_proc where oid = fns[1]::regprocedure) and not (select prosecdef from pg_proc where oid = fns[2]::regprocedure) and not (select prosecdef from pg_proc where oid = fns[3]::regprocedure), 'B only record is security definer');
  -- The whole-database security definer inventory is asserted in c5/tests.sql; here, the snapshot and the pair record functions are the only two.
  perform t.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and prosecdef and proname like 'nexra_search_console%') = 2, 'B two security definer search-console functions');
end $$;

-- A direct insert by service_role is refused: the record function is the only write path.
set role service_role;
do $$
begin
  perform t.ok(t.err($q$ insert into public.nexra_search_console_query_pages (project_id, property, range_id, days, start_date, end_date, query, page, clicks, impressions, ctr, position, fetched_at)
    values ('halcyon-fintech', 'sc-domain:halcyon.example', '30d', 30, t.win_start(), t.win_end(), 'q', 'https://halcyon.example/', 1, 2, 0.5, 1, now()) $q$) = '42501', 'B service_role direct insert: permission denied');
  perform t.ok((t.qp(p_end => t.win_end(40)) ->> 'outcome') = 'created', 'B service_role records through the function');
  perform t.ok(t.err($q$ select public.nexra_search_console_pairs_valid('[]', 250, 2048) $q$) = '42501', 'B service_role cannot call the validator directly');
end $$;
reset role;

-- C: validation. A malformed list is invalid_parameter_value (22023) from the function, before any write.
do $$
declare v jsonb;
begin
  perform t.ok(public.nexra_search_console_pairs_valid('[]', 250, 2048), 'C validator: empty list is well-formed (the function refuses it separately)');
  perform t.ok(public.nexra_search_console_pairs_valid(t.pairs(250), 250, 2048), 'C validator: 250 pairs');
  perform t.ok(not public.nexra_search_console_pairs_valid(t.pairs(251), 250, 2048), 'C validator: 251 pairs refused');
  perform t.ok(not public.nexra_search_console_pairs_valid('{}', 250, 2048) and not public.nexra_search_console_pairs_valid('"x"', 250, 2048) and not public.nexra_search_console_pairs_valid(null, 250, 2048), 'C validator: not an array refused');
  perform t.ok(not public.nexra_search_console_pairs_valid('[1]', 250, 2048) and not public.nexra_search_console_pairs_valid('[null]', 250, 2048), 'C validator: element not an object refused');
  perform t.ok(not public.nexra_search_console_pairs_valid('[{"query":"a","page":"https://h.example/","clicks":1,"impressions":2,"ctr":0.5}]', 250, 2048), 'C validator: missing metric refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/') || '{"extra":1}'), 250, 2048), 'C validator: extra key refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('', 'https://h.example/')), 250, 2048), 'C validator: empty query refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', '')), 250, 2048), 'C validator: empty page refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', '/relative')), 250, 2048) and not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'ftp://h.example/')), 250, 2048), 'C validator: page not an absolute http(s) URL refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/a b')), 250, 2048), 'C validator: page with whitespace refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair(repeat('k', 2049), 'https://h.example/')), 250, 2048)
    and public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair(repeat('k', 2048), 'https://h.example/')), 250, 2048), 'C validator: query length bound');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/' || repeat('k', 2031))), 250, 2048)
    and public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/' || repeat('k', 2030))), 250, 2048), 'C validator: page length bound (2,048 characters kept, 2,049 refused)');
  perform t.ok(not public.nexra_search_console_pairs_valid('[{"query":1,"page":"https://h.example/","clicks":1,"impressions":2,"ctr":0.5,"position":1}]', 250, 2048), 'C validator: query not a string refused');
  perform t.ok(not public.nexra_search_console_pairs_valid('[{"query":"a","page":"https://h.example/","clicks":"1","impressions":2,"ctr":0.5,"position":1}]', 250, 2048), 'C validator: metric not a number refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/', clicks => -1)), 250, 2048), 'C validator: negative clicks refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/', clicks => 0, impressions => 0, ctr => 0, pos => 0)), 250, 2048), 'C validator: zero impressions refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/', clicks => 3, impressions => 2, ctr => 1)), 250, 2048), 'C validator: clicks above impressions refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/', ctr => 1.5)), 250, 2048), 'C validator: ctr above 1 refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/', pos => -1)), 250, 2048), 'C validator: negative position refused');
  perform t.ok(not public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/'), t.pair('a', 'https://h.example/', clicks => 2)), 250, 2048), 'C validator: repeated pair refused');
  perform t.ok(public.nexra_search_console_pairs_valid(jsonb_build_array(t.pair('a', 'https://h.example/'), t.pair('a', 'https://h.example/2'), t.pair('b', 'https://h.example/')), 250, 2048), 'C validator: one query on two pages and one page under two queries accepted');

  -- Through the record function.
  perform t.ok(t.err($q$ select t.qp(p_pairs => '[]') $q$) = '22023', 'C empty list refused (22023), nothing written');
  perform t.ok(t.err($q$ select t.qp(p_pairs => t.pairs(251)) $q$) = '22023', 'C 251 pairs refused (22023)');
  perform t.ok(t.err($q$ select t.qp(p_pairs => jsonb_build_array(t.pair('a', '/relative'))) $q$) = '22023', 'C malformed pair refused (22023)');
  perform t.ok(t.err($q$ select t.qp(p_pairs => '{}') $q$) = '22023', 'C not an array refused (22023)');
  perform t.ok((select count(*) from public.nexra_search_console_query_pages where project_id = 'halcyon-fintech' and end_date = t.win_end()) = 0, 'C refusals wrote nothing');
  perform t.ok(t.err($q$ select t.qp(p_property => 'halcyon.example') $q$) = '23514', 'C property without sc-domain: or scheme refused');
  perform t.ok(t.err($q$ select t.qp(p_property => 'https://halcyon.example') $q$) = '23514', 'C URL property without trailing slash refused');
  perform t.ok(t.err($q$ select t.qp(p_property => 'sc-domain:Halcyon.Example') $q$) = '23514', 'C upper-case domain property refused');
  perform t.ok(t.err($q$ select t.qp(p_range => '7d') $q$) = '23514', 'C range other than 30d refused');
  perform t.ok(t.err($q$ select t.qp(p_start => t.win_start() + 1) $q$) = '23514', 'C 29-day window refused');
  perform t.ok(t.err($q$ select t.qp(p_start => t.win_start() - 1) $q$) = '23514', 'C 31-day window refused');
  perform t.ok(t.err($q$ select t.qp(p_end => current_date, p_start => current_date - 29) $q$) = '23514', 'C window ending today refused');
  perform t.ok(t.err($q$ select t.qp(p_end => current_date + 1, p_start => current_date - 28) $q$) = '23514', 'C window ending tomorrow refused');
  perform t.ok(t.err($q$ select t.qp(p_fetched => now() + interval '1 hour') $q$) = '23514', 'C fetched_at well after capture refused');
  perform t.ok(t.err($q$ select t.qp(p_project => null) $q$) = '22023', 'C null argument refused (invalid_parameter_value)');
  perform t.ok(t.err($q$ select public.nexra_search_console_query_pages_record('halcyon-fintech','sc-domain:halcyon.example','30d',t.win_start(),t.win_end(),t.pairs(1),null) $q$) = '22023', 'C null fetched_at refused');
  perform t.ok((t.qp(p_project => 'no-such-project') ->> 'outcome') = 'not-found', 'C unknown project: not-found, nothing written');
  perform t.ok((select count(*) from public.nexra_search_console_query_pages where project_id = 'no-such-project') = 0, 'C unknown project left no row');
  perform t.ok((select count(*) from information_schema.columns where table_name = 'nexra_search_console_query_pages' and column_name ~* 'token|secret|key|password|credential') = 0, 'C no credential-shaped column');
end $$;

-- D: recording, exists, immutability, isolation.
do $$
declare v jsonb; w jsonb; n int;
begin
  v := t.qp(p_pairs => jsonb_build_array(t.pair('q1', 'https://halcyon.example/a', 12, 300, 0.04, 4.2), t.pair('q1', 'https://halcyon.example/b', 3, 120, 0.025, 6.8), t.pair('q2', 'https://halcyon.example/a', 1, 40)));
  perform t.ok((v ->> 'outcome') = 'created' and (v ->> 'count') = '3', 'D three pairs created in one call');
  perform t.ok((select count(*) from public.nexra_search_console_query_pages where project_id = 'halcyon-fintech' and end_date = t.win_end()) = 3, 'D three rows for the window');
  perform t.ok((select clicks || '/' || impressions || '/' || ctr || '/' || position || '/' || days || '/' || source from public.nexra_search_console_query_pages where query = 'q1' and page = 'https://halcyon.example/a' and end_date = t.win_end())
    = '12/300/0.040000/4.200/30/scheduled', 'D a row carries the recorded values');
  perform t.ok((select bool_and(captured_at >= fetched_at and end_date - start_date + 1 = 30) from public.nexra_search_console_query_pages), 'D captured after fetched; days derived from the window');

  w := t.qp(p_pairs => t.pairs(5));
  perform t.ok((w ->> 'outcome') = 'exists' and (w ->> 'count') = '3', 'D same window again: exists with the stored count, nothing written');
  perform t.ok((select count(*) from public.nexra_search_console_query_pages where project_id = 'halcyon-fintech' and end_date = t.win_end()) = 3, 'D still three rows: a second answer never extends the set');
  perform t.ok((t.qp(p_end => t.win_end(4), p_start => t.win_start(4)) ->> 'outcome') = 'created', 'D the previous day''s window is a new set');
  perform t.ok((t.qp(p_property => 'https://halcyon.example/') ->> 'outcome') = 'created', 'D another property, same project and window: a new set');
  perform t.ok((t.qp(p_project => 'verdant-home') ->> 'outcome') = 'created', 'D another project, same window: a new set');
  perform t.ok((t.qp(p_pairs => t.pairs(250), p_end => t.win_end(12), p_start => t.win_start(12)) ->> 'count') = '250', 'D 250 pairs, the per-capture limit, recorded');

  -- Immutable.
  perform t.ok(t.err($q$ update public.nexra_search_console_query_pages set clicks = 0 where query = 'q1' $q$) = '23514', 'D update refused by the guard');
  perform t.ok(t.err($q$ delete from public.nexra_search_console_query_pages where query = 'q1' $q$) = '23514', 'D delete refused by the guard');
  perform t.ok(t.err($q$ truncate public.nexra_search_console_query_pages $q$) = '23514', 'D truncate refused by the guard');
  perform t.ok(t.err($q$ delete from public.projects where id = 'halcyon-fintech' $q$) = '23503', 'D a project with rows cannot be deleted (restrict)');
  perform t.ok((select count(*) from public.nexra_search_console_query_pages where query = 'q1' and end_date = t.win_end() and clicks in (12, 3)) = 2, 'D rows unchanged after the refusals');

  -- Isolation: one project's rows never carry another's id, and the snapshot table is untouched.
  select count(*) into n from public.nexra_search_console_query_pages where project_id = 'verdant-home';
  perform t.ok(n = 3, 'D the other project holds only its own three rows');
  perform t.ok((select count(*) from public.nexra_search_console_snapshots) = 0, 'D no snapshot row was written by any pair call');
end $$;

-- The role this suite created for privilege checks, dropped so any suite order works.
drop role if exists tg_nobody;
