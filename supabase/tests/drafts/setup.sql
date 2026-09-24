-- Draft publication proposals (Stage 5A): fixtures (schema td). Runs after c4/setup.sql.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.
--
-- Drafts are created directly (the Writer path is not under test here). Their fact-check and
-- approval are written the way the application writes them: as service_role UPDATEs, through
-- the existing draft guards. Only the Writer runs are inserted with triggers off.

\set ON_ERROR_STOP 1
create schema td;
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count)
 select ('70000000-0000-4000-8000-0000000000' || n)::uuid, 'halcyon-fintech', 'writer', 'section-draft', encode(sha256(convert_to('w7-' || n, 'UTF8')), 'hex'),
        'completed', '00000000-0000-4000-8000-0000000000aa', now(), now(), 'ai', 'w', 1
   from generate_series(10, 99) n;
set session_replication_role = origin;

create function td.d(n int) returns uuid language sql immutable as $$ select ('d7000000-0000-4000-8000-0000000000' || n)::uuid $$;
create function td.sha(p_title text, p_body text) returns text language sql immutable as $$
  select encode(sha256(convert_to('nexra-content-draft-version/1', 'UTF8') || decode('00', 'hex') || convert_to(p_title, 'UTF8') || decode('00', 'hex') || convert_to(p_body, 'UTF8')), 'hex')
$$;
-- Draft n (d7000000-...-0000000000n) with version 1.
create function td.draft(n int, p_title text default 'T', p_body text default 'B') returns uuid language plpgsql as $$
begin
  insert into nexra_content_drafts (id, project_id, source_writer_run_id, section_label, created_by)
    values (td.d(n), 'halcyon-fintech', ('70000000-0000-4000-8000-0000000000' || n)::uuid, 'S', '00000000-0000-4000-8000-0000000000aa');
  insert into nexra_content_draft_versions (id, draft_id, version, origin, title, body, created_by)
    values (('d7100000-0000-4000-8000-0000000000' || n)::uuid, td.d(n), 1, 'writer', p_title, p_body, '00000000-0000-4000-8000-0000000000aa');
  return td.d(n);
end $$;
-- The application's fact-check result and approval of the current version, as service_role.
create function td.approve(d uuid, p_check text default 'passed') returns void language plpgsql as $$
declare v smallint := (select current_version from nexra_content_drafts where id = d);
begin
  set local role service_role;
  update nexra_content_draft_versions set fact_check = jsonb_build_object('status', p_check, 'version', v) where draft_id = d and version = v;
  update nexra_content_drafts set status = 'approved', approved_version = v, approved_by = '00000000-0000-4000-8000-0000000000bb', approved_at = now() where id = d;
  reset role;
end $$;
-- A draft n, approved; returns its id.
create function td.ready(n int, p_title text default 'T', p_body text default 'B') returns uuid language plpgsql as $$
begin perform td.draft(n, p_title, p_body); perform td.approve(td.d(n)); return td.d(n); end $$;
-- Propose the draft's current version; defaults from the stored rows; any argument may be overridden.
create function td.propose(d uuid, p_slug text, p_dest text default 'nexra-agency-website', p_project text default 'halcyon-fintech',
  p_version int default null, p_vid uuid default null, p_sha text default null, p_by uuid default null, p_at timestamptz default null,
  p_fmt text default 'draft-section-text/1', p_pv text default null, p_requested_by uuid default '00000000-0000-4000-8000-0000000000cc')
returns jsonb language sql as $$
  select public.nexra_content_publication_propose(p_project, d,
    coalesce(p_version, (select current_version from nexra_content_drafts where id = d), 1)::smallint,
    coalesce(p_vid, (select v.id from nexra_content_draft_versions v join nexra_content_drafts x on x.id = v.draft_id and v.version = x.current_version where x.id = d), '00000000-0000-4000-8000-00000000ffff'::uuid),
    coalesce(p_sha, (select td.sha(v.title, v.body) from nexra_content_draft_versions v join nexra_content_drafts x on x.id = v.draft_id and v.version = x.current_version where x.id = d), repeat('0', 64)),
    coalesce(p_by, (select approved_by from nexra_content_drafts where id = d), '00000000-0000-4000-8000-0000000000bb'::uuid),
    coalesce(p_at, (select approved_at from nexra_content_drafts where id = d), now()),
    p_dest, p_slug, p_fmt, coalesce(p_pv, repeat('c', 64)), p_requested_by)
$$;
-- Withdrawal exactly as the application's store writes it: one conditional service_role UPDATE.
-- Returns the number of rows withdrawn (1, or 0 when the proposal was no longer active).
create function td.withdraw(p uuid) returns int language plpgsql as $$
declare n int;
begin
  set local role service_role;
  update nexra_content_publication_proposals set status = 'withdrawn', withdrawn_by = '00000000-0000-4000-8000-0000000000dd'
   where id = p and project_id = 'halcyon-fintech' and status = 'proposed';
  get diagnostics n = row_count;
  reset role;
  return n;
end $$;
create function td.active(p_slug text) returns bigint language sql as $$
  select count(*) from nexra_content_publication_proposals where slug = p_slug and status = 'proposed'
$$;
