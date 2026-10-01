-- C5 article approval gate. Updated for C6: approvals are referenced by a foreign key (TRUNCATE 0A000 / CASCADE 23514), and the security definer inventory names the C6 functions and (since 20260927120000) the M1 Search Console snapshot record function, (since 20260928120000) the T3 crawl findings record function, and (since 20260930120000) the M1 P4c query × page record function, and (since 20261002120000) the M3 finding triage set function, and (since 20261003120000) the agent task create function, and (since 20261014120000) the F8 check-unit carry and fresh functions, and (since 20261016120000) the F0 provider snapshot functions.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
-- A: the happy path, idempotency, history after a new version.
do $$
declare a uuid; r jsonb; n int;
begin
  a := t5.article(0, t5.txt('different-angle'));
  r := t5.approve(a, 1);
  perform t.ok(r->>'outcome' = 'status-unexpected' and r->>'status' = 'drafting', 'drafting, no units: refused status-unexpected');
  perform t5.rec(a, 1, 0, 'passed'); perform t5.rec(a, 1, 1, 'passed'); perform t5.rec(a, 1, 2, 'passed');
  perform t.ok(t5.approve(a, 1)->>'outcome' = 'status-unexpected', 'three of four passed: still drafting, refused');
  perform t5.rec(a, 1, 3, 'passed');
  perform t.ok((select status from nexra_articles where id = a) = 'checked', 'all four passed: checked');
  perform t.ok(t5.digest(a, 1) = t5.digest(a, 1), 'digest deterministic');
  r := t5.approve(a, 1);
  perform t.ok(r->>'outcome' = 'approved', 'approved: ' || (r->>'outcome'));
  perform t.ok(r->'article'->>'status' = 'approved' and (r->'article'->>'approved_version')::int = 1 and r->'article'->>'approved_by' = '00000000-0000-4000-8000-0000000000bb', 'parent pointer set');
  perform t.ok(r->'approval'->>'content_sha256' = t5.sha(a,1) and (r->'approval'->>'unit_count')::int = 4 and r->'approval'->>'units_sha256' = t5.digest(a,1)
               and (r->'approval'->>'article_version_id')::uuid = t5.vid(a,1), 'approval row binds version row, hash, unit count and digest');
  perform t.ok(r->'approval'->>'approved_at' = (select to_jsonb(approved_at)->>0 from nexra_articles where id = a), 'pointer time equals approval time');
  r := t5.approve(a, 1);
  perform t.ok(r->>'outcome' = 'exists', 'repeat: exists');
  perform t.ok((select count(*) from nexra_article_approvals where article_id = a) = 1, 'repeat wrote nothing');
  -- A new version: back to drafting, pointer kept as history, nothing inherited.
  r := public.nexra_article_save_version('halcyon-fintech', a, 1::smallint, t5.txt('different-angle','Edited lead.'), encode(sha256(convert_to(t5.txt('different-angle','Edited lead.'),'UTF8')),'hex'), t5.sources(), '00000000-0000-4000-8000-0000000000aa');
  perform t.ok(r->>'outcome' = 'created', 'saved version 2');
  perform t.ok((select status = 'drafting' and approved_version = 1 and current_version = 2 from nexra_articles where id = a), 'drafting, pointer still names version 1');
  perform t.ok(t5.approve(a, 1)->>'outcome' = 'stale', 'the old version is stale');
  perform t.ok(t5.approve(a, 2)->>'outcome' = 'status-unexpected', 'version 2 inherits nothing');
  perform t5.passall(a, 2);
  r := t5.approve(a, 2);
  perform t.ok(r->>'outcome' = 'approved', 'version 2 approved after its own checks');
  perform t.ok((select count(*) from nexra_article_approvals where article_id = a) = 2, 'history holds both approvals');
  perform t.ok((select approved_version from nexra_articles where id = a) = 2, 'pointer moved to version 2');
end $$;

