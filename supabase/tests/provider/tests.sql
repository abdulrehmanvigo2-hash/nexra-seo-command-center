-- F0 provider keyword snapshot (migration 20261016120000): sections A (schema and security), B (reserve: outcomes, the
-- cap, the ceiling, sandbox not counted, refusals), C (request_record: once per seq, no credential, sandbox at 0),
-- D (keyword_metrics_record: provenance, one set per request, invalid rows), E (finish: cost and status consistency),
-- F (resume: decision Q4), G (the guards, for any writer), H (isolation). Runs over c4/setup.sql, gsc/setup.sql and
-- provider/setup.sql. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh, which creates
-- and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: the schema and its security.
do $$
declare t_ text; fn text;
begin
  perform t.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'nexra_provider_runs')
    = array['id','project_id','provider','kind','mode','api_host','seeds','location_code','language_code','status','estimate_usd','cost_usd','unknown_cost_usd','error_code','requested_by','created_at','finished_at'], 'A the run columns');
  perform t.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'nexra_provider_requests')
    = array['id','run_id','seq','endpoint','params','outcome','provider_status_code','provider_task_id','cost_usd','items','response_sha256','sent_at','received_at'], 'A the request columns');
  perform t.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'nexra_keyword_metrics')
    = array['id','run_id','request_id','project_id','seed','keyword','relation','search_volume','cpc','competition','keyword_difficulty','intent','monthly_searches','provider_updated_at','provider','mode','location_code','language_code','fetched_at'], 'A the metric columns');
  foreach t_ in array array['nexra_provider_runs', 'nexra_provider_requests', 'nexra_keyword_metrics'] loop
    perform t.ok((select relrowsecurity from pg_class where oid = ('public.' || t_)::regclass) and (select count(*) from pg_policy where polrelid = ('public.' || t_)::regclass) = 0, format('A %s: RLS on, no policies', t_));
    perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = t_ and grantee = 'service_role') = array['SELECT'], format('A %s: service_role holds SELECT only', t_));
    perform t.ok((select count(*) from information_schema.table_privileges where table_name = t_ and grantee in ('anon', 'authenticated', 'PUBLIC')) = 0, format('A %s: anon, authenticated and PUBLIC hold nothing', t_));
    perform t.ok((select tableowner = 'postgres' from pg_tables where tablename = t_), format('A %s: owned by postgres', t_));
  end loop;
  perform t.ok((select array_agg(proname::text order by proname) from pg_proc where proname like 'nexra_provider%' and prosecdef)
    = array['nexra_provider_metrics_record','nexra_provider_request_record','nexra_provider_run_finish','nexra_provider_run_reserve','nexra_provider_run_resume'], 'A exactly the five write functions are security definer');
  perform t.ok((select bool_and(proconfig = array['search_path=""']) from pg_proc where proname like 'nexra_provider%'), 'A every provider function has an empty search_path');
  perform t.ok((select bool_and(pg_get_userbyid(proowner) = 'postgres') from pg_proc where proname like 'nexra_provider%'), 'A every provider function is owned by postgres');
  foreach fn in array array['public.nexra_provider_run_reserve(text,text[],integer,text,text,text,numeric,numeric,uuid)',
    'public.nexra_provider_request_record(uuid,smallint,text,jsonb,text,integer,text,numeric,integer,text,timestamptz,timestamptz)',
    'public.nexra_provider_metrics_record(uuid,uuid,jsonb)', 'public.nexra_provider_run_finish(uuid,text,numeric,numeric,text)', 'public.nexra_provider_run_resume(uuid,numeric,numeric,uuid)'] loop
    perform t.ok(has_function_privilege('service_role', fn, 'EXECUTE') and not has_function_privilege('anon', fn, 'EXECUTE')
      and not has_function_privilege('authenticated', fn, 'EXECUTE') and not has_function_privilege('public', fn, 'EXECUTE'), format('A %s: EXECUTE for service_role only', split_part(fn, '(', 1)));
  end loop;
  foreach fn in array array['public.nexra_provider_live_spend_today(uuid)', 'public.nexra_provider_lock_day()', 'public.nexra_provider_guard_insert()', 'public.nexra_provider_runs_guard_update()', 'public.nexra_provider_guard_immutable()'] loop
    perform t.ok(not has_function_privilege('service_role', fn, 'EXECUTE') and not has_function_privilege('anon', fn, 'EXECUTE') and not has_function_privilege('authenticated', fn, 'EXECUTE') and not has_function_privilege('public', fn, 'EXECUTE'),
      format('A %s: executable by no API role', split_part(fn, '(', 1)));
  end loop;
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_provider_runs'::regclass and not tgisinternal)
    = array['nexra_provider_runs_guard_delete','nexra_provider_runs_guard_insert','nexra_provider_runs_guard_truncate','nexra_provider_runs_guard_update'], 'A the four run triggers');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_provider_requests'::regclass and not tgisinternal)
    = array['nexra_provider_requests_guard_delete','nexra_provider_requests_guard_insert','nexra_provider_requests_guard_truncate','nexra_provider_requests_guard_update'], 'A the four request triggers');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_keyword_metrics'::regclass and not tgisinternal)
    = array['nexra_keyword_metrics_guard_delete','nexra_keyword_metrics_guard_insert','nexra_keyword_metrics_guard_truncate','nexra_keyword_metrics_guard_update'], 'A the four metric triggers');
  perform t.ok((select bool_and(tgenabled = 'O') from pg_trigger where not tgisinternal and tgrelid in ('public.nexra_provider_runs'::regclass, 'public.nexra_provider_requests'::regclass, 'public.nexra_keyword_metrics'::regclass)), 'A every guard trigger is enabled');
  perform t.ok((select count(*) from pg_constraint where conname = 'nexra_provider_requests_run_seq_unique' and contype = 'u') = 1
    and (select count(*) from pg_constraint where conname = 'nexra_keyword_metrics_run_seed_keyword_unique' and contype = 'u') = 1, 'A unique (run_id, seq) and unique (run_id, seed, keyword)');
