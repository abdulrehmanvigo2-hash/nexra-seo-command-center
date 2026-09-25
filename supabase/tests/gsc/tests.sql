-- M1 CP1a Search Console snapshots: sections A (schema), B (security), C (validation), D (recording, duplicates, immutability, isolation).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema.
do $$
declare cols text[];
begin
  perform t.ok(to_regclass('public.nexra_search_console_snapshots') is not null, 'A table exists');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_search_console_snapshots';
  perform t.ok(cols = array['id','project_id','property','range_id','days','start_date','end_date','state','clicks','impressions','ctr','position','queries','pages','partial','source','fetched_at','captured_at'], 'A columns in order: ' || cols::text);
  perform t.ok((select array_agg(column_name::text order by column_name) from information_schema.columns where table_name = 'nexra_search_console_snapshots' and is_nullable = 'YES') = array['clicks','ctr','impressions','position'], 'A only the four totals nullable');
  perform t.ok((select array_agg(conname::text order by conname) from pg_constraint where conrelid = 'public.nexra_search_console_snapshots'::regclass and contype = 'f') = array['nexra_search_console_snapshots_project_fkey'], 'A one foreign key, to projects');
  perform t.ok((select confdeltype from pg_constraint where conname = 'nexra_search_console_snapshots_project_fkey') = 'r', 'A the foreign key is on delete restrict');
  perform t.ok((select count(*) from pg_constraint where conrelid = 'public.nexra_search_console_snapshots'::regclass and contype = 'c') = 13, 'A thirteen check constraints');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_search_console_snapshots_one_per_window') = 'UNIQUE (project_id, property, range_id, end_date)', 'A one snapshot per project, property, range and window end');
  perform t.ok((select indexdef from pg_indexes where indexname = 'nexra_search_console_snapshots_project_idx') like '%(project_id, range_id, end_date DESC)', 'A history index');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_search_console_snapshots'::regclass and not tgisinternal)
    = array['nexra_search_console_snapshots_guard_delete','nexra_search_console_snapshots_guard_truncate','nexra_search_console_snapshots_guard_update'], 'A three guard triggers, no insert trigger');
  perform t.ok((select bool_and(tgenabled = 'O') from pg_trigger where tgrelid = 'public.nexra_search_console_snapshots'::regclass and not tgisinternal), 'A guards enabled');
  perform t.ok((select provolatile from pg_proc where oid = 'public.nexra_search_console_rows_valid(jsonb,integer,integer)'::regprocedure) = 'i', 'A the row validator is immutable');
  perform t.ok((select count(*) from pg_constraint where conrelid = 'public.nexra_search_console_snapshots'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%nexra_search_console_rows_valid(%') = 2, 'A queries and pages are checked by the validator');
end $$;

-- B: security.
do $$
declare f text; fns text[] := array[
  'public.nexra_search_console_snapshot_record(text,text,text,date,date,text,bigint,bigint,numeric,numeric,jsonb,jsonb,text[],timestamptz)',
  'public.nexra_search_console_rows_valid(jsonb,integer,integer)',
  'public.nexra_search_console_snapshots_guard_write()'];
begin
  create role tg_nobody nologin;
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_search_console_snapshots'::regclass), 'B RLS enabled');
  perform t.ok((select count(*) from pg_policy where polrelid = 'public.nexra_search_console_snapshots'::regclass) = 0, 'B no policies');
  perform t.ok((select pg_get_userbyid(relowner) from pg_class where oid = 'public.nexra_search_console_snapshots'::regclass) = 'postgres', 'B table owned by the migration owner');
  foreach f in array array['anon','authenticated','tg_nobody'] loop
    perform t.ok(not has_table_privilege(f, 'public.nexra_search_console_snapshots', 'select,insert,update,delete,truncate,references,trigger'), 'B ' || f || ': no table privilege');
  end loop;
  perform t.ok(has_table_privilege('service_role', 'public.nexra_search_console_snapshots', 'select'), 'B service_role: select');
  perform t.ok(not has_table_privilege('service_role', 'public.nexra_search_console_snapshots', 'insert,update,delete,truncate,references,trigger'), 'B service_role: no direct write');
  foreach f in array fns loop
    perform t.ok(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('tg_nobody', f, 'execute'), 'B no public/anon/authenticated execute: ' || f);
    perform t.ok((select proconfig = array['search_path=""'] from pg_proc where oid = f::regprocedure), 'B empty search_path: ' || f);
    perform t.ok((select pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = f::regprocedure), 'B owner: ' || f);
  end loop;
  perform t.ok(has_function_privilege('service_role', fns[1], 'execute'), 'B service_role executes record');
  perform t.ok(not has_function_privilege('service_role', fns[2], 'execute') and not has_function_privilege('service_role', fns[3], 'execute'), 'B service_role executes no helper or trigger function');
  perform t.ok((select prosecdef from pg_proc where oid = fns[1]::regprocedure) and not (select prosecdef from pg_proc where oid = fns[2]::regprocedure) and not (select prosecdef from pg_proc where oid = fns[3]::regprocedure), 'B only record is security definer');
  -- The whole-database security definer inventory is asserted in c5/tests.sql; here, the snapshot record function and (since 20260930120000, M1 P4c) the query × page record function are the only two.
  perform t.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and prosecdef and proname like 'nexra_search_console%') = 2, 'B two security definer search-console functions');
end $$;

-- A direct insert by service_role is refused: the record function is the only write path.
set role service_role;
do $$
begin
  perform t.ok(t.err($q$ insert into public.nexra_search_console_snapshots (project_id, property, range_id, days, start_date, end_date, state, fetched_at)
    values ('halcyon-fintech', 'sc-domain:halcyon.example', '30d', 30, t.win_start(), t.win_end(), 'no-data', now()) $q$) = '42501', 'B service_role direct insert: permission denied');
  perform t.ok((t.snap_nodata(p_end => t.win_end(40)) ->> 'outcome') = 'created', 'B service_role records through the function');
end $$;
reset role;

-- C: validation. Every refusal is a check_violation (23514) from the table, or the function's own check.
do $$
declare v jsonb;
begin
  perform t.ok(public.nexra_search_console_rows_valid('[]', 25, 2048), 'C validator: empty list');
  perform t.ok(public.nexra_search_console_rows_valid(t.rows(25), 25, 2048), 'C validator: 25 rows');
  perform t.ok(not public.nexra_search_console_rows_valid(t.rows(26), 25, 2048), 'C validator: 26 rows refused');
  perform t.ok(not public.nexra_search_console_rows_valid('{}', 25, 2048) and not public.nexra_search_console_rows_valid('"x"', 25, 2048) and not public.nexra_search_console_rows_valid(null, 25, 2048), 'C validator: not an array refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[1]', 25, 2048) and not public.nexra_search_console_rows_valid('[null]', 25, 2048), 'C validator: element not an object refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":1,"impressions":2,"ctr":0.5}]', 25, 2048), 'C validator: missing metric refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":1,"impressions":2,"ctr":0.5,"position":1,"extra":1}]', 25, 2048), 'C validator: extra key refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"","clicks":1,"impressions":2,"ctr":0.5,"position":1}]', 25, 2048), 'C validator: empty key refused');
  perform t.ok(not public.nexra_search_console_rows_valid(jsonb_build_array(jsonb_build_object('key', repeat('k', 2049), 'clicks', 1, 'impressions', 2, 'ctr', 0.5, 'position', 1)), 25, 2048)
    and public.nexra_search_console_rows_valid(jsonb_build_array(jsonb_build_object('key', repeat('k', 2048), 'clicks', 1, 'impressions', 2, 'ctr', 0.5, 'position', 1)), 25, 2048), 'C validator: key length bound');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":1,"clicks":1,"impressions":2,"ctr":0.5,"position":1}]', 25, 2048), 'C validator: key not a string refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":"1","impressions":2,"ctr":0.5,"position":1}]', 25, 2048), 'C validator: metric not a number refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":-1,"impressions":2,"ctr":0.5,"position":1}]', 25, 2048), 'C validator: negative clicks refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":0,"impressions":0,"ctr":0,"position":0}]', 25, 2048), 'C validator: zero impressions refused (no observed position)');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":3,"impressions":2,"ctr":1,"position":1}]', 25, 2048), 'C validator: clicks above impressions refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":1,"impressions":2,"ctr":1.5,"position":1}]', 25, 2048), 'C validator: ctr above 1 refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":1,"impressions":2,"ctr":0.5,"position":-1}]', 25, 2048), 'C validator: negative position refused');
  perform t.ok(not public.nexra_search_console_rows_valid('[{"key":"a","clicks":1,"impressions":2,"ctr":0.5,"position":1},{"key":"a","clicks":1,"impressions":2,"ctr":0.5,"position":1}]', 25, 2048), 'C validator: repeated key refused');

  -- Through the record function: shape refusals from the table's constraints.
  perform t.ok(t.err($q$ select t.snap(p_property => 'halcyon.example') $q$) = '23514', 'C property without sc-domain: or scheme refused');
  perform t.ok(t.err($q$ select t.snap(p_property => 'https://halcyon.example') $q$) = '23514', 'C URL property without trailing slash refused');
  perform t.ok(t.err($q$ select t.snap(p_property => 'https://halcyon.example/?q=1') $q$) = '23514', 'C URL property with a query refused');
  perform t.ok(t.err($q$ select t.snap(p_property => 'sc-domain:Halcyon.Example') $q$) = '23514', 'C upper-case domain property refused');
  perform t.ok((t.snap(p_property => 'https://www.halcyon.example/blog/', p_end => t.win_end(41)) ->> 'outcome') = 'created', 'C URL-prefix property with a path accepted');
  perform t.ok(t.err($q$ select t.snap(p_range => '7d') $q$) = '23514', 'C range other than 30d refused');
  perform t.ok(t.err($q$ select t.snap(p_start => t.win_start() + 1) $q$) = '23514', 'C 29-day window refused');
  perform t.ok(t.err($q$ select t.snap(p_start => t.win_start() - 1) $q$) = '23514', 'C 31-day window refused');
  perform t.ok(t.err($q$ select t.snap(p_end => current_date, p_start => current_date - 29) $q$) = '23514', 'C window ending today refused');
  perform t.ok(t.err($q$ select t.snap(p_end => current_date + 1, p_start => current_date - 28) $q$) = '23514', 'C window ending tomorrow refused');
  perform t.ok(t.err($q$ select t.snap(p_state => 'unavailable') $q$) = '23514', 'C state other than connected/no-data refused');
  perform t.ok(t.err($q$ select t.snap(p_clicks => null) $q$) = '23514', 'C connected with a missing total refused');
  perform t.ok(t.err($q$ select t.snap(p_state => 'no-data', p_queries => '[]', p_pages => '[]') $q$) = '23514', 'C no-data with totals refused');
  perform t.ok(t.err($q$ select t.snap(p_state => 'no-data', p_clicks => null, p_impressions => null, p_ctr => null, p_position => null, p_pages => '[]') $q$) = '23514', 'C no-data with queries refused');
  perform t.ok(t.err($q$ select t.snap(p_impressions => 0, p_clicks => 0) $q$) = '23514', 'C connected with zero impressions refused');
  perform t.ok(t.err($q$ select t.snap(p_clicks => 5000) $q$) = '23514', 'C clicks above impressions refused');
  perform t.ok(t.err($q$ select t.snap(p_ctr => 1.01) $q$) = '23514', 'C ctr above 1 refused');
  perform t.ok(t.err($q$ select t.snap(p_position => -0.5) $q$) = '23514', 'C negative position refused');
  perform t.ok(t.err($q$ select t.snap(p_queries => t.rows(26)) $q$) = '23514', 'C 26 queries refused');
  perform t.ok(t.err($q$ select t.snap(p_pages => '[{"key":"https://halcyon.example/","clicks":1,"impressions":0,"ctr":0,"position":0}]') $q$) = '23514', 'C page row with zero impressions refused');
  perform t.ok(t.err($q$ select t.snap(p_partial => array['comparison-unavailable']) $q$) = '23514', 'C unknown partial marker refused');
  perform t.ok(t.err($q$ select t.snap(p_partial => array['queries-unavailable','queries-unavailable']) $q$) = '23514', 'C repeated partial marker refused');
  perform t.ok(t.err($q$ select t.snap(p_fetched => now() + interval '1 hour') $q$) = '23514', 'C fetched_at well after capture refused');
  perform t.ok(t.err($q$ select t.snap(p_project => null) $q$) = '22023', 'C null argument refused (invalid_parameter_value)');
  perform t.ok(t.err($q$ select public.nexra_search_console_snapshot_record('halcyon-fintech','sc-domain:halcyon.example','30d',t.win_start(),t.win_end(),'connected',1,2,0.5,1.0,'[]','[]',null,now()) $q$) = '22023', 'C null partial refused');
  perform t.ok((t.snap(p_project => 'no-such-project') ->> 'outcome') = 'not-found', 'C unknown project: not-found, nothing written');
  perform t.ok((select count(*) from public.nexra_search_console_snapshots where project_id = 'no-such-project') = 0, 'C unknown project left no row');
  -- Secrets never belong in a snapshot; the schema holds no credential column, and a key is stored as data only.
  perform t.ok((select count(*) from information_schema.columns where table_name = 'nexra_search_console_snapshots' and column_name ~* 'token|secret|key|password|credential') = 0, 'C no credential-shaped column');
