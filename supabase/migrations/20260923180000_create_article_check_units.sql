-- Article check units: exact-version, article-level fact-check results in
-- bounded units (Stage 5, milestone C4).
--
-- An article version is never checked as one prompt. The application reads
-- one immutable version as blocks in a fixed order — metadata,
-- lead-introduction, one block per H2 section, one FAQ block when the
-- article has FAQs, the CTA — and cuts each block, deterministically, into
-- parts of at most 10 statements and 6,000 bytes. Each part is one check
-- unit: the Research & Evidence agent checks one unit at a time, and each
-- unit's result is recorded here, bound to that exact version. Nothing here
-- approves, proposes, publishes or calls anything outside this database.
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
--     unit's identity — index across the article, kind, key
--     (`<block>:<part>`), part, the block's part count and the version's
--     unit count — the SHA-256 of its canonical `nexra-article-check-unit/1`
--     text, its status and its structured result, and the Research &
--     Evidence run that produced it. No article text is stored here: the
--     unit text is regenerated from the version's immutable canonical text
--     whenever it is needed.
--
-- IDENTITY. On every insert, for every writer, the row's version must be
-- the article's version with that number; its key's block must be one the
-- version's stored content has (`nexra_article_check_blocks`), with the
-- matching kind; its part must lie within its part count; and its counts
-- must agree with every other row of the same version (one unit count) and
-- of the same block (one part count). Keys come from the content —
-- `metadata:<n>`, `lead-introduction:<n>`, `section:<id>:<n>`, `faq:<n>`,
-- `cta:<n>` — never from a database id. How a block is cut into parts is
-- the application's deterministic rule; this database checks the structure
-- it can see, and requires the application's counts and hash to equal the
-- ones the Research & Evidence run itself recorded.
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
-- article's current one, and the version is complete
-- (`nexra_article_check_version_complete`): exactly `unit_count` rows, all
-- passed, all naming that unit count; every block the content has present,
-- each with exactly its part count of rows (so parts 1 … n, no gap and no
-- duplicate); and every row's index its position in block order, then part
-- order. It never moves to `approved`. Saving a new version returns it to
-- `drafting` (20260923120000, unchanged).
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

  -- Zero-based position across the article's units. At most 150 units.
  unit_index smallint not null
    constraint nexra_article_check_units_unit_index_range check (unit_index between 0 and 149),
  unit_kind text not null
    constraint nexra_article_check_units_unit_kind_valid check (unit_kind in ('metadata', 'lead-introduction', 'section', 'faq', 'cta')),
  unit_key text not null
    constraint nexra_article_check_units_unit_key_format
      check (char_length(unit_key) <= 96 and unit_key ~ '^(metadata|lead-introduction|faq|cta|section:[a-z0-9]+(-[a-z0-9]+)*):[1-9][0-9]{0,2}$'),
  constraint nexra_article_check_units_kind_matches_key
    check ((unit_kind = 'section') = starts_with(unit_key, 'section:') and (unit_kind = 'section' or starts_with(unit_key, unit_kind || ':'))),

  -- The unit's part within its block (1-based), the block's part count, and the version's unit count.
  part smallint not null,
  part_count smallint not null,
  unit_count smallint not null,
  constraint nexra_article_check_units_part_range check (part >= 1 and part <= part_count and part_count <= 150),
  constraint nexra_article_check_units_unit_count_range check (unit_count between 1 and 150 and unit_index < unit_count and part_count <= unit_count),
  constraint nexra_article_check_units_key_ends_with_part
    check (right(unit_key, char_length(part::text) + 1) = ':' || part::text),

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
  'Article-level fact-check results, one row per check unit (one part of one block) of one exact article version: the unit''s identity, counts and hash, its status and structured result, and the Research & Evidence run behind it. No article text. Never approves or publishes.';
comment on column public.nexra_article_check_units.status is
  'pending while its run is queued or running; passed or needs-review from a completed check (final for the version); failed only for an execution failure.';

create index nexra_article_check_units_article_idx
  on public.nexra_article_check_units (article_id, article_version);

