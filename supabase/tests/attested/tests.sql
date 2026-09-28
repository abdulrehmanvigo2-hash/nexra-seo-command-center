-- Operator-attested paragraphs (Phase 6, checkpoint 6.8b, migration 20261010120000). Sections A (schema and security),
-- B (the count function), C (create and save: format 1 or format 2, only as the content implies), D (the approval gate:
-- the tick, at least three supported statements, the count written), E (the approval table's own guards), F (proposals:
-- the preview format the content implies), G (format 1 unchanged). Runs over c4/setup.sql, c5/setup.sql and c6/setup.sql
-- on every migration. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh, which creates and
-- destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t8;
-- C1-shaped text for nexra-agency: format 2 with the given attestations (null → format 1, no member).
create function t8.txt(p_slug text, p_att jsonb default '[{"locator":"s1/0","basis":"experience"}]'::jsonb, p_topic text default 'different-angle') returns text language sql as $$
  select '{"format":"nexra-article-content/' || case when p_att is null then '1' else '2' end || '","topic":"t","slug":' || to_jsonb(p_slug)::text
      || ',"lead":"A lead.","sections":[{"id":"s1","paragraphs":["We saw it first-hand.","The pages declare it."]}],"faqs":[],"topicDecision":' || to_jsonb(p_topic)::text
      || case when p_att is null then '' else ',"attestations":' || p_att::text end || '}'
$$;
-- Record unit i of (a, v) as passed, its result counting the given supported statements.
create function t8.rec(a uuid, v int, i int, p_supported int) returns jsonb language plpgsql as $$
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
  return public.nexra_article_check_unit_record('nexra-agency', a, v::smallint, vid, i::smallint, p.kind, p.key, 1::smallint, 1::smallint, 4::smallint, t5.h(a,v,i), 'passed',
    jsonb_build_object('status','passed','checkedByRunId',rid::text,'counts',jsonb_build_object('supported',p_supported,'partial',0,'unsupported',0,'unverifiable',0,'editorial',0,'attested',1)),
    rid, '00000000-0000-4000-8000-0000000000aa');
end $$;
-- Every unit passed; the supported statements split as given across units 0..3.
create function t8.passall(a uuid, v int, s0 int, s1 int default 0, s2 int default 0, s3 int default 0) returns void language plpgsql as $$
begin perform t8.rec(a, v, 0, s0); perform t8.rec(a, v, 1, s1); perform t8.rec(a, v, 2, s2); perform t8.rec(a, v, 3, s3); end $$;
create function t8.approve(a uuid, v int, p_tick boolean default null) returns jsonb language plpgsql as $$
begin
  if p_tick is null then
    return public.nexra_article_approve_version('nexra-agency', a, v::smallint, t5.vid(a, v), t5.sha(a, v), t5.units(a, v), t5.digest(a, v), '00000000-0000-4000-8000-0000000000bb');
  end if;
  return public.nexra_article_approve_version('nexra-agency', a, v::smallint, t5.vid(a, v), t5.sha(a, v), t5.units(a, v), t5.digest(a, v), '00000000-0000-4000-8000-0000000000bb', p_tick);
end $$;
grant usage on schema t8 to service_role;
grant execute on all functions in schema t8 to service_role;