end $$;

-- B: reserve, as service_role.
set role service_role;
do $$
declare r jsonb; a uuid; b uuid;
begin
  r := t.reserve('halcyon-fintech', 'sandbox', 0.16);
  perform t.ok(r->>'outcome' = 'reserved', 'B a sandbox run: reserved');
  a := t.rid(r);
  perform t.ok((t.run(a)).mode = 'sandbox' and (t.run(a)).api_host = 'sandbox.dataforseo.com' and (t.run(a)).estimate_usd = 0 and (t.run(a)).status = 'reserved'
    and (t.run(a)).provider = 'dataforseo' and (t.run(a)).kind = 'keyword-snapshot' and (t.run(a)).seeds = t.seeds() and (t.run(a)).location_code = 2840 and (t.run(a)).language_code = 'en'
    and (t.run(a)).requested_by = t.pop() and (t.run(a)).cost_usd is null and (t.run(a)).finished_at is null, 'B the sandbox row records its mode and host, the seeds, location and language, and an estimate of 0');
  perform t.ok(t.reserve('halcyon-fintech', 'live', 0.16)->>'outcome' = 'run-active', 'B a second run for a project with an open run: run-active');
  perform t.ok(t.err($q$select t.reserve('verdant-home', 'live', 0.16, 1.00, p_host => 'sandbox.dataforseo.com')$q$) = '22023', 'B a live run naming the sandbox host raises 22023');
end $$;
do $$
declare r jsonb; a uuid; b uuid; c uuid;
begin
  r := t.reserve('verdant-home', 'live', 0.16);
  perform t.ok(r->>'outcome' = 'reserved' and (r->>'spent_usd')::numeric = 0, 'B a live run with nothing spent today: reserved, spent 0');
  b := t.rid(r);
  perform t.ok((t.run(b)).mode = 'live' and (t.run(b)).api_host = 'api.dataforseo.com' and (t.run(b)).estimate_usd = 0.16, 'B the live row records the live host and its estimate');
  perform t.ok(t.reserve('no-such-project')->>'outcome' = 'project-not-found', 'B an unknown project: project-not-found');

  perform t.ok(t.err($q$select t.reserve(p_mode => 'test')$q$) = '22023', 'B a mode other than sandbox or live raises 22023');
  perform t.ok(t.err($q$select t.reserve('verdant-home', 'sandbox', p_host => 'api.dataforseo.com')$q$) = '22023', 'B a sandbox run naming the live host raises 22023');
  perform t.ok(t.err($q$select t.reserve(p_seeds => '{}')$q$) = '22023' and t.err($q$select t.reserve(p_seeds => t.seeds(11))$q$) = '22023', 'B 0 or 11 seeds raise 22023');
  perform t.ok(t.err($q$select t.reserve(p_seeds => array['a', 'a'])$q$) = '22023', 'B repeated seeds raise 22023');
  perform t.ok(t.err($q$select t.reserve(p_seeds => array['a', ' b'])$q$) = '22023' and t.err($q$select t.reserve(p_seeds => array['a', ''])$q$) = '22023', 'B an untrimmed or empty seed raises 22023');
  perform t.ok(t.err($q$select t.reserve(p_cap => 5.01)$q$) = '22023', 'B a cap above 5.00 raises 22023 (the SQL ceiling)');
  perform t.ok(t.err($q$select t.reserve(p_cap => -0.01)$q$) = '22023', 'B a negative cap raises 22023');
  perform t.ok(t.err($q$select t.reserve(p_estimate => 1.01, p_cap => 1.00)$q$) = '22023', 'B an estimate above the cap raises 22023');
  perform t.ok(t.err($q$select t.reserve(p_estimate => -0.01)$q$) = '22023', 'B a negative estimate raises 22023');
  perform t.ok(t.err($q$select t.reserve(p_language => 'eng')$q$) = '22023' and t.err($q$select t.reserve(p_location => 0)$q$) = '22023', 'B a bad language or location raises 22023');
  perform t.ok(t.err($q$select public.nexra_provider_run_reserve('verdant-home', t.seeds(), 2840, 'en', 'live', 'api.dataforseo.com', 0.1, 1.0, null)$q$) = '22023', 'B a missing operator raises 22023');
  perform t.ok((select count(*) from nexra_provider_runs) = 2, 'B only the two reserved rows exist');

  perform t.ok(t.err($q$insert into public.nexra_provider_runs (project_id, provider, kind, mode, api_host, seeds, location_code, language_code, estimate_usd, requested_by) values ('verdant-home', 'dataforseo', 'keyword-snapshot', 'live', 'api.dataforseo.com', t.seeds(), 2840, 'en', 0, t.pop())$q$) = '42501', 'B service_role cannot insert a run directly (42501)');
  perform t.ok(t.err(format($q$update public.nexra_provider_runs set status = 'completed' where id = %L$q$, b)) = '42501', 'B service_role cannot update a run directly (42501)');
  perform t.ok(t.err(format($q$delete from public.nexra_provider_runs where id = %L$q$, b)) = '42501', 'B service_role cannot delete a run directly (42501)');
  perform t.ok(t.err($q$truncate public.nexra_provider_runs$q$) = '42501', 'B service_role cannot truncate the runs (42501)');