-- B: refusals.
do $$
declare a uuid; b uuid; r jsonb; u jsonb;
begin
  a := t5.article(1, t5.txt('update-existing'));
  perform t5.passall(a, 1);
  perform t.ok(t5.approve(a, 1, p_project => 'verdant-home')->>'outcome' = 'not-found', 'cross-project: not-found');
  perform t.ok(t5.approve(a, 2)->>'outcome' = 'stale', 'future version: stale');
  perform t.ok(t5.approve(a, 1, p_vid => gen_random_uuid())->>'outcome' = 'version-mismatch', 'other version row: version-mismatch');
  perform t.ok(t5.approve(a, 1, p_sha => repeat('0',64))->>'outcome' = 'content-mismatch', 'other hash: content-mismatch');
  u := t5.units(a, 1);
  perform t.ok(t5.approve(a, 1, p_units => u - 3)->>'outcome' = 'units-mismatch', 'missing unit');
  perform t.ok(t5.approve(a, 1, p_units => u || jsonb_build_array(jsonb_build_object('index',4,'key','cta:2','sha256',repeat('a',64))))->>'outcome' = 'units-mismatch', 'extra unit');
  perform t.ok(t5.approve(a, 1, p_units => jsonb_set(u, '{1,sha256}', to_jsonb(repeat('b',64))))->>'outcome' = 'units-mismatch', 'wrong unit hash');
  perform t.ok(t5.approve(a, 1, p_units => jsonb_set(u, '{2,key}', '"section:other:1"'))->>'outcome' = 'units-mismatch', 'wrong unit key');
  perform t.ok(t5.approve(a, 1, p_units => jsonb_build_array(u->1, u->0, u->2, u->3))->>'outcome' = 'units-mismatch', 'out-of-order units');
  perform t.ok(t5.approve(a, 1, p_units => jsonb_set(u, '{0,index}', '"x"'))->>'outcome' = 'units-mismatch', 'malformed index');
  perform t.ok(t5.approve(a, 1, p_units => jsonb_set(u, '{0,index}', '1.5'))->>'outcome' = 'units-mismatch', 'fractional index');
  perform t.ok(t5.approve(a, 1, p_units => '{}'::jsonb)->>'outcome' = 'units-mismatch', 'not an array');
  perform t.ok(t5.approve(a, 1, p_units => '[]'::jsonb)->>'outcome' = 'units-mismatch', 'empty');
  perform t.ok(t5.approve(a, 1, p_digest => repeat('c',64))->>'outcome' = 'units-mismatch', 'wrong digest');
  perform t.ok((select count(*) from nexra_article_approvals where article_id = a) = 0 and (select status from nexra_articles where id = a) = 'checked', 'refusals wrote nothing');

  b := t5.article(2, t5.txt('unset'));
  perform t5.passall(b, 1);
  r := t5.approve(b, 1);
  perform t.ok(r->>'outcome' = 'topic-decision' and r->>'topic_decision' = 'unset', 'topic unset refused');
  b := t5.article(3, t5.txt('do-not-create'));
  perform t5.passall(b, 1);
  perform t.ok(t5.approve(b, 1)->>'outcome' = 'topic-decision', 'topic do-not-create refused');
  b := t5.article(4, t5.txt('different-angle', 'A lead [NEEDS EVIDENCE: a figure].'));
  perform t5.passall(b, 1);
  perform t.ok(t5.approve(b, 1)->>'outcome' = 'unresolved-placeholder', 'placeholder refused');
  b := t5.article(5, t5.txt('different-angle', 'a lead [needs evidence: lower].'));
  perform t5.passall(b, 1);
  perform t.ok(t5.approve(b, 1)->>'outcome' = 'unresolved-placeholder', 'lower-case placeholder refused');
  perform t.ok((select count(*) from nexra_article_approvals) = 2, 'only article 0 has approvals');
end $$;

-- C: every non-passed unit state keeps the article drafting; forcing checked still cannot pass the gate.
do $$
declare a uuid; st text; n int := 6; r jsonb;
begin
  foreach st in array array['needs-review', 'failed', 'pending'] loop
    a := t5.article(n, t5.txt('different-angle'));
    n := n + 1;
    perform t5.rec(a, 1, 0, 'passed'); perform t5.rec(a, 1, 1, 'passed'); perform t5.rec(a, 1, 2, 'passed');
    if st = 'pending' then
      -- a pending row needs a queued run
      set local session_replication_role = replica;
      insert into agent_runs (id, project_id, agent_id, task_type, input, input_hash, status, created_by, attempt_count)
      values ('30000000-0000-4000-8000-000000000001','halcyon-fintech','research-evidence','article-check-unit',
        jsonb_build_object('articleId',a::text,'articleVersion',1,'articleVersionId',t5.vid(a,1)::text,'unitIndex',3), repeat('e',64),'queued','00000000-0000-4000-8000-0000000000aa',0);
      set local session_replication_role = origin;
      r := public.nexra_article_check_unit_record('halcyon-fintech', a, 1::smallint, t5.vid(a,1), 3::smallint, 'cta', 'cta:1', 1::smallint, 1::smallint, 4::smallint, t5.h(a,1,3), 'pending', null, '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa');
    else
      r := t5.rec(a, 1, 3, st);
    end if;
    perform t.ok(r->>'outcome' = 'recorded', st || ' recorded');
    perform t.ok(t5.approve(a, 1)->>'outcome' = 'status-unexpected', st || ': article not checked, refused');
    -- Defence in depth: even a parent forced to checked is refused on the unit rows.
    update nexra_articles set status = 'checked' where id = a;
    r := t5.approve(a, 1);
    perform t.ok(r->>'outcome' = 'units-not-passed', st || ': forced checked, refused units-not-passed: ' || r::text);
    update nexra_articles set status = 'drafting' where id = a;
  end loop;
