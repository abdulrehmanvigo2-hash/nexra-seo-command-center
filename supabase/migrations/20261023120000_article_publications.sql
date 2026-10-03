-- P-L2: the published-state table (C7b) — one row per publication request of an approved article
-- (docs/roadmap/P-L2-publishing.md, PR 2 of 9; docs/roadmap/NEXT-FOUR-PLAN.md).
--
-- WHY. Articles 1–3 were published by hand: a pull request to nexra-ai opened from a Claude Code session, then a
-- migration per article recording its slug as live (runbook §7 step 5). P-L2 moves publishing into the product: an
-- approved article is requested for publication (a 6.8 approval, single use, 24 hours, bound to the exact request);
-- a press on the publish page consumes it and opens, checks and — in `merge` mode — merges the pull request. This
-- table is the record of each request and every step, and a merged publication's slug is live from the records, so
-- the per-article live-slug migration ends.
--
-- WHAT.
--   * `nexra_article_publications` — bound at the request and never changed: project, article, version, version row,
--     content SHA-256, the C5 approval, the active proposal, destination, slug, the published date, the optional
--     cross-link anchor, the request payload's SHA-256 and the 6.8 approval it recorded (unique). Progress, changed
--     only by the functions: status (requested → publishing → pull-request-open → merged → live), the mode
--     (`dry-run` or `merge`), the base commit and the rendered files, the branch, pull request, head commit, merge
--     commit, live check, and the last error (set without changing the status, cleared by the next step).
--   * `nexra_article_publication_request` — checks the article is approved at that version and the proposal is its
--     active one, refuses a second publication of an article, records the 6.8 approval and the row.
--   * `nexra_article_publication_start` — consumes the approval (every refusal writes nothing) and records the mode,
--     base commit and files; a row past `requested` answers `resume`.
--   * `nexra_article_publication_progress` — the next step in order, or an error.
--   * `nexra_article_publication_live_slugs` and `nexra_article_publication_live_slug_article` are replaced with the
--     same signatures, now `stable`: a merged or live publication's slug is live and owned by its article, after the
--     slugs recorded so far (20261018120000's lists, unchanged). So the live-articles read, the propose check and the
--     renderer see a published article at once.
--
-- SECURITY. RLS on with no policies; guards refuse an insert outside the request function, a change outside the
-- functions, any change to a bound column, deletes and truncates (transaction-local flag nexra.publication_write).
-- service_role holds SELECT on the table and EXECUTE on the three functions only; the two list functions stay
-- executable by no API role. Nothing here contacts GitHub: the application does, and records each step here.

-- ---------------------------------------------------------------------------
-- The rendered files: 1 to 3 objects, each exactly { path, kind, sha256, base_sha256 }.

create function public.nexra_article_publication_files_valid(p_files jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_files) = 'array'
     and pg_catalog.jsonb_array_length(p_files) between 1 and 3
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(p_files) f
        where pg_catalog.jsonb_typeof(f) <> 'object'
           or (select count(*) from pg_catalog.jsonb_object_keys(f)) <> 4
           or pg_catalog.jsonb_typeof(f->'path') <> 'string'
           or (f->>'path') !~ '^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$' or (f->>'path') ~ '\.\.'
           or coalesce(f->>'kind', '') not in ('new-file', 'modify')
           or coalesce(f->>'sha256', '') !~ '^[0-9a-f]{64}$'
           or not (f ? 'base_sha256')
           or (f->>'kind' = 'new-file' and pg_catalog.jsonb_typeof(f->'base_sha256') <> 'null')
           or (f->>'kind' = 'modify' and coalesce(f->>'base_sha256', '') !~ '^[0-9a-f]{64}$')
     )
     and (select count(distinct f->>'path') from pg_catalog.jsonb_array_elements(p_files) f) = pg_catalog.jsonb_array_length(p_files)
$$;

-- ---------------------------------------------------------------------------
-- The table.