end $$;

-- B, the cap: today's live spend, with the two open runs finished first.
do $$
declare r jsonb; a uuid; b uuid; c uuid; s uuid;
begin
  a := (select id from nexra_provider_runs where project_id = 'halcyon-fintech');
  b := (select id from nexra_provider_runs where project_id = 'verdant-home');
  perform t.req(a, 0, 'succeeded', 0); perform t.finish(a, 'completed', 0, 0);
  perform t.req(b, 0, 'succeeded', 0.013); perform t.finish(b, 'completed', 0.013, 0);
  -- verdant spends 0.587 more today (recorded cost 0.5 + an unknown call at 0.087): 0.6 counted.
  s := t.spent('verdant-home', 0.5, 'partial', 0.1);
  perform t.ok((t.run(s)).status = 'partial' and (t.run(s)).cost_usd = 0.5 and (t.run(s)).unknown_cost_usd = 0.1, 'B setup: a partial live run with 0.5 recorded and 0.1 unknown');
  r := t.reserve('halcyon-fintech', 'live', 0.5, 1.00);
  perform t.ok(r->>'outcome' = 'cap-reached' and (r->>'spent_usd')::numeric = 0.613 and (r->>'cap_usd')::numeric = 1.00 and (r->>'estimate_usd')::numeric = 0.5, 'B over the cap (0.613 spent + 0.5 > 1.00): cap-reached, naming the spend, cap and estimate');
  perform t.ok((select count(*) from nexra_provider_runs where project_id = 'halcyon-fintech' and status = 'reserved') = 0, 'B a refused reservation creates no row');
  perform t.ok(t.reserve('halcyon-fintech', 'sandbox', 0.5, 1.00)->>'outcome' = 'reserved', 'B a sandbox run while the cap is reached: reserved (never counted, never refused)');
  c := (select id from nexra_provider_runs where project_id = 'halcyon-fintech' and status = 'reserved');
  perform t.req(c, 0, 'succeeded', 0.5);
  perform t.ok((select cost_usd from nexra_provider_requests where run_id = c) = 0, 'B a sandbox call is recorded at cost 0 whatever the caller says');
  perform t.finish(c, 'completed', 0, 0);
  r := t.reserve('halcyon-fintech', 'live', 0.387, 1.00);
  perform t.ok(r->>'outcome' = 'reserved' and (r->>'spent_usd')::numeric = 0.613, 'B exactly up to the cap (0.613 + 0.387 = 1.00): reserved — the finished 0.013 run and the partial run count, the sandbox runs do not');
  perform t.ok((t.run(t.rid(r))).estimate_usd = 0.387, 'B the open run holds its estimate');
  perform t.ok(t.reserve('verdant-home', 'live', 0.01, 1.00)->>'outcome' = 'cap-reached', 'B an open run counts at its estimate: 1.00 reached, 0.01 more refused');
  perform t.ok(t.reserve('verdant-home', 'live', 0.01, 1.00) is not null and (select count(*) from nexra_provider_runs where status = 'reserved') = 1, 'B the refusal left one open run');
  perform t.ok(t.reserve('verdant-home', 'live', 1.0, 2.00)->>'outcome' = 'reserved', 'B a higher cap passed by the server admits more (1.00 + 1.0 under 2.00)');
  perform t.ok((select count(*) from nexra_provider_runs where mode = 'live') = 4 and (select count(*) from nexra_provider_runs where mode = 'sandbox') = 2, 'B six runs: four live, two sandbox');
