-- M2 opportunities (migration 20261021120000) on the full schema: the table and its security, accept with every
-- refusal, the derived priority and owner, the task it creates, the guards. Part of the local PostgreSQL test harness;
-- run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema and security.
do $$
begin
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_opportunities'::regclass)
    and not exists (select 1 from pg_policy where polrelid = 'public.nexra_opportunities'::regclass), 'A RLS on, no policies');
  perform t.ok(has_table_privilege('service_role', 'public.nexra_opportunities', 'select')
    and not has_table_privilege('service_role', 'public.nexra_opportunities', 'insert')
    and not has_table_privilege('service_role', 'public.nexra_opportunities', 'update')
    and not has_table_privilege('service_role', 'public.nexra_opportunities', 'delete')
    and not has_table_privilege('anon', 'public.nexra_opportunities', 'select')
    and not has_table_privilege('authenticated', 'public.nexra_opportunities', 'select'), 'A service_role SELECT only; nothing for anon or authenticated');
  perform t.ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.nexra_opportunity_accept(text,jsonb,uuid)'::regprocedure)
    and has_function_privilege('service_role', 'public.nexra_opportunity_accept(text,jsonb,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.nexra_opportunity_accept(text,jsonb,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.nexra_opportunity_accept(text,jsonb,uuid)', 'execute'), 'A accept: security definer, empty search_path, EXECUTE for service_role only');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_opportunity_signals_valid(jsonb)', 'execute')
    and not has_function_privilege('service_role', 'public.nexra_opportunities_guard_insert()', 'execute'), 'A the helpers and guards: executable by no API role');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_agent_tasks_source_kind_valid') like '%director-run%keyword%opportunity%', 'A tasks: three source kinds');
  perform t.ok((select count(*) from pg_trigger where tgrelid = 'public.nexra_opportunities'::regclass and not tgisinternal and tgenabled = 'O') = 4, 'A four guard triggers, enabled');
  perform t.ok(t.err($q$select public.nexra_agent_task_create('halcyon-fintech', 'x', 'opportunity', 'x', 'writer', 'medium', t.op())$q$) = '22023', 'A the task create function still refuses the opportunity kind (22023)');
end $$;

-- B: accept a write on the gap: the opportunity, its backlog task and the task's created event, in one go.
do $$
declare m uuid; r jsonb; o jsonb; k jsonb;
begin
  m := t21.map();
  r := t21.accept(t21.opp(m, t21.cid(m, 1)));
  o := r->'opportunity'; k := r->'task';
  perform t.ok(r->>'outcome' = 'accepted', 'B accepted');
  perform t.ok(o->>'action' = 'write' and (o->>'score')::int = 45 and o->>'priority' = 'medium' and (o->>'rules_version')::int = 1
    and o->>'gsc_end_date' = '2026-09-29' and o->'crawl_id' = 'null'::jsonb and o->'finding_key' = 'null'::jsonb, 'B the opportunity as scored: write, 45, medium, rules 1, the window, no crawl, no finding');
  perform t.ok(k->>'status' = 'backlog' and k->>'source_kind' = 'opportunity' and k->>'source_ref' = o->>'id' and k->>'owning_agent' = 'content-strategist'
    and k->>'priority' = 'medium' and k->>'title' = 'Write: Seed 1', 'B the task: backlog, source kind opportunity naming the opportunity, Content Strategist, medium');
  perform t.ok((o->>'task_id')::uuid = (k->>'id')::uuid, 'B the opportunity names its task');
  perform t.ok(exists (select 1 from public.nexra_agent_task_events where task_id = (k->>'id')::uuid and event_type = 'created'), 'B the task''s created event was recorded');
end $$;

-- C: the same again answers exists and writes nothing; another action on another cluster is its own row.
do $$
declare m uuid; n0 text; r jsonb;
begin
  m := (select map_id from public.nexra_opportunities limit 1);
  n0 := t21.n();
  r := t21.accept(t21.opp(m, t21.cid(m, 1)));
  perform t.ok(r->>'outcome' = 'exists' and r->'opportunity'->>'cluster_id' = t21.cid(m, 1)::text, 'C a repeat: exists, with the earlier row');
  perform t.ok(t21.n() = n0, 'C a repeat writes nothing');
  r := t21.accept(t21.opp(m, t21.cid(m, 2), 'expand', 30, null, t21.signals(10, 10, 10), 'Expand: /blog/x'));
  perform t.ok(r->>'outcome' = 'accepted' and r->'opportunity'->>'priority' = 'medium', 'C expand on the partial cluster: accepted (30 is medium)');
  r := t21.accept(t21.opp(m, t21.cid(m, 3), 'refresh', 60, null, t21.signals(30, 20, 10), 'Refresh: /blog/y'));
  perform t.ok(r->>'outcome' = 'accepted' and r->'opportunity'->>'priority' = 'high' and r->'task'->>'priority' = 'high', 'C refresh on the covered cluster: accepted (60 is high)');
  r := t21.accept(t21.opp(m, t21.cid(m, 2), 'fix', 29, 'title-duplicate', t21.signals(10, 9, 10), 'Fix: duplicate title on /blog/x'));
  perform t.ok(r->>'outcome' = 'accepted' and r->'opportunity'->>'priority' = 'low' and r->'task'->>'owning_agent' = 'technical-seo', 'C fix on a cluster with a page: accepted, low under 30, Technical SEO');
  r := t21.accept(t21.opp(m, t21.cid(m, 2), 'fix', 29, 'h1-missing', t21.signals(10, 9, 10), 'Fix: missing h1 on /blog/x'));
  perform t.ok(r->>'outcome' = 'accepted', 'C a second finding on the same cluster is its own opportunity');
end $$;