end $$;

-- D: archived.
do $$
declare a uuid;
begin
  a := t5.article(9, t5.txt('different-angle'));
  perform t5.passall(a, 1);
  update nexra_articles set status = 'archived' where id = a;
  perform t.ok(t5.approve(a, 1)->>'outcome' = 'archived', 'archived refused');
  update nexra_articles set status = 'checked' where id = a;
end $$;

-- E: the parent constraint, immutability and the insert trigger.
do $$
begin
  begin
    update nexra_articles set status = 'approved', approved_version = 1, approved_by = gen_random_uuid(), approved_at = now() where id = (select article_id from nexra_article_approvals order by approved_at limit 1);
    perform t.ok(false, 'approved with the pointer on an old version must fail');
  exception when check_violation then perform t.ok(true, 'approved must name the current version (constraint)');
  end;
  begin
    update nexra_articles set status = 'approved' where status = 'checked';
    perform t.ok(false, 'approved without a pointer must fail');
  exception when check_violation then perform t.ok(true, 'approved requires a pointer');
  end;
  begin
    update nexra_article_approvals set unit_count = 1;
    perform t.ok(false, 'update must fail');
  exception when check_violation then perform t.ok(true, 'approval rows cannot be updated');
  end;
  begin
    delete from nexra_article_approvals;
    perform t.ok(false, 'delete must fail');
  exception when check_violation then perform t.ok(true, 'approval rows cannot be deleted');
  end;
  -- Since C6 (20260925120000) the approvals are referenced by a foreign key,
  -- so a plain TRUNCATE is refused by PostgreSQL itself (0A000) before the
  -- guard runs; TRUNCATE ... CASCADE reaches the guard, which refuses it.
  -- Either way the history stays.
  declare v_before bigint := (select count(*) from nexra_article_approvals);
  begin
    perform t.ok(v_before > 0, 'approval history exists before the truncate attempts');
    begin
      truncate nexra_article_approvals;
      perform t.ok(false, 'truncate must fail');
    exception when feature_not_supported then perform t.ok(true, 'approval rows cannot be truncated (referenced by a foreign key)');
    end;
    begin
      truncate nexra_article_approvals cascade;
      perform t.ok(false, 'truncate cascade must fail');
    exception when check_violation then perform t.ok(true, 'approval rows cannot be truncated with cascade (guard refuses)');
    end;
    perform t.ok((select count(*) from nexra_article_approvals) = v_before, 'approval history intact after both truncate attempts');
  end;
  begin
    insert into nexra_article_approvals (article_id, article_version, article_version_id, content_sha256, unit_count, units_sha256, approved_by)
      select article_id, article_version, article_version_id, repeat('9',64), unit_count, units_sha256, approved_by from nexra_article_approvals limit 1;
    perform t.ok(false, 'insert with a wrong hash must fail');
  exception when check_violation then perform t.ok(true, 'insert trigger refuses a hash that is not the version''s');
  end;
end $$;

