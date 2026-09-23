-- Article approvals: the approval gate for one exact, immutable article
-- version (Stage 5, milestone C5).
--
-- An operator approves one article version, and only when every check unit
-- of that exact version passed. Approval is not publication: nothing here
-- proposes, publishes, renders, or calls anything outside this database,
-- and there is still no published state.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000 and 20260922120000.
--
-- ONE TABLE, new, append-only: `nexra_article_approvals`. Each row binds
-- one approval to the article, the exact version number, that version's
-- immutable row id and canonical-content SHA-256, the number of check units
-- the version was approved with, and the SHA-256 of the ordered unit set
-- (see UNITS DIGEST), with the operator and the time. One approval per
-- article version. A row is written once and never updated or deleted.
--
-- THE PARENT'S EXISTING COLUMNS stay the current-approval pointer:
-- `nexra_articles.status`, `approved_version`, `approved_by`, `approved_at`
-- (20260923120000, unchanged). The approval function writes the history
-- row and the pointer in one transaction. Saving a new version returns the
-- parent to `drafting` and leaves the pointer as it was — so it names the
-- older version, which the history row also names, and the new version
-- inherits nothing.
--
-- ONE CONSTRAINT is added to the existing `nexra_articles` table:
-- `approved` requires the pointer to name the current version. It holds
-- for every legal transition: `nexra_article_create` writes `drafting`;
-- `nexra_article_save_version` moves `current_version` and sets `drafting`
-- in one statement; `nexra_article_check_unit_record` moves only
-- `drafting` to `checked`; and the function below sets `approved` with the
-- pointer at the current version. Nothing else writes the table. No other
-- existing table, column, constraint, function, trigger or grant is changed.
--
-- UNITS DIGEST. The SHA-256, lowercase hex, of the UTF-8 text
--   nexra-article-approval-units/1\n
-- followed, for each unit in index order, by
--   <unit_index> <unit_key> <unit_sha256>\n
-- The application computes it from the units it regenerates from the
-- stored canonical text; this database recomputes it from the stored
-- check-unit rows, and the two must agree.
--
-- THE GATE is `nexra_article_approve_version`, one `security definer`
-- function, one transaction under a row lock on the parent (the same lock
-- the save and check-record functions take, so approval, edit and check
-- recording are serialised). It refuses, in this order: an article not in
-- the project; an archived article; a version that is not the current one
-- (stale); a version row that is not the one named; a content hash that is
-- not the version's; — then answers `exists` for a version already
-- approved, writing nothing — a parent that is not `checked`; a unit list
-- that does not equal the stored rows exactly (index, key, hash, count,
-- digest); any unit that is not `passed`; a unit set the completeness rule
-- (`nexra_article_check_version_complete`, 20260923180000) does not accept;
-- a topic decision other than `update-existing` or `different-angle`; and
-- a `[NEEDS EVIDENCE` placeholder left anywhere in the text. There is no
-- override.
--
-- ACCESS. service_role is granted SELECT on the table and EXECUTE on the
-- approval function, nothing else. Row level security is enabled with no
-- policies.

create table public.nexra_article_approvals (
  id uuid primary key default gen_random_uuid(),

  article_id uuid not null
    constraint nexra_article_approvals_article_fkey references public.nexra_articles (id) on delete restrict,
  article_version smallint not null
    constraint nexra_article_approvals_article_version_range check (article_version >= 1),
  article_version_id uuid not null
    constraint nexra_article_approvals_version_fkey references public.nexra_article_versions (id) on delete restrict,
  constraint nexra_article_approvals_version_number_fkey
    foreign key (article_id, article_version) references public.nexra_article_versions (article_id, version) on delete restrict,

  -- The approved version's canonical-content SHA-256, as stored on the version.
  content_sha256 text not null
    constraint nexra_article_approvals_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$'),

  -- The check units the version was approved with: how many, and the digest of the ordered set.
  unit_count smallint not null
    constraint nexra_article_approvals_unit_count_range check (unit_count between 1 and 150),
  units_sha256 text not null
    constraint nexra_article_approvals_units_sha256_format check (units_sha256 ~ '^[0-9a-f]{64}$'),

  -- The Supabase Auth user id of the operator who approved it. No foreign key, as on the drafts.
  approved_by uuid not null,
  approved_at timestamptz not null default now(),

  constraint nexra_article_approvals_version_unique unique (article_id, article_version)
);