-- D: refusals, each writing nothing.
do $$
declare m uuid; other uuid; n0 text; proposed uuid; v uuid;
begin
  m := (select map_id from public.nexra_opportunities limit 1);
  n0 := t21.n();
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1)), 'no-such-project')->>'outcome' = 'project-not-found', 'D an unknown project: project-not-found');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1)), 'verdant-home')->>'outcome' = 'map-not-approved', 'D another project''s map: map-not-approved');
  v := t19.run('halcyon-fintech');
  proposed := t19.id(t19.record(t19.map(v)));
  perform t.ok(t21.accept(t21.opp(proposed, t21.cid(proposed, 1)))->>'outcome' = 'map-not-approved', 'D a proposed map: map-not-approved');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(proposed, 1)))->>'outcome' = 'cluster-not-found', 'D another map''s cluster: cluster-not-found');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1), 'expand'))->>'reason' = 'action-coverage', 'D expand on a gap: invalid action-coverage');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 2), 'write'))->>'reason' = 'action-coverage', 'D write on a partial: invalid action-coverage');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1), 'fix', 45, 'h1-missing'))->>'reason' = 'action-coverage', 'D fix on a cluster with no page: invalid action-coverage');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 2), 'fix'))->>'reason' = 'finding', 'D fix without a finding: invalid finding');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1), 'write', 45, 'h1-missing'))->>'reason' = 'finding', 'D a finding on a write: invalid finding');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1), 'write', 44))->>'reason' = 'score', 'D a score that is not the lines'' sum: invalid score');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1), 'write', 45, null, '[{"label":"x","points":45,"source":"derived","detail":"y"}]'))->>'reason' = 'signals', 'D a line over 30 points: invalid signals');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1), 'write', 5, null, '[{"label":"x","points":5,"source":"guessed","detail":"y"}]'))->>'reason' = 'signals', 'D a line with an unknown source: invalid signals');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1), 'write', 0, null, '[]'))->>'reason' = 'signals', 'D no lines: invalid signals');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1), 'write', 45, null, null, '   '))->>'reason' = 'title', 'D a blank title: invalid title');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1)) || '{"action":"publish"}')->>'reason' = 'action', 'D an unknown action: invalid action');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 1)) || '{"map_id":"not-a-uuid"}')->>'reason' = 'ids', 'D a malformed id: invalid ids');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 3), 'fix', 29, 'meta-description-long', t21.signals(10, 9, 10), 'Fix: long description') || '{"crawl_id":"00000000-0000-4000-8000-000000000999"}')->>'reason' = 'crawl', 'D a crawl that is not the project''s: invalid crawl');
  perform t.ok(t.err($q$select public.nexra_opportunity_accept('halcyon-fintech', '"x"', t.pop())$q$) = '22023', 'D a non-object payload raises 22023');
  perform t.ok((select count(*) from public.nexra_opportunities) = split_part(n0, '/', 1)::int
    and (select count(*) from public.nexra_agent_tasks) = split_part(n0, '/', 2)::int, 'D the refusals wrote no opportunity and no task');
end $$;

-- E: once the map is superseded by a newer approved map, its clusters can no longer be accepted; the rows stay.
do $$
declare m uuid; m2 uuid; n0 bigint;
begin
  m := (select map_id from public.nexra_opportunities limit 1);
  n0 := (select count(*) from public.nexra_opportunities);
  m2 := t21.map();
  perform t.ok(t19.status(m) = 'superseded', 'E the first map is superseded by the second approval');
  perform t.ok(t21.accept(t21.opp(m, t21.cid(m, 3), 'fix', 29, 'meta-description-long', t21.signals(10, 9, 10), 'Fix: long description'))->>'outcome' = 'map-not-approved', 'E a superseded map: map-not-approved');
  perform t.ok((select count(*) from public.nexra_opportunities) = n0, 'E the accepted rows of the superseded map stay');
  perform t.ok(t21.accept(t21.opp(m2, t21.cid(m2, 1)))->>'outcome' = 'accepted', 'E the new approved map''s gap: accepted');
end $$;

-- F: guards, for every writer.
do $$
declare o uuid;
begin
  o := (select id from public.nexra_opportunities limit 1);
  perform t.ok(t.err($q$insert into public.nexra_opportunities (project_id, map_id, cluster_id, action, title, score, rules_version, priority, signals, task_id, accepted_by)
    select project_id, map_id, cluster_id, 'expand', 'x', score, rules_version, priority, signals, task_id, accepted_by from public.nexra_opportunities limit 1$q$) = '23514', 'F a direct insert: refused (23514)');
  perform t.ok(t.err(format('update public.nexra_opportunities set title = %L where id = %L', 'y', o)) = '23514', 'F an update: refused (23514)');
  perform t.ok(t.err(format('delete from public.nexra_opportunities where id = %L', o)) = '23514', 'F a delete: refused (23514)');
  perform t.ok(t.err('truncate public.nexra_opportunities') = '23514', 'F a truncate: refused (23514)');
end $$;

set role service_role;
do $$
begin
  perform t.ok(t.err($q$insert into public.nexra_opportunities (project_id) values ('halcyon-fintech')$q$) = '42501', 'G service_role has no INSERT (42501)');
  perform t.ok((select count(*) from public.nexra_opportunities) > 0, 'G service_role reads the table');
  perform t.ok(t21.accept(t21.opp((select id from public.nexra_topic_maps where status = 'approved' and project_id = 'halcyon-fintech'),
    (select id from public.nexra_topic_clusters where map_id = (select id from public.nexra_topic_maps where status = 'approved' and project_id = 'halcyon-fintech') and position = 1)))->>'outcome' = 'exists',
    'G service_role calls accept through the function (a repeat: exists)');
end $$;
reset role;