-- A: schema and security.
do $$
begin
  perform t.ok(to_regprocedure('public.nexra_article_attested_count(text)') is not null, 'A the count function exists');
  perform t.ok((select not prosecdef and provolatile = 'i' and proconfig = array['search_path=""'] from pg_proc where proname = 'nexra_article_attested_count'), 'A the count function: immutable, not security definer, empty search_path');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_article_attested_count(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.nexra_article_attested_count(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.nexra_article_attested_count(text)', 'EXECUTE'), 'A no API role executes the count function');
  perform t.ok((select count(*) from pg_proc where proname = 'nexra_article_approve_version') = 1
    and to_regprocedure('public.nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)') is not null, 'A one approve function, nine parameters');
  perform t.ok((select pronargdefaults from pg_proc where proname = 'nexra_article_approve_version') = 1, 'A the tick defaults (false)');
  perform t.ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where proname = 'nexra_article_approve_version'), 'A approve: security definer, empty search_path');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)', 'EXECUTE')
    and not has_function_privilege('public', 'public.nexra_article_approve_version(text,uuid,smallint,uuid,text,jsonb,text,uuid,boolean)', 'EXECUTE'), 'A approve: service_role only');
  perform t.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_name = 'nexra_article_approvals')
    = array['id','article_id','article_version','article_version_id','content_sha256','unit_count','units_sha256','approved_by','approved_at','attested_count','attested_confirmed'], 'A approvals gain attested_count and attested_confirmed at the end');
  perform t.ok((select column_default from information_schema.columns where table_name = 'nexra_article_approvals' and column_name = 'attested_count') = '0'
    and (select column_default from information_schema.columns where table_name = 'nexra_article_approvals' and column_name = 'attested_confirmed') = 'false', 'A defaults 0 and false');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_article_approvals_attested_confirmed') like '%attested_confirmed = (attested_count > 0)%', 'A the tick is stored exactly when the count is positive');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_article_versions_canonical_format') like '%nexra-article-content/1%nexra-article-content/2%', 'A versions accept format 1 or format 2');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_article_publication_proposals_preview_format_valid') like '%article-proposal-text/1%article-proposal-text/2%', 'A proposals accept preview format 1 or 2');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_article_approvals'::regclass and not tgisinternal)
    = array['nexra_article_approvals_check_insert','nexra_article_approvals_guard_delete','nexra_article_approvals_guard_truncate','nexra_article_approvals_guard_update'], 'A approval triggers unchanged: the insert check and three guards');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_article_approvals' and grantee = 'service_role') = array['SELECT'], 'A service_role: still SELECT only on approvals');
end $$;

-- B: the count function.
do $$
begin
  perform t.ok(public.nexra_article_attested_count(t8.txt('a-b-c', null)) = 0, 'B format 1 with no member: 0');
  perform t.ok(public.nexra_article_attested_count(t8.txt('a-b-c')) = 1, 'B format 2 with one attestation: 1');
  perform t.ok(public.nexra_article_attested_count(t8.txt('a-b-c', '[{"locator":"s1/0","basis":"experience"},{"locator":"s1/1","basis":"opinion"}]')) = 2, 'B two attestations: 2');
  perform t.ok(public.nexra_article_attested_count(t8.txt('a-b-c', '[]')) is null, 'B format 2 with an empty list: invalid');
  perform t.ok(public.nexra_article_attested_count(replace(t8.txt('a-b-c'), 'content/2', 'content/1')) is null, 'B format 1 carrying attestations: invalid');
  perform t.ok(public.nexra_article_attested_count(replace(t8.txt('a-b-c', null), 'content/1', 'content/2')) is null, 'B format 2 without the member: invalid');
  perform t.ok(public.nexra_article_attested_count(replace(t8.txt('a-b-c', null), 'content/1', 'content/3')) is null, 'B an unknown format: invalid');
  perform t.ok(public.nexra_article_attested_count('not json') is null and public.nexra_article_attested_count(null) is null, 'B not JSON, or null: invalid');
end $$;

