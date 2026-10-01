-- F8 fixtures (schema t9): a run-and-record helper that writes the run metadata F8 records (instructions and evidence
-- hashes) and a result with a SUPPORTED count, and a carry helper. Runs after c4, c5 and c6 setup. Part of the local
-- PostgreSQL test harness; run only through supabase/tests/run.sh. Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t9;

-- The unit text hash this harness uses: one per unit index and "text" n, so two versions can share a unit exactly.
create function t9.h(i int, n int) returns text language sql immutable as $$ select encode(sha256(convert_to('f8-unit-' || i || '-' || n, 'UTF8')), 'hex') $$;
create function t9.instr(n int default 3) returns text language sql immutable as $$ select encode(sha256(convert_to('instructions-v' || n, 'UTF8')), 'hex') $$;
create function t9.evid(n int default 1) returns text language sql immutable as $$ select encode(sha256(convert_to('evidence-' || n, 'UTF8')), 'hex') $$;

-- A completed check run of unit i of version v, recorded with status s and a result holding `sup` SUPPORTED
-- statements; the run's evidence records the instructions and evidence hashes given (null: not recorded, as before F8).
create function t9.rec(a uuid, v int, i int, s text, p_sha text, sup int default 0, p_instr text default t9.instr(), p_evid text default t9.evid())
returns jsonb language plpgsql as $$
declare p t5.plan; rid uuid := gen_random_uuid(); vid uuid := t5.vid(a, v); ev jsonb;
begin
  select * into p from t5.plan where idx = i;
  ev := jsonb_build_object('source','article-unit','unitKey',p.key,'unitSha256',p_sha,'unitIndex',i,'part',1,'partCount',1,'unitCount',4);
  if p_instr is not null then ev := ev || jsonb_build_object('instructionsSha256', p_instr); end if;
  if p_evid is not null then ev := ev || jsonb_build_object('evidenceSha256', p_evid); end if;
  set local session_replication_role = replica;
  insert into agent_runs (id, project_id, agent_id, task_type, input, input_hash, status, created_by, started_at, finished_at, executor, result_summary, result_metadata, attempt_count)
  values (rid, 'nexra-agency', 'research-evidence', 'article-check-unit',
    jsonb_build_object('articleId', a::text, 'articleVersion', v, 'articleVersionId', vid::text, 'unitIndex', i),
    encode(sha256(convert_to(rid::text,'UTF8')),'hex'), 'completed', '00000000-0000-4000-8000-0000000000aa', now(), now(), 'ai', 'answer',
    jsonb_build_object('simulated', false, 'grounded', true, 'evidence', ev), 1);
  set local session_replication_role = origin;
  return public.nexra_article_check_unit_record('nexra-agency', a, v::smallint, vid, i::smallint, p.kind, p.key, 1::smallint, 1::smallint, 4::smallint, p_sha, s,
    jsonb_build_object('status', s, 'checkedByRunId', rid::text, 'counts', jsonb_build_object('supported', sup, 'partial', 0, 'unsupported', 0, 'unverifiable', 0, 'editorial', 1)),
    rid, '00000000-0000-4000-8000-0000000000aa');
end $$;

create function t9.unit(a uuid, v int, i int) returns uuid language sql as $$
  select id from nexra_article_check_units where article_id = a and article_version = v and unit_index = i $$;

-- Carry the source unit (from version sv) onto unit i of version v.
create function t9.carry(a uuid, v int, i int, sv int, p_sha text, p_instr text default t9.instr(), p_evid text default t9.evid(), p_source uuid default null)
returns jsonb language plpgsql as $$
declare p t5.plan;
begin
  select * into p from t5.plan where idx = i;
  return public.nexra_article_check_unit_carry('nexra-agency', a, v::smallint, t5.vid(a, v), i::smallint, p.kind, p.key, 1::smallint, 1::smallint, 4::smallint,
    p_sha, coalesce(p_source, t9.unit(a, sv, i)), p_instr, p_evid, '00000000-0000-4000-8000-0000000000aa');
end $$;

create function t9.fresh(a uuid, v int, i int) returns jsonb language sql as $$
  select public.nexra_article_check_unit_fresh('nexra-agency', a, t5.vid(a, v), i::smallint, '00000000-0000-4000-8000-0000000000aa') $$;
create function t9.status(a uuid) returns text language sql as $$ select status from nexra_articles where id = a $$;

-- Approve version v from its stored unit rows (this suite's unit hashes are not the C5 fixture's).
create function t9.approve(a uuid, v int) returns jsonb language sql as $$
  select public.nexra_article_approve_version('nexra-agency', a, v::smallint, t5.vid(a, v), t5.sha(a, v),
    (select jsonb_agg(jsonb_build_object('index', unit_index, 'key', unit_key, 'sha256', unit_sha256) order by unit_index) from nexra_article_check_units where article_version_id = t5.vid(a, v)),
    (select encode(sha256(convert_to('nexra-article-approval-units/1' || chr(10) || string_agg(unit_index || ' ' || unit_key || ' ' || unit_sha256 || chr(10), '' order by unit_index), 'UTF8')), 'hex')
       from nexra_article_check_units where article_version_id = t5.vid(a, v)),
    '00000000-0000-4000-8000-0000000000bb')
$$;
