-- Content drafts: the durable home of one Writer section draft and every
-- version a person makes of it.
--
-- NAMING. Both tables, and every constraint, index, trigger and function
-- here, carry the `nexra_` prefix the crawl tables introduced
-- (20260920120000): this database holds a separate live subsystem whose
-- unprefixed names this repository must never create, alter, grant or
-- revoke, and a constraint name collides across tables in the same schema.
-- The prefix keeps this product's tables apart from it.
--
-- What is stored, and why it is split in two:
--
--   * `nexra_content_drafts` is the parent: which project, which Writer run
--     seeded it, which content plan and section that run drafted, where the
--     draft stands (`status`), which version is current, and — for later
--     milestones — which exact version was approved and which was published,
--     by whom and when. One Writer run seeds at most one draft: the unique
--     `source_writer_run_id` is the idempotency key for "Save as draft".
--   * `nexra_content_draft_versions` holds the text. Version 1 is the
--     Writer's own output, `origin = 'writer'`, kept exactly as generated so
--     the model-generated original is always recoverable; every later save
--     by an operator is a new row, `origin = 'operator'`, never a change to
--     an earlier one. A guard trigger refuses any update to a version's
--     identity or text. `fact_check` is the one column a later milestone may
--     fill in, once, for the exact version it checked.
--
-- What this milestone does NOT do: no operator edit (no version 2), no
-- fact-check write, no approval, no publication, no remote target. The
-- columns for those exist so the next milestones add rows and transitions,
-- not schema; every one of them is null until its milestone.
--
-- Row level security is enabled with no policies, as on every table here: no
-- browser-side role can read or write these. The application reads and
-- writes on the server with the secret key. Grants are the next migration.