create trigger nexra_article_check_units_set_updated_at
  before update on public.nexra_article_check_units
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Internal helpers: executable by no API role.

-- The blocks one stored version has, in order: [{block, kind}, …].
create function public.nexra_article_check_blocks(p_canonical_content text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_content jsonb;
  v_blocks jsonb;
begin
  if p_canonical_content is null then
    return null;
  end if;
  v_content := p_canonical_content::jsonb;
  v_blocks := jsonb_build_array(
    jsonb_build_object('block', 'metadata', 'kind', 'metadata'),
    jsonb_build_object('block', 'lead-introduction', 'kind', 'lead-introduction')
  );
  v_blocks := v_blocks || coalesce(
    (select jsonb_agg(jsonb_build_object('block', 'section:' || (s.value ->> 'id'), 'kind', 'section') order by s.ordinality)
       from jsonb_array_elements(v_content -> 'sections') with ordinality as s(value, ordinality)),
    '[]'::jsonb
  );
  if jsonb_array_length(v_content -> 'faqs') > 0 then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('block', 'faq', 'kind', 'faq'));
  end if;
  return v_blocks || jsonb_build_array(jsonb_build_object('block', 'cta', 'kind', 'cta'));
end;
$$;

-- The block a key names: the key without its `:<part>` suffix.
create function public.nexra_article_check_block_of(p_unit_key text, p_part integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(p_unit_key, char_length(p_unit_key) - char_length(p_part::text) - 1)
$$;

-- Whether one version's rows are the complete, all-passed unit set its
-- stored content and unit count describe. See the header.
create function public.nexra_article_check_version_complete(p_article_version_id uuid, p_canonical_content text, p_unit_count integer)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_blocks jsonb;
begin
  v_blocks := public.nexra_article_check_blocks(p_canonical_content);
  if v_blocks is null or p_unit_count is null or p_unit_count < jsonb_array_length(v_blocks) or p_unit_count > 150 then
    return false;
  end if;

  -- Every row passed and names this unit count; exactly that many rows.
  if exists (
    select 1 from public.nexra_article_check_units u
     where u.article_version_id = p_article_version_id
       and (u.status <> 'passed' or u.unit_count <> p_unit_count)
  ) then
    return false;
  end if;
  if (select count(*) from public.nexra_article_check_units u where u.article_version_id = p_article_version_id) <> p_unit_count then
    return false;
  end if;

  -- Every block present, with one part count and exactly that many rows:
  -- parts are unique per block and lie in 1 … part count, so they are 1 … n.
  if exists (
    select 1
      from jsonb_array_elements(v_blocks) as b(value)
      left join lateral (
        select count(*) as n, min(u.part_count) as lo, max(u.part_count) as hi
          from public.nexra_article_check_units u
         where u.article_version_id = p_article_version_id
           and public.nexra_article_check_block_of(u.unit_key, u.part) = b.value ->> 'block'
      ) s on true
     where s.n = 0 or s.lo <> s.hi or s.n <> s.lo
  ) then
    return false;
  end if;

  -- Every row's index is its position: block order, then part order.
  if exists (
    select 1
      from (
        select u.unit_index, (row_number() over (order by b.ordinality, u.part) - 1) as expected
          from public.nexra_article_check_units u
          join jsonb_array_elements(v_blocks) with ordinality as b(value, ordinality)
            on public.nexra_article_check_block_of(u.unit_key, u.part) = b.value ->> 'block'
         where u.article_version_id = p_article_version_id
      ) positions
     where positions.unit_index <> positions.expected
  ) then
    return false;
  end if;

  return true;
end;
$$;

-- For every writer, not only the function below: the version is the
-- article's version with that number; the key's block is one the version's
-- content has, with the matching kind; and the counts agree with the rows
-- already recorded for this version and this block.
create function public.nexra_article_check_units_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version public.nexra_article_versions;
  v_blocks jsonb;
  v_block text;
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

  v_blocks := public.nexra_article_check_blocks(v_version.canonical_content);
  v_block := public.nexra_article_check_block_of(new.unit_key, new.part);
  if not exists (
    select 1 from jsonb_array_elements(v_blocks) as b(value)
     where b.value ->> 'block' = v_block and b.value ->> 'kind' = new.unit_kind
  ) or new.unit_count < jsonb_array_length(v_blocks) then
    raise exception 'nexra_article_check_units: the unit is not a part of a block this version has'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.nexra_article_check_units u
     where u.article_version_id = new.article_version_id
       and (
         u.unit_count <> new.unit_count
         or (public.nexra_article_check_block_of(u.unit_key, u.part) = v_block and u.part_count <> new.part_count)
       )
  ) then
    raise exception 'nexra_article_check_units: the unit''s counts disagree with this version''s other units'
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
    or new.part is distinct from old.part
    or new.part_count is distinct from old.part_count
    or new.unit_count is distinct from old.unit_count
    or new.unit_sha256 is distinct from old.unit_sha256
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_article_check_units: a unit''s identity, counts and version cannot be changed'
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
-- project's and not archived; the version number and row id agree; the
-- unit's block is one the version has, with its kind, key, part and counts
-- in range; the counts agree with the version's other rows; the run is this
-- project's Research & Evidence `article-check-unit` run whose input names
-- exactly this article, version, version id and unit index; the status
-- agrees with the run's own state (pending only while it is queued or
-- running; passed or needs-review only from a completed, model-executed,
-- grounded run; failed from a failed or cancelled run, or a completed one);
-- a completed run's own evidence names this unit's key, hash, index, part,
-- part count and unit count; and the result carries the status and run.
-- Then it inserts the row or moves it forward, and — only for a pass of the
-- article's current version that leaves the version complete — moves the
-- parent from drafting to checked.

