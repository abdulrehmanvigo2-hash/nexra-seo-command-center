-- Check-result carry-forward (fix F8; audit A5-02, A3-03).
--
-- WHY. A check result binds to one exact article version, so every revision
-- re-checked units whose text had not changed. On article 1003104c (6.10b)
-- eight of the twenty check runs re-checked a unit identical, byte for byte,
-- to one that had already passed — and the checker's default sampling judged
-- identical text differently from one run to the next (V4's metadata unit was
-- refused after passing on V2 and V3).
--
-- THE RULE. A passed result may be carried onto the current version's unit
-- with the identical unit text (same unit SHA-256, key and kind) only when:
--   * the source passed on an earlier version of the same article and was
--     itself checked by a run (a carried row is never a source);
--   * the source run recorded the checker instructions' SHA-256, and it equals
--     the hash the server checks with now;
--   * and either the source result holds no SUPPORTED statement (it rests on
--     no record), or the source run recorded the evidence fingerprint and it
--     equals the evidence as read now.
-- Results recorded before this change carry neither hash, so they are never
-- carried: every existing row stays bound to the version and instructions it
-- was checked under.
--
-- NEVER SILENT. A carried row names its source unit, the version it came
-- from, the basis, and the hashes it was carried under; its run is the source
-- run. An approval lists the carried units of the version it approves
-- (`carried_units`, filled by trigger), and the application marks them on the
-- unit, the approval and the proposal preview.
--
-- FRESH CHECK. The operator may clear any carried unit of the current,
-- unapproved version: the row becomes `failed` (reason
-- `fresh-check-requested`, the carry kept in its result), so the normal check
-- path may queue a new run; a `checked` article returns to `drafting`. An
-- approved version is refused: its results are what was approved.
--
-- WHAT CHANGES.
-- * `nexra_article_check_units`: five nullable carry columns and one
--   consistency constraint. Existing rows keep every value (the new columns
--   are null).
-- * `nexra_article_check_units_guard_update` (replaced): the original rules
--   word for word, plus — carry columns never change, except when a fresh
--   check clears a carried unit (passed → failed, same run, under its flag).
-- * `nexra_article_check_units_check_carry` (new BEFORE INSERT trigger): a
--   carried row is written only by the carry function and names a valid source.
-- * `nexra_article_check_unit_carry`, `nexra_article_check_unit_fresh` (new,
--   security definer, EXECUTE for service_role only).
-- * `nexra_article_approvals.carried_units` (jsonb, default '[]') and a BEFORE
--   INSERT trigger that fills it from the version's units. Existing approvals
--   read '[]': none of them was approved with a carried unit.
-- Nothing else: the record and approve functions, every other table, row and
-- grant are untouched.