end $$;
reset role;
-- Live spend today, read as the owner (the function is closed to API roles): sandbox never counted.
do $$
begin
  perform t.ok(public.nexra_provider_live_spend_today(null) = 0.013 + 0.6 + 0.387 + 1.0, 'B live spend today = 0.013 (finished) + 0.6 (partial + unknown) + 0.387 + 1.0 (open estimates); sandbox 0');
  perform t.ok((select sum(estimate_usd) + sum(coalesce(cost_usd, 0)) + sum(unknown_cost_usd) from nexra_provider_runs where mode = 'sandbox') = 0, 'B every sandbox figure is 0');
end $$;

-- C: request_record, as service_role.
set role service_role;
do $$
declare a uuid; r jsonb; q uuid; before jsonb;
begin
  a := (select id from nexra_provider_runs where project_id = 'halcyon-fintech' and status = 'reserved');
  r := t.req(a, 0);
  perform t.ok(r->>'outcome' = 'recorded', 'C a call: recorded');
  q := t.qid(r);
  perform t.ok((select endpoint = 'dataforseo_labs/google/keyword_overview/live' and outcome = 'succeeded' and cost_usd = 0.013 and items = 10 and response_sha256 = repeat('c', 64)
    and provider_status_code = 20000 and provider_task_id = 'task-1' and received_at >= sent_at and params->>'limit' = '20' from nexra_provider_requests where id = q), 'C the row records endpoint, outcome, cost, items, hash, status, task id, times and params');
  before := to_jsonb(t.run(a));
  r := t.req(a, 0, 'succeeded', 9.99, p_items => 99);
  perform t.ok(r->>'outcome' = 'exists' and t.qid(r) = q and (select cost_usd = 0.013 and items = 10 from nexra_provider_requests where id = q), 'C the same seq again: exists, the row unchanged (unique (run_id, seq) is a no-op on repeat)');
  perform t.ok((select count(*) from nexra_provider_requests where run_id = a) = 1, 'C one row for the seq');
  r := t.req(a, 1, 'unknown');
  perform t.ok(r->>'outcome' = 'recorded' and (select cost_usd is null and items is null and received_at is null from nexra_provider_requests where run_id = a and seq = 1), 'C a timed-out call: recorded unknown, no cost, no received time');
  perform t.ok(t.req(a, 2, 'failed', 0, p_status => 40501)->>'outcome' = 'recorded', 'C a refused call: recorded failed with the provider''s status code');
  perform t.ok(t.req(gen_random_uuid(), 0)->>'outcome' = 'run-not-found', 'C an unknown run: run-not-found');
  perform t.ok(t.req((select id from nexra_provider_runs where status = 'completed' limit 1), 5)->>'outcome' = 'run-not-open', 'C a finished run: run-not-open');
  perform t.ok(t.err(format($q$select t.req(%L, 3, p_params => '{"keywords": ["a"], "password": "x"}')$q$, a)) = '22023', 'C params holding a credential key raise 22023');
  perform t.ok(t.err(format($q$select t.req(%L, 3, p_params => '{"keywords": ["a"], "Authorization": "Basic x"}')$q$, a)) = '22023', 'C an Authorization key, any case, raises 22023');
  perform t.ok(t.err(format($q$select t.req(%L, 3, p_params => '["a"]')$q$, a)) = '22023', 'C params that are not an object raise 22023');
  perform t.ok(t.err(format($q$select t.req(%L, 3, p_endpoint => 'serp/google/organic/live')$q$, a)) = '22023', 'C an endpoint outside the two raises 22023');
  perform t.ok(t.err(format($q$select t.req(%L, 3, 'timeout')$q$, a)) = '22023', 'C an outcome outside the three raises 22023');
  perform t.ok(t.err(format($q$select t.req(%L, 21)$q$, a)) = '23514', 'C a seq above 20 is refused by the table (23514)');
  perform t.ok(t.err(format($q$select t.req(%L, 3, 'succeeded', p_sha => 'abc')$q$, a)) = '23514', 'C a malformed response hash is refused by the table (23514)');
  perform t.ok(t.err(format($q$select public.nexra_provider_request_record(%L, 3::smallint, 'dataforseo_labs/google/related_keywords/live', '{}', 'succeeded', 20000, 't', 0.01, null, repeat('d', 64), now(), now())$q$, a)) = '23514', 'C a succeeded call without items is refused by the table (23514)');
  perform t.ok((select count(*) from nexra_provider_requests where run_id = a) = 3, 'C three rows after the refusals');
  perform t.ok(t.err(format($q$insert into public.nexra_provider_requests (run_id, seq, endpoint, params, outcome, sent_at) values (%L, 9, 'dataforseo_labs/google/related_keywords/live', '{}', 'failed', now())$q$, a)) = '42501', 'C service_role cannot insert a request directly (42501)');
  perform t.ok(t.err(format($q$update public.nexra_provider_requests set cost_usd = 0 where id = %L$q$, q)) = '42501', 'C service_role cannot update a request directly (42501)');
