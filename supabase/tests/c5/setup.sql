-- C5 fixtures (schema t5): article, check-unit and approval helpers. Runs after c4/setup.sql.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
create schema t5;
-- A source draft for saves.
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count) values
 ('20000000-0000-4000-8000-000000000001','halcyon-fintech','writer','section-draft',repeat('3',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','w',1);
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count)
 select ('10000000-0000-4000-8000-0000000000' || lpad(n::text,2,'0'))::uuid,'halcyon-fintech','content-strategist','content-plan-review',encode(sha256(convert_to(n::text,'UTF8')),'hex'),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','plan',1
   from generate_series(10,19) n;
set session_replication_role = origin;
insert into nexra_content_drafts (id, project_id, source_writer_run_id, section_label, created_by)
 values ('d0000000-0000-4000-8000-000000000001','halcyon-fintech','20000000-0000-4000-8000-000000000001','S','00000000-0000-4000-8000-0000000000aa');
insert into nexra_content_draft_versions (id, draft_id, version, origin, title, body, created_by)
 values ('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',1,'writer','T','B','00000000-0000-4000-8000-0000000000aa');

create function t5.sources() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('draft_id','d0000000-0000-4000-8000-000000000001','version',1,'version_id','d1000000-0000-4000-8000-000000000001',
    'content_sha256', encode(sha256(convert_to('nexra-content-draft-version/1','UTF8') || decode('00','hex') || convert_to('T','UTF8') || decode('00','hex') || convert_to('B','UTF8')),'hex')))
$$;
create function t5.txt(p_topic text, p_lead text default 'A lead.') returns text language sql as $$
  select '{"format":"nexra-article-content/1","topic":"t","lead":' || to_jsonb(p_lead)::text || ',"sections":[{"id":"s1"}],"faqs":[],"topicDecision":' || to_jsonb(p_topic)::text || '}'
$$;

-- Create article n (a1000000-...-00000000000n) on plan run 100000..0n+10, version 1 with the given text.
create function t5.article(n int, p_txt text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.nexra_article_create('halcyon-fintech', ('10000000-0000-4000-8000-0000000000' || (n + 10))::uuid, p_txt,
         encode(sha256(convert_to(p_txt,'UTF8')),'hex'), t5.sources(), '00000000-0000-4000-8000-0000000000aa');
  if r->>'outcome' <> 'created' then raise exception 'create failed: %', r; end if;
  return (r->'article'->>'id')::uuid;
end $$;
create function t5.vid(a uuid, v int) returns uuid language sql as $$ select id from nexra_article_versions where article_id = a and version = v $$;
create function t5.sha(a uuid, v int) returns text language sql as $$ select content_sha256 from nexra_article_versions where article_id = a and version = v $$;

-- The four-unit plan for these texts.
create table t5.plan(idx int primary key, kind text, key text);
insert into t5.plan values (0,'metadata','metadata:1'),(1,'lead-introduction','lead-introduction:1'),(2,'section','section:s1:1'),(3,'cta','cta:1');
create function t5.h(a uuid, v int, i int) returns text language sql immutable as $$ select encode(sha256(convert_to('u-' || a || '-' || v || '-' || i, 'UTF8')), 'hex') $$;

-- Record unit i of (a, v) with the given status through the real C4 function.
create function t5.rec(a uuid, v int, i int, p_status text) returns jsonb language plpgsql as $$
declare p t5.plan; rid uuid := gen_random_uuid(); vid uuid := t5.vid(a, v);
begin
  select * into p from t5.plan where idx = i;
  set local session_replication_role = replica;
  insert into agent_runs (id, project_id, agent_id, task_type, input, input_hash, status, created_by, started_at, finished_at, executor, result_summary, result_metadata, attempt_count)
  values (rid, 'halcyon-fintech', 'research-evidence', 'article-check-unit',
    jsonb_build_object('articleId', a::text, 'articleVersion', v, 'articleVersionId', vid::text, 'unitIndex', i),
    encode(sha256(convert_to(rid::text,'UTF8')),'hex'), 'completed', '00000000-0000-4000-8000-0000000000aa', now(), now(), 'ai', 'answer',
    jsonb_build_object('simulated', false, 'grounded', true, 'evidence', jsonb_build_object('source','article-unit','unitKey',p.key,'unitSha256',t5.h(a,v,i),'unitIndex',i,'part',1,'partCount',1,'unitCount',4)), 1);
  set local session_replication_role = origin;
  return public.nexra_article_check_unit_record('halcyon-fintech', a, v::smallint, vid, i::smallint, p.kind, p.key, 1::smallint, 1::smallint, 4::smallint, t5.h(a,v,i), p_status,
    case when p_status = 'failed' then jsonb_build_object('status','failed','reason','coverage-incomplete','checkedByRunId',rid::text) else jsonb_build_object('status',p_status,'checkedByRunId',rid::text) end,
    rid, '00000000-0000-4000-8000-0000000000aa');
end $$;

create function t5.units(a uuid, v int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('index', idx, 'key', key, 'sha256', t5.h(a, v, idx)) order by idx) from t5.plan
$$;
create function t5.digest(a uuid, v int) returns text language sql as $$
  select encode(sha256(convert_to('nexra-article-approval-units/1' || chr(10) || string_agg(idx || ' ' || key || ' ' || t5.h(a,v,idx) || chr(10), '' order by idx), 'UTF8')), 'hex') from t5.plan
$$;
create function t5.approve(a uuid, v int, p_units jsonb default null, p_digest text default null, p_project text default 'halcyon-fintech', p_vid uuid default null, p_sha text default null)
returns jsonb language sql as $$
  select public.nexra_article_approve_version(p_project, a, v::smallint, coalesce(p_vid, t5.vid(a, v), '00000000-0000-4000-8000-00000000ffff'::uuid), coalesce(p_sha, t5.sha(a, v), repeat('0',64)),
    coalesce(p_units, t5.units(a, v)), coalesce(p_digest, t5.digest(a, v)), '00000000-0000-4000-8000-0000000000bb')
$$;
create function t5.passall(a uuid, v int) returns void language plpgsql as $$
begin for i in 0..3 loop perform t5.rec(a, v, i, 'passed'); end loop; end $$;
