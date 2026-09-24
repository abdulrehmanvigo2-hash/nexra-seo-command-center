-- D3 gap fixtures: two approved, fact-checked nexra-agency drafts (state fabricated with triggers off, test only) and two approved articles.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
-- Fabricate two approved, fact-checked nexra-agency drafts (test only; triggers off to set state).
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count) values
 ('60000000-0000-4000-8000-000000000002','nexra-agency','writer','section-draft',repeat('7',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','w',1);
insert into nexra_content_drafts (id, project_id, source_writer_run_id, section_label, created_by)
 values ('d6000000-0000-4000-8000-000000000002','nexra-agency','60000000-0000-4000-8000-000000000002','S2','00000000-0000-4000-8000-0000000000aa');
insert into nexra_content_draft_versions (id, draft_id, version, origin, title, body, created_by)
 values ('d6100000-0000-4000-8000-000000000002','d6000000-0000-4000-8000-000000000002',1,'writer','T','B','00000000-0000-4000-8000-0000000000aa');
update nexra_content_draft_versions set fact_check = '{"status":"passed","version":1}' where draft_id::text like 'd6000000%';
update nexra_content_drafts set status = 'approved', approved_version = 1, approved_by = '00000000-0000-4000-8000-0000000000bb', approved_at = '2026-09-24 00:00:00+00' where id::text like 'd6000000%';
set session_replication_role = origin;
create function t6.dprop(p_draft uuid, p_slug text) returns text language sql as $$
  select public.nexra_content_publication_propose('nexra-agency', p_draft, 1::smallint,
    (select id from nexra_content_draft_versions where draft_id = p_draft and version = 1),
    encode(sha256(convert_to('nexra-content-draft-version/1','UTF8') || decode('00','hex') || convert_to('T','UTF8') || decode('00','hex') || convert_to('B','UTF8')),'hex'),
    '00000000-0000-4000-8000-0000000000bb', '2026-09-24 00:00:00+00', 'nexra-agency-website', p_slug, 'draft-section-text/1', repeat('c',64), '00000000-0000-4000-8000-0000000000cc') ->> 'outcome'
$$;
select t6.ready(n, t6.txt(s)) from (values (60,'gap-one'),(61,'gap-two')) v(n, s);
