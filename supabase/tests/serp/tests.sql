-- M4 SERP results (migration 20261024120000): sections A (schema and security), B (serp_reserve: the keyword chosen in the
-- database, the shared cap, refusals), C (request_record and finish by kind), D (serp_record), E (the guards and the
-- opportunity's immutability), F (keyword snapshots unchanged). Part of the local PostgreSQL test harness; run only
-- through supabase/tests/run.sh. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema and security.
do $$
declare fn text;
begin
  perform t.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'nexra_serp_results')
    = array['id','run_id','request_id','project_id','opportunity_id','keyword','result_type','rank','url','domain','title','snippet','provider','mode','location_code','language_code','fetched_at'], 'A the result columns');
  perform t.ok(exists (select 1 from information_schema.columns where table_name = 'nexra_provider_runs' and column_name = 'opportunity_id' and is_nullable = 'YES'), 'A runs gain a nullable opportunity_id');
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_serp_results'::regclass) and (select count(*) from pg_policy where polrelid = 'public.nexra_serp_results'::regclass) = 0, 'A results: RLS on, no policies');
  perform t.ok((select array_agg(privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_serp_results' and grantee = 'service_role') = array['SELECT'], 'A results: service_role holds SELECT only');
  perform t.ok((select count(*) from information_schema.table_privileges where table_name = 'nexra_serp_results' and grantee in ('anon', 'authenticated', 'PUBLIC')) = 0, 'A results: anon, authenticated and PUBLIC hold nothing');
  perform t.ok((select array_agg(proname::text order by proname) from pg_proc where proname like 'nexra_provider%' and prosecdef)
    = array['nexra_provider_metrics_record','nexra_provider_request_record','nexra_provider_run_finish','nexra_provider_run_reserve','nexra_provider_run_resume','nexra_provider_serp_record','nexra_provider_serp_reserve'], 'A the seven write functions are security definer');
  perform t.ok((select bool_and(proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres') from pg_proc where proname like 'nexra_provider%'), 'A every provider function: empty search_path, owned by postgres');
  foreach fn in array array['public.nexra_provider_serp_reserve(text,uuid,integer,text,text,text,numeric,numeric,uuid)', 'public.nexra_provider_serp_record(uuid,uuid,jsonb)',
    'public.nexra_provider_request_record(uuid,smallint,text,jsonb,text,integer,text,numeric,integer,text,timestamptz,timestamptz)', 'public.nexra_provider_run_finish(uuid,text,numeric,numeric,text)'] loop
    perform t.ok(has_function_privilege('service_role', fn, 'EXECUTE') and not has_function_privilege('anon', fn, 'EXECUTE')
      and not has_function_privilege('authenticated', fn, 'EXECUTE') and not has_function_privilege('public', fn, 'EXECUTE'), format('A %s: EXECUTE for service_role only', split_part(fn, '(', 1)));
  end loop;
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_provider_runs_guard_update()', 'EXECUTE'), 'A the replaced update guard: executable by no API role');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_serp_results'::regclass and not tgisinternal)
    = array['nexra_serp_results_guard_delete','nexra_serp_results_guard_insert','nexra_serp_results_guard_truncate','nexra_serp_results_guard_update']
    and (select bool_and(tgenabled = 'O') from pg_trigger where tgrelid = 'public.nexra_serp_results'::regclass and not tgisinternal), 'A the four result triggers, enabled');
  perform t.ok((select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgrelid in ('public.nexra_provider_runs'::regclass, 'public.nexra_provider_requests'::regclass, 'public.nexra_keyword_metrics'::regclass)) = 12, 'A the twelve F0 guard triggers still enabled');
end $$;

-- B: serp_reserve, as service_role.
set role service_role;
do $$
declare o uuid; r jsonb; a uuid; other uuid;
begin
  o := t24.opp();
  r := t24.reserve(o);
  perform t.ok(r->>'outcome' = 'reserved', 'B a live SERP run: reserved');
  a := t.rid(r);
  perform t.ok((t.run(a)).kind = 'serp' and (t.run(a)).opportunity_id = o and (t.run(a)).seeds = array['seed 1'] and (t.run(a)).estimate_usd = 0.0024,
    'B the run is kind serp, names the opportunity and its cluster''s primary keyword, at its estimate');
  perform t.ok(t24.reserve(o)->>'outcome' = 'run-active', 'B a second run on the project while one is open: run-active');
  perform t.ok(t.reserve()->>'outcome' = 'run-active', 'B a keyword snapshot on the project while a SERP is open: run-active (one open run per project)');
  perform t.ok(t.finish(a, 'failed', 0, 0, 'test')->>'outcome' = 'finished', 'B the open run finishes failed with no calls');
  perform t.ok(t24.reserve(gen_random_uuid())->>'outcome' = 'opportunity-not-found', 'B an unknown opportunity: opportunity-not-found');
  other := t24.opp('verdant-home');
  perform t.ok(t24.reserve(other)->>'outcome' = 'opportunity-not-found', 'B another project''s opportunity: opportunity-not-found');
  perform t.ok(public.nexra_provider_serp_reserve('no-such-project', o, 2840, 'en', 'live', 'api.dataforseo.com', 0.0024, 1.00, t.pop())->>'outcome' = 'project-not-found', 'B an unknown project: project-not-found');
  perform t.ok(t.err(format($q$select t24.reserve(%L, p_host => 'sandbox.dataforseo.com')$q$, o)) = '22023', 'B a live run naming the sandbox host raises 22023');
  perform t.ok(t.err(format($q$select t24.reserve(%L, p_estimate => 2, p_cap => 1)$q$, o)) = '22023', 'B an estimate above the cap raises 22023');
  perform t.ok(t.err(format($q$select t24.reserve(%L, p_cap => 6)$q$, o)) = '22023', 'B a cap above the $5.00 ceiling raises 22023');
  perform t.ok(t.err($q$select public.nexra_provider_serp_reserve('halcyon-fintech', null, 2840, 'en', 'live', 'api.dataforseo.com', 0.0024, 1.00, t.pop())$q$) = '22023', 'B a missing opportunity raises 22023');
  -- The shared cap: the two maps' keyword snapshots are today's live spend; a SERP under a cap they already fill is refused.
  r := t24.reserve(o, p_cap => 0.05);
  perform t.ok(r->>'outcome' = 'cap-reached' and (r->>'spent_usd')::numeric = (select sum(cost_usd) from public.nexra_provider_runs where mode = 'live' and kind = 'keyword-snapshot')
    and (r->>'spent_usd')::numeric > 0, 'B the cap is shared with keyword snapshots: cap-reached, counting their spend');
  r := t24.reserve(o, p_mode => 'sandbox', p_estimate => 0.0024);
  perform t.ok(r->>'outcome' = 'reserved' and (t.run(t.rid(r))).estimate_usd = 0 and (t.run(t.rid(r))).api_host = 'sandbox.dataforseo.com', 'B a sandbox SERP is never counted: reserved at 0 even past the cap');
  perform t.finish(t.rid(r), 'failed', 0, 0, 'test');
end $$;
reset role;

-- C: request_record and finish by kind.
set role service_role;
do $$
declare o uuid; a uuid; k uuid; r jsonb;
begin
  o := (select opportunity_id from public.nexra_provider_runs where kind = 'serp' limit 1);
  a := t.rid(t24.reserve(o, p_mode => 'sandbox'));
  r := t.req(a, 0, 'succeeded', 0.013, 'dataforseo_labs/google/keyword_overview/live');
  perform t.ok(r->>'outcome' = 'endpoint-not-for-kind' and not exists (select 1 from public.nexra_provider_requests where run_id = a), 'C a Labs endpoint on a SERP run: endpoint-not-for-kind, nothing written');
  r := t24.req(a);
  perform t.ok(r->>'outcome' = 'recorded' and (r->'request'->>'cost_usd')::numeric = 0, 'C the SERP call on a sandbox run: recorded at cost 0');
  perform t.ok(t24.req(a)->>'outcome' = 'exists', 'C the same seq again: exists');
  perform t.ok(t.finish(a, 'completed')->>'outcome' = 'finished' and (t.run(a)).status = 'completed', 'C one succeeded call completes a SERP run (it plans seq 0 only)');
  -- A keyword snapshot still needs its planned calls, and refuses the SERP endpoint.
  k := t.rid(t.reserve('halcyon-fintech', 'sandbox'));
  perform t.ok(t24.req(k)->>'outcome' = 'endpoint-not-for-kind', 'C the SERP endpoint on a keyword snapshot: endpoint-not-for-kind');
  perform t.req(k, 0);
  perform t.ok(t.finish(k, 'completed')->>'outcome' = 'status-not-consistent', 'C a keyword snapshot with only its overview is still not completed');
  perform t.ok(t.finish(k, 'partial')->>'outcome' = 'finished', 'C it finishes partial');
  -- A live SERP run with no succeeded call cannot be completed.
  perform t.ok(t.finish(t.rid(t24.reserve(o, p_mode => 'sandbox')), 'completed')->>'outcome' = 'status-not-consistent', 'C a SERP run with no succeeded call: status-not-consistent');
  perform t.finish(id, 'failed', 0, 0, 'test') from public.nexra_provider_runs where status = 'reserved';
end $$;
reset role;

-- D: serp_record.
set role service_role;
do $$
declare o uuid; a uuid; q uuid; f uuid; k uuid; kq uuid; r jsonb;
begin
  o := (select opportunity_id from public.nexra_provider_runs where kind = 'serp' limit 1);
  a := t.rid(t24.reserve(o, p_mode => 'sandbox'));
  f := t.qid(t24.req(a, 0, 'failed', 0));
  perform t.ok(t24.record(a, f)->>'outcome' = 'request-not-found', 'D a failed request takes no results: request-not-found');
  q := t.qid(t24.req(a, 1));
  r := t24.record(a, q, '[{"type":"organic","rank":1,"title":"No URL"}]');
  perform t.ok(r->>'outcome' = 'invalid-row', 'D an organic result without a URL: invalid-row');
  perform t.ok(t24.record(a, q, '[{"type":"related-search","rank":1,"title":"x","url":"https://a.example"}]')->>'outcome' = 'invalid-row', 'D a related search with a URL: invalid-row');
  perform t.ok(t24.record(a, q, '[{"type":"people-also-ask","rank":1,"title":"q","snippet":"s"}]')->>'outcome' = 'invalid-row', 'D a question with a snippet: invalid-row');
  perform t.ok(t24.record(a, q, '[{"type":"organic","rank":1,"title":"t","url":"ftp://a","domain":"a"}]')->>'outcome' = 'invalid-row', 'D a non-http URL: invalid-row');
  perform t.ok(t24.record(a, q, '[{"type":"organic","rank":0,"title":"t","url":"https://a","domain":"a"}]')->>'outcome' = 'invalid-row', 'D rank 0: invalid-row');
  perform t.ok(t24.record(a, q, t24.rows(1) || '[{"type":"organic","rank":1,"title":"t","url":"https://b","domain":"b"}]'::jsonb)->>'outcome' = 'invalid-row', 'D the same type and rank twice: invalid-row');
  perform t.ok(t24.record(a, q, '[{"type":"answer-box","rank":1,"title":"t"}]')->>'outcome' = 'invalid-row', 'D an unknown type: invalid-row');
  perform t.ok(not exists (select 1 from public.nexra_serp_results), 'D nothing was written by a refused set');
  r := t24.record(a, q);
  perform t.ok(r->>'outcome' = 'recorded' and (r->>'rows')::int = 7, 'D a well-formed set: recorded, 7 rows');
  perform t.ok((select bool_and(opportunity_id = o and keyword = 'seed 1' and project_id = 'halcyon-fintech' and mode = 'sandbox' and provider = 'dataforseo'
    and location_code = 2840 and language_code = 'en' and run_id = a and request_id = q) from public.nexra_serp_results), 'D every row carries the run''s opportunity, keyword and provenance');
  perform t.ok((select count(*) from public.nexra_serp_results where result_type = 'people-also-ask' and url is not null) = 1
    and (select count(*) from public.nexra_serp_results where result_type = 'related-search') = 2, 'D questions and related searches kept with their types');
  perform t.ok(t24.record(a, q)->>'outcome' = 'exists', 'D a second set for the request: exists');
  perform t.ok(t24.record(gen_random_uuid(), q)->>'outcome' = 'run-not-found', 'D an unknown run: run-not-found');
  perform t.ok(t.finish(a, 'completed')->>'outcome' = 'status-not-consistent', 'D seq 0 failed and seq 1 names no retry_of: the run is not completed');
  k := t.rid(t.reserve('verdant-home', 'sandbox'));
  kq := t.qid(t.req(k, 0));
  perform t.ok(t24.record(k, kq)->>'outcome' = 'run-not-found', 'D a keyword snapshot run takes no SERP rows: run-not-found');
  perform t.finish(k, 'partial');
  perform t.finish(a, 'partial');
  perform t.ok(t24.record(a, q)->>'outcome' = 'run-not-open', 'D a closed run: run-not-open');
  perform t.ok(t.err(format($q$select t24.record(%L, %L, '{}')$q$, a, q)) = '22023', 'D rows that are not an array raise 22023');
end $$;
reset role;

-- E: the guards, for any writer (as the owner), and the opportunity's immutability.
do $$
declare a uuid;
begin
  a := (select run_id from public.nexra_serp_results limit 1);
  perform t.ok(t.err($q$insert into public.nexra_serp_results (run_id, request_id, project_id, opportunity_id, keyword, result_type, rank, title, provider, mode, location_code, language_code, fetched_at)
    select run_id, request_id, project_id, opportunity_id, keyword, 'related-search', 9, 'x', provider, mode, location_code, language_code, fetched_at from public.nexra_serp_results limit 1$q$) = '23514', 'E a direct insert is refused (23514)');
  perform t.ok(t.err($q$update public.nexra_serp_results set title = 'changed'$q$) = '23514', 'E an update is refused (23514)');
  perform t.ok(t.err($q$delete from public.nexra_serp_results$q$) = '23514', 'E a delete is refused (23514)');
  perform t.ok(t.err($q$truncate public.nexra_serp_results$q$) = '23514', 'E a truncate is refused (23514)');
  perform set_config('nexra.provider_write', a::text, true);
  perform t.ok(t.err(format($q$update public.nexra_provider_runs set opportunity_id = null where id = %L$q$, a)) = '23514', 'E a run''s opportunity never changes, even under the flag (23514)');
  perform set_config('nexra.provider_write', '', true);
  perform t.ok(t.err($q$insert into public.nexra_provider_runs (project_id, provider, kind, mode, api_host, seeds, location_code, language_code, estimate_usd, requested_by)
    values ('halcyon-fintech', 'dataforseo', 'serp', 'sandbox', 'sandbox.dataforseo.com', array['x'], 2840, 'en', 0, t.pop())$q$) = '23514', 'E a direct run insert is refused (23514)');
end $$;
set role service_role;
do $$
begin
  perform t.ok(t.err($q$update public.nexra_serp_results set title = 'x'$q$) = '42501', 'E service_role cannot update results (42501)');
end $$;
reset role;

-- F: constraints and keyword snapshots unchanged.
do $$
begin
  perform t.ok(not exists (select 1 from public.nexra_provider_runs where kind = 'keyword-snapshot' and opportunity_id is not null)
    and not exists (select 1 from public.nexra_provider_runs where kind = 'serp' and (opportunity_id is null or cardinality(seeds) <> 1)), 'F every SERP run has an opportunity and one keyword; no snapshot has one');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_provider_runs_serp_has_opportunity') like '%serp%', 'F the kind-opportunity check is in place');
  perform t.ok((select prosrc from pg_proc where proname = 'nexra_provider_run_reserve') like '%''keyword-snapshot''%', 'F the keyword snapshot reserve still writes kind keyword-snapshot');
end $$;