alter table public.nexra_article_check_units
  add column carried_from_unit_id uuid
    constraint nexra_article_check_units_carried_from_fkey references public.nexra_article_check_units (id) on delete restrict,
  add column carried_from_version smallint,
  add column carry_basis text
    constraint nexra_article_check_units_carry_basis_valid check (carry_basis in ('no-supported', 'evidence-unchanged')),
  add column carried_instructions_sha256 text
    constraint nexra_article_check_units_carried_instructions_format check (carried_instructions_sha256 ~ '^[0-9a-f]{64}$'),
  add column carried_evidence_sha256 text
    constraint nexra_article_check_units_carried_evidence_format check (carried_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint nexra_article_check_units_carry_consistent check (
    (carried_from_unit_id is null and carried_from_version is null and carry_basis is null
      and carried_instructions_sha256 is null and carried_evidence_sha256 is null)
    or (carried_from_unit_id is not null and carried_from_version is not null and carry_basis is not null
      and carried_instructions_sha256 is not null and status = 'passed'
      and carried_from_version < article_version
      and (carry_basis = 'evidence-unchanged') = (carried_evidence_sha256 is not null))
  );

comment on column public.nexra_article_check_units.carried_from_unit_id is
  'Set only on a result carried from an earlier version''s identical, run-checked unit (F8); null on every checked result.';

create or replace function public.nexra_article_check_units_guard_update()
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
  -- F8: a fresh check clears a carried unit (passed → failed, the same run, the carry columns emptied), only
  -- inside nexra_article_check_unit_fresh.
  if old.carried_from_unit_id is not null
    and old.status = 'passed'
    and new.status = 'failed'
    and new.checked_by_run_id = old.checked_by_run_id
    and new.carried_from_unit_id is null and new.carried_from_version is null and new.carry_basis is null
    and new.carried_instructions_sha256 is null and new.carried_evidence_sha256 is null
    and coalesce(current_setting('nexra.check_unit_fresh', true), '') = 'on'
  then
    return new;
  end if;
  -- F8: otherwise the carry columns never change.
  if new.carried_from_unit_id is distinct from old.carried_from_unit_id
    or new.carried_from_version is distinct from old.carried_from_version
    or new.carry_basis is distinct from old.carry_basis
    or new.carried_instructions_sha256 is distinct from old.carried_instructions_sha256
    or new.carried_evidence_sha256 is distinct from old.carried_evidence_sha256
  then
    raise exception 'nexra_article_check_units: a carried result changes only when a fresh check clears it'
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

-- For every writer: a carried row is written only by the carry function, and names a source that passed on an
-- earlier version of the same article, was checked by its own run, and holds this exact unit and this result.
create function public.nexra_article_check_units_check_carry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.carried_from_unit_id is null then
    return new;
  end if;
  if coalesce(current_setting('nexra.check_unit_carry', true), '') <> 'on' then
    raise exception 'nexra_article_check_units: a carried result is written only by nexra_article_check_unit_carry'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.nexra_article_check_units s
     where s.id = new.carried_from_unit_id
       and s.article_id = new.article_id
       and s.article_version = new.carried_from_version
       and s.article_version < new.article_version
       and s.status = 'passed'
       and s.carried_from_unit_id is null
       and s.unit_sha256 = new.unit_sha256
       and s.unit_key = new.unit_key
       and s.unit_kind = new.unit_kind
       and s.checked_by_run_id = new.checked_by_run_id
       and s.result = new.result
  ) then
    raise exception 'nexra_article_check_units: a carried result must name a passed, run-checked, identical unit of an earlier version'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_article_check_units_check_carry
  before insert on public.nexra_article_check_units
  for each row
  execute function public.nexra_article_check_units_check_carry();