comment on table public.nexra_article_approvals is
  'Immutable approval history: one row per approved article version, binding the exact version row, its content hash, the check-unit count and ordered unit-set digest, the operator and the time. Approval is not publication.';

-- For every writer, not only the function below: the version row is the
-- article's version with that number, and the hash is that version's.
create function public.nexra_article_approvals_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.nexra_article_versions v
     where v.id = new.article_version_id
       and v.article_id = new.article_id
       and v.version = new.article_version
       and v.content_sha256 = new.content_sha256
  ) then
    raise exception 'nexra_article_approvals: the version row, number and content hash do not name one stored version of this article'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_article_approvals_check_insert
  before insert on public.nexra_article_approvals
  for each row
  execute function public.nexra_article_approvals_check_insert();

create function public.nexra_article_approvals_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_article_approvals: an approval is permanent history and is never changed or removed'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_article_approvals_guard_update
  before update on public.nexra_article_approvals
  for each row
  execute function public.nexra_article_approvals_guard_write();

create trigger nexra_article_approvals_guard_delete
  before delete on public.nexra_article_approvals
  for each row
  execute function public.nexra_article_approvals_guard_write();

create trigger nexra_article_approvals_guard_truncate
  before truncate on public.nexra_article_approvals
  for each statement
  execute function public.nexra_article_approvals_guard_write();

-- `approved` always names the current version. See the header.
alter table public.nexra_articles
  add constraint nexra_articles_approved_is_current
    check (status <> 'approved' or (approved_version is not null and approved_version = current_version));

-- ---------------------------------------------------------------------------
-- The approval gate. See the header for the order of refusals.