-- C: create and save — format 2 only as the content implies.
do $$
declare r jsonb; a uuid;
begin
  a := t6.article(40, t8.txt('attested-one'));
  perform t.ok((select canonical_content from nexra_article_versions where article_id = a and version = 1) = t8.txt('attested-one'), 'C a format 2 article is created with its text as given');
  r := public.nexra_article_create('nexra-agency', '60000000-0000-4000-8000-000000000041', t8.txt('att-empty', '[]'), t6.sha(t8.txt('att-empty', '[]')), t6.sources(), '00000000-0000-4000-8000-0000000000aa');
  perform t.ok(r->>'outcome' = 'invalid-content', 'C format 2 with an empty list: invalid-content');
  r := public.nexra_article_create('nexra-agency', '60000000-0000-4000-8000-000000000042', replace(t8.txt('att-one'), 'content/2', 'content/1'), t6.sha(replace(t8.txt('att-one'), 'content/2', 'content/1')), t6.sources(), '00000000-0000-4000-8000-0000000000aa');
  perform t.ok(r->>'outcome' = 'invalid-content', 'C format 1 carrying attestations: invalid-content');
  r := public.nexra_article_create('nexra-agency', '60000000-0000-4000-8000-000000000043', replace(t8.txt('att-three'), 'content/2', 'content/3'), t6.sha(replace(t8.txt('att-three'), 'content/2', 'content/3')), t6.sources(), '00000000-0000-4000-8000-0000000000aa');
  perform t.ok(r->>'outcome' = 'invalid-content', 'C an unknown format: invalid-content');
  r := t6.save(a, 1, t8.txt('attested-one', null));
  perform t.ok(r->>'outcome' = 'created', 'C a format 1 version saved over a format 2 one');
  r := t6.save(a, 2, t8.txt('attested-one'));
  perform t.ok(r->>'outcome' = 'created', 'C and a format 2 version again');
  perform t.ok(t.err($q$insert into nexra_article_versions (article_id, version, origin, canonical_content, content_sha256, created_by) values ('a0000000-0000-4000-8000-000000000001', 99, 'operator', '{"format":"nexra-article-content/3"}', repeat('0',64), '00000000-0000-4000-8000-0000000000aa')$q$) = '23514', 'C a direct row in another format is refused (23514)');
end $$;

-- D: the approval gate.
do $$
declare r jsonb; a1 uuid; a2 uuid; a3 uuid; a4 uuid; n int;
begin
  -- Format 1: unchanged — no tick needed, no supported minimum, count 0 and no tick stored.
  a1 := t6.article(44, t8.txt('plain-one', null));
  perform t8.passall(a1, 1, 0);
  r := t8.approve(a1, 1);
  perform t.ok(r->>'outcome' = 'approved', 'D format 1, no supported statement, no tick: approved as before');
  perform t.ok((r->'approval'->>'attested_count')::int = 0 and (r->'approval'->>'attested_confirmed')::boolean = false, 'D its approval: count 0, tick false');

  -- Format 2 with three supported statements.
  a2 := t6.article(45, t8.txt('attested-two'));
  perform t8.passall(a2, 1, 2, 1);
  n := (select count(*) from nexra_article_approvals);
  r := t8.approve(a2, 1);
  perform t.ok(r->>'outcome' = 'attestation-unconfirmed' and (r->>'attested_count')::int = 1, 'D format 2 without the tick: attestation-unconfirmed, naming the count');
  r := t8.approve(a2, 1, false);
  perform t.ok(r->>'outcome' = 'attestation-unconfirmed', 'D an explicit false tick: attestation-unconfirmed');
  perform t.ok((select count(*) from nexra_article_approvals) = n and (select status from nexra_articles where id = a2) = 'checked', 'D the refusals wrote nothing; the article is still checked');
  r := t8.approve(a2, 1, true);
  perform t.ok(r->>'outcome' = 'approved', 'D with the tick: approved');
  perform t.ok((r->'approval'->>'attested_count')::int = 1 and (r->'approval'->>'attested_confirmed')::boolean = true, 'D the approval stores the count (1) and the tick');
  perform t.ok((select attested_count from nexra_article_approvals where article_id = a2) = 1, 'D the stored count is the text''s own');

  -- Too few supported statements.
  a3 := t6.article(46, t8.txt('attested-three'));
  perform t8.passall(a3, 1, 1, 1);
  r := t8.approve(a3, 1, true);
  perform t.ok(r->>'outcome' = 'too-few-supported' and (r->>'supported')::int = 2, 'D two supported statements, with the tick: too-few-supported');
  perform t.ok((select count(*) from nexra_article_approvals where article_id = a3) = 0, 'D too-few-supported wrote nothing');

  -- Two attestations counted.
  a4 := t6.article(47, t8.txt('attested-four', '[{"locator":"s1/0","basis":"experience"},{"locator":"s1/1","basis":"opinion"}]'));
  perform t8.passall(a4, 1, 3);
  r := t8.approve(a4, 1, true);
  perform t.ok(r->>'outcome' = 'approved' and (r->'approval'->>'attested_count')::int = 2, 'D two attestations: approved with count 2');

  -- A tick on format 1 changes nothing.
  a1 := t6.article(48, t8.txt('plain-two', null));
  perform t8.passall(a1, 1, 0);
  r := t8.approve(a1, 1, true);
  perform t.ok(r->>'outcome' = 'approved' and (r->'approval'->>'attested_confirmed')::boolean = false, 'D a tick on a format 1 version stores no tick');

  -- The earlier gate still answers first.
  a3 := t6.article(49, t8.txt('attested-five'));
  perform t8.rec(a3, 1, 0, 5);
  r := t8.approve(a3, 1, true);
  perform t.ok(r->>'outcome' = 'status-unexpected', 'D an unchecked version answers the earlier refusal before the attestation rules');