create function public.nexra_article_check_unit_carry(
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
  p_source_unit_id uuid,
  p_instructions_sha256 text,
  p_evidence_sha256 text,
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
  v_source public.nexra_article_check_units;
  v_run public.agent_runs;
  v_blocks jsonb;
  v_block text;
  v_basis text;
  v_row public.nexra_article_check_units;
  v_advanced boolean := false;
begin
  if p_project_id is null or p_article_id is null or p_article_version is null or p_article_version_id is null
    or p_unit_index is null or p_unit_kind is null or p_unit_key is null or p_part is null or p_part_count is null
    or p_unit_count is null or p_unit_sha256 is null or p_source_unit_id is null or p_instructions_sha256 is null
    or p_recorded_by is null
    or p_unit_sha256 !~ '^[0-9a-f]{64}$' or p_instructions_sha256 !~ '^[0-9a-f]{64}$'
    or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$')
  then
    raise exception 'nexra_article_check_unit_carry: every argument except the evidence fingerprint is required, hashes as 64 hex'
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
  -- Only the current version is checked; an earlier one keeps what it had.
  if v_article.current_version <> p_article_version then
    return jsonb_build_object('outcome', 'not-current');
  end if;

  -- The unit's identity, as the record function checks it.
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
  if exists (
    select 1 from public.nexra_article_check_units
     where article_version_id = p_article_version_id and (unit_index = p_unit_index or unit_key = p_unit_key)
  ) then
    return jsonb_build_object('outcome', 'already-recorded');
  end if;

  -- The source: a passed, run-checked, identical unit of an earlier version of this article.
  select * into v_source
    from public.nexra_article_check_units
   where id = p_source_unit_id
     and article_id = p_article_id
     and article_version < p_article_version
     and status = 'passed'
     and carried_from_unit_id is null
     and unit_sha256 = p_unit_sha256
     and unit_key = p_unit_key
     and unit_kind = p_unit_kind;
  if not found then
    return jsonb_build_object('outcome', 'source-not-eligible');
  end if;

  -- Its run recorded the instructions it checked under, and they are the ones checked with now; and either the
  -- result rests on no record, or the evidence it read is the evidence read now.
  select * into v_run
    from public.agent_runs
   where id = v_source.checked_by_run_id
     and project_id = p_project_id
     and agent_id = 'research-evidence'
     and task_type = 'article-check-unit'
     and status = 'completed';
  if not found
    or v_run.result_metadata -> 'evidence' ->> 'instructionsSha256' is distinct from p_instructions_sha256
    or v_run.result_metadata -> 'evidence' ->> 'unitSha256' is distinct from p_unit_sha256
  then
    return jsonb_build_object('outcome', 'source-not-eligible');
  end if;
  if coalesce((v_source.result -> 'counts' ->> 'supported')::integer, -1) = 0 then
    v_basis := 'no-supported';
  elsif p_evidence_sha256 is not null
    and v_run.result_metadata -> 'evidence' ->> 'evidenceSha256' = p_evidence_sha256
  then
    v_basis := 'evidence-unchanged';
  else
    return jsonb_build_object('outcome', 'source-not-eligible');
  end if;

  perform set_config('nexra.check_unit_carry', 'on', true);
  insert into public.nexra_article_check_units
    (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count,
     unit_sha256, status, result, checked_by_run_id, recorded_by,
     carried_from_unit_id, carried_from_version, carry_basis, carried_instructions_sha256, carried_evidence_sha256)
  values
    (p_article_id, p_article_version_id, p_article_version, p_unit_index, p_unit_kind, p_unit_key, p_part, p_part_count, p_unit_count,
     p_unit_sha256, 'passed', v_source.result, v_source.checked_by_run_id, p_recorded_by,
     v_source.id, v_source.article_version, v_basis, p_instructions_sha256,
     case when v_basis = 'evidence-unchanged' then p_evidence_sha256 end)
  returning * into v_row;
  perform set_config('nexra.check_unit_carry', 'off', true);

  -- The parent moves as for a recorded pass: its current version, from drafting, a complete unit set.
  if v_article.status = 'drafting'
    and public.nexra_article_check_version_complete(p_article_version_id, v_version.canonical_content, p_unit_count)
  then
    update public.nexra_articles
       set status = 'checked'
     where id = p_article_id and status = 'drafting' and current_version = p_article_version
    returning * into v_article;
    v_advanced := found;
  end if;

  return jsonb_build_object('outcome', 'carried', 'record', to_jsonb(v_row), 'article', to_jsonb(v_article), 'article_status_advanced', v_advanced);
end;
$$;

comment on function public.nexra_article_check_unit_carry(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, uuid, text, text, uuid) is
  'F8: carries a passed result from an earlier version''s identical, run-checked unit onto the current version''s unit, only under the same instructions and with no supported statement or unchanged evidence; marks it as carried. Never says which condition failed.';

create function public.nexra_article_check_unit_fresh(
  p_project_id text,
  p_article_id uuid,
  p_article_version_id uuid,
  p_unit_index smallint,
  p_recorded_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_unit public.nexra_article_check_units;
  v_row public.nexra_article_check_units;
  v_reverted boolean := false;
begin
  if p_project_id is null or p_article_id is null or p_article_version_id is null or p_unit_index is null or p_recorded_by is null then
    raise exception 'nexra_article_check_unit_fresh: every argument is required'
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

  select * into v_unit
    from public.nexra_article_check_units
   where article_id = p_article_id and article_version_id = p_article_version_id and unit_index = p_unit_index
     for update;
  if not found then
    return jsonb_build_object('outcome', 'unit-not-found');
  end if;
  if v_unit.article_version <> v_article.current_version then
    return jsonb_build_object('outcome', 'not-current');
  end if;
  if v_article.status = 'approved' then
    return jsonb_build_object('outcome', 'approved');
  end if;
  if v_unit.carried_from_unit_id is null or v_unit.status <> 'passed' then
    return jsonb_build_object('outcome', 'not-carried');
  end if;

  perform set_config('nexra.check_unit_fresh', 'on', true);
  update public.nexra_article_check_units
     set status = 'failed',
         result = jsonb_build_object(
           'status', 'failed',
           'reason', 'fresh-check-requested',
           'checkedByRunId', v_unit.checked_by_run_id::text,
           'recordedBy', p_recorded_by::text,
           'recordedAt', to_jsonb(now()),
           'carriedFrom', jsonb_build_object(
             'unitId', v_unit.carried_from_unit_id::text,
             'version', v_unit.carried_from_version,
             'basis', v_unit.carry_basis,
             'instructionsSha256', v_unit.carried_instructions_sha256,
             'evidenceSha256', v_unit.carried_evidence_sha256)),
         recorded_by = p_recorded_by,
         carried_from_unit_id = null,
         carried_from_version = null,
         carry_basis = null,
         carried_instructions_sha256 = null,
         carried_evidence_sha256 = null
   where id = v_unit.id
  returning * into v_row;
  perform set_config('nexra.check_unit_fresh', 'off', true);

  -- A version with a cleared unit is no longer fully checked.
  if v_article.status = 'checked' then
    update public.nexra_articles
       set status = 'drafting'
     where id = p_article_id and status = 'checked'
    returning * into v_article;
    v_reverted := found;
  end if;

  return jsonb_build_object('outcome', 'cleared', 'record', to_jsonb(v_row), 'article', to_jsonb(v_article), 'article_status_reverted', v_reverted);
end;
$$;

comment on function public.nexra_article_check_unit_fresh(text, uuid, uuid, smallint, uuid) is
  'F8: clears a carried result of the current, unapproved version so a fresh run may check the unit; keeps the carry in the failed result; returns a checked article to drafting.';

-- The approval lists the carried units of the version it approves, from the units themselves.
alter table public.nexra_article_approvals
  add column carried_units jsonb not null default '[]'::jsonb
    constraint nexra_article_approvals_carried_units_shape check (jsonb_typeof(carried_units) = 'array' and octet_length(carried_units::text) <= 32768);

comment on column public.nexra_article_approvals.carried_units is
  'F8: the approved version''s carried check results (unit index and key, source version, source unit, run, basis), filled on insert; [] when none was carried.';

create function public.nexra_article_approvals_fill_carried()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.carried_units := coalesce((
    select jsonb_agg(jsonb_build_object(
             'unitIndex', u.unit_index,
             'unitKey', u.unit_key,
             'fromVersion', u.carried_from_version,
             'fromUnitId', u.carried_from_unit_id::text,
             'runId', u.checked_by_run_id::text,
             'basis', u.carry_basis) order by u.unit_index)
      from public.nexra_article_check_units u
     where u.article_version_id = new.article_version_id and u.carried_from_unit_id is not null
  ), '[]'::jsonb);
  return new;
end;
$$;

create trigger nexra_article_approvals_fill_carried
  before insert on public.nexra_article_approvals
  for each row
  execute function public.nexra_article_approvals_fill_carried();

revoke all on function public.nexra_article_check_unit_carry(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, uuid, text, text, uuid) from public;
revoke all on function public.nexra_article_check_unit_fresh(text, uuid, uuid, smallint, uuid) from public;
revoke all on function public.nexra_article_check_units_check_carry() from public;
revoke all on function public.nexra_article_approvals_fill_carried() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nexra_article_check_unit_carry(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, uuid, text, text, uuid) to service_role;
    grant execute on function public.nexra_article_check_unit_fresh(text, uuid, uuid, smallint, uuid) to service_role;
  end if;
end
$$;