create table public.nexra_content_drafts (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_content_drafts_project_fkey references public.projects (id) on delete restrict,

  -- The Writer run whose output became version 1. Unique: a run is saved once.
  source_writer_run_id uuid not null
    constraint nexra_content_drafts_writer_run_fkey references public.agent_runs (id) on delete restrict
    constraint nexra_content_drafts_writer_run_key unique,
  -- The content plan that run drafted from, as the run's own metadata records it.
  source_plan_run_id uuid
    constraint nexra_content_drafts_plan_run_fkey references public.agent_runs (id) on delete restrict,

  -- Which outline line of the plan was drafted (1-based), when the run recorded one.
  section_index smallint
    constraint nexra_content_drafts_section_index_range check (section_index is null or section_index >= 1),
  section_label text not null
    constraint nexra_content_drafts_section_label_length check (char_length(section_label) between 1 and 400),

  status text not null default 'drafting'
    constraint nexra_content_drafts_status_valid
      check (status in ('drafting', 'fact-checked', 'approved', 'published', 'archived')),

  current_version smallint not null default 1
    constraint nexra_content_drafts_current_version_range check (current_version >= 1),

  -- Later milestones. Each names an exact version row; null until then.
  approved_version smallint
    constraint nexra_content_drafts_approved_version_range check (approved_version is null or approved_version >= 1),
  approved_by uuid,
  approved_at timestamptz,
  constraint nexra_content_drafts_approval_complete
    check ((approved_version is null) = (approved_by is null) and (approved_version is null) = (approved_at is null)),

  published_version smallint
    constraint nexra_content_drafts_published_version_range check (published_version is null or published_version >= 1),
  published_at timestamptz,
  constraint nexra_content_drafts_publication_complete
    check ((published_version is null) = (published_at is null)),
  remote_content_id text
    constraint nexra_content_drafts_remote_content_id_length check (remote_content_id is null or char_length(remote_content_id) between 1 and 512),
  remote_target text
    constraint nexra_content_drafts_remote_target_length check (remote_target is null or char_length(remote_target) between 1 and 120),

  -- The Supabase Auth user id of the operator who saved it. No foreign key,
  -- as on agent_runs: auth.users is not this product's table.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nexra_content_drafts is
  'One draft per Writer section run: its provenance, its state, and pointers to the exact versions approved and published. Text lives in nexra_content_draft_versions.';
comment on column public.nexra_content_drafts.source_writer_run_id is
  'The completed, grounded Writer run whose output is version 1. Unique: saving the same run again returns the same draft.';
comment on column public.nexra_content_drafts.status is
  'drafting until a fact-check is stored; approval and publication are later milestones and never automatic.';

create index nexra_content_drafts_project_idx
  on public.nexra_content_drafts (project_id, created_at desc);

-- Keep updated_at honest on every change (the helper is shared with projects).
create trigger nexra_content_drafts_set_updated_at
  before update on public.nexra_content_drafts
  for each row
  execute function public.set_updated_at();

-- A draft's provenance is fixed at creation: which project, which run, which
-- plan, which section, who saved it and when. Everything else is a later
-- milestone's transition.
create function public.nexra_content_drafts_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.source_writer_run_id is distinct from old.source_writer_run_id
    or new.source_plan_run_id is distinct from old.source_plan_run_id
    or new.section_index is distinct from old.section_index
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_content_drafts: a draft''s provenance cannot be changed after it is created'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_content_drafts_guard_update
  before update on public.nexra_content_drafts
  for each row
  execute function public.nexra_content_drafts_guard_update();

-- ---------------------------------------------------------------------------

create table public.nexra_content_draft_versions (
  id uuid primary key default gen_random_uuid(),

  -- A version is part of its draft's record: deleting a draft (maintenance
  -- only) takes its versions with it.
  draft_id uuid not null
    constraint nexra_content_draft_versions_draft_fkey references public.nexra_content_drafts (id) on delete cascade,

  version smallint not null
    constraint nexra_content_draft_versions_version_range check (version >= 1),

  -- writer: the model's own output, saved once. operator: a person's edit.
  origin text not null
    constraint nexra_content_draft_versions_origin_valid check (origin in ('writer', 'operator')),

  title text not null
    constraint nexra_content_draft_versions_title_length check (char_length(title) between 1 and 400),
  body text not null
    constraint nexra_content_draft_versions_body_length check (char_length(body) between 1 and 20000),

  -- The CLAIMS USED and PLACEHOLDERS lines, each as a JSON array of strings.
  claims jsonb not null default '[]'::jsonb
    constraint nexra_content_draft_versions_claims_array check (jsonb_typeof(claims) = 'array'),
  placeholders jsonb not null default '[]'::jsonb
    constraint nexra_content_draft_versions_placeholders_array check (jsonb_typeof(placeholders) = 'array'),

  -- Filled once by a later milestone for the exact version it checked. Null
  -- means unchecked, never "passed".
  fact_check jsonb
    constraint nexra_content_draft_versions_fact_check_object check (fact_check is null or jsonb_typeof(fact_check) = 'object'),

  created_by uuid not null,
  created_at timestamptz not null default now(),

  constraint nexra_content_draft_versions_number_unique unique (draft_id, version)
);

comment on table public.nexra_content_draft_versions is
  'Immutable versions of a draft. Version 1 is the Writer''s output as generated; later versions are operator saves. Only fact_check may be written after creation.';

-- A version is written once. Its identity and text never change; only
-- fact_check may be set later, by the milestone that does the checking.
create function public.nexra_content_draft_versions_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.draft_id is distinct from old.draft_id
    or new.version is distinct from old.version
    or new.origin is distinct from old.origin
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.claims is distinct from old.claims
    or new.placeholders is distinct from old.placeholders
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_content_draft_versions: a version is immutable; save a new version instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_content_draft_versions_guard_update
  before update on public.nexra_content_draft_versions
  for each row
  execute function public.nexra_content_draft_versions_guard_update();

-- ---------------------------------------------------------------------------
-- Row level security with no policies, as on every other table here.

alter table public.nexra_content_drafts enable row level security;
alter table public.nexra_content_draft_versions enable row level security;