end $$;

-- E: the approval table's own guards, for any writer.
do $$
declare a uuid := (select id from nexra_articles where current_version = 1 and status = 'approved' and project_id = 'nexra-agency' order by created_at limit 1);
begin
  perform t.ok(t.err(format($q$insert into nexra_article_approvals (article_id, article_version, article_version_id, content_sha256, unit_count, units_sha256, approved_by, attested_count, attested_confirmed)
    select article_id, article_version, article_version_id, content_sha256, unit_count, units_sha256, approved_by, 3, true from nexra_article_approvals where article_id = %L$q$, a)) = '23514', 'E a count that is not the stored version''s is refused (23514)');
  perform t.ok(t.err($q$insert into nexra_article_approvals (article_id, article_version, article_version_id, content_sha256, unit_count, units_sha256, approved_by, attested_count, attested_confirmed)
    select article_id, article_version, article_version_id, content_sha256, unit_count, units_sha256, approved_by, 1, false from nexra_article_approvals where attested_count = 1 limit 1$q$) = '23514', 'E a positive count without the tick is refused (23514)');
  perform t.ok(t.err($q$update nexra_article_approvals set attested_confirmed = false where attested_count > 0$q$) = '23514', 'E an approval is never changed (23514)');
  perform t.ok(t.err($q$update nexra_article_approvals set attested_count = 0$q$) = '23514', 'E the count never changes (23514)');
end $$;

-- F: proposals — the preview format the content implies.
do $$
declare r jsonb; a2 uuid := (select article_id from nexra_article_approvals where attested_count = 1 limit 1); a1 uuid := (select article_id from nexra_article_approvals a join nexra_articles x on x.id = a.article_id where a.attested_count = 0 and x.project_id = 'nexra-agency' order by a.approved_at limit 1);
begin
  r := t6.propose(a2, 1, p_fmt => 'article-proposal-text/1');
  perform t.ok(r->>'outcome' = 'invalid-preview', 'F an attested article with preview format 1: invalid-preview');
  r := t6.propose(a2, 1, p_fmt => 'article-proposal-text/2');
  perform t.ok(r->>'outcome' = 'created' and r->'proposal'->>'preview_format' = 'article-proposal-text/2', 'F with preview format 2: created');
  r := t6.propose(a1, 1, p_fmt => 'article-proposal-text/2');
  perform t.ok(r->>'outcome' = 'invalid-preview', 'F a format 1 article with preview format 2: invalid-preview');
  r := t6.propose(a1, 1);
  perform t.ok(r->>'outcome' = 'created' and r->'proposal'->>'preview_format' = 'article-proposal-text/1', 'F a format 1 article with preview format 1: created, as before');
  perform t.ok(t.err($q$update nexra_article_publication_proposals set preview_format = 'article-proposal-text/3'$q$) = '23514', 'F no proposal changes its preview format (23514)');
end $$;
