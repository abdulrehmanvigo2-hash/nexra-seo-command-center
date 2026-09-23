-- Article check units: exact-version, article-level fact-check results in
-- bounded units (Stage 5, milestone C4).
--
-- An article version is never checked as one prompt. The application cuts
-- one immutable version into check units in a fixed order — metadata,
-- lead-introduction, one unit per H2 section, one FAQ unit when the article
-- has FAQs, the CTA — runs the Research & Evidence agent on one unit at a
-- time, and records each unit's result here, bound to that exact version.
-- Nothing here approves, proposes, publishes or calls anything outside this
-- database.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000 and 20260922120000.
--
-- ONE TABLE, new. No existing table, column, constraint, trigger or grant is
-- altered; the draft fact-check (`nexra_content_draft_versions.fact_check`)
-- and the publication proposals are not touched. Foreign keys reference the
-- article tables and agent_runs without changing them.
--
--   * `nexra_article_check_units` holds, per article version and unit, the
--     unit's identity (index, kind, key), the SHA-256 of its canonical
--     `nexra-article-check-unit/1` text, its status and its structured
--     result, and the Research & Evidence run that produced it. No article
--     text is stored here: the unit text is regenerated from the version's
--     immutable canonical text whenever it is needed.
--
-- IDENTITY. On every insert, for every writer, the row's version must be
-- the article's version with that number, and its index, kind and key must
-- be exactly what the version's stored content yields at that index
-- (`nexra_article_check_expected_unit`). Keys come from the content —
-- `metadata`, `lead-introduction`, `section:<id>`, `faq`, `cta` — never from
-- a database id.
--
-- STATUS is `pending`, `passed`, `needs-review` or `failed`. `failed` is an
-- execution failure, never a content verdict. A row moves only forward:
-- pending → passed | needs-review | failed, with the same run; failed → any
-- status, with a new run (a re-check after an execution failure). A passed
-- or needs-review row is final for its version. Identity never changes, and
-- no row is ever deleted.
--
-- NO CARRY-FORWARD. Rows name one exact version. Version N's rows stay as
-- history when version N+1 is saved, and N+1 starts with none; nothing is
-- inferred from a source draft's check.
--
-- THE PARENT moves from `drafting` to `checked` only inside the record
-- function, only when the recorded unit passed, the version is the
-- article's current one, and every unit that version yields is passed. It
-- never moves to `approved`. Saving a new version returns it to `drafting`
-- (20260923120000, unchanged).
--
-- WRITES go through one `security definer` function,
-- `nexra_article_check_unit_record`, one transaction under a row lock on
-- the parent article (the same lock `nexra_article_save_version` takes).
-- service_role is granted SELECT on the table and EXECUTE on that function,
-- nothing else. Row level security is enabled with no policies.

create table public.nexra_article_check_units (
  id uuid primary key default gen_random_uuid(),

  article_id uuid not null
    constraint nexra_article_check_units_article_fkey references public.nexra_articles (id) on delete restrict,
  article_version_id uuid not null
    constraint nexra_article_check_units_version_fkey references public.nexra_article_versions (id) on delete restrict,
  article_version smallint not null
    constraint nexra_article_check_units_article_version_range check (article_version >= 1),
  constraint nexra_article_check_units_version_number_fkey
    foreign key (article_id, article_version) references public.nexra_article_versions (article_id, version) on delete restrict,

  -- Zero-based position in the fixed unit order. An article yields at most
  -- 2 + 30 sections + 1 FAQ unit + 1 CTA unit = 34 units.
  unit_index smallint not null
    constraint nexra_article_check_units_unit_index_range check (unit_index between 0 and 33),
  unit_kind text not null
    constraint nexra_article_check_units_unit_kind_valid check (unit_kind in ('metadata', 'lead-introduction', 'section', 'faq', 'cta')),
  unit_key text not null
    constraint nexra_article_check_units_unit_key_format
      check (char_length(unit_key) <= 88 and unit_key ~ '^(metadata|lead-introduction|faq|cta|section:[a-z0-9]+(-[a-z0-9]+)*)$'),
  constraint nexra_article_check_units_kind_matches_key
    check ((unit_kind = 'section') = starts_with(unit_key, 'section:') and (unit_kind = 'section' or unit_kind = unit_key)),

  -- SHA-256 of the unit's canonical nexra-article-check-unit/1 text, computed by the server.
  unit_sha256 text not null
    constraint nexra_article_check_units_unit_sha256_format check (unit_sha256 ~ '^[0-9a-f]{64}$'),

  status text not null
    constraint nexra_article_check_units_status_valid check (status in ('pending', 'passed', 'needs-review', 'failed')),

  -- The structured result; null while pending, and its own status always the row's.
  result jsonb
    constraint nexra_article_check_units_result_bounded check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 32768)),
  constraint nexra_article_check_units_result_matches_status
    check ((status = 'pending') = (result is null) and (result is null or result ->> 'status' = status)),

  -- The Research & Evidence run that produced the status and result.
  checked_by_run_id uuid not null
    constraint nexra_article_check_units_run_fkey references public.agent_runs (id) on delete restrict,
  constraint nexra_article_check_units_result_run_matches
    check (result is null or result ->> 'checkedByRunId' = checked_by_run_id::text),

  -- The Supabase Auth user id of the operator who recorded it. No foreign key, as on the drafts.
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint nexra_article_check_units_index_unique unique (article_version_id, unit_index),
  constraint nexra_article_check_units_key_unique unique (article_version_id, unit_key)
);

