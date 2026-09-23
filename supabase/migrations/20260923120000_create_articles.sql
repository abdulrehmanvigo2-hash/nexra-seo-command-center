-- Articles: durable, article-level persistence for Complete Article Assembly
-- (Stage 5, milestone C2).
--
-- An article is one complete page assembled from a content plan and from
-- exact, immutable section-draft versions. Its text is the C1 canonical
-- serialisation (`nexra-article-content/1`), stored once, as `text`, and
-- never changed. Nothing here fact-checks, approves, proposes, publishes or
-- calls anything outside this database.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000 and 20260922120000: this database holds a separate live
-- subsystem whose unprefixed names this repository must never touch.
--
-- THREE TABLES, all new. No existing table, column, constraint, function,
-- trigger or grant is altered. The foreign keys below reference existing
-- tables (projects, agent_runs, the draft tables) without changing them.
--
--   * `nexra_articles` is the parent: which project, which content plan run
--     it was assembled for (one article per plan run: the plan plans one
--     page, and the unique key makes a repeated create idempotent), where it
--     stands, which version is current, and — for a later milestone — which
--     exact version was approved, by whom and when. Status is `drafting`,
--     `checked`, `approved` or `archived`; there is no published state. C2
--     only ever writes `drafting`; `checked` and `approved` exist so later
--     milestones add transitions, not schema.
--   * `nexra_article_versions` holds the text: the canonical JSON and its
--     SHA-256, bound together by a CHECK constraint that recomputes the hash
--     from the stored text on every insert. No other copy of any article
--     field is stored. A version is written once; every update, delete and
--     truncate is refused.
--   * `nexra_article_version_sources` records, per version, the exact draft
--     versions the content was assembled from: draft id, version number,
--     immutable row id and that row's `nexra-content-draft-version/1` hash.
--     Provenance only: it carries no fact-check or approval, so none is
--     inherited. Rows are written once and never updated or deleted.
--
-- WRITES go through two `security definer` functions only —
-- `nexra_article_create` and `nexra_article_save_version` — each one
-- transaction. service_role is granted SELECT on the tables and EXECUTE on
-- those two functions, nothing else. Each function re-checks, against the
-- stored rows: the project; the content plan run (this project's, completed,
-- `content-plan-review`); the canonical text's format and its hash; and every
-- source (in this project, the row id matching the draft and version, and
-- the draft version's text hashing to the value given).
--
-- Row level security is enabled with no policies, as on every table here.

create table public.nexra_articles (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_articles_project_fkey references public.projects (id) on delete restrict,

  -- The completed content plan run this article was assembled for. Unique:
  -- one article per plan, and creating it again returns the same article.
  source_plan_run_id uuid not null
    constraint nexra_articles_plan_run_fkey references public.agent_runs (id) on delete restrict
    constraint nexra_articles_plan_run_key unique,

  status text not null default 'drafting'
    constraint nexra_articles_status_valid check (status in ('drafting', 'checked', 'approved', 'archived')),

  current_version smallint not null default 1
    constraint nexra_articles_current_version_range check (current_version >= 1),

  -- A later milestone. Names an exact version; null until then, and never
  -- carried to a newer version.
  approved_version smallint
    constraint nexra_articles_approved_version_range check (approved_version is null or approved_version >= 1),
  approved_by uuid,
  approved_at timestamptz,
  constraint nexra_articles_approval_complete
    check ((approved_version is null) = (approved_by is null) and (approved_version is null) = (approved_at is null)),

  -- The Supabase Auth user id of the operator. No foreign key, as on the drafts.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nexra_articles is
  'One assembled article per content plan run: its provenance, its state, and a pointer to its current version. Text lives in nexra_article_versions. Never published from here.';
comment on column public.nexra_articles.status is
  'drafting after every save. checked and approved are later milestones and never automatic; there is no published state.';

create index nexra_articles_project_idx
  on public.nexra_articles (project_id, created_at desc);

create trigger nexra_articles_set_updated_at
  before update on public.nexra_articles
  for each row
  execute function public.set_updated_at();

-- Provenance is fixed at creation, and the version pointer only moves forward.
create function public.nexra_articles_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.source_plan_run_id is distinct from old.source_plan_run_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_articles: an article''s provenance cannot be changed after it is created'
      using errcode = 'check_violation';
  end if;
  if new.current_version < old.current_version then
    raise exception 'nexra_articles: current_version never moves backwards'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_articles_guard_update
  before update on public.nexra_articles
  for each row
  execute function public.nexra_articles_guard_update();

create function public.nexra_articles_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_articles: an article is never deleted; archive it instead'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_articles_guard_delete
  before delete on public.nexra_articles
  for each row
  execute function public.nexra_articles_guard_delete();

create trigger nexra_articles_guard_truncate
  before truncate on public.nexra_articles
  for each statement
  execute function public.nexra_articles_guard_delete();

-- ---------------------------------------------------------------------------

create table public.nexra_article_versions (
  id uuid primary key default gen_random_uuid(),

  article_id uuid not null
    constraint nexra_article_versions_article_fkey references public.nexra_articles (id) on delete restrict,

  version smallint not null
    constraint nexra_article_versions_version_range check (version >= 1),

  -- C2 writes operator versions only.
  origin text not null
    constraint nexra_article_versions_origin_valid check (origin in ('operator')),

  -- Exactly the C1 canonical serialisation: a JSON object whose first member
  -- is the format tag. Stored as text, never jsonb, so its bytes are kept.
  canonical_content text not null
    constraint nexra_article_versions_canonical_length check (char_length(canonical_content) between 2 and 1000000)
    constraint nexra_article_versions_canonical_format check (starts_with(canonical_content, '{"format":"nexra-article-content/1",'))
    constraint nexra_article_versions_canonical_object check (jsonb_typeof(canonical_content::jsonb) = 'object'),

  -- SHA-256 of the canonical text's UTF-8 bytes, lowercase hex, recomputed here.
  content_sha256 text not null
    constraint nexra_article_versions_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint nexra_article_versions_content_sha256_matches
    check (content_sha256 = encode(sha256(convert_to(canonical_content, 'UTF8')), 'hex')),

  created_by uuid not null,
  created_at timestamptz not null default now(),

  constraint nexra_article_versions_number_unique unique (article_id, version)
);

comment on table public.nexra_article_versions is
  'Immutable article versions. canonical_content is the C1 nexra-article-content/1 text; content_sha256 is checked against it on insert. No row is ever updated or deleted.';

create function public.nexra_article_versions_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_article_versions: a version is immutable and permanent; save a new version instead'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_article_versions_guard_update
  before update on public.nexra_article_versions
  for each row
  execute function public.nexra_article_versions_guard_write();

create trigger nexra_article_versions_guard_delete
  before delete on public.nexra_article_versions
  for each row
  execute function public.nexra_article_versions_guard_write();

create trigger nexra_article_versions_guard_truncate
  before truncate on public.nexra_article_versions
  for each statement
  execute function public.nexra_article_versions_guard_write();

-- ---------------------------------------------------------------------------

create table public.nexra_article_version_sources (
  id uuid primary key default gen_random_uuid(),

  article_version_id uuid not null
    constraint nexra_article_version_sources_version_fkey references public.nexra_article_versions (id) on delete restrict,

  -- The reference's place in the list the operator gave, 1-based.
  position smallint not null
    constraint nexra_article_version_sources_position_range check (position between 1 and 20),

  source_draft_id uuid not null
    constraint nexra_article_version_sources_draft_fkey references public.nexra_content_drafts (id) on delete restrict,
  source_version smallint not null
    constraint nexra_article_version_sources_source_version_range check (source_version >= 1),
  source_version_id uuid not null
    constraint nexra_article_version_sources_source_row_fkey references public.nexra_content_draft_versions (id) on delete restrict,
  constraint nexra_article_version_sources_source_number_fkey
    foreign key (source_draft_id, source_version) references public.nexra_content_draft_versions (draft_id, version) on delete restrict,

  -- SHA-256 of 'nexra-content-draft-version/1' NUL title NUL body, as Stage 5A computes it.
  source_content_sha256 text not null
    constraint nexra_article_version_sources_sha256_format check (source_content_sha256 ~ '^[0-9a-f]{64}$'),

  created_at timestamptz not null default now(),

  constraint nexra_article_version_sources_position_unique unique (article_version_id, position),
  constraint nexra_article_version_sources_row_unique unique (article_version_id, source_version_id),
  constraint nexra_article_version_sources_number_unique unique (article_version_id, source_draft_id, source_version)
);

comment on table public.nexra_article_version_sources is
  'Provenance of one article version: the exact draft versions it was assembled from, by number, row id and content hash. Carries no fact-check or approval. Immutable.';

-- For every writer, not only the functions below: the row id must be the
-- draft's version with that number, the draft must be in the article's
-- project, and the draft version's stored text must hash to the value given.
create function public.nexra_article_version_sources_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  select true into v_ok
    from public.nexra_content_draft_versions dv
    join public.nexra_content_drafts d on d.id = dv.draft_id
    join public.nexra_article_versions av on av.id = new.article_version_id
    join public.nexra_articles a on a.id = av.article_id
   where dv.id = new.source_version_id
     and dv.draft_id = new.source_draft_id
     and dv.version = new.source_version
     and d.project_id = a.project_id
     and encode(
           sha256(
             convert_to('nexra-content-draft-version/1', 'UTF8') || decode('00', 'hex')
             || convert_to(dv.title, 'UTF8') || decode('00', 'hex')
             || convert_to(dv.body, 'UTF8')
           ),
           'hex'
         ) = new.source_content_sha256;
  if v_ok is not true then
    raise exception 'nexra_article_version_sources: the source does not match an immutable draft version of this project'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_article_version_sources_check_insert
  before insert on public.nexra_article_version_sources
  for each row
  execute function public.nexra_article_version_sources_check_insert();

create function public.nexra_article_version_sources_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_article_version_sources: provenance is immutable and permanent'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_article_version_sources_guard_update
  before update on public.nexra_article_version_sources
  for each row
  execute function public.nexra_article_version_sources_guard_write();

create trigger nexra_article_version_sources_guard_delete
  before delete on public.nexra_article_version_sources
  for each row
  execute function public.nexra_article_version_sources_guard_write();

create trigger nexra_article_version_sources_guard_truncate
  before truncate on public.nexra_article_version_sources
  for each statement
  execute function public.nexra_article_version_sources_guard_write();

-- ---------------------------------------------------------------------------
-- Shared checks for the two write functions. Internal: executable by no API
-- role; the functions below call them as their owner.

-- The canonical text's format and hash. Returns null when both hold, or the
-- outcome to answer with.
create function public.nexra_article_check_content(p_canonical_content text, p_content_sha256 text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_canonical_content is null
    or char_length(p_canonical_content) not between 2 and 1000000
    or not starts_with(p_canonical_content, '{"format":"nexra-article-content/1",')
  then
    return 'invalid-content';
  end if;
  begin
    if jsonb_typeof(p_canonical_content::jsonb) <> 'object' then
      return 'invalid-content';
    end if;
  exception when others then
    return 'invalid-content';
  end;
  if p_content_sha256 is null or encode(sha256(convert_to(p_canonical_content, 'UTF8')), 'hex') <> p_content_sha256 then
    return 'content-mismatch';
  end if;
  return null;
end;
$$;

-- Every source reference, checked against the stored draft rows. Returns
-- null when all hold, or a JSON refusal naming the first bad entry (0-based).
create function public.nexra_article_check_sources(p_project_id text, p_sources jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_index integer := 0;
  v_draft public.nexra_content_drafts;
  v_version public.nexra_content_draft_versions;
  v_draft_id uuid;
  v_version_id uuid;
  v_number integer;
  v_hash text;
  v_seen_rows uuid[] := array[]::uuid[];
  v_seen_numbers text[] := array[]::text[];
begin
  if p_sources is null or jsonb_typeof(p_sources) <> 'array'
    or jsonb_array_length(p_sources) not between 1 and 20
  then
    return jsonb_build_object('outcome', 'source-invalid', 'index', null, 'reason', 'count');
  end if;

  for v_entry in select value from jsonb_array_elements(p_sources) loop
    if jsonb_typeof(v_entry) <> 'object'
      or (select count(*) from jsonb_object_keys(v_entry)) <> 4
      or not (v_entry ? 'draft_id' and v_entry ? 'version' and v_entry ? 'version_id' and v_entry ? 'content_sha256')
      or jsonb_typeof(v_entry -> 'draft_id') <> 'string'
      or jsonb_typeof(v_entry -> 'version_id') <> 'string'
      or jsonb_typeof(v_entry -> 'version') <> 'number'
      or jsonb_typeof(v_entry -> 'content_sha256') <> 'string'
      or (v_entry ->> 'draft_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry ->> 'version_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry ->> 'version') !~ '^[1-9][0-9]{0,3}$'
      or (v_entry ->> 'content_sha256') !~ '^[0-9a-f]{64}$'
    then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'shape');
    end if;

    v_draft_id := (v_entry ->> 'draft_id')::uuid;
    v_version_id := (v_entry ->> 'version_id')::uuid;
    v_number := (v_entry ->> 'version')::integer;

    if v_version_id = any (v_seen_rows) or (v_draft_id::text || '#' || v_number::text) = any (v_seen_numbers) then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'duplicate');
    end if;
    v_seen_rows := v_seen_rows || v_version_id;
    v_seen_numbers := v_seen_numbers || (v_draft_id::text || '#' || v_number::text);

    -- The project is part of the lookup: another project's draft is not found.
    select * into v_draft from public.nexra_content_drafts where id = v_draft_id and project_id = p_project_id;
    if not found then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'not-found');
    end if;

    select * into v_version from public.nexra_content_draft_versions where draft_id = v_draft_id and version = v_number;
    if not found then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'not-found');
    end if;
    if v_version.id <> v_version_id then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'version-mismatch');
    end if;

    v_hash := encode(
      sha256(
        convert_to('nexra-content-draft-version/1', 'UTF8') || decode('00', 'hex')
        || convert_to(v_version.title, 'UTF8') || decode('00', 'hex')
        || convert_to(v_version.body, 'UTF8')
      ),
      'hex'
    );
    if v_hash <> (v_entry ->> 'content_sha256') then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'hash-mismatch');
    end if;

    v_index := v_index + 1;
  end loop;

  return null;
