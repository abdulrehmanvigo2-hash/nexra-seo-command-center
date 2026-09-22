-- Publication proposals: an operator's recorded intention to publish one
-- exact, approved, immutable draft version to one registered destination.
--
-- A proposal is NOT a publication. Nothing here writes to a website, a
-- repository, a branch, a pull request, or a deployment, and nothing calls
-- anything outside this database. The only states are `proposed` and
-- `withdrawn`. Pull requests, merges, deployments and live verification are
-- later milestones, each with its own states and its own migration.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000 and 20260922120000: this database holds a separate live
-- subsystem whose unprefixed names this repository must never touch.
--
-- WHAT A PROPOSAL IS BOUND TO. The draft and project; the exact version by
-- number AND by its immutable row id; a SHA-256 of that version's title and
-- body, recomputed here from the stored row and refused if it differs from
-- what the application computed; the approval as it stood (approver and
-- time, copied from the parent under a row lock, and refused if they are not
-- what the application read); the destination registry key and a validated
-- slug; the preview format and the hash of the preview the application
-- rendered; and the operator who asked. None of these can change after the
-- row is written: a guard trigger refuses it.
--
-- HOW IT IS CREATED. Only through `nexra_content_publication_propose`, one
-- function, one transaction, under a row lock on the parent draft. The lock
-- serialises proposal creation with the Stage 2 version save (which locks
-- the same row), so a draft edited or re-approved between the application's
-- read and this write is answered `stale`, never proposed as "the current
-- one". service_role is granted SELECT and UPDATE on the table but not
-- INSERT or DELETE: the function is the only way in.
--
-- ONE ACTIVE PROPOSAL PER DRAFT, and one active proposal per destination
-- slug: two partial unique indexes on `status = 'proposed'`.
--
-- WITHDRAWAL is the one transition: `proposed` to `withdrawn`, final. The
-- withdrawal time is the database's own. A withdrawal touches this table
-- only: no draft, version, fact-check or approval column changes.
--
-- What this migration does NOT change: the parent draft's published
-- columns, the Stage 2 save-version function, the version table, and any
-- grant on an existing table.
--
-- Row level security is enabled with no policies, as on every table here.