-- F: access.
do $$
begin
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_article_approvals'::regclass), 'RLS enabled');
  perform t.ok((select count(*) from pg_policy where polrelid = 'public.nexra_article_approvals'::regclass) = 0, 'no policies');
  perform t.ok(not has_table_privilege('anon', 'public.nexra_article_approvals', 'select,insert,update,delete'), 'anon: no table access');
  perform t.ok(not has_table_privilege('authenticated', 'public.nexra_article_approvals', 'select,insert,update,delete'), 'authenticated: no table access');
  perform t.ok(has_table_privilege('service_role', 'public.nexra_article_approvals', 'select'), 'service_role: select');
  perform t.ok(not has_table_privilege('service_role', 'public.nexra_article_approvals', 'insert,update,delete,truncate'), 'service_role: no direct write');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)', 'execute'), 'service_role: execute approve');
  perform t.ok(not has_function_privilege('anon', 'public.nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)', 'execute'), 'anon: no execute');
  perform t.ok(not has_function_privilege('authenticated', 'public.nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)', 'execute'), 'authenticated: no execute');
  perform t.ok(not has_table_privilege('service_role', 'public.nexra_articles', 'update,insert,delete'), 'service_role still cannot write articles directly');
  -- The authorized security definer article functions: C2 create/save, C4 record,
  -- C5 approve, and (since 20260925120000) C6 propose/withdraw. Any other is refused.
  perform t.ok((select array_agg(proname order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and prosecdef and proname like 'nexra_article%')
     = array['nexra_article_approve_version','nexra_article_check_unit_carry','nexra_article_check_unit_fresh','nexra_article_check_unit_record','nexra_article_create','nexra_article_publication_live_articles','nexra_article_publication_propose','nexra_article_publication_withdraw','nexra_article_save_version']::name[], 'security definer article functions: exactly C2, C4, C5, C6, the F8 carry and fresh write functions and the F9 live-articles read');
  perform t.ok((select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where prosecdef and n.nspname not in ('pg_catalog', 'information_schema'))
     = array['agent_run_claim(uuid,text,text,integer)','agent_run_finish(uuid,uuid,text,text,jsonb,text,text)','agent_run_heartbeat(uuid,uuid,integer)',
             'agent_run_recover_expired(integer)','agent_run_schedule_retries(integer)','agent_runs_close_cancelled_attempt()','agent_runtime_status()',
             'nexra_agent_task_create(text,text,text,text,text,text,uuid)',
             'nexra_agent_task_handoff_link(text,uuid,uuid,uuid)','nexra_agent_task_handoff_request(text,uuid,uuid)',
             'nexra_agent_task_set_owner(text,uuid,text,uuid)','nexra_agent_task_set_priority(text,uuid,text,uuid,uuid)','nexra_agent_task_set_status(text,uuid,text,uuid)',
             'nexra_approval_consume(text,uuid,text,uuid,text,uuid)','nexra_approval_record(text,text,uuid,text,text,uuid,integer)',
             'nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)',
             'nexra_article_check_unit_carry(text,uuid,smallint,uuid,smallint,text,text,smallint,smallint,smallint,text,uuid,text,text,uuid)',
             'nexra_article_check_unit_fresh(text,uuid,uuid,smallint,uuid)',
             'nexra_article_check_unit_record(text,uuid,smallint,uuid,smallint,text,text,smallint,smallint,smallint,text,text,jsonb,uuid,uuid)',
             'nexra_article_create(text,uuid,text,text,jsonb,uuid)',
             'nexra_article_publication_live_articles(text)',
             'nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)',
             'nexra_article_publication_withdraw(text,uuid,uuid)',
             'nexra_article_save_version(text,uuid,smallint,text,text,jsonb,uuid)',
             'nexra_content_draft_save_version(uuid,text,smallint,text,text,uuid)',
             'nexra_content_publication_propose(text,uuid,smallint,uuid,text,uuid,timestamp with time zone,text,text,text,text,uuid)',
             'nexra_crawl_finding_triage_set(text,uuid,text,text,text,uuid)',
             'nexra_crawl_findings_record(text,uuid,smallint,integer,integer,integer,integer,integer,boolean,jsonb,text[],jsonb)',
             'nexra_keyword_add(text,text,text,text,text,uuid)','nexra_keyword_set_group(text,uuid,text,uuid)','nexra_keyword_set_note(text,uuid,text,uuid)',
             'nexra_keyword_set_status(text,uuid,text,uuid)','nexra_keyword_set_target(text,uuid,text,uuid)',
             'nexra_provider_metrics_record(uuid,uuid,jsonb)',
             'nexra_provider_request_record(uuid,smallint,text,jsonb,text,integer,text,numeric,integer,text,timestamp with time zone,timestamp with time zone)',
             'nexra_provider_run_finish(uuid,text,numeric,numeric,text)','nexra_provider_run_reserve(text,text[],integer,text,text,text,numeric,numeric,uuid)','nexra_provider_run_resume(uuid,numeric,numeric,uuid)',
             'nexra_search_console_query_pages_record(text,text,text,date,date,jsonb,timestamp with time zone)',
             'nexra_search_console_snapshot_record(text,text,text,date,date,text,bigint,bigint,numeric,numeric,jsonb,jsonb,text[],timestamp with time zone)',
             'rate_limit_consume(text,integer,integer)'],
     'security definer, whole database: exactly the authorized functions with their signatures; nothing unexpected');
  perform t.ok((select bool_and(proconfig = array['search_path=""']) from pg_proc where proname in ('nexra_article_approve_version','nexra_article_approvals_check_insert','nexra_article_approvals_guard_write')), 'empty search_path');
end $$;