end $$;

-- D: keyword_metrics_record, as service_role.
do $$
declare a uuid; q uuid; q2 uuid; r jsonb; other uuid;
begin
  a := (select id from nexra_provider_runs where project_id = 'halcyon-fintech' and status = 'reserved');
  q := (select id from nexra_provider_requests where run_id = a and seq = 0);
  r := t.metrics(a, q);
  perform t.ok(r->>'outcome' = 'recorded' and (r->>'rows')::int = 9, 'D nine rows (3 seeds, 2 related each): recorded');
  perform t.ok((select bool_and(project_id = 'halcyon-fintech' and provider = 'dataforseo' and mode = 'live' and location_code = 2840 and language_code = 'en' and request_id = q
    and fetched_at = (select received_at from nexra_provider_requests where id = q)) from nexra_keyword_metrics where run_id = a), 'D every row carries the run''s provenance and the request''s received time');
  perform t.ok((select search_volume = 100 and cpc = 1.5 and competition = 0.42 and keyword_difficulty = 31 and intent = 'informational' and monthly_searches->0->>'search_volume' = '90'
    and provider_updated_at = '2026-09-30T00:00:00Z'::timestamptz and relation = 'seed' from nexra_keyword_metrics where run_id = a and keyword = 'seed 1'), 'D a seed row holds the metrics as given');
  perform t.ok((select cpc is null and competition is null and keyword_difficulty is null and intent is null and monthly_searches is null and provider_updated_at is null and search_volume = 20
    from nexra_keyword_metrics where run_id = a and keyword = 'seed 1 related 2'), 'D a value the provider did not give stays null, never 0');
  perform t.ok(t.metrics(a, q)->>'outcome' = 'exists' and (select count(*) from nexra_keyword_metrics where run_id = a) = 9, 'D the same request again: exists, nothing added');
  q2 := t.qid(t.req(a, 3));
  perform t.ok(t.metrics(a, q2, t.mrows())->>'outcome' = 'invalid-row', 'D a keyword already recorded for the run: invalid-row');
  perform t.ok(t.metrics(a, q2, '[{"seed":"seed 1","keyword":"x","relation":"related"},{"seed":"seed 1","keyword":"x","relation":"related"}]')->>'outcome' = 'invalid-row', 'D a keyword twice in one set: invalid-row');
  perform t.ok(t.metrics(a, q2, '[{"seed":"seed 9","keyword":"seed 9","relation":"seed"}]')->>'outcome' = 'invalid-row', 'D a seed the run did not ask: invalid-row');
  perform t.ok(t.metrics(a, q2, '[{"seed":"seed 1","keyword":"other","relation":"seed"}]')->>'outcome' = 'invalid-row', 'D a seed row whose keyword is not the seed: invalid-row');
  perform t.ok(t.metrics(a, q2, '[{"seed":"seed 1","keyword":"y","relation":"cousin"}]')->>'outcome' = 'invalid-row', 'D a relation outside seed/related: invalid-row');
  perform t.ok(t.metrics(a, q2, '[{"seed":"seed 1","keyword":"y","relation":"related","competition":1.5}]')->>'outcome' = 'invalid-row', 'D competition above 1: invalid-row');
  perform t.ok(t.metrics(a, q2, '[{"seed":"seed 1","keyword":"y","relation":"related","keyword_difficulty":101}]')->>'outcome' = 'invalid-row', 'D difficulty above 100: invalid-row');
  perform t.ok(t.metrics(a, q2, '[{"seed":"seed 1","keyword":"y","relation":"related","search_volume":"many"}]')->>'outcome' = 'invalid-row', 'D a volume that is not a number: invalid-row');
  perform t.ok(t.metrics(a, q2, '["seed 1"]')->>'outcome' = 'invalid-row', 'D a row that is not an object: invalid-row');
  perform t.ok((select count(*) from nexra_keyword_metrics where run_id = a) = 9, 'D no refused set wrote a row');
  perform t.ok(t.metrics(a, q2, '[]')->>'outcome' = 'recorded' and (select count(*) from nexra_keyword_metrics where request_id = q2) = 0, 'D an empty set: recorded, nothing to write');
  r := t.metrics(a, q2, '[{"seed":"seed 2","keyword":"seed 2 more","relation":"related","search_volume":5.7}]');
  perform t.ok(r->>'outcome' = 'recorded' and (select search_volume = 5 from nexra_keyword_metrics where request_id = q2), 'D a later set for a request with no rows: recorded (volume floored to a whole number)');
  other := (select id from nexra_provider_requests where run_id <> a limit 1);
  perform t.ok(t.metrics(a, other)->>'outcome' = 'request-not-found', 'D another run''s request: request-not-found');
  perform t.ok(t.metrics(gen_random_uuid(), q)->>'outcome' = 'run-not-found', 'D an unknown run: run-not-found');
  perform t.ok(t.metrics((select id from nexra_provider_runs where status = 'completed' limit 1), q)->>'outcome' = 'run-not-open', 'D a finished run: run-not-open');
  perform t.ok(t.err(format($q$select t.metrics(%L, %L, '{"a":1}')$q$, a, q)) = '22023', 'D rows that are not an array raise 22023');
  perform t.ok(t.err(format($q$insert into public.nexra_keyword_metrics (run_id, request_id, project_id, seed, keyword, relation, provider, mode, location_code, language_code, fetched_at) values (%L, %L, 'halcyon-fintech', 'seed 1', 'z', 'related', 'dataforseo', 'live', 2840, 'en', now())$q$, a, q)) = '42501', 'D service_role cannot insert a metric row directly (42501)');
  perform t.ok(t.err($q$delete from public.nexra_keyword_metrics$q$) = '42501' and t.err($q$truncate public.nexra_keyword_metrics$q$) = '42501', 'D service_role cannot delete or truncate the metrics (42501)');