create table public.nexra_article_publications (
  id uuid primary key default gen_random_uuid(),

  -- Bound at the request; never changed.
  project_id text not null
    constraint nexra_article_publications_project_fkey references public.projects (id) on delete restrict,
  article_id uuid not null
    constraint nexra_article_publications_article_fkey references public.nexra_articles (id) on delete restrict,
  article_version smallint not null
    constraint nexra_article_publications_article_version_range check (article_version >= 1),
  article_version_id uuid not null
    constraint nexra_article_publications_version_fkey references public.nexra_article_versions (id) on delete restrict,
  constraint nexra_article_publications_version_number_fkey
    foreign key (article_id, article_version) references public.nexra_article_versions (article_id, version) on delete restrict,
  content_sha256 text not null
    constraint nexra_article_publications_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$'),
  article_approval_id uuid not null
    constraint nexra_article_publications_article_approval_fkey references public.nexra_article_approvals (id) on delete restrict,
  proposal_id uuid not null
    constraint nexra_article_publications_proposal_fkey references public.nexra_article_publication_proposals (id) on delete restrict,
  destination text not null
    constraint nexra_article_publications_destination_format
      check (char_length(destination) between 2 and 64 and destination ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  slug text not null
    constraint nexra_article_publications_slug_format
      check (char_length(slug) between 3 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  published_on date not null
    constraint nexra_article_publications_published_range check (published_on between date '2020-01-01' and date '2099-12-31'),
  cross_link_anchor text
    constraint nexra_article_publications_anchor_format
      check (cross_link_anchor is null or (char_length(cross_link_anchor) between 2 and 120 and cross_link_anchor !~ '[[:cntrl:]<>{}]'
             and cross_link_anchor = btrim(cross_link_anchor))),
  payload_sha256 text not null
    constraint nexra_article_publications_payload_sha256_format check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  approval_id uuid not null
    constraint nexra_article_publications_approval_fkey references public.nexra_approvals (id) on delete restrict
    constraint nexra_article_publications_approval_unique unique,
  requested_by uuid not null,
  requested_at timestamptz not null default clock_timestamp(),

  -- Progress; changed only by the functions.
  status text not null default 'requested'
    constraint nexra_article_publications_status_valid
      check (status in ('requested', 'publishing', 'pull-request-open', 'merged', 'live')),
  mode text
    constraint nexra_article_publications_mode_valid check (mode is null or mode in ('dry-run', 'merge')),
  base_commit text
    constraint nexra_article_publications_base_commit_format check (base_commit is null or base_commit ~ '^[0-9a-f]{40}$'),
  files jsonb
    constraint nexra_article_publications_files_valid check (files is null or public.nexra_article_publication_files_valid(files)),
  started_by uuid,
  started_at timestamptz,
  branch text
    constraint nexra_article_publications_branch_format check (branch is null or branch ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$'),
  pull_request_number integer
    constraint nexra_article_publications_pull_request_number_range check (pull_request_number is null or pull_request_number > 0),
  pull_request_url text
    constraint nexra_article_publications_pull_request_url_format
      check (pull_request_url is null or (pull_request_url ~ '^https://github\.com/[A-Za-z0-9._/-]+$' and char_length(pull_request_url) <= 300)),
  head_commit text
    constraint nexra_article_publications_head_commit_format check (head_commit is null or head_commit ~ '^[0-9a-f]{40}$'),
  merge_commit text
    constraint nexra_article_publications_merge_commit_format check (merge_commit is null or merge_commit ~ '^[0-9a-f]{40}$'),
  merged_at timestamptz,
  live_checked_at timestamptz,
  last_error_code text
    constraint nexra_article_publications_error_code_format check (last_error_code is null or last_error_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(last_error_code) <= 64),
  last_error_step text
    constraint nexra_article_publications_error_step_format check (last_error_step is null or last_error_step ~ '^[a-z]+(-[a-z]+)*$' and char_length(last_error_step) <= 32),
  last_error_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),

  constraint nexra_article_publications_started
    check ((status = 'requested') = (mode is null) and (mode is null) = (base_commit is null) and (mode is null) = (files is null)
           and (mode is null) = (started_by is null) and (mode is null) = (started_at is null)),
  constraint nexra_article_publications_pull_request
    check ((status in ('pull-request-open', 'merged', 'live')) = (branch is not null)
           and (branch is null) = (pull_request_number is null) and (branch is null) = (pull_request_url is null)
           and (branch is null) = (head_commit is null)),
  constraint nexra_article_publications_merged
    check ((status in ('merged', 'live')) = (merge_commit is not null) and (merge_commit is null) = (merged_at is null)),
  constraint nexra_article_publications_live
    check ((status = 'live') = (live_checked_at is not null)),
  constraint nexra_article_publications_error_together
    check ((last_error_code is null) = (last_error_step is null) and (last_error_code is null) = (last_error_at is null))
);

-- One merged or live publication per destination and slug: a slug is published once.
create unique index nexra_article_publications_live_slug_idx
  on public.nexra_article_publications (destination, slug) where status in ('merged', 'live');
create index nexra_article_publications_project_idx on public.nexra_article_publications (project_id, requested_at desc);
create index nexra_article_publications_article_idx on public.nexra_article_publications (article_id, requested_at desc);

comment on table public.nexra_article_publications is
  'P-L2 (C7b): one publication request of an approved article version — bound at the request to the exact version, C5 approval, active proposal, slug, date, optional cross-link and the 6.8 approval it recorded — and each step after it (consumed, pull request opened, merged, live). Written only by the request, start and progress functions; never deleted.';

alter table public.nexra_article_publications enable row level security;

-- ---------------------------------------------------------------------------
-- Guards, for every writer.

create function public.nexra_article_publications_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('nexra.publication_write', true), '') <> new.id::text then
    raise exception 'nexra_article_publications: rows are written only through nexra_article_publication_request'
      using errcode = 'check_violation';
  end if;
  if new.status <> 'requested' then
    raise exception 'nexra_article_publications: a publication is recorded requested'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function public.nexra_article_publications_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.article_id is distinct from old.article_id
    or new.article_version is distinct from old.article_version
    or new.article_version_id is distinct from old.article_version_id
    or new.content_sha256 is distinct from old.content_sha256
    or new.article_approval_id is distinct from old.article_approval_id
    or new.proposal_id is distinct from old.proposal_id
    or new.destination is distinct from old.destination
    or new.slug is distinct from old.slug
    or new.published_on is distinct from old.published_on
    or new.cross_link_anchor is distinct from old.cross_link_anchor
    or new.payload_sha256 is distinct from old.payload_sha256
    or new.approval_id is distinct from old.approval_id
    or new.requested_by is distinct from old.requested_by
    or new.requested_at is distinct from old.requested_at
  then
    raise exception 'nexra_article_publications: what a request bound never changes'
      using errcode = 'check_violation';
  end if;
  if coalesce(pg_catalog.current_setting('nexra.publication_write', true), '') <> old.id::text then
    raise exception 'nexra_article_publications: a publication changes only through nexra_article_publication_start or nexra_article_publication_progress'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function public.nexra_article_publications_guard_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_article_publications: a publication is permanent history and is never removed'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_article_publications_guard_insert
  before insert on public.nexra_article_publications
  for each row execute function public.nexra_article_publications_guard_insert();
create trigger nexra_article_publications_guard_update
  before update on public.nexra_article_publications
  for each row execute function public.nexra_article_publications_guard_update();
create trigger nexra_article_publications_guard_delete
  before delete on public.nexra_article_publications
  for each row execute function public.nexra_article_publications_guard_remove();
create trigger nexra_article_publications_guard_truncate
  before truncate on public.nexra_article_publications
  for each statement execute function public.nexra_article_publications_guard_remove();

-- ---------------------------------------------------------------------------
-- Request a publication.
--
-- p_request: { "article_id": uuid, "article_version": int, "article_version_id": uuid, "content_sha256": text,
--              "article_approval_id": uuid, "proposal_id": uuid, "destination": text, "slug": text,
--              "published_on": "YYYY-MM-DD", "cross_link_anchor": text | null }
-- p_payload_sha256: the digest of the exact request text the application built from those fields
-- (`nexra-publication-request/1`), bound by the 6.8 approval this records.
-- Answers 'requested' (with the publication and approval rows), 'project-not-found', 'article-not-found',
-- 'not-approved', 'version-mismatch', 'approval-mismatch', 'proposal-not-active', 'already-published',
-- 'publication-in-progress', or 'invalid' with a short reason. A refusal writes nothing.

create function public.nexra_article_publication_request(
  p_project_id text,
  p_request jsonb,
  p_payload_sha256 text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article_id uuid;
  v_version integer;
  v_version_id uuid;
  v_sha text;
  v_c5 uuid;
  v_proposal_id uuid;
  v_destination text;
  v_slug text;
  v_published date;
  v_anchor text;
  v_article public.nexra_articles;
  v_proposal public.nexra_article_publication_proposals;
  v_approval jsonb;
  v_id uuid;
  v_row public.nexra_article_publications;
begin
  if p_project_id is null or p_request is null or p_payload_sha256 is null or p_operator is null then
    raise exception 'nexra_article_publication_request: project, request, digest and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.jsonb_typeof(p_request) <> 'object' or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'nexra_article_publication_request: the request is an object and the digest a lowercase SHA-256'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;

  -- Shape.
  begin
    v_article_id := (p_request->>'article_id')::uuid;
    v_version_id := (p_request->>'article_version_id')::uuid;
    v_c5 := (p_request->>'article_approval_id')::uuid;
    v_proposal_id := (p_request->>'proposal_id')::uuid;
    v_published := (p_request->>'published_on')::date;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'ids');
  end;
  if v_article_id is null or v_version_id is null or v_c5 is null or v_proposal_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'ids');
  end if;
  if pg_catalog.jsonb_typeof(p_request->'article_version') <> 'number' or (p_request->>'article_version') !~ '^[0-9]{1,4}$' then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'version');
  end if;
  v_version := (p_request->>'article_version')::integer;
  v_sha := p_request->>'content_sha256';
  v_destination := p_request->>'destination';
  v_slug := p_request->>'slug';
  if coalesce(v_sha, '') !~ '^[0-9a-f]{64}$' or v_destination is null or v_slug is null then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'binding');
  end if;
  if v_published is null or v_published not between date '2020-01-01' and date '2099-12-31'
     or (p_request->>'published_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'published');
  end if;
  if pg_catalog.jsonb_typeof(p_request->'cross_link_anchor') = 'string' then
    v_anchor := p_request->>'cross_link_anchor';
    if pg_catalog.char_length(v_anchor) not between 2 and 120 or v_anchor ~ '[[:cntrl:]<>{}]' or v_anchor <> pg_catalog.btrim(v_anchor) then
      return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'anchor');
    end if;
  elsif coalesce(pg_catalog.jsonb_typeof(p_request->'cross_link_anchor'), 'null') <> 'null' then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'anchor');
  end if;

  -- The records, under the article's row lock.
  select * into v_article from public.nexra_articles where id = v_article_id and project_id = p_project_id for update;
  if v_article.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'article-not-found');
  end if;
  if v_article.status <> 'approved' or v_article.approved_version is distinct from v_version or v_article.current_version <> v_version then
    return pg_catalog.jsonb_build_object('outcome', 'not-approved');
  end if;
  if not exists (select 1 from public.nexra_article_versions v
                  where v.id = v_version_id and v.article_id = v_article_id and v.version = v_version and v.content_sha256 = v_sha) then
    return pg_catalog.jsonb_build_object('outcome', 'version-mismatch');
  end if;
  if not exists (select 1 from public.nexra_article_approvals a
                  where a.id = v_c5 and a.article_id = v_article_id and a.article_version = v_version
                    and a.article_version_id = v_version_id and a.content_sha256 = v_sha) then
    return pg_catalog.jsonb_build_object('outcome', 'approval-mismatch');
  end if;
  select * into v_proposal from public.nexra_article_publication_proposals p
   where p.id = v_proposal_id and p.project_id = p_project_id and p.article_id = v_article_id;
  if v_proposal.id is null or v_proposal.status <> 'proposed' or v_proposal.article_version <> v_version
     or v_proposal.article_version_id <> v_version_id or v_proposal.content_sha256 <> v_sha or v_proposal.approval_id <> v_c5
     or v_proposal.destination <> v_destination or v_proposal.slug <> v_slug then
    return pg_catalog.jsonb_build_object('outcome', 'proposal-not-active');
  end if;
  if v_slug = any (public.nexra_article_publication_live_slugs(v_destination))
     or exists (select 1 from public.nexra_article_publications p
                 where (p.article_id = v_article_id or (p.destination = v_destination and p.slug = v_slug)) and p.status in ('merged', 'live')) then
    return pg_catalog.jsonb_build_object('outcome', 'already-published');
  end if;
  if exists (select 1 from public.nexra_article_publications p
              where p.article_id = v_article_id and p.status in ('publishing', 'pull-request-open')) then
    return pg_catalog.jsonb_build_object('outcome', 'publication-in-progress');
  end if;

  -- The 6.8 approval, then the row.
  v_approval := public.nexra_approval_record(p_project_id, 'article-publication', v_article_id, p_payload_sha256, 'approve', p_operator, 1440);
  if v_approval->>'outcome' <> 'recorded' then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;

  v_id := pg_catalog.gen_random_uuid();
  perform pg_catalog.set_config('nexra.publication_write', v_id::text, true);
  insert into public.nexra_article_publications (id, project_id, article_id, article_version, article_version_id, content_sha256,
    article_approval_id, proposal_id, destination, slug, published_on, cross_link_anchor, payload_sha256, approval_id, requested_by)
  values (v_id, p_project_id, v_article_id, v_version, v_version_id, v_sha, v_c5, v_proposal_id, v_destination, v_slug,
    v_published, v_anchor, p_payload_sha256, (v_approval->'approval'->>'id')::uuid, p_operator)
  returning * into v_row;
  perform pg_catalog.set_config('nexra.publication_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'requested', 'publication', pg_catalog.to_jsonb(v_row), 'approval', v_approval->'approval');
end;
$$;

comment on function public.nexra_article_publication_request(text, jsonb, text, uuid) is
  'P-L2: requests the publication of an approved article version through its active proposal — records a 6.8 approval (article-publication, 24 hours, single use) bound to the request digest and the publication row, requested. Publishes nothing.';

-- ---------------------------------------------------------------------------
-- Start: consume the approval and record what will be written.

create function public.nexra_article_publication_start(
  p_project_id text,
  p_publication_id uuid,
  p_payload_sha256 text,
  p_mode text,
  p_base_commit text,
  p_files jsonb,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.nexra_article_publications;
  v_consumed jsonb;
begin
  if p_project_id is null or p_publication_id is null or p_payload_sha256 is null or p_mode is null
     or p_base_commit is null or p_files is null or p_operator is null then
    raise exception 'nexra_article_publication_start: project, publication, digest, mode, base commit, files and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_mode not in ('dry-run', 'merge') or p_base_commit !~ '^[0-9a-f]{40}$' or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or not public.nexra_article_publication_files_valid(p_files) then
    raise exception 'nexra_article_publication_start: the mode, base commit, digest or files are malformed'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.nexra_article_publications where id = p_publication_id and project_id = p_project_id for update;
  if v_row.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'publication-not-found');
  end if;
  if v_row.status <> 'requested' then
    return pg_catalog.jsonb_build_object('outcome', 'resume', 'publication', pg_catalog.to_jsonb(v_row));
  end if;

  -- The records still hold: the article approved at the version, the proposal active.
  if not exists (select 1 from public.nexra_articles a
                  where a.id = v_row.article_id and a.status = 'approved' and a.approved_version = v_row.article_version
                    and a.current_version = v_row.article_version) then
    return pg_catalog.jsonb_build_object('outcome', 'not-eligible', 'reason', 'not-approved');
  end if;
  if not exists (select 1 from public.nexra_article_publication_proposals p
                  where p.id = v_row.proposal_id and p.status = 'proposed') then
    return pg_catalog.jsonb_build_object('outcome', 'not-eligible', 'reason', 'proposal-not-active');
  end if;
  if exists (select 1 from public.nexra_article_publications p
              where p.id <> v_row.id and ((p.destination = v_row.destination and p.slug = v_row.slug and p.status in ('merged', 'live'))
                                          or (p.article_id = v_row.article_id and p.status in ('publishing', 'pull-request-open', 'merged', 'live')))) then
    return pg_catalog.jsonb_build_object('outcome', 'not-eligible', 'reason', 'already-published');
  end if;

  v_consumed := public.nexra_approval_consume(p_project_id, v_row.approval_id, 'article-publication', v_row.article_id, p_payload_sha256, p_operator);
  if v_consumed->>'outcome' <> 'consumed' then
    return pg_catalog.jsonb_build_object('outcome', v_consumed->>'outcome');
  end if;

  perform pg_catalog.set_config('nexra.publication_write', v_row.id::text, true);
  update public.nexra_article_publications
     set status = 'publishing', mode = p_mode, base_commit = p_base_commit, files = p_files,
         started_by = p_operator, started_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
   where id = v_row.id
  returning * into v_row;
  perform pg_catalog.set_config('nexra.publication_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'started', 'publication', pg_catalog.to_jsonb(v_row));
end;
$$;

comment on function public.nexra_article_publication_start(text, uuid, text, text, text, jsonb, uuid) is
  'P-L2: consumes a requested publication''s 6.8 approval (every refusal writes nothing) and records the mode, base commit and rendered files: started, resume (already past requested), publication-not-found, not-eligible or the consume refusal.';

-- ---------------------------------------------------------------------------
-- Progress: the next step, in order, or an error.
--
-- p_step: 'pull-request-open' { branch, pull_request_number, pull_request_url, head_commit } (from publishing),
--         'merged' { merge_commit } (from pull-request-open), 'live' {} (from merged),
--         'error' { code, step } (from publishing, pull-request-open or merged; the status does not change).
-- Answers 'recorded' (with the row), 'same' (the step is already recorded with the same values),
-- 'publication-not-found', 'out-of-order', or 'invalid' with a short reason.

create function public.nexra_article_publication_progress(
  p_project_id text,
  p_publication_id uuid,
  p_step text,
  p_detail jsonb,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.nexra_article_publications;
  v_number integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_project_id is null or p_publication_id is null or p_step is null or p_detail is null or p_operator is null then
    raise exception 'nexra_article_publication_progress: project, publication, step, detail and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.jsonb_typeof(p_detail) <> 'object' then
    raise exception 'nexra_article_publication_progress: the detail is an object'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_step not in ('pull-request-open', 'merged', 'live', 'error') then
    return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'step');
  end if;

  select * into v_row from public.nexra_article_publications where id = p_publication_id and project_id = p_project_id for update;
  if v_row.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'publication-not-found');
  end if;

  perform pg_catalog.set_config('nexra.publication_write', v_row.id::text, true);

  if p_step = 'pull-request-open' then
    if coalesce(p_detail->>'branch', '') !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$'
       or pg_catalog.jsonb_typeof(p_detail->'pull_request_number') <> 'number' or (p_detail->>'pull_request_number') !~ '^[1-9][0-9]{0,8}$'
       or coalesce(p_detail->>'pull_request_url', '') !~ '^https://github\.com/[A-Za-z0-9._/-]+$' or pg_catalog.char_length(p_detail->>'pull_request_url') > 300
       or coalesce(p_detail->>'head_commit', '') !~ '^[0-9a-f]{40}$' then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'pull-request');
    end if;
    v_number := (p_detail->>'pull_request_number')::integer;
    if v_row.status = 'pull-request-open' and v_row.pull_request_number = v_number and v_row.branch = p_detail->>'branch'
       and v_row.head_commit = p_detail->>'head_commit' then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'same', 'publication', pg_catalog.to_jsonb(v_row));
    end if;
    if v_row.status <> 'publishing' then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'out-of-order', 'publication', pg_catalog.to_jsonb(v_row));
    end if;
    update public.nexra_article_publications
       set status = 'pull-request-open', branch = p_detail->>'branch', pull_request_number = v_number,
           pull_request_url = p_detail->>'pull_request_url', head_commit = p_detail->>'head_commit',
           last_error_code = null, last_error_step = null, last_error_at = null, updated_at = v_now
     where id = v_row.id returning * into v_row;

  elsif p_step = 'merged' then
    if coalesce(p_detail->>'merge_commit', '') !~ '^[0-9a-f]{40}$' then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'merge-commit');
    end if;
    if v_row.status in ('merged', 'live') and v_row.merge_commit = p_detail->>'merge_commit' then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'same', 'publication', pg_catalog.to_jsonb(v_row));
    end if;
    if v_row.status <> 'pull-request-open' then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'out-of-order', 'publication', pg_catalog.to_jsonb(v_row));
    end if;
    update public.nexra_article_publications
       set status = 'merged', merge_commit = p_detail->>'merge_commit', merged_at = v_now,
           last_error_code = null, last_error_step = null, last_error_at = null, updated_at = v_now
     where id = v_row.id returning * into v_row;

  elsif p_step = 'live' then
    if v_row.status = 'live' then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'same', 'publication', pg_catalog.to_jsonb(v_row));
    end if;
    if v_row.status <> 'merged' then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'out-of-order', 'publication', pg_catalog.to_jsonb(v_row));
    end if;
    update public.nexra_article_publications
       set status = 'live', live_checked_at = v_now,
           last_error_code = null, last_error_step = null, last_error_at = null, updated_at = v_now
     where id = v_row.id returning * into v_row;

  else -- error
    if coalesce(p_detail->>'code', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or pg_catalog.char_length(p_detail->>'code') > 64
       or coalesce(p_detail->>'step', '') !~ '^[a-z]+(-[a-z]+)*$' or pg_catalog.char_length(p_detail->>'step') > 32 then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'invalid', 'reason', 'error');
    end if;
    if v_row.status not in ('publishing', 'pull-request-open', 'merged') then
      perform pg_catalog.set_config('nexra.publication_write', '', true);
      return pg_catalog.jsonb_build_object('outcome', 'out-of-order', 'publication', pg_catalog.to_jsonb(v_row));
    end if;
    update public.nexra_article_publications
       set last_error_code = p_detail->>'code', last_error_step = p_detail->>'step', last_error_at = v_now, updated_at = v_now
     where id = v_row.id returning * into v_row;
  end if;

  perform pg_catalog.set_config('nexra.publication_write', '', true);
  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'publication', pg_catalog.to_jsonb(v_row));