create table public.nexra_content_publication_proposals (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_content_publication_proposals_project_fkey references public.projects (id) on delete restrict,
  draft_id uuid not null
    constraint nexra_content_publication_proposals_draft_fkey references public.nexra_content_drafts (id) on delete restrict,

  -- The exact version: by number (with its draft, against the versions'
  -- unique key) and by the immutable row id.
  version smallint not null
    constraint nexra_content_publication_proposals_version_range check (version >= 1),
  version_id uuid not null
    constraint nexra_content_publication_proposals_version_row_fkey references public.nexra_content_draft_versions (id) on delete restrict,
  constraint nexra_content_publication_proposals_version_fkey
    foreign key (draft_id, version) references public.nexra_content_draft_versions (draft_id, version) on delete restrict,

  -- SHA-256, lowercase hex, of 'nexra-content-draft-version/1' NUL title NUL body (UTF-8).
  content_sha256 text not null
    constraint nexra_content_publication_proposals_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$'),

  -- The approval as it stood when the proposal was made.
  approved_by uuid not null,
  approved_at timestamptz not null,

  -- A key of the application's destination registry, never a URL.
  destination text not null
    constraint nexra_content_publication_proposals_destination_format
      check (char_length(destination) between 2 and 64 and destination ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- The final path on the destination is unresolved in this milestone; the slug is the target identifier.
  slug text not null
    constraint nexra_content_publication_proposals_slug_format
      check (char_length(slug) between 3 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  preview_format text not null
    constraint nexra_content_publication_proposals_preview_format_valid check (preview_format in ('draft-section-text/1')),
  preview_sha256 text not null
    constraint nexra_content_publication_proposals_preview_sha256_format check (preview_sha256 ~ '^[0-9a-f]{64}$'),

  status text not null default 'proposed'
    constraint nexra_content_publication_proposals_status_valid check (status in ('proposed', 'withdrawn')),

  -- The Supabase Auth user ids of the operators. No foreign key, as on the drafts.
  requested_by uuid not null,
  withdrawn_by uuid,
  withdrawn_at timestamptz,
  constraint nexra_content_publication_proposals_withdrawal_complete
    check ((status = 'withdrawn') = (withdrawn_at is not null) and (withdrawn_at is null) = (withdrawn_by is null)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nexra_content_publication_proposals is
  'An operator''s proposal to publish one exact approved draft version to one registered destination. Proposed or withdrawn only; nothing here publishes, contacts a repository, or deploys.';
comment on column public.nexra_content_publication_proposals.content_sha256 is
  'SHA-256 of the bound version''s text, recomputed by nexra_content_publication_propose from the stored row.';
comment on column public.nexra_content_publication_proposals.slug is
  'The operator''s target identifier. The destination''s content path is unresolved until the website''s content format is inspected.';

create unique index nexra_content_publication_proposals_one_active_per_draft
  on public.nexra_content_publication_proposals (draft_id)
  where status = 'proposed';

create unique index nexra_content_publication_proposals_one_active_per_slug
  on public.nexra_content_publication_proposals (destination, slug)
  where status = 'proposed';

create index nexra_content_publication_proposals_draft_idx
  on public.nexra_content_publication_proposals (draft_id, created_at desc);

create trigger nexra_content_publication_proposals_set_updated_at
  before update on public.nexra_content_publication_proposals
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The binding never changes; `withdrawn` is final; the withdrawal time is
-- the database's.

create function public.nexra_content_publication_proposals_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'withdrawn' then
    raise exception 'nexra_content_publication_proposals: a withdrawn proposal is final'
      using errcode = 'check_violation';
  end if;

  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.draft_id is distinct from old.draft_id
    or new.version is distinct from old.version
    or new.version_id is distinct from old.version_id
    or new.content_sha256 is distinct from old.content_sha256
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.destination is distinct from old.destination
    or new.slug is distinct from old.slug
    or new.preview_format is distinct from old.preview_format
    or new.preview_sha256 is distinct from old.preview_sha256
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_content_publication_proposals: a proposal''s binding cannot be changed; withdraw it and propose again'
      using errcode = 'check_violation';
  end if;

  if new.status = 'withdrawn' then
    new.withdrawn_at := now();
  end if;

  return new;
end;
$$;

create trigger nexra_content_publication_proposals_guard_update
  before update on public.nexra_content_publication_proposals
  for each row
  execute function public.nexra_content_publication_proposals_guard_update();

-- A proposal is part of the record: never deleted, by anything.
create function public.nexra_content_publication_proposals_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_content_publication_proposals: a proposal is never deleted; withdraw it instead'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_content_publication_proposals_guard_delete
  before delete on public.nexra_content_publication_proposals
  for each row
  execute function public.nexra_content_publication_proposals_guard_delete();

create trigger nexra_content_publication_proposals_guard_truncate
  before truncate on public.nexra_content_publication_proposals
  for each statement
  execute function public.nexra_content_publication_proposals_guard_delete();

-- ---------------------------------------------------------------------------
-- Creating a proposal: one function, one transaction, under the parent's lock.
--
-- Every condition the application checked is checked again here against the
-- locked rows, so nothing the application read can have moved underneath
-- it: the draft is this project's; it is approved, and its approved version
-- is its current version and is the version asked for; the approver and
-- time are the ones the application read; the version row is the one the
-- application read; its recorded fact-check passed and was recorded for it;
-- it carries no unresolved placeholder; and its text hashes to the value the
-- application computed. Only then, if no proposal for this draft is active,
-- is the row written.

create function public.nexra_content_publication_propose(
  p_project_id text,
  p_draft_id uuid,
  p_version smallint,
  p_version_id uuid,
  p_content_sha256 text,
  p_approved_by uuid,
  p_approved_at timestamptz,
  p_destination text,
  p_slug text,
  p_preview_format text,
  p_preview_sha256 text,
  p_requested_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.nexra_content_drafts;
  v_version public.nexra_content_draft_versions;
  v_active public.nexra_content_publication_proposals;
  v_proposal public.nexra_content_publication_proposals;
  v_hash text;
begin
  if p_project_id is null or p_draft_id is null or p_version is null or p_version_id is null
    or p_content_sha256 is null or p_approved_by is null or p_approved_at is null
    or p_destination is null or p_slug is null or p_preview_format is null
    or p_preview_sha256 is null or p_requested_by is null
  then
    raise exception 'nexra_content_publication_propose: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_draft
    from public.nexra_content_drafts
   where id = p_draft_id and project_id = p_project_id
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found');
  end if;

  if v_draft.status <> 'approved'
    or v_draft.current_version <> p_version
    or v_draft.approved_version is distinct from p_version
    or v_draft.approved_by is distinct from p_approved_by
    or v_draft.approved_at is distinct from p_approved_at
  then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_draft.current_version, 'status', v_draft.status);
  end if;

  select * into v_version
    from public.nexra_content_draft_versions
   where draft_id = p_draft_id and version = p_version;
  if not found then
    return jsonb_build_object('outcome', 'version-not-found');
  end if;
  if v_version.id <> p_version_id then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_draft.current_version, 'status', v_draft.status);
  end if;

  if v_version.fact_check is null
    or v_version.fact_check ->> 'status' is distinct from 'passed'
    or v_version.fact_check ->> 'version' is distinct from p_version::text
  then
    return jsonb_build_object('outcome', 'ineligible', 'reason', 'fact-check-not-passed');
  end if;

  if jsonb_array_length(v_version.placeholders) > 0
    or strpos(lower(v_version.title), '[needs evidence') > 0
    or strpos(lower(v_version.body), '[needs evidence') > 0
  then
    return jsonb_build_object('outcome', 'ineligible', 'reason', 'unresolved-placeholders');
  end if;

  v_hash := encode(
    sha256(
      convert_to('nexra-content-draft-version/1', 'UTF8') || decode('00', 'hex')
      || convert_to(v_version.title, 'UTF8') || decode('00', 'hex')
      || convert_to(v_version.body, 'UTF8')
    ),
    'hex'
  );
  if v_hash <> p_content_sha256 then
    return jsonb_build_object('outcome', 'content-mismatch');
  end if;

  select * into v_active
    from public.nexra_content_publication_proposals
   where draft_id = p_draft_id and status = 'proposed';
  if found then
    return jsonb_build_object('outcome', 'exists', 'proposal', to_jsonb(v_active));
  end if;

  begin
    insert into public.nexra_content_publication_proposals
      (project_id, draft_id, version, version_id, content_sha256, approved_by, approved_at,
       destination, slug, preview_format, preview_sha256, requested_by)
    values
      (p_project_id, p_draft_id, p_version, p_version_id, v_hash, v_draft.approved_by, v_draft.approved_at,
       p_destination, p_slug, p_preview_format, p_preview_sha256, p_requested_by)
    returning * into v_proposal;
  exception when unique_violation then
    -- The parent's lock makes a second active proposal for this draft
    -- impossible here; what remains is the slug, taken at this destination
    -- by another draft's active proposal.
    select * into v_active
      from public.nexra_content_publication_proposals
     where draft_id = p_draft_id and status = 'proposed';
    if found then
      return jsonb_build_object('outcome', 'exists', 'proposal', to_jsonb(v_active));
    end if;
    return jsonb_build_object('outcome', 'slug-taken');
  end;

  return jsonb_build_object('outcome', 'created', 'proposal', to_jsonb(v_proposal));
end;
$$;

comment on function public.nexra_content_publication_propose(text, uuid, smallint, uuid, text, uuid, timestamptz, text, text, text, text, uuid) is
  'Records a publication proposal for one exact approved draft version, under a row lock on the draft; refuses a stale draft, a changed text, an unpassed check, an unresolved placeholder, or a second active proposal. Publishes nothing.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads and withdraws; only the function creates.

alter table public.nexra_content_publication_proposals enable row level security;

revoke all on function public.nexra_content_publication_propose(text, uuid, smallint, uuid, text, uuid, timestamptz, text, text, text, text, uuid) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_content_publication_proposals from %I', v_role);
      execute format('revoke all on function public.nexra_content_publication_propose(text, uuid, smallint, uuid, text, uuid, timestamptz, text, text, text, text, uuid) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Supabase's default privileges may already have granted everything on
    -- a new table; take it all back first, so INSERT, DELETE and TRUNCATE
    -- are really absent and the function really is the only way in.
    revoke all on table public.nexra_content_publication_proposals from service_role;
    grant select, update on table public.nexra_content_publication_proposals to service_role;
    grant execute on function public.nexra_content_publication_propose(text, uuid, smallint, uuid, text, uuid, timestamptz, text, text, text, text, uuid) to service_role;
  end if;
end
$$;