end $$;

-- E: finish, as service_role.
do $$
declare a uuid; r jsonb; v uuid;
begin
  a := (select id from nexra_provider_runs where project_id = 'halcyon-fintech' and status = 'reserved');
  -- a holds: seq 0 succeeded 0.013, seq 1 unknown, seq 2 failed, seq 3 succeeded 0.013.
  perform t.ok(t.finish(a, 'completed', 0.026, 0)->>'outcome' = 'status-not-consistent', 'E completed with a failed and an unknown call: status-not-consistent');
  perform t.ok(t.finish(a, 'partial', 0.03, 0)->>'outcome' = 'cost-mismatch' and (t.finish(a, 'partial', 0.03, 0)->>'recorded_usd')::numeric = 0.026, 'E a cost that is not the succeeded calls'' sum: cost-mismatch, naming the recorded sum');
  perform t.ok((t.run(a)).status = 'reserved', 'E the refusals left the run open');
  perform t.ok(t.err(format($q$select t.finish(%L, 'done')$q$, a)) = '22023', 'E a status outside completed/partial/failed raises 22023');
  perform t.ok(t.err(format($q$select t.finish(%L, 'partial', 0.026, -1)$q$, a)) = '22023', 'E a negative unknown cost raises 22023');
  r := t.finish(a, 'partial', 0.026, 0.1, 'provider-timeout');
  perform t.ok(r->>'outcome' = 'finished' and (t.run(a)).status = 'partial' and (t.run(a)).cost_usd = 0.026 and (t.run(a)).unknown_cost_usd = 0.1 and (t.run(a)).error_code = 'provider-timeout' and (t.run(a)).finished_at is not null, 'E partial: finished with the recorded cost, the unknown estimate and the error code');
  perform t.ok(t.finish(a, 'partial', 0.026, 0.1)->>'outcome' = 'run-not-open', 'E a second finish: run-not-open');
  perform t.ok(t.finish(gen_random_uuid())->>'outcome' = 'run-not-found', 'E an unknown run: run-not-found');
  v := (select id from nexra_provider_runs where project_id = 'verdant-home' and status = 'reserved');
  perform t.ok(t.finish(v, 'completed', 0, 0)->>'outcome' = 'status-not-consistent', 'E completed with no call recorded: status-not-consistent');
  r := t.finish(v, 'failed', 0, 0, 'provider-refused');
  perform t.ok(r->>'outcome' = 'finished' and (t.run(v)).status = 'failed' and (t.run(v)).cost_usd = 0, 'E failed with nothing recorded: finished at cost 0');
  v := t.rid(t.reserve('verdant-home', 'sandbox'));
  perform t.req(v, 0, 'succeeded', 0.013);
  perform t.ok(t.finish(v, 'completed', 0.013, 0)->>'outcome' = 'cost-mismatch', 'E a sandbox run with a cost: cost-mismatch');
  r := t.finish(v, 'completed', 0, 0);
  perform t.ok(r->>'outcome' = 'finished' and (t.run(v)).cost_usd = 0, 'E a sandbox run finishes at 0');
