-- D3 fixtures: nexra-agency drafts beside the C6 articles, for the cross-table
-- destination/slug lock (20260926120000). Runs after c6/setup.sql.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.
--
-- Drafts are created directly; their fact-check and approval are written as the application
-- writes them (service_role UPDATEs through the draft guards). Only the Writer runs are
-- inserted with triggers off.

\set ON_ERROR_STOP 1
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count)
 select ('61000000-0000-4000-8000-0000000000' || n)::uuid, 'nexra-agency', 'writer', 'section-draft', encode(sha256(convert_to('w61-' || n, 'UTF8')), 'hex'),
        'completed', '00000000-0000-4000-8000-0000000000aa', now(), now(), 'ai', 'w', 1
   from generate_series(10, 99) n;
set session_replication_role = origin;

create function t6.dd(n int) returns uuid language sql immutable as $$ select ('d6200000-0000-4000-8000-0000000000' || n)::uuid $$;
-- Draft n of nexra-agency, version 1 (title T, body B), fact-checked and approved by the application's UPDATEs.
create function t6.dready(n int) returns uuid language plpgsql as $$
declare d uuid := t6.dd(n);
begin
  insert into nexra_content_drafts (id, project_id, source_writer_run_id, section_label, created_by)
    values (t6.dd(n), 'nexra-agency', ('61000000-0000-4000-8000-0000000000' || n)::uuid, 'S', '00000000-0000-4000-8000-0000000000aa');
  insert into nexra_content_draft_versions (id, draft_id, version, origin, title, body, created_by)
    values (('d6300000-0000-4000-8000-0000000000' || n)::uuid, t6.dd(n), 1, 'writer', 'T', 'B', '00000000-0000-4000-8000-0000000000aa');
  set local role service_role;
  update nexra_content_draft_versions set fact_check = '{"status":"passed","version":1}' where draft_id = d;
  update nexra_content_drafts set status = 'approved', approved_version = 1, approved_by = '00000000-0000-4000-8000-0000000000bb', approved_at = now() where id = d;
  reset role;
  return d;
end $$;
-- The draft propose function's outcome for draft d, slug and destination.
create function t6.dprop(d uuid, p_slug text, p_dest text default 'nexra-agency-website') returns text language sql as $$
  select public.nexra_content_publication_propose('nexra-agency', d, 1::smallint, ('d6300000' || substr(d::text, 9))::uuid,
    encode(sha256(convert_to('nexra-content-draft-version/1','UTF8') || decode('00','hex') || convert_to('T','UTF8') || decode('00','hex') || convert_to('B','UTF8')),'hex'),
    (select approved_by from nexra_content_drafts where id = d), (select approved_at from nexra_content_drafts where id = d),
    p_dest, p_slug, 'draft-section-text/1', repeat('c',64), '00000000-0000-4000-8000-0000000000cc') ->> 'outcome'
$$;
-- The application's draft withdrawal (one conditional service_role UPDATE) of draft d's active proposal; returns rows withdrawn.
create function t6.dwithdraw(d uuid) returns int language plpgsql as $$
declare n int;
begin
  set local role service_role;
  update nexra_content_publication_proposals set status = 'withdrawn', withdrawn_by = '00000000-0000-4000-8000-0000000000dd'
   where draft_id = d and project_id = 'nexra-agency' and status = 'proposed';
  get diagnostics n = row_count;
  reset role;
  return n;
end $$;
-- The article withdraw function for article a's active proposal; returns its outcome.
create function t6.awithdraw(a uuid) returns text language sql as $$
  select t6.withdraw((select id from nexra_article_publication_proposals where article_id = a and status = 'proposed')) ->> 'outcome'
$$;
-- Active reservations of a destination/slug: '<article count>/<draft count>'.
create function t6.held(p_slug text, p_dest text default 'nexra-agency-website') returns text language sql as $$
  select (select count(*) from nexra_article_publication_proposals where destination = p_dest and slug = p_slug and status = 'proposed')
    || '/' || (select count(*) from nexra_content_publication_proposals where destination = p_dest and slug = p_slug and status = 'proposed')
$$;