create function public.nexra_article_check_unit_record(
  p_project_id text,
  p_article_id uuid,
  p_article_version smallint,
  p_article_version_id uuid,
  p_unit_index smallint,
  p_unit_kind text,
  p_unit_key text,
  p_part smallint,
  p_part_count smallint,
  p_unit_count smallint,
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
  v_blocks jsonb;
  v_block text;
  v_evidence jsonb;
  v_existing public.nexra_article_check_units;
  v_row public.nexra_article_check_units;
  v_advanced boolean := false;
begin
  if p_project_id is null or p_article_id is null or p_article_version is null or p_article_version_id is null
    or p_unit_index is null or p_unit_kind is null or p_unit_key is null or p_part is null or p_part_count is null
    or p_unit_count is null or p_unit_sha256 is null or p_status is null or p_run_id is null or p_recorded_by is null
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

  -- The unit's identity: a block this version has, its kind, its key, and counts in range.
  v_blocks := public.nexra_article_check_blocks(v_version.canonical_content);
  if p_part < 1 or p_part > p_part_count or p_part_count > p_unit_count or p_unit_count > 150
    or p_unit_count < jsonb_array_length(v_blocks) or p_unit_index < 0 or p_unit_index >= p_unit_count
    or p_unit_key !~ '^(metadata|lead-introduction|faq|cta|section:[a-z0-9]+(-[a-z0-9]+)*):[1-9][0-9]{0,2}$'
    or right(p_unit_key, char_length(p_part::text) + 1) <> ':' || p_part::text
  then
    return jsonb_build_object('outcome', 'unit-mismatch');
  end if;
  v_block := public.nexra_article_check_block_of(p_unit_key, p_part);
  if not exists (
    select 1 from jsonb_array_elements(v_blocks) as b(value)
     where b.value ->> 'block' = v_block and b.value ->> 'kind' = p_unit_kind
  ) then
    return jsonb_build_object('outcome', 'unit-mismatch');
  end if;

  -- One unit count per version, one part count per block.
  if exists (
    select 1 from public.nexra_article_check_units u
     where u.article_version_id = p_article_version_id
       and (
         u.unit_count <> p_unit_count
         or (public.nexra_article_check_block_of(u.unit_key, u.part) = v_block and u.part_count <> p_part_count)
       )
  ) then
    return jsonb_build_object('outcome', 'count-mismatch');
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

  -- A completed run's own evidence must name exactly this unit and these counts.
  v_evidence := v_run.result_metadata -> 'evidence';
  if not (
    (p_status = 'pending' and v_run.status in ('queued', 'running'))
    or (p_status = 'failed' and v_run.status in ('failed', 'cancelled'))
    or (
      v_run.status = 'completed'
      and (
        p_status = 'failed'
        or (
          p_status in ('passed', 'needs-review')
          and v_run.executor = 'ai'
          and v_run.result_metadata -> 'simulated' = 'false'::jsonb
          and v_run.result_metadata -> 'grounded' = 'true'::jsonb
        )
      )
      and v_evidence ->> 'source' = 'article-unit'
      and v_evidence ->> 'unitKey' = p_unit_key
      and v_evidence ->> 'unitSha256' = p_unit_sha256
      and v_evidence -> 'unitIndex' = to_jsonb(p_unit_index::integer)
      and v_evidence -> 'part' = to_jsonb(p_part::integer)
      and v_evidence -> 'partCount' = to_jsonb(p_part_count::integer)
      and v_evidence -> 'unitCount' = to_jsonb(p_unit_count::integer)
    )
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

  -- The same key at another index is a different unit.
  if exists (
    select 1 from public.nexra_article_check_units
     where article_version_id = p_article_version_id and unit_key = p_unit_key and unit_index <> p_unit_index
  ) then
    return jsonb_build_object('outcome', 'unit-mismatch');
  end if;

  select * into v_existing
    from public.nexra_article_check_units
   where article_version_id = p_article_version_id and unit_index = p_unit_index;

  if not found then
    insert into public.nexra_article_check_units
      (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count,
       unit_sha256, status, result, checked_by_run_id, recorded_by)
    values
      (p_article_id, p_article_version_id, p_article_version, p_unit_index, p_unit_kind, p_unit_key, p_part, p_part_count, p_unit_count,
       p_unit_sha256, p_status, p_result, p_run_id, p_recorded_by)
    returning * into v_row;
  else
    if v_existing.unit_sha256 <> p_unit_sha256 or v_existing.unit_key <> p_unit_key or v_existing.unit_kind <> p_unit_kind
      or v_existing.part <> p_part or v_existing.part_count <> p_part_count or v_existing.unit_count <> p_unit_count
    then
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
  -- drafting, and only when that version's unit set is complete.
  if p_status = 'passed' and v_article.status = 'drafting' and v_article.current_version = p_article_version
    and public.nexra_article_check_version_complete(p_article_version_id, v_version.canonical_content, p_unit_count)
  then
    update public.nexra_articles
       set status = 'checked'
     where id = p_article_id and status = 'drafting' and current_version = p_article_version
    returning * into v_article;
    v_advanced := found;
  end if;

  return jsonb_build_object('outcome', 'recorded', 'record', to_jsonb(v_row), 'article', to_jsonb(v_article), 'article_status_advanced', v_advanced);
end;
$$;

comment on function public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, text, jsonb, uuid, uuid) is
  'Records one article check unit''s status and result for one exact version, after re-checking the article, the version, the unit identity and counts, the Research & Evidence run, its state and its own evidence, under the parent''s row lock. Moves the parent from drafting to checked only when its current version''s unit set is complete and all passed. Never approves or publishes.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the record function.
-- Nothing else, for anyone.

alter table public.nexra_article_check_units enable row level security;

revoke all on function public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, text, jsonb, uuid, uuid) from public;
revoke all on function public.nexra_article_check_blocks(text) from public;
revoke all on function public.nexra_article_check_block_of(text, integer) from public;
revoke all on function public.nexra_article_check_version_complete(uuid, text, integer) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      -- Supabase's default privileges may already have granted everything
      -- on a new table or function; take it all back first.
      execute format('revoke all on table public.nexra_article_check_units from %I', v_role);
      execute format('revoke all on function public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, text, jsonb, uuid, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_article_check_blocks(text) from %I', v_role);
      execute format('revoke all on function public.nexra_article_check_block_of(text, integer) from %I', v_role);
      execute format('revoke all on function public.nexra_article_check_version_complete(uuid, text, integer) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_article_check_units to service_role;
    grant execute on function public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, text, jsonb, uuid, uuid) to service_role;
  end if;
end
$$;
