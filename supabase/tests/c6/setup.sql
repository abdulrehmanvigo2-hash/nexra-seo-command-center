-- C6 fixtures (schema t6): project nexra-agency, approved articles, propose/withdraw helpers. Runs after c5/setup.sql.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
-- C6 harness: runs after reset5.sh (t2 setup + t5 setup). Project nexra-agency is the one
-- the pinned destination registry allows for nexra-agency-website.
create schema t6;
insert into projects (id, name, client, domain, initials, industry, type, goal, market, language, target_location) values
 ('nexra-agency','Nexra','Nexra','nexraagency.com','NX','agency','saas','leads','US','en','US');
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count) values
 ('60000000-0000-4000-8000-000000000001','nexra-agency','writer','section-draft',repeat('6',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','w',1);
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count)
 select ('60000000-0000-4000-8000-0000000000' || n)::uuid,'nexra-agency','content-strategist','content-plan-review',encode(sha256(convert_to('p6-' || n,'UTF8')),'hex'),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','plan',1
   from generate_series(10,99) n;
set session_replication_role = origin;
insert into nexra_content_drafts (id, project_id, source_writer_run_id, section_label, created_by)
 values ('d6000000-0000-4000-8000-000000000001','nexra-agency','60000000-0000-4000-8000-000000000001','S','00000000-0000-4000-8000-0000000000aa');
insert into nexra_content_draft_versions (id, draft_id, version, origin, title, body, created_by)
 values ('d6100000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001',1,'writer','T','B','00000000-0000-4000-8000-0000000000aa');

create function t6.sources() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('draft_id','d6000000-0000-4000-8000-000000000001','version',1,'version_id','d6100000-0000-4000-8000-000000000001',
    'content_sha256', encode(sha256(convert_to('nexra-content-draft-version/1','UTF8') || decode('00','hex') || convert_to('T','UTF8') || decode('00','hex') || convert_to('B','UTF8')),'hex')))
$$;
-- C1-shaped text (key order as canonical.ts) with a slug and a topic decision.
create function t6.txt(p_slug text, p_topic text default 'different-angle', p_lead text default 'A lead.') returns text language sql as $$
  select '{"format":"nexra-article-content/1","topic":"t","slug":' || to_jsonb(p_slug)::text || ',"lead":' || to_jsonb(p_lead)::text
      || ',"sections":[{"id":"s1"}],"faqs":[],"topicDecision":' || to_jsonb(p_topic)::text || '}'
$$;
create function t6.sha(p_txt text) returns text language sql as $$ select encode(sha256(convert_to(p_txt,'UTF8')),'hex') $$;
create function t6.article(n int, p_txt text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.nexra_article_create('nexra-agency', ('60000000-0000-4000-8000-0000000000' || n)::uuid, p_txt, t6.sha(p_txt), t6.sources(), '00000000-0000-4000-8000-0000000000aa');
  if r->>'outcome' <> 'created' then raise exception 'create failed: %', r; end if;
  return (r->'article'->>'id')::uuid;
end $$;
create function t6.save(a uuid, v int, p_txt text) returns jsonb language sql as $$
  select public.nexra_article_save_version('nexra-agency', a, v::smallint, p_txt, t6.sha(p_txt), t6.sources(), '00000000-0000-4000-8000-0000000000aa')
$$;
create function t6.rec(a uuid, v int, i int, p_status text) returns jsonb language plpgsql as $$
declare p t5.plan; rid uuid := gen_random_uuid(); vid uuid := t5.vid(a, v);
begin
  select * into p from t5.plan where idx = i;
  set local session_replication_role = replica;
  insert into agent_runs (id, project_id, agent_id, task_type, input, input_hash, status, created_by, started_at, finished_at, executor, result_summary, result_metadata, attempt_count)
  values (rid, 'nexra-agency', 'research-evidence', 'article-check-unit',
    jsonb_build_object('articleId', a::text, 'articleVersion', v, 'articleVersionId', vid::text, 'unitIndex', i),
    encode(sha256(convert_to(rid::text,'UTF8')),'hex'), 'completed', '00000000-0000-4000-8000-0000000000aa', now(), now(), 'ai', 'answer',
    jsonb_build_object('simulated', false, 'grounded', true, 'evidence', jsonb_build_object('source','article-unit','unitKey',p.key,'unitSha256',t5.h(a,v,i),'unitIndex',i,'part',1,'partCount',1,'unitCount',4)), 1);
  set local session_replication_role = origin;
  return public.nexra_article_check_unit_record('nexra-agency', a, v::smallint, vid, i::smallint, p.kind, p.key, 1::smallint, 1::smallint, 4::smallint, t5.h(a,v,i), p_status,
    jsonb_build_object('status',p_status,'checkedByRunId',rid::text), rid, '00000000-0000-4000-8000-0000000000aa');
end $$;
create function t6.passall(a uuid, v int) returns void language plpgsql as $$
begin for i in 0..3 loop perform t6.rec(a, v, i, 'passed'); end loop; end $$;
create function t6.approve(a uuid, v int) returns jsonb language sql as $$
  select public.nexra_article_approve_version('nexra-agency', a, v::smallint, t5.vid(a, v), t5.sha(a, v), t5.units(a, v), t5.digest(a, v), '00000000-0000-4000-8000-0000000000bb')
$$;
create function t6.aid(a uuid, v int) returns uuid language sql as $$ select id from nexra_article_approvals where article_id = a and article_version = v $$;
-- Article n, version 1 with the given text, every unit passed, approved through C5.
create function t6.ready(n int, p_txt text) returns uuid language plpgsql as $$
declare a uuid; r jsonb;
begin
  a := t6.article(n, p_txt);
  perform t6.passall(a, 1);
  r := t6.approve(a, 1);
  if r->>'outcome' <> 'approved' then raise exception 'approve failed: %', r; end if;
  return a;
end $$;
-- Propose version v of a, defaults from the stored rows; any argument may be overridden.
create function t6.propose(a uuid, v int, p_slug text default null, p_dest text default 'nexra-agency-website', p_pv text default null,
  p_fmt text default 'article-proposal-text/1', p_project text default 'nexra-agency', p_vid uuid default null, p_sha text default null, p_aid uuid default null,
  p_by uuid default '00000000-0000-4000-8000-0000000000cc')
returns jsonb language sql as $$
  select public.nexra_article_publication_propose(p_project, a, v::smallint,
    coalesce(p_vid, t5.vid(a, v), '00000000-0000-4000-8000-00000000ffff'::uuid),
    coalesce(p_sha, t5.sha(a, v), repeat('0',64)),
    coalesce(p_aid, t6.aid(a, v), '00000000-0000-4000-8000-00000000fffe'::uuid),
    p_dest,
    coalesce(p_slug, (select canonical_content::jsonb->>'slug' from nexra_article_versions where article_id = a and version = v), 'x-x-x'),
    p_fmt, coalesce(p_pv, repeat('a',64)), p_by)
$$;
create function t6.withdraw(p uuid, p_project text default 'nexra-agency') returns jsonb language sql as $$
  select public.nexra_article_publication_withdraw(p_project, p, '00000000-0000-4000-8000-0000000000dd')
$$;
create function t6.n() returns bigint language sql as $$ select count(*) from nexra_article_publication_proposals $$;
create function t6.a(n int) returns uuid language sql as $$ select id from nexra_articles where source_plan_run_id = ('60000000-0000-4000-8000-0000000000' || n)::uuid $$;