end $$;

-- F: resume (decision Q4), as service_role.
do $$
declare a uuid; r jsonb; p uuid; s uuid;
begin
  a := (select id from nexra_provider_runs where project_id = 'halcyon-fintech' and status = 'partial' order by created_at desc limit 1);
  perform t.ok(t.resume((select id from nexra_provider_runs where status = 'completed' limit 1))->>'outcome' = 'run-not-partial', 'F a completed run: run-not-partial');
  perform t.ok(t.resume(gen_random_uuid())->>'outcome' = 'run-not-found', 'F an unknown run: run-not-found');
  perform t.ok(t.err(format($q$select t.resume(%L, 0.1, 5.01)$q$, a)) = '22023', 'F a cap above 5.00 raises 22023');
  perform t.ok(t.err(format($q$select t.resume(%L, 1.1, 1.00)$q$, a)) = '22023', 'F an estimate above the cap raises 22023');
  -- Today's live spend: 0.013 + 0.6 (verdant partial) + a's 0.026 + 0.1 unknown; the verdant 1.0 run was finished failed at 0: 0.739.
  r := t.resume(a, 0.3, 1.00);
  perform t.ok(r->>'outcome' = 'cap-reached' and (r->>'spent_usd')::numeric = 0.739, 'F over the cap on resume (0.739 + 0.3 > 1.00): cap-reached, this run''s own recorded spend counted once');
  perform t.ok((t.run(a)).status = 'partial', 'F the refusal left it partial');
  s := t.rid(t.reserve('halcyon-fintech', 'live', 0.01, 1.00));
  perform t.ok(t.resume(a, 0.1, 1.00)->>'outcome' = 'run-active', 'F another open run on the project: run-active');
  perform t.finish(s, 'failed', 0, 0, 'abandoned');
  r := t.resume(a, 0.2, 1.00);
  perform t.ok(r->>'outcome' = 'reserved' and (t.run(a)).status = 'reserved' and (t.run(a)).estimate_usd = 0.226 and (t.run(a)).cost_usd is null and (t.run(a)).finished_at is null and (t.run(a)).error_code is null and (t.run(a)).unknown_cost_usd = 0.1,
    'F resume within the cap: reserved, estimate = recorded cost so far + the missing calls (0.026 + 0.2), cost cleared, unknown kept');
  perform t.ok(t.req(a, 1, 'succeeded', 0.013)->>'outcome' = 'exists', 'F the earlier unknown seq is not re-recorded (exists) — the application resumes with new seqs or accepts the record');
  perform t.ok(t.req(a, 4, 'succeeded', 0.013)->>'outcome' = 'recorded', 'F a missing call is recorded under the reopened run');
  perform t.ok(t.finish(a, 'completed', 0.039, 0)->>'outcome' = 'status-not-consistent', 'F completed still refused while a failed/unknown call stands');
  r := t.finish(a, 'partial', 0.039, 0.1);
  perform t.ok(r->>'outcome' = 'finished' and (t.run(a)).cost_usd = 0.039, 'F finished again as partial, the cost recomputed over every succeeded call (3 × 0.013)');
  p := t.rid(t.reserve('verdant-home', 'sandbox'));
  perform t.req(p, 0, 'succeeded', 0); perform t.finish(p, 'partial', 0, 0);
  r := t.resume(p, 0.5, 1.00);
  perform t.ok(r->>'outcome' = 'reserved' and (t.run(p)).estimate_usd = 0, 'F a sandbox partial run resumes with estimate 0, uncounted');
  perform t.finish(p, 'partial', 0, 0);
end $$;
reset role;

-- G: the guards, for any writer (the owner here).
do $$
declare a uuid := (select id from nexra_provider_runs where status = 'partial' and mode = 'live' order by created_at limit 1);
        c uuid := (select id from nexra_provider_runs where status = 'completed' and mode = 'live' limit 1);
        q uuid := (select id from nexra_provider_requests order by sent_at limit 1);
        m uuid := (select id from nexra_keyword_metrics limit 1);