end;
$$;

-- Writes the checked references for one version, in the order given.
create function public.nexra_article_insert_sources(p_article_version_id uuid, p_sources jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  insert into public.nexra_article_version_sources
    (article_version_id, position, source_draft_id, source_version, source_version_id, source_content_sha256)
  select p_article_version_id,
         e.ordinality::smallint,
         (e.value ->> 'draft_id')::uuid,
         (e.value ->> 'version')::smallint,
         (e.value ->> 'version_id')::uuid,
         e.value ->> 'content_sha256'
    from jsonb_array_elements(p_sources) with ordinality as e(value, ordinality);

  select coalesce(jsonb_agg(to_jsonb(s) order by s.position), '[]'::jsonb) into v_rows
    from public.nexra_article_version_sources s
   where s.article_version_id = p_article_version_id;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating an article: the parent, version 1 and its sources, in one
-- transaction. Idempotent per content plan run: a second create for the
-- same plan answers `exists` with the article already recorded.

create function public.nexra_article_create(
  p_project_id text,
  p_source_plan_run_id uuid,
  p_canonical_content text,
  p_content_sha256 text,
  p_sources jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_refusal text;
  v_source_refusal jsonb;
  v_sources jsonb;
begin
  if p_project_id is null or p_source_plan_run_id is null or p_canonical_content is null
    or p_content_sha256 is null or p_sources is null or p_created_by is null
  then
    raise exception 'nexra_article_create: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    return jsonb_build_object('outcome', 'project-not-found');
  end if;

  if not exists (
    select 1 from public.agent_runs
     where id = p_source_plan_run_id
       and project_id = p_project_id
       and agent_id = 'content-strategist'
       and task_type = 'content-plan-review'
       and status = 'completed'
  ) then
    return jsonb_build_object('outcome', 'plan-run-invalid');
  end if;

  select * into v_article from public.nexra_articles where source_plan_run_id = p_source_plan_run_id;
  if found then
    return jsonb_build_object('outcome', 'exists', 'article', to_jsonb(v_article));
  end if;

  v_refusal := public.nexra_article_check_content(p_canonical_content, p_content_sha256);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;

  v_source_refusal := public.nexra_article_check_sources(p_project_id, p_sources);
  if v_source_refusal is not null then
    return v_source_refusal;
  end if;

  begin
    insert into public.nexra_articles (project_id, source_plan_run_id, status, current_version, created_by)
    values (p_project_id, p_source_plan_run_id, 'drafting', 1, p_created_by)
    returning * into v_article;
  exception when unique_violation then
    -- A concurrent create for the same plan got there first.
    select * into v_article from public.nexra_articles where source_plan_run_id = p_source_plan_run_id;
    return jsonb_build_object('outcome', 'exists', 'article', to_jsonb(v_article));
  end;

  insert into public.nexra_article_versions (article_id, version, origin, canonical_content, content_sha256, created_by)
  values (v_article.id, 1, 'operator', p_canonical_content, p_content_sha256, p_created_by)
  returning * into v_version;

  v_sources := public.nexra_article_insert_sources(v_version.id, p_sources);

  return jsonb_build_object(
    'outcome', 'created',
    'article', to_jsonb(v_article),
    'version', to_jsonb(v_version),
    'sources', v_sources
  );
end;
$$;

comment on function public.nexra_article_create(text, uuid, text, text, jsonb, uuid) is
  'Creates an article, its version 1 and that version''s source rows in one transaction, after re-checking the project, the completed content plan run, the canonical text and its hash, and every source. One article per plan run. Approves and publishes nothing.';

-- ---------------------------------------------------------------------------
-- Saving an operator's edit as version N+1: one transaction, under a row
-- lock on the parent, so concurrent saves are serialised and the second is
-- answered `stale`. The status returns to `drafting`; the approved-version
-- pointer is left exactly as it was, as history, and never names the new
-- version. An archived article is not edited.

create function public.nexra_article_save_version(
  p_project_id text,
  p_article_id uuid,
  p_expected_version smallint,
  p_canonical_content text,
  p_content_sha256 text,
  p_sources jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_refusal text;
  v_source_refusal jsonb;
  v_sources jsonb;
  v_next smallint;
begin
  if p_project_id is null or p_article_id is null or p_expected_version is null or p_canonical_content is null
    or p_content_sha256 is null or p_sources is null or p_created_by is null
  then
    raise exception 'nexra_article_save_version: every argument is required'
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

  if v_article.current_version <> p_expected_version then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_article.current_version);
  end if;

  v_refusal := public.nexra_article_check_content(p_canonical_content, p_content_sha256);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;

  v_source_refusal := public.nexra_article_check_sources(p_project_id, p_sources);
  if v_source_refusal is not null then
    return v_source_refusal;
  end if;

  v_next := v_article.current_version + 1;

  insert into public.nexra_article_versions (article_id, version, origin, canonical_content, content_sha256, created_by)
  values (p_article_id, v_next, 'operator', p_canonical_content, p_content_sha256, p_created_by)
  returning * into v_version;

  v_sources := public.nexra_article_insert_sources(v_version.id, p_sources);

  update public.nexra_articles
     set current_version = v_next,
         status = 'drafting'
   where id = p_article_id
  returning * into v_article;

  return jsonb_build_object(
    'outcome', 'created',
    'article', to_jsonb(v_article),
    'version', to_jsonb(v_version),
    'sources', v_sources
  );
end;
$$;

comment on function public.nexra_article_save_version(text, uuid, smallint, text, text, jsonb, uuid) is
  'Saves an operator edit as the article''s next immutable version with its source rows, advances current_version and returns the status to drafting, in one transaction under the parent''s lock; refuses a stale expected version or an archived article. Never carries an approval forward.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the tables and executes the two write
-- functions. Nothing else, for anyone.

alter table public.nexra_articles enable row level security;
alter table public.nexra_article_versions enable row level security;
alter table public.nexra_article_version_sources enable row level security;

revoke all on function public.nexra_article_create(text, uuid, text, text, jsonb, uuid) from public;
revoke all on function public.nexra_article_save_version(text, uuid, smallint, text, text, jsonb, uuid) from public;
revoke all on function public.nexra_article_check_content(text, text) from public;
revoke all on function public.nexra_article_check_sources(text, jsonb) from public;
revoke all on function public.nexra_article_insert_sources(uuid, jsonb) from public;

do $$
declare
  v_role text;
  v_table text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      -- Supabase's default privileges may already have granted everything
      -- on a new table or function; take it all back first.
      foreach v_table in array array['nexra_articles', 'nexra_article_versions', 'nexra_article_version_sources'] loop
        execute format('revoke all on table public.%I from %I', v_table, v_role);
      end loop;
      execute format('revoke all on function public.nexra_article_create(text, uuid, text, text, jsonb, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_save_version(text, uuid, smallint, text, text, jsonb, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_check_content(text, text) from %I', v_role);
      execute format('revoke all on function public.nexra_article_check_sources(text, jsonb) from %I', v_role);
      execute format('revoke all on function public.nexra_article_insert_sources(uuid, jsonb) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_articles to service_role;
    grant select on table public.nexra_article_versions to service_role;
    grant select on table public.nexra_article_version_sources to service_role;
    grant execute on function public.nexra_article_create(text, uuid, text, text, jsonb, uuid) to service_role;
    grant execute on function public.nexra_article_save_version(text, uuid, smallint, text, text, jsonb, uuid) to service_role;
  end if;
end
$$;