end;
$$;

comment on function public.nexra_article_publication_progress(text, uuid, text, jsonb, uuid) is
  'P-L2: records the next step of a publication in order — pull-request-open, merged, live — or an error (no status change): recorded, same, publication-not-found, out-of-order or invalid. Contacts nothing.';

-- ---------------------------------------------------------------------------
-- The live slugs, now from the records too: 20261018120000's lists, then each merged or live publication's slug.

create or replace function public.nexra_article_publication_live_slugs(p_destination text)
returns text[]
language sql
stable
set search_path = ''
as $$
  with recorded as (
    select case p_destination
      when 'nexra-agency-website' then array['ai-lead-follow-up-automation', 'ai-dead-lead-reactivation', 'ai-sdr-tool', 'missed-call-text-back']::text[]
      else array[]::text[]
    end as slugs
  )
  select recorded.slugs || coalesce((
    select pg_catalog.array_agg(p.slug order by p.merged_at, p.id)
      from public.nexra_article_publications p
     where p.destination = p_destination and p.status in ('merged', 'live') and not (p.slug = any (recorded.slugs))
  ), array[]::text[])
    from recorded
$$;

create or replace function public.nexra_article_publication_live_slug_article(p_destination text, p_slug text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    case
      when (p_destination, p_slug) = ('nexra-agency-website', 'ai-dead-lead-reactivation')
        then '1003104c-6b25-456f-9304-eefa2ba88e7d'::uuid
      when (p_destination, p_slug) = ('nexra-agency-website', 'ai-sdr-tool')
        then '6f50f8cb-bb85-4389-a5b4-21402c739f8b'::uuid
      when (p_destination, p_slug) = ('nexra-agency-website', 'missed-call-text-back')
        then '339c9b60-7f4c-4c6b-8692-1bb7b9cdfc52'::uuid
      when (p_destination, p_slug) = ('nexra-agency-website', 'ai-lead-follow-up-automation')
        then null::uuid
    end,
    (select p.article_id from public.nexra_article_publications p
      where p.destination = p_destination and p.slug = p_slug and p.status in ('merged', 'live')
        and not ((p_destination, p_slug) = ('nexra-agency-website', 'ai-lead-follow-up-automation'))
      limit 1)
  )
