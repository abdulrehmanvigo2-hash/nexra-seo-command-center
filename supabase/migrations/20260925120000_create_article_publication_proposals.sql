-- Article publication proposals: an operator's recorded intention to publish
-- one exact, approved, immutable article version to one registered
-- destination (Stage 5, milestone C6 — record-only).
--
-- A proposal is NOT a publication. Nothing here renders a website artifact,
-- writes to a website or repository, creates a branch, commit, pull request
-- or deployment, approves anything, or calls anything outside this
-- database. The only states are `proposed` and `withdrawn`; there is no
-- published state.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000 and 20260922120000.
--
-- ONE TABLE, new: `nexra_article_publication_proposals`. The draft
-- proposal table (20260922140000) requires a draft and cannot hold an
-- article; it, its function and its behaviour are not changed. No existing
-- table, column, constraint, function, trigger or grant is changed.
--
-- WHAT A PROPOSAL IS BOUND TO. The project and article; the exact version
-- by number AND by its immutable row id; that version's canonical-content
-- SHA-256; the exact C5 approval-history row (id), with its approver and
-- time copied from it; the destination registry key; the slug; the preview
-- format and the hash of the preview the application rendered; and the
-- operator who asked. An insert trigger checks the binding for every
-- writer, and an update trigger keeps it fixed forever.
--
-- THE SLUG (decision D1) is the one inside the approved canonical content
-- (`slug`, validated by C1). The propose function refuses any other.
--
-- THE DESTINATION REGISTRY AND LIVE SLUGS (decision D2). The application's
-- registry (`src/lib/content/publications/destinations.ts`) and the pinned
-- website template (`src/lib/content/publications/website/template.ts`,
-- `nexra-ai-blog-tsx/1` at nexra-ai commit
-- a4a572296eca5944dc29a436048a6fff68c33d5d) are code. The two small
-- immutable functions below restate exactly that pinned registry and that
-- pinned list of existing live slugs, so the gate can be enforced here; a
-- repository test compares them with the TypeScript. They read nothing
-- outside this database and are not live website state: a new pin is a new
-- migration. A slug that names an existing live article is refused unless
-- the stored topic decision is `update-existing`; then it is allowed, and
-- the application reports the collision as a warning. A proposal is never
-- permission to overwrite a live article: it publishes nothing.
--
-- CROSS-TABLE SLUGS (decision D3). A new article proposal is refused when
-- an active article proposal OR an active draft proposal holds the same
-- destination and slug. The draft function does not check this table, and
-- the two tables share no lock or index; that reverse direction (and a
-- draft/article race on the same slug) is a known gap left, unchanged, for
-- a later, separately approved publishing milestone.
--
-- HOW IT IS WRITTEN. Only through two `security definer` functions, each
-- one transaction under a row lock on the parent article (the lock the C2
-- save, C4 check-record and C5 approve functions take):
-- `nexra_article_publication_propose` and
-- `nexra_article_publication_withdraw`. service_role is granted SELECT on
-- the table and EXECUTE on those two functions, nothing else. Row level
-- security is enabled with no policies.
--
-- ONE ACTIVE PROPOSAL PER ARTICLE, and one active article proposal per
-- destination and slug: two partial unique indexes on `status = 'proposed'`.
-- WITHDRAWAL is the one transition, `proposed` to `withdrawn`, final; its
-- time is the database's. Nothing is ever deleted.
--
-- A proposal stays bound to its version. When the article is edited, the
-- proposal no longer names the current approved version: the application
-- reports it stale, and a new proposal needs it withdrawn first.