comment on table public.nexra_article_check_units is
  'Article-level fact-check results, one row per unit of one exact article version: the unit''s identity and hash, its status and structured result, and the Research & Evidence run behind it. No article text. Never approves or publishes.';
comment on column public.nexra_article_check_units.status is
  'pending while its run is queued or running; passed or needs-review from a completed check (final for the version); failed only for an execution failure.';

create index nexra_article_check_units_article_idx
  on public.nexra_article_check_units (article_id, article_version);

create trigger nexra_article_check_units_set_updated_at
  before update on public.nexra_article_check_units
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- What one stored version yields at one index: the unit's kind and key, and
-- how many units the version yields. Null for an index the version does not
-- have. Internal: executable by no API role.

create function public.nexra_article_check_expected_unit(p_canonical_content text, p_unit_index integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_content jsonb;
  v_sections integer;
  v_faqs integer;
  v_count integer;
begin
  if p_canonical_content is null or p_unit_index is null then
    return null;
  end if;
  v_content := p_canonical_content::jsonb;
  v_sections := jsonb_array_length(v_content -> 'sections');
  v_faqs := jsonb_array_length(v_content -> 'faqs');
  v_count := 3 + v_sections + case when v_faqs > 0 then 1 else 0 end;

  if p_unit_index < 0 or p_unit_index >= v_count then
    return null;
  end if;
  if p_unit_index = 0 then
    return jsonb_build_object('kind', 'metadata', 'key', 'metadata', 'count', v_count);
  end if;
  if p_unit_index = 1 then
    return jsonb_build_object('kind', 'lead-introduction', 'key', 'lead-introduction', 'count', v_count);
  end if;
  if p_unit_index < 2 + v_sections then
    return jsonb_build_object(
      'kind', 'section',
      'key', 'section:' || (v_content -> 'sections' -> (p_unit_index - 2) ->> 'id'),
      'count', v_count
    );
  end if;
  if v_faqs > 0 and p_unit_index = 2 + v_sections then
    return jsonb_build_object('kind', 'faq', 'key', 'faq', 'count', v_count);
  end if;
  return jsonb_build_object('kind', 'cta', 'key', 'cta', 'count', v_count);
end;
$$;

-- For every writer, not only the function below: the version is the
-- article's version with that number, and the unit identity is exactly what
-- that version's stored content yields at that index.
create function public.nexra_article_check_units_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version public.nexra_article_versions;
  v_expected jsonb;
begin
  select * into v_version
    from public.nexra_article_versions
   where id = new.article_version_id
     and article_id = new.article_id
     and version = new.article_version;
  if not found then
    raise exception 'nexra_article_check_units: the version is not this article''s version with that number'
      using errcode = 'check_violation';
  end if;
  v_expected := public.nexra_article_check_expected_unit(v_version.canonical_content, new.unit_index);
  if v_expected is null
    or v_expected ->> 'kind' is distinct from new.unit_kind
    or v_expected ->> 'key' is distinct from new.unit_key
  then
    raise exception 'nexra_article_check_units: the unit is not what this version yields at that index'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_article_check_units_check_insert
  before insert on public.nexra_article_check_units
  for each row
  execute function public.nexra_article_check_units_check_insert();

-- Identity is fixed; a row moves only forward, as described above.
create function public.nexra_article_check_units_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.article_id is distinct from old.article_id
    or new.article_version_id is distinct from old.article_version_id
    or new.article_version is distinct from old.article_version
    or new.unit_index is distinct from old.unit_index
    or new.unit_kind is distinct from old.unit_kind
    or new.unit_key is distinct from old.unit_key
    or new.unit_sha256 is distinct from old.unit_sha256
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_article_check_units: a unit''s identity and version cannot be changed'
      using errcode = 'check_violation';
  end if;
  if old.status = 'pending'
    and new.status in ('passed', 'needs-review', 'failed')
    and new.checked_by_run_id = old.checked_by_run_id
  then
    return new;
  end if;
  if old.status = 'failed' and new.checked_by_run_id <> old.checked_by_run_id then
    return new;
  end if;
  raise exception 'nexra_article_check_units: % cannot move to % here; a passed or needs-review unit is final for its version', old.status, new.status
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_article_check_units_guard_update
  before update on public.nexra_article_check_units
  for each row
  execute function public.nexra_article_check_units_guard_update();

create function public.nexra_article_check_units_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_article_check_units: a check result is permanent history'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_article_check_units_guard_delete
  before delete on public.nexra_article_check_units
  for each row
  execute function public.nexra_article_check_units_guard_delete();

create trigger nexra_article_check_units_guard_truncate
  before truncate on public.nexra_article_check_units
  for each statement
  execute function public.nexra_article_check_units_guard_delete();

-- ---------------------------------------------------------------------------
-- Recording one unit's check: one transaction under the parent article's
-- row lock. Re-checks, against the stored rows: the article is this
-- project's and not archived; the version number and row id agree; the unit
-- identity is what the version yields; the run is this project's Research &
-- Evidence `article-check-unit` run whose input names exactly this article,
-- version, version id and unit index; the status agrees with the run's own
-- state (pending only while it is queued or running; passed or
-- needs-review only from a completed, model-executed, grounded run whose
-- evidence names this unit's key and hash; failed from a failed, cancelled
-- or unreadable run); and the result carries that status and run. Then it
-- inserts the row or moves it forward, and — only for a pass of the
-- article's current version whose every unit is now passed — moves the
-- parent from drafting to checked.

create function public.nexra_article_check_unit_record(
  p_project_id text,
  p_article_id uuid,
  p_article_version smallint,
  p_article_version_id uuid,
  p_unit_index smallint,
  p_unit_kind text,
  p_unit_key text,
  p_unit_sha256 text,
  p_status text,
  p_result jsonb,
  p_run_id uuid,
  p_recorded_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_run public.agent_runs;
  v_expected jsonb;
  v_existing public.nexra_article_check_units;
  v_row public.nexra_article_check_units;
  v_passed integer;
  v_advanced boolean := false;
begin
  if p_project_id is null or p_article_id is null or p_article_version is null or p_article_version_id is null
    or p_unit_index is null or p_unit_kind is null or p_unit_key is null or p_unit_sha256 is null
    or p_status is null or p_run_id is null or p_recorded_by is null
  then
    raise exception 'nexra_article_check_unit_record: every argument except the result is required'
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

  select * into v_version
    from public.nexra_article_versions
   where article_id = p_article_id and version = p_article_version;
  if not found then
    return jsonb_build_object('outcome', 'version-not-found');
  end if;
  if v_version.id <> p_article_version_id then
    return jsonb_build_object('outcome', 'version-mismatch');
  end if;

  v_expected := public.nexra_article_check_expected_unit(v_version.canonical_content, p_unit_index);
  if v_expected is null or v_expected ->> 'kind' <> p_unit_kind or v_expected ->> 'key' <> p_unit_key then
    return jsonb_build_object('outcome', 'unit-mismatch');
  end if;

  select * into v_run
    from public.agent_runs
   where id = p_run_id
     and project_id = p_project_id
     and agent_id = 'research-evidence'
     and task_type = 'article-check-unit'
     and input -> 'articleId' = to_jsonb(p_article_id::text)
     and input -> 'articleVersion' = to_jsonb(p_article_version::integer)
     and input -> 'articleVersionId' = to_jsonb(p_article_version_id::text)
     and input -> 'unitIndex' = to_jsonb(p_unit_index::integer);
  if not found then
    return jsonb_build_object('outcome', 'run-mismatch');
  end if;

  if not (
    (p_status = 'pending' and v_run.status in ('queued', 'running'))
    or (
      p_status in ('passed', 'needs-review')
      and v_run.status = 'completed'
      and v_run.executor = 'ai'
      and v_run.result_metadata -> 'simulated' = 'false'::jsonb
      and v_run.result_metadata -> 'grounded' = 'true'::jsonb
      and v_run.result_metadata -> 'evidence' ->> 'source' = 'article-unit'
      and v_run.result_metadata -> 'evidence' ->> 'unitKey' = p_unit_key
      and v_run.result_metadata -> 'evidence' ->> 'unitSha256' = p_unit_sha256
    )
    or (p_status = 'failed' and v_run.status in ('failed', 'cancelled', 'completed'))
  ) then
    return jsonb_build_object('outcome', 'run-state-mismatch');
  end if;

  if (p_status = 'pending') <> (p_result is null)
    or (p_result is not null and (
      jsonb_typeof(p_result) <> 'object'
      or p_result ->> 'status' is distinct from p_status
      or p_result ->> 'checkedByRunId' is distinct from p_run_id::text
    ))
  then
    return jsonb_build_object('outcome', 'invalid-result');
  end if;

  select * into v_existing
    from public.nexra_article_check_units
   where article_version_id = p_article_version_id and unit_index = p_unit_index;

  if not found then
    insert into public.nexra_article_check_units
      (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, unit_sha256, status, result, checked_by_run_id, recorded_by)
    values
      (p_article_id, p_article_version_id, p_article_version, p_unit_index, p_unit_kind, p_unit_key, p_unit_sha256, p_status, p_result, p_run_id, p_recorded_by)
    returning * into v_row;
  else
    if v_existing.unit_sha256 <> p_unit_sha256 then
      return jsonb_build_object('outcome', 'unit-mismatch');
    end if;
    if v_existing.checked_by_run_id = p_run_id and v_existing.status = p_status then
      return jsonb_build_object('outcome', 'exists', 'record', to_jsonb(v_existing), 'article', to_jsonb(v_article), 'article_status_advanced', false);
    end if;
    if not (
      (v_existing.status = 'pending' and p_status <> 'pending' and v_existing.checked_by_run_id = p_run_id)
      or (v_existing.status = 'failed' and v_existing.checked_by_run_id <> p_run_id)
    ) then
      return jsonb_build_object('outcome', 'already-recorded', 'record', to_jsonb(v_existing));
    end if;
    update public.nexra_article_check_units
       set status = p_status,
           result = p_result,
           checked_by_run_id = p_run_id,
           recorded_by = p_recorded_by
     where id = v_existing.id
    returning * into v_row;
  end if;

  -- The parent moves only for a pass of its current version, only from
  -- drafting, and only when every unit that version yields is passed.
  if p_status = 'passed' and v_article.status = 'drafting' and v_article.current_version = p_article_version then
    select count(*) into v_passed
      from public.nexra_article_check_units
     where article_version_id = p_article_version_id and status = 'passed';
    if v_passed = (v_expected ->> 'count')::integer then
      update public.nexra_articles
         set status = 'checked'
       where id = p_article_id and status = 'drafting' and current_version = p_article_version
      returning * into v_article;
      v_advanced := found;
    end if;
  end if;

  return jsonb_build_object('outcome', 'recorded', 'record', to_jsonb(v_row), 'article', to_jsonb(v_article), 'article_status_advanced', v_advanced);
end;
$$;

comment on function public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, text, text, jsonb, uuid, uuid) is
  'Records one article check unit''s status and result for one exact version, after re-checking the article, the version, the unit identity, the Research & Evidence run and its state, under the parent''s row lock. Moves the parent from drafting to checked only when every unit of its current version is passed. Never approves or publishes.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the record function.
-- Nothing else, for anyone.

alter table public.nexra_article_check_units enable row level security;

revoke all on function public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, text, text, jsonb, uuid, uuid) from public;
revoke all on function public.nexra_article_check_expected_unit(text, integer) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      -- Supabase's default privileges may already have granted everything
      -- on a new table or function; take it all back first.
      execute format('revoke all on table public.nexra_article_check_units from %I', v_role);
      execute format('revoke all on function public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, text, text, jsonb, uuid, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_check_expected_unit(text, integer) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_article_check_units to service_role;
    grant execute on function public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, text, text, jsonb, uuid, uuid) to service_role;
  end if;
end
$$;