$$;

comment on function public.nexra_article_publication_live_slug_article(text, text) is
  'The article a live slug published after the template pin came from (D10, and P-L2: a merged or live publication''s article); null for a pinned template slug or a slug that is not live.';

-- ---------------------------------------------------------------------------
-- Privileges: nothing for PUBLIC, anon or authenticated; service_role reads the table and executes the three functions.
-- The two list functions and the internal helpers stay executable by no API role.

revoke all on table public.nexra_article_publications from public;
revoke all on function public.nexra_article_publication_request(text, jsonb, text, uuid) from public;
revoke all on function public.nexra_article_publication_start(text, uuid, text, text, text, jsonb, uuid) from public;
revoke all on function public.nexra_article_publication_progress(text, uuid, text, jsonb, uuid) from public;
revoke all on function public.nexra_article_publication_files_valid(jsonb) from public;
revoke all on function public.nexra_article_publications_guard_insert() from public;
revoke all on function public.nexra_article_publications_guard_update() from public;
revoke all on function public.nexra_article_publications_guard_remove() from public;
revoke all on function public.nexra_article_publication_live_slugs(text) from public;
revoke all on function public.nexra_article_publication_live_slug_article(text, text) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_article_publications from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_request(text, jsonb, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_start(text, uuid, text, text, text, jsonb, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_progress(text, uuid, text, jsonb, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_files_valid(jsonb) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publications_guard_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_article_publications_guard_update() from %I', v_role);
      execute format('revoke all on function public.nexra_article_publications_guard_remove() from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_live_slugs(text) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_live_slug_article(text, text) from %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_article_publications to service_role;
    grant execute on function public.nexra_article_publication_request(text, jsonb, text, uuid) to service_role;
    grant execute on function public.nexra_article_publication_start(text, uuid, text, text, text, jsonb, uuid) to service_role;
    grant execute on function public.nexra_article_publication_progress(text, uuid, text, jsonb, uuid) to service_role;
  end if;
end
$$;
