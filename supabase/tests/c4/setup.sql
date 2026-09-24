-- Shared base for C4, C5 and C6: projects halcyon-fintech / verdant-home, schema t with t.ok(), C4 fixtures.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
insert into projects (id, name, client, domain, initials, industry, type, goal, market, language, target_location) values
 ('halcyon-fintech','Halcyon','Halcyon','halcyon.example','HF','fintech','saas','leads','US','en','US'),
 ('verdant-home','Verdant','Verdant','verdant.example','VH','home','saas','leads','US','en','US');

create schema t;
create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;

-- Canonical-shaped texts: v1/v2 have 2 sections + FAQs (6 blocks); v3 one section, no FAQs (4 blocks).
create table t.ver(n int primary key, txt text);
insert into t.ver values
 (1, '{"format":"nexra-article-content/1","topic":"t","sections":[{"id":"what-it-does"},{"id":"where-it-stops"}],"faqs":[{"question":"q","answer":"a"}]}'),
 (2, '{"format":"nexra-article-content/1","topic":"t2","sections":[{"id":"what-it-does"},{"id":"where-it-stops"}],"faqs":[{"question":"q","answer":"a"}]}'),
 (3, '{"format":"nexra-article-content/1","topic":"t3","sections":[{"id":"what-it-does"}],"faqs":[]}');

-- The unit plan the application would yield, per version: blocks with part counts.
create table t.plan(v int, idx int, kind text, key text, part int, part_count int, unit_count int, primary key (v, idx));
insert into t.plan values
 (1,0,'metadata','metadata:1',1,2,9),(1,1,'metadata','metadata:2',2,2,9),(1,2,'lead-introduction','lead-introduction:1',1,1,9),
 (1,3,'section','section:what-it-does:1',1,3,9),(1,4,'section','section:what-it-does:2',2,3,9),(1,5,'section','section:what-it-does:3',3,3,9),
 (1,6,'section','section:where-it-stops:1',1,1,9),(1,7,'faq','faq:1',1,1,9),(1,8,'cta','cta:1',1,1,9),
 (2,0,'metadata','metadata:1',1,1,6),(2,1,'lead-introduction','lead-introduction:1',1,1,6),(2,2,'section','section:what-it-does:1',1,1,6),
 (2,3,'section','section:where-it-stops:1',1,1,6),(2,4,'faq','faq:1',1,1,6),(2,5,'cta','cta:1',1,1,6),
 (3,0,'metadata','metadata:1',1,1,4),(3,1,'lead-introduction','lead-introduction:1',1,1,4),(3,2,'section','section:what-it-does:1',1,1,4),(3,3,'cta','cta:1',1,1,4);