create table public.nexra_article_publication_proposals (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_article_publication_proposals_project_fkey references public.projects (id) on delete restrict,
  article_id uuid not null
    constraint nexra_article_publication_proposals_article_fkey references public.nexra_articles (id) on delete restrict,

  -- The exact version: by number (with its article) and by the immutable row id.
  article_version smallint not null
    constraint nexra_article_publication_proposals_article_version_range check (article_version >= 1),
  article_version_id uuid not null
    constraint nexra_article_publication_proposals_version_fkey references public.nexra_article_versions (id) on delete restrict,
  constraint nexra_article_publication_proposals_version_number_fkey
    foreign key (article_id, article_version) references public.nexra_article_versions (article_id, version) on delete restrict,

  -- The bound version's canonical-content SHA-256, as stored on the version.
  content_sha256 text not null
    constraint nexra_article_publication_proposals_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$'),

  -- The exact C5 approval-history row, and its approver and time as recorded there.
  approval_id uuid not null
    constraint nexra_article_publication_proposals_approval_fkey references public.nexra_article_approvals (id) on delete restrict,
  approved_by uuid not null,
  approved_at timestamptz not null,

  -- A key of the application's destination registry, never a URL.
  destination text not null
    constraint nexra_article_publication_proposals_destination_format
      check (char_length(destination) between 2 and 64 and destination ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- The approved content's own slug (C1 rules).
  slug text not null
    constraint nexra_article_publication_proposals_slug_format
      check (char_length(slug) between 3 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  preview_format text not null
    constraint nexra_article_publication_proposals_preview_format_valid check (preview_format in ('article-proposal-text/1')),
  preview_sha256 text not null
    constraint nexra_article_publication_proposals_preview_sha256_format check (preview_sha256 ~ '^[0-9a-f]{64}$'),

  status text not null default 'proposed'
    constraint nexra_article_publication_proposals_status_valid check (status in ('proposed', 'withdrawn')),

  -- The Supabase Auth user ids of the operators. No foreign key, as on the drafts.
  requested_by uuid not null,
  withdrawn_by uuid,
  withdrawn_at timestamptz,
  constraint nexra_article_publication_proposals_withdrawal_complete
    check ((status = 'withdrawn') = (withdrawn_at is not null) and (withdrawn_at is null) = (withdrawn_by is null)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nexra_article_publication_proposals is
  'An operator''s record-only proposal to publish one exact approved article version to one registered destination. Proposed or withdrawn only; nothing here publishes, renders, contacts a repository, or deploys.';

create unique index nexra_article_publication_proposals_one_active_per_article
  on public.nexra_article_publication_proposals (article_id)
  where status = 'proposed';

create unique index nexra_article_publication_proposals_one_active_per_slug
  on public.nexra_article_publication_proposals (destination, slug)
  where status = 'proposed';

create index nexra_article_publication_proposals_article_idx
  on public.nexra_article_publication_proposals (article_id, created_at desc);

create trigger nexra_article_publication_proposals_set_updated_at
  before update on public.nexra_article_publication_proposals
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The pinned registry (D2). See the header. Executable by no API role.

-- Whether a destination key is registered for a project
-- (`destinations.ts`: `nexra-agency-website` for `nexra-agency`).
create function public.nexra_article_publication_destination_allowed(p_destination text, p_project_id text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p_destination, p_project_id) in (('nexra-agency-website', 'nexra-agency')), false)
$$;

-- The slugs of the live articles at a destination, as the pinned template
-- lists them (`template.ts` `existingArticles`, nexra-ai-blog-tsx/1 at
-- a4a572296eca5944dc29a436048a6fff68c33d5d).
create function public.nexra_article_publication_live_slugs(p_destination text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_destination
    when 'nexra-agency-website' then array['ai-lead-follow-up-automation']::text[]
    else array[]::text[]
  end
$$;

-- ---------------------------------------------------------------------------
-- For every writer, not only the functions below: a new row is proposed,
-- and its binding names one stored version and one approval of it.
create function public.nexra_article_publication_proposals_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'proposed' or new.withdrawn_by is not null or new.withdrawn_at is not null then
    raise exception 'nexra_article_publication_proposals: a proposal is created proposed'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.nexra_articles a
     where a.id = new.article_id and a.project_id = new.project_id
  ) then
    raise exception 'nexra_article_publication_proposals: the article is not this project''s'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.nexra_article_versions v
     where v.id = new.article_version_id
       and v.article_id = new.article_id
       and v.version = new.article_version
       and v.content_sha256 = new.content_sha256
  ) then
    raise exception 'nexra_article_publication_proposals: the version row, number and content hash do not name one stored version of this article'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.nexra_article_approvals ap
     where ap.id = new.approval_id
       and ap.article_id = new.article_id
       and ap.article_version = new.article_version
       and ap.article_version_id = new.article_version_id
       and ap.content_sha256 = new.content_sha256
       and ap.approved_by = new.approved_by
       and ap.approved_at = new.approved_at
  ) then
    raise exception 'nexra_article_publication_proposals: the approval does not name this exact version, hash, approver and time'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_article_publication_proposals_check_insert
  before insert on public.nexra_article_publication_proposals
  for each row
  execute function public.nexra_article_publication_proposals_check_insert();

-- The binding never changes; `proposed` to `withdrawn` is the only move, and
-- final; the withdrawal time is the database's.
create function public.nexra_article_publication_proposals_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'withdrawn' then
    raise exception 'nexra_article_publication_proposals: a withdrawn proposal is final'
      using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.article_id is distinct from old.article_id
    or new.article_version is distinct from old.article_version
    or new.article_version_id is distinct from old.article_version_id
    or new.content_sha256 is distinct from old.content_sha256
    or new.approval_id is distinct from old.approval_id
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.destination is distinct from old.destination
    or new.slug is distinct from old.slug
    or new.preview_format is distinct from old.preview_format
    or new.preview_sha256 is distinct from old.preview_sha256
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_article_publication_proposals: a proposal''s binding cannot be changed; withdraw it and propose again'
      using errcode = 'check_violation';
  end if;
  if new.status <> 'withdrawn' or new.withdrawn_by is null then
    raise exception 'nexra_article_publication_proposals: the only change is withdrawal, by a named operator'
      using errcode = 'check_violation';
  end if;
  new.withdrawn_at := now();
  return new;
end;
$$;

create trigger nexra_article_publication_proposals_guard_update
  before update on public.nexra_article_publication_proposals
  for each row
  execute function public.nexra_article_publication_proposals_guard_update();

create function public.nexra_article_publication_proposals_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_article_publication_proposals: a proposal is never deleted; withdraw it instead'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_article_publication_proposals_guard_delete
  before delete on public.nexra_article_publication_proposals
  for each row
  execute function public.nexra_article_publication_proposals_guard_delete();

create trigger nexra_article_publication_proposals_guard_truncate
  before truncate on public.nexra_article_publication_proposals
  for each statement
  execute function public.nexra_article_publication_proposals_guard_delete();

-- ---------------------------------------------------------------------------
-- Proposing: one transaction under the parent article's row lock. Every
-- condition the application checked is checked again here against the
-- locked rows. Refusals, in order: not-found (not this project's);
-- archived; destination-unavailable; not-approved; stale (another current
-- version, or the approval pointer on another version); version-not-found;
-- version-mismatch; content-mismatch; approval-mismatch; slug-mismatch;
-- unresolved-placeholder; invalid-preview; slug-live-collision; then, for an
-- active proposal of this article, `exists` when its binding is identical
-- (nothing written) or active-exists; slug-taken. Then the row is written.

create function public.nexra_article_publication_propose(
  p_project_id text,
  p_article_id uuid,
  p_article_version smallint,
  p_article_version_id uuid,
  p_content_sha256 text,
  p_approval_id uuid,
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
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_approval public.nexra_article_approvals;
  v_active public.nexra_article_publication_proposals;
  v_proposal public.nexra_article_publication_proposals;
  v_content jsonb;
begin
  if p_project_id is null or p_article_id is null or p_article_version is null or p_article_version_id is null
    or p_content_sha256 is null or p_approval_id is null or p_destination is null or p_slug is null
    or p_preview_format is null or p_preview_sha256 is null or p_requested_by is null
  then
    raise exception 'nexra_article_publication_propose: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_article
    from public.nexra_articles
   where id = p_article_id and project_id = p_project_id
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found');
  end if;
  if v_article.status = 'archived' then
    return jsonb_build_object('outcome', 'archived');
  end if;
  if not public.nexra_article_publication_destination_allowed(p_destination, p_project_id) then
    return jsonb_build_object('outcome', 'destination-unavailable');
  end if;
  if v_article.status <> 'approved' then
    return jsonb_build_object('outcome', 'not-approved', 'status', v_article.status);
  end if;
  if v_article.current_version <> p_article_version or v_article.approved_version is distinct from p_article_version then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_article.current_version, 'approved_version', v_article.approved_version);
  end if;

  select * into v_version
    from public.nexra_article_versions
   where article_id = p_article_id and version = p_article_version;
  if not found then
    return jsonb_build_object('outcome', 'version-not-found');
  end if;
  if v_version.id <> p_article_version_id then
    return jsonb_build_object('outcome', 'version-mismatch');
  end if;
  if v_version.content_sha256 <> p_content_sha256
    or encode(sha256(convert_to(v_version.canonical_content, 'UTF8')), 'hex') <> p_content_sha256
  then
    return jsonb_build_object('outcome', 'content-mismatch');
  end if;

  select * into v_approval
    from public.nexra_article_approvals
   where id = p_approval_id;
  if not found
    or v_approval.article_id <> p_article_id
    or v_approval.article_version <> p_article_version
    or v_approval.article_version_id <> p_article_version_id
    or v_approval.content_sha256 <> p_content_sha256
    or v_approval.approved_by is distinct from v_article.approved_by
    or v_approval.approved_at is distinct from v_article.approved_at
  then
    return jsonb_build_object('outcome', 'approval-mismatch');
  end if;

  v_content := v_version.canonical_content::jsonb;
  if (v_content ->> 'slug') is distinct from p_slug
    or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) not between 3 and 80
  then
    return jsonb_build_object('outcome', 'slug-mismatch');
  end if;
  if strpos(lower(v_version.canonical_content), '[needs evidence') > 0 then
    return jsonb_build_object('outcome', 'unresolved-placeholder');
  end if;
  if p_preview_format <> 'article-proposal-text/1' or p_preview_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid-preview');
  end if;
  if p_slug = any (public.nexra_article_publication_live_slugs(p_destination))
    and (v_content ->> 'topicDecision') is distinct from 'update-existing'
  then
    return jsonb_build_object('outcome', 'slug-live-collision');
  end if;

  -- An active proposal of this article: the same binding again writes nothing.
  select * into v_active
    from public.nexra_article_publication_proposals
   where article_id = p_article_id and status = 'proposed';
  if found then
    if v_active.article_version = p_article_version
      and v_active.article_version_id = p_article_version_id
      and v_active.content_sha256 = p_content_sha256
      and v_active.approval_id = p_approval_id
      and v_active.destination = p_destination
      and v_active.slug = p_slug
      and v_active.preview_format = p_preview_format
      and v_active.preview_sha256 = p_preview_sha256
    then
      return jsonb_build_object('outcome', 'exists', 'proposal', to_jsonb(v_active));
    end if;
    return jsonb_build_object('outcome', 'active-exists', 'proposal', to_jsonb(v_active));
  end if;

  -- The destination slug, held by another article's or a draft's active proposal.
  if exists (
    select 1 from public.nexra_article_publication_proposals
     where destination = p_destination and slug = p_slug and status = 'proposed'
  ) or exists (
    select 1 from public.nexra_content_publication_proposals
     where destination = p_destination and slug = p_slug and status = 'proposed'
  ) then
    return jsonb_build_object('outcome', 'slug-taken');
  end if;

  begin
    insert into public.nexra_article_publication_proposals
      (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at,
       destination, slug, preview_format, preview_sha256, requested_by)
    values
      (p_project_id, p_article_id, p_article_version, p_article_version_id, v_version.content_sha256, v_approval.id,
       v_approval.approved_by, v_approval.approved_at, p_destination, p_slug, p_preview_format, p_preview_sha256, p_requested_by)
    returning * into v_proposal;
  exception when unique_violation then
    -- The parent's lock rules out a second active proposal of this article;
    -- what remains is the slug, taken meanwhile by another article.
    return jsonb_build_object('outcome', 'slug-taken');
  end;

  return jsonb_build_object('outcome', 'created', 'proposal', to_jsonb(v_proposal));
end;
$$;

comment on function public.nexra_article_publication_propose(text, uuid, smallint, uuid, text, uuid, text, text, text, text, uuid) is
  'Records a record-only publication proposal for one exact approved article version, under a row lock on the article; re-checks the project, archive state, registered destination, approval, current version, version row, content hash, the exact approval-history row, the content''s own slug, placeholders, the preview, live slugs, an active proposal and a taken slug. Publishes nothing.';

-- ---------------------------------------------------------------------------
-- Withdrawing: the article's lock first, then the proposal's — the same
-- order as proposing. `proposed` to `withdrawn` only; a repeat answers
-- already-withdrawn. Touches this table only.

create function public.nexra_article_publication_withdraw(
  p_project_id text,
  p_proposal_id uuid,
  p_withdrawn_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article_id uuid;
  v_proposal public.nexra_article_publication_proposals;
begin
  if p_project_id is null or p_proposal_id is null or p_withdrawn_by is null then
    raise exception 'nexra_article_publication_withdraw: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select article_id into v_article_id
    from public.nexra_article_publication_proposals
   where id = p_proposal_id and project_id = p_project_id;
  if not found then
    return jsonb_build_object('outcome', 'not-found');
  end if;

  perform 1
    from public.nexra_articles
   where id = v_article_id and project_id = p_project_id
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found');
  end if;

  select * into v_proposal
    from public.nexra_article_publication_proposals
   where id = p_proposal_id and project_id = p_project_id
     for update;
  if v_proposal.status = 'withdrawn' then
    return jsonb_build_object('outcome', 'already-withdrawn', 'proposal', to_jsonb(v_proposal));
  end if;

  update public.nexra_article_publication_proposals
     set status = 'withdrawn',
         withdrawn_by = p_withdrawn_by
   where id = p_proposal_id
  returning * into v_proposal;

  return jsonb_build_object('outcome', 'withdrawn', 'proposal', to_jsonb(v_proposal));
end;
$$;

comment on function public.nexra_article_publication_withdraw(text, uuid, uuid) is
  'Withdraws one active article publication proposal, under the article''s row lock then the proposal''s; final, with the database''s time. Never deletes, and changes no article, version or approval.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the two write
-- functions. Nothing else, for anyone.

alter table public.nexra_article_publication_proposals enable row level security;

revoke all on function public.nexra_article_publication_propose(text, uuid, smallint, uuid, text, uuid, text, text, text, text, uuid) from public;
revoke all on function public.nexra_article_publication_withdraw(text, uuid, uuid) from public;
revoke all on function public.nexra_article_publication_destination_allowed(text, text) from public;
revoke all on function public.nexra_article_publication_live_slugs(text) from public;
revoke all on function public.nexra_article_publication_proposals_check_insert() from public;
revoke all on function public.nexra_article_publication_proposals_guard_update() from public;
revoke all on function public.nexra_article_publication_proposals_guard_delete() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      -- Supabase's default privileges may already have granted everything
      -- on a new table or function; take it all back first.
      execute format('revoke all on table public.nexra_article_publication_proposals from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_propose(text, uuid, smallint, uuid, text, uuid, text, text, text, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_withdraw(text, uuid, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_destination_allowed(text, text) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_live_slugs(text) from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_proposals_check_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_proposals_guard_update() from %I', v_role);
      execute format('revoke all on function public.nexra_article_publication_proposals_guard_delete() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_article_publication_proposals to service_role;
    grant execute on function public.nexra_article_publication_propose(text, uuid, smallint, uuid, text, uuid, text, text, text, text, uuid) to service_role;
    grant execute on function public.nexra_article_publication_withdraw(text, uuid, uuid) to service_role;
  end if;
end
$$;