begin
  perform t.ok(t.err($q$insert into public.nexra_provider_runs (project_id, provider, kind, mode, api_host, seeds, location_code, language_code, estimate_usd, requested_by) values ('verdant-home', 'dataforseo', 'keyword-snapshot', 'live', 'api.dataforseo.com', t.seeds(), 2840, 'en', 0, t.pop())$q$) = '23514', 'G a run is inserted only through reserve (23514)');
  perform t.ok(t.err(format($q$insert into public.nexra_provider_requests (run_id, seq, endpoint, params, outcome, sent_at) values (%L, 19, 'dataforseo_labs/google/related_keywords/live', '{}', 'failed', now())$q$, a)) = '23514', 'G a request is inserted only through request_record (23514)');
  perform t.ok(t.err(format($q$insert into public.nexra_keyword_metrics (run_id, request_id, project_id, seed, keyword, relation, provider, mode, location_code, language_code, fetched_at) values (%L, %L, 'halcyon-fintech', 'seed 1', 'zz', 'related', 'dataforseo', 'live', 2840, 'en', now())$q$, a, q)) = '23514', 'G a metric row is inserted only through keyword_metrics_record (23514)');
  perform t.ok(t.err(format($q$update public.nexra_provider_runs set status = 'reserved' where id = %L$q$, a)) = '23514', 'G a run changes only through finish or resume (23514)');
  perform t.ok(t.err(format($q$update public.nexra_provider_runs set seeds = array['x'] where id = %L$q$, a)) = '23514', 'G a run''s seeds never change (23514)');
  perform set_config('nexra.provider_write', a::text, true);
  perform t.ok(t.err(format($q$update public.nexra_provider_runs set mode = 'sandbox', api_host = 'sandbox.dataforseo.com' where id = %L$q$, a)) = '23514', 'G even under the flag, a run''s mode never changes (23514)');
  perform t.ok(t.err(format($q$update public.nexra_provider_runs set requested_by = gen_random_uuid() where id = %L$q$, a)) = '23514', 'G even under the flag, the operator never changes (23514)');
  perform set_config('nexra.provider_write', c::text, true);
  perform t.ok(t.err(format($q$update public.nexra_provider_runs set status = 'reserved', cost_usd = null, finished_at = null where id = %L$q$, c)) = '23514', 'G even under the flag, completed never goes back to reserved (23514)');
  perform set_config('nexra.provider_write', '', true);
  perform t.ok(t.err(format($q$update public.nexra_provider_requests set cost_usd = 0 where id = %L$q$, q)) = '23514', 'G a request never changes (23514)');
  perform t.ok(t.err(format($q$update public.nexra_keyword_metrics set search_volume = 0 where id = %L$q$, m)) = '23514', 'G a metric row never changes (23514)');
  perform t.ok(t.err(format($q$delete from public.nexra_keyword_metrics where id = %L$q$, m)) = '23514', 'G a metric row is never deleted (23514)');
  perform t.ok(t.err(format($q$delete from public.nexra_provider_requests where id = %L$q$, q)) = '23514', 'G a request is never deleted (23514)');
  perform t.ok(t.err(format($q$delete from public.nexra_provider_runs where id = %L$q$, c)) = '23514', 'G a run is never deleted (23514)');
  perform t.ok(t.err($q$truncate public.nexra_keyword_metrics$q$) = '23514', 'G the metrics are never truncated (23514)');
  perform t.ok(t.err($q$truncate public.nexra_provider_requests$q$) in ('23514', '0A000') and t.err($q$truncate public.nexra_provider_runs$q$) in ('23514', '0A000'), 'G requests and runs are never truncated (the foreign-key check, 0A000, precedes the guard)');
  perform t.ok(t.err($q$truncate public.nexra_provider_runs, public.nexra_provider_requests, public.nexra_keyword_metrics$q$) = '23514' and t.err($q$truncate public.nexra_provider_runs cascade$q$) = '23514', 'G truncating the three together, or with CASCADE, is refused by the guard (23514)');
  perform t.ok((select count(*) from nexra_provider_runs) = 9 and (select count(*) from nexra_keyword_metrics) = 10, 'G every refused statement removed nothing (9 runs, 10 metric rows)');
  perform t.ok(t.err($q$delete from public.projects where id = 'verdant-home'$q$) in ('23503', '23514'), 'G a project with provider runs is never deleted');
  perform t.ok(t.err(format($q$update public.nexra_provider_runs set cost_usd = 9 where id = %L$q$, c)) = '23514', 'G a finished run''s cost is never edited by hand (23514)');
end $$;

-- H: isolation and totals.
do $$
begin
  perform t.ok(not exists (select 1 from nexra_keyword_metrics m join nexra_provider_runs r on r.id = m.run_id where m.project_id <> r.project_id), 'H every metric row names its run''s project');
  perform t.ok(not exists (select 1 from nexra_keyword_metrics m join nexra_provider_requests q on q.id = m.request_id where q.run_id <> m.run_id), 'H every metric row names a request of its own run');
  perform t.ok((select count(*) from nexra_keyword_metrics where project_id = 'verdant-home') = 0, 'H verdant holds no metric row: nothing crossed projects');
  perform t.ok((select count(*) from nexra_provider_runs where status = 'reserved') = 0, 'H no run is left open');
  perform t.ok((select bool_and((status = 'reserved') = (cost_usd is null and finished_at is null)) from nexra_provider_runs), 'H every closed run has a cost and a finish time; no open run has either');
end $$;