set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count) values
 ('10000000-0000-4000-8000-000000000001','halcyon-fintech','content-strategist','content-plan-review',repeat('1',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','plan',1),
 ('10000000-0000-4000-8000-000000000002','verdant-home','content-strategist','content-plan-review',repeat('2',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','plan',1);
set session_replication_role = origin;

insert into nexra_articles (id, project_id, source_plan_run_id, created_by) values
 ('a0000000-0000-4000-8000-000000000001','halcyon-fintech','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000aa'),
 ('a0000000-0000-4000-8000-000000000002','verdant-home','10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-0000000000aa');
insert into nexra_article_versions (id, article_id, version, origin, canonical_content, content_sha256, created_by)
 select ('b0000000-0000-4000-8000-00000000000' || n)::uuid, 'a0000000-0000-4000-8000-000000000001', n, 'operator', txt, encode(sha256(convert_to(txt,'UTF8')),'hex'), '00000000-0000-4000-8000-0000000000aa' from t.ver where n in (1,2);
insert into nexra_article_versions (id, article_id, version, origin, canonical_content, content_sha256, created_by)
 select 'b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000002', 1, 'operator', txt, encode(sha256(convert_to(txt,'UTF8')),'hex'), '00000000-0000-4000-8000-0000000000aa' from t.ver where n = 1;


create function t.h(v int, i int) returns text language sql immutable as $$ select encode(sha256(convert_to('unit-' || v || '-' || i, 'UTF8')), 'hex') $$;
create function t.p(pv int, pi int) returns t.plan language sql as $$ select * from t.plan where v = pv and idx = pi $$;

-- A Research & Evidence run for (version, unit index); a completed run's evidence names the plan's identity unless overridden.
create function t.run(p_id uuid, p_project text, pv int, pi int, p_status text, p_simulated boolean default false, p_evidence jsonb default '{}', p_version_id uuid default null, p_article uuid default 'a0000000-0000-4000-8000-000000000001') returns uuid language plpgsql as $$
declare v_vid uuid := coalesce(p_version_id, ('b0000000-0000-4000-8000-00000000000' || pv)::uuid); v_p t.plan := t.p(pv, pi);
begin
  set local session_replication_role = replica;
  insert into agent_runs (id, project_id, agent_id, task_type, input, input_hash, status, created_by, started_at, finished_at, executor, result_summary, result_metadata, attempt_count, error_code, error_message)
  values (p_id, p_project, 'research-evidence', 'article-check-unit',
    jsonb_build_object('articleId', p_article::text, 'articleVersion', pv, 'articleVersionId', v_vid::text, 'unitIndex', pi),
    encode(sha256(convert_to(p_id::text,'UTF8')),'hex'), p_status, '00000000-0000-4000-8000-0000000000aa',
    case when p_status = 'queued' then null else now() end,
    case when p_status in ('completed','failed','cancelled') then now() else null end,
    case when p_status = 'queued' then null when p_simulated then 'mock' else 'ai' end,
    case when p_status = 'completed' then 'answer' else null end,
    case when p_status = 'completed' then jsonb_build_object('simulated', p_simulated, 'grounded', not p_simulated, 'evidence',
      jsonb_build_object('source','article-unit','unitKey', v_p.key, 'unitSha256', t.h(pv,pi), 'unitIndex', pi, 'part', v_p.part, 'partCount', v_p.part_count, 'unitCount', v_p.unit_count) || p_evidence) else null end,
    case when p_status = 'queued' then 0 else 1 end,
    case when p_status = 'failed' then 'execution-failed' else null end,
    case when p_status = 'failed' then 'failed' else null end);
  return p_id;
end $$;

-- Record with the plan's identity unless overridden.
create function t.rec(pv int, pi int, p_status text, p_run uuid, p_project text default 'halcyon-fintech', p_article uuid default 'a0000000-0000-4000-8000-000000000001', p_vid uuid default null,
  p_key text default null, p_kind text default null, p_part int default null, p_part_count int default null, p_unit_count int default null, p_sha text default null, p_result jsonb default 'null') returns jsonb language plpgsql as $$
declare v_p t.plan := t.p(pv, pi);
begin
  return public.nexra_article_check_unit_record(p_project, p_article, pv::smallint, coalesce(p_vid, ('b0000000-0000-4000-8000-00000000000' || pv)::uuid), pi::smallint,
    coalesce(p_kind, v_p.kind), coalesce(p_key, v_p.key), coalesce(p_part, v_p.part)::smallint, coalesce(p_part_count, v_p.part_count)::smallint, coalesce(p_unit_count, v_p.unit_count)::smallint,
    coalesce(p_sha, t.h(pv,pi)), p_status,
    case when p_result <> 'null'::jsonb then p_result when p_status = 'pending' then null else jsonb_build_object('status', p_status, 'checkedByRunId', p_run::text) end,
    p_run, '00000000-0000-4000-8000-0000000000aa');
end $$;

create function t.uid(prefix text, pv int, pi int) returns uuid language sql immutable as $$ select (prefix || '000000-0000-4000-8000-' || lpad(pv::text, 6, '0') || lpad(pi::text, 6, '0'))::uuid $$;