create function public.nexra_article_approve_version(
  p_project_id text,
  p_article_id uuid,
  p_article_version smallint,
  p_article_version_id uuid,
  p_content_sha256 text,
  p_units jsonb,
  p_units_sha256 text,
  p_approved_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_existing public.nexra_article_approvals;
  v_approval public.nexra_article_approvals;
  v_unit_count integer;
  v_digest text;
  v_topic text;
begin
  if p_project_id is null or p_article_id is null or p_article_version is null or p_article_version_id is null
    or p_content_sha256 is null or p_units is null or p_units_sha256 is null or p_approved_by is null
  then
    raise exception 'nexra_article_approve_version: every argument is required'
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
  if v_article.current_version <> p_article_version then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_article.current_version);
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

  -- The same version approved again: the existing record, and no write.
  select * into v_existing
    from public.nexra_article_approvals
   where article_id = p_article_id and article_version = p_article_version;
  if found then
    return jsonb_build_object('outcome', 'exists', 'approval', to_jsonb(v_existing), 'article', to_jsonb(v_article));
  end if;

  if v_article.status <> 'checked' then
    return jsonb_build_object('outcome', 'status-unexpected', 'status', v_article.status);
  end if;

  -- The units the server regenerated must be exactly the stored rows of this version.
  if jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) < 1 or jsonb_array_length(p_units) > 150 then
    return jsonb_build_object('outcome', 'units-mismatch');
  end if;
  v_unit_count := jsonb_array_length(p_units);
  if exists (
    select 1 from jsonb_array_elements(p_units) with ordinality as e(value, ordinality)
     where jsonb_typeof(e.value) <> 'object'
        or jsonb_typeof(e.value -> 'index') <> 'number'
        or jsonb_typeof(e.value -> 'key') <> 'string'
        or jsonb_typeof(e.value -> 'sha256') <> 'string'
        or case when (e.value ->> 'index') ~ '^[0-9]{1,3}$' then (e.value ->> 'index')::integer <> e.ordinality - 1 else true end
  ) then
    return jsonb_build_object('outcome', 'units-mismatch');
  end if;
  if exists (
    select 1
      from (
        select (e.value ->> 'index')::integer as unit_index, e.value ->> 'key' as unit_key, e.value ->> 'sha256' as unit_sha256
          from jsonb_array_elements(p_units) as e(value)
      ) expected
      full join (
        select u.unit_index::integer as unit_index, u.unit_key, u.unit_sha256, u.unit_count
          from public.nexra_article_check_units u
         where u.article_version_id = p_article_version_id
      ) stored
        on stored.unit_index = expected.unit_index
     where expected.unit_index is null
        or stored.unit_index is null
        or stored.unit_key <> expected.unit_key
        or stored.unit_sha256 <> expected.unit_sha256
        or stored.unit_count <> v_unit_count
  ) then
    return jsonb_build_object('outcome', 'units-mismatch');
  end if;

  select encode(sha256(convert_to(
           'nexra-article-approval-units/1' || chr(10) ||
           string_agg(u.unit_index::text || ' ' || u.unit_key || ' ' || u.unit_sha256 || chr(10), '' order by u.unit_index),
           'UTF8')), 'hex')
    into v_digest
    from public.nexra_article_check_units u
   where u.article_version_id = p_article_version_id;
  if v_digest is distinct from p_units_sha256 then
    return jsonb_build_object('outcome', 'units-mismatch');
  end if;

  if exists (
    select 1 from public.nexra_article_check_units u
     where u.article_version_id = p_article_version_id and u.status <> 'passed'
  ) then
    return jsonb_build_object(
      'outcome', 'units-not-passed',
      'pending', (select count(*) from public.nexra_article_check_units u where u.article_version_id = p_article_version_id and u.status = 'pending'),
      'needs_review', (select count(*) from public.nexra_article_check_units u where u.article_version_id = p_article_version_id and u.status = 'needs-review'),
      'failed', (select count(*) from public.nexra_article_check_units u where u.article_version_id = p_article_version_id and u.status = 'failed')
    );
  end if;
  if not public.nexra_article_check_version_complete(p_article_version_id, v_version.canonical_content, v_unit_count) then
    return jsonb_build_object('outcome', 'units-incomplete');
  end if;

  v_topic := v_version.canonical_content::jsonb ->> 'topicDecision';
  if v_topic is null or v_topic not in ('update-existing', 'different-angle') then
    return jsonb_build_object('outcome', 'topic-decision', 'topic_decision', v_topic);
  end if;

  if strpos(lower(v_version.canonical_content), '[needs evidence') > 0 then
    return jsonb_build_object('outcome', 'unresolved-placeholder');
  end if;

  insert into public.nexra_article_approvals
    (article_id, article_version, article_version_id, content_sha256, unit_count, units_sha256, approved_by)
  values
    (p_article_id, p_article_version, p_article_version_id, v_version.content_sha256, v_unit_count, v_digest, p_approved_by)
  returning * into v_approval;

  update public.nexra_articles
     set status = 'approved',
         approved_version = p_article_version,
         approved_by = p_approved_by,
         approved_at = v_approval.approved_at
   where id = p_article_id and status = 'checked' and current_version = p_article_version
  returning * into v_article;
  if not found then
    raise exception 'nexra_article_approve_version: the article changed under its own lock'
      using errcode = 'serialization_failure';
  end if;

  return jsonb_build_object('outcome', 'approved', 'approval', to_jsonb(v_approval), 'article', to_jsonb(v_article));
end;
$$;

comment on function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid) is
  'Approves one exact article version under the parent''s row lock, after re-checking the project, archive state, current version, version row, content hash, the exact stored check-unit set (all passed and complete), the topic decision and unresolved placeholders; writes one immutable approval row and the parent''s approval pointer together. Publishes nothing.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the approval function.
-- Nothing else, for anyone.

alter table public.nexra_article_approvals enable row level security;

revoke all on function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid) from public;
revoke all on function public.nexra_article_approvals_check_insert() from public;
revoke all on function public.nexra_article_approvals_guard_write() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      -- Supabase's default privileges may already have granted everything
      -- on a new table or function; take it all back first.
      execute format('revoke all on table public.nexra_article_approvals from %I', v_role);
      execute format('revoke all on function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_approvals_check_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_article_approvals_guard_write() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_article_approvals to service_role;
    grant execute on function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid) to service_role;
  end if;
end
$$;