end $$;

-- D: recording, duplicates, immutability, isolation.
do $$
declare v jsonb; w jsonb; first_id uuid;
begin
  v := t.snap();
  perform t.ok((v ->> 'outcome') = 'created', 'D connected snapshot created');
  first_id := (v -> 'snapshot' ->> 'id')::uuid;
  perform t.ok((v -> 'snapshot' ->> 'state') = 'connected' and (v -> 'snapshot' ->> 'days') = '30' and (v -> 'snapshot' ->> 'clicks') = '120' and (v -> 'snapshot' ->> 'impressions') = '4000'
    and (v -> 'snapshot' ->> 'ctr') = '0.030000' and (v -> 'snapshot' ->> 'position') = '12.400' and (v -> 'snapshot' ->> 'source') = 'scheduled'
    and jsonb_array_length(v -> 'snapshot' -> 'queries') = 25 and jsonb_array_length(v -> 'snapshot' -> 'pages') = 25 and (v -> 'snapshot' ->> 'partial') = '[]', 'D created row carries the recorded values');
  perform t.ok((select days from public.nexra_search_console_snapshots where id = first_id) = 30 and (select end_date - start_date + 1 from public.nexra_search_console_snapshots where id = first_id) = 30, 'D days derived from the window');
  perform t.ok((select captured_at >= fetched_at from public.nexra_search_console_snapshots where id = first_id), 'D captured after fetched');

  w := t.snap(p_clicks => 999, p_queries => t.rows(3));
  perform t.ok((w ->> 'outcome') = 'exists' and (w -> 'snapshot' ->> 'id') = first_id::text and (w -> 'snapshot' ->> 'clicks') = '120', 'D same window again: exists, the first row, nothing rewritten');
  perform t.ok((select count(*) from public.nexra_search_console_snapshots where project_id = 'halcyon-fintech' and property = 'sc-domain:halcyon.example' and end_date = t.win_end()) = 1, 'D one row for the window');
  perform t.ok((t.snap(p_end => t.win_end(4), p_start => t.win_start(4)) ->> 'outcome') = 'created', 'D the previous day''s window is a new row');
  perform t.ok((t.snap(p_property => 'https://halcyon.example/') ->> 'outcome') = 'created', 'D another property, same project and window: a new row');

  v := t.snap_nodata(p_end => t.win_end(5));
  perform t.ok((v ->> 'outcome') = 'created' and (v -> 'snapshot' ->> 'state') = 'no-data' and (v -> 'snapshot' -> 'clicks') = 'null'::jsonb and (v -> 'snapshot' ->> 'queries') = '[]', 'D no-data snapshot: nulls, empty lists');
  v := t.snap(p_end => t.win_end(6), p_start => t.win_start(6), p_pages => '[]', p_partial => array['pages-unavailable']);
  perform t.ok((v ->> 'outcome') = 'created' and (v -> 'snapshot' ->> 'partial') = '["pages-unavailable"]', 'D partial connected snapshot recorded with its marker');

  -- Immutable.
  perform t.ok(t.err(format($q$ update public.nexra_search_console_snapshots set clicks = 1 where id = %L $q$, first_id)) = '23514', 'D update refused');
  perform t.ok(t.err(format($q$ update public.nexra_search_console_snapshots set captured_at = now() where id = %L $q$, first_id)) = '23514', 'D update of the timestamp refused');
  perform t.ok(t.err(format($q$ delete from public.nexra_search_console_snapshots where id = %L $q$, first_id)) = '23514', 'D delete refused');
  perform t.ok(t.err($q$ truncate public.nexra_search_console_snapshots $q$) = '23514', 'D truncate refused');
  perform t.ok(t.err($q$ delete from public.projects where id = 'halcyon-fintech' $q$) = '23503', 'D a project with snapshots cannot be deleted');
  perform t.ok((select clicks from public.nexra_search_console_snapshots where id = first_id) = 120, 'D the first row is intact');

  -- Isolation: the store contract reads by project; another project's rows never answer.
  perform t.ok((t.snap(p_project => 'verdant-home', p_property => 'sc-domain:verdant.example') ->> 'outcome') = 'created', 'D another project records its own window');
  perform t.ok((t.snap(p_project => 'verdant-home', p_property => 'sc-domain:halcyon.example', p_end => t.win_end(7), p_start => t.win_start(7)) ->> 'outcome') = 'created', 'D a property shared by two projects is keyed per project');
  perform t.ok((select count(*) from public.nexra_search_console_snapshots where project_id = 'halcyon-fintech') = 7
    and (select count(*) from public.nexra_search_console_snapshots where project_id = 'verdant-home') = 2, 'D per-project reads see only that project''s rows');
  perform t.ok((select count(*) from public.nexra_search_console_snapshots where project_id = 'halcyon-fintech' and property = 'sc-domain:verdant.example') = 0, 'D no cross-project row');
end $$;
