-- Approval records: an operator's decision on one exact external action,
-- recorded before the action and consumed once by it (Phase 6, checkpoint
-- 6.8, decision Q1 of the 6.1 design note).
--
-- WHY. Checkpoint 6.11 (C7c) will make this product's one external write: a
-- pull request publishing one approved article to the website repository.
-- Decision Q1 puts that write behind an approval of its own, recorded in a
-- reusable table and consumed by the write — C7 only; the run-claim gate
-- (`agent_run_claim`) is unchanged, and no agent task becomes
-- approval-required. Nothing here performs, queues or calls anything: it
-- records a decision and, later, its single use. There is no consumer yet;
-- C7 (6.11) will be the first.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000.
--
-- ONE TABLE, new: `nexra_approvals`. Each row binds one decision to one
-- exact action: the project, the action kind (one value today,
-- `article-publication`; a later kind is a later migration), the target's
-- id and the SHA-256 of the exact payload the action will carry; the
-- decision (`approve` or `refuse`), who decided and when; when it expires
-- (at most 24 hours after the decision, at least one minute); and, for an
-- approval, when and by whom it was used. A row is written once and changes
-- once at most: `used_at` and `used_by` go from null to set, together,
-- inside the consume function and nowhere else. Nothing is ever deleted or
-- truncated. A refusal is never used.
--
-- FAIL-CLOSED CONSUMPTION. `nexra_approval_consume` takes the approval's id
-- beside the exact action the caller is about to perform, locks the row and
-- answers, in this order, without writing: `approval-not-found` (unknown, or
-- another project's — never which); `refused` (the decision is a refusal);
-- `action-mismatch` (another kind or another target); `digest-mismatch`
-- (the payload the caller holds is not the one approved); `used`; `expired`
-- (at or after `expires_at`); `superseded` (a later decision on the same
-- action, of either kind, was recorded — the newest decision wins, and a
-- later refusal revokes an earlier approval; decisions are stamped with the
-- wall clock, not the transaction's start, so two recorded in one
-- transaction are still ordered). Only then does it stamp
-- `used_at` and `used_by` and answer `consumed`. The row lock serialises two
-- consumers of one approval: the second answers `used`.
--
-- RECORDING. `nexra_approval_record` takes the project, kind, target,
-- digest, decision, operator and a lifetime in minutes (1–1440), and answers
-- `recorded` with the row, or `project-not-found`. Every malformed argument
-- raises invalid_parameter_value and writes nothing. Recording an approval
-- does not consume one and performs nothing.
--
-- ACCESS. Row level security on, no policies. service_role is granted
-- SELECT on the table and EXECUTE on the two functions, nothing else; no
-- INSERT, UPDATE or DELETE grant exists for any API role. The guard
-- functions are executable by no API role. The harness's whole-database
-- security definer inventory (c5) names the two functions.

create table public.nexra_approvals (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_approvals_project_fkey references public.projects (id) on delete restrict,

  -- The one exact action this decision is about.
  action_kind text not null
    constraint nexra_approvals_action_kind_valid check (action_kind in ('article-publication')),
  target_id uuid not null,
  payload_sha256 text not null
    constraint nexra_approvals_payload_sha256_format check (payload_sha256 ~ '^[0-9a-f]{64}$'),

  decision text not null
    constraint nexra_approvals_decision_valid check (decision in ('approve', 'refuse')),
  -- The Supabase Auth user id of the operator who decided. No foreign key, as on the other approvals.
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint nexra_approvals_expiry_range
    check (expires_at >= decided_at + interval '1 minute' and expires_at <= decided_at + interval '24 hours'),

  used_at timestamptz,
  used_by uuid,
  constraint nexra_approvals_used_together check ((used_at is null) = (used_by is null)),
  constraint nexra_approvals_only_approvals_used check (used_at is null or decision = 'approve'),
  constraint nexra_approvals_used_in_time check (used_at is null or (used_at >= decided_at and used_at < expires_at))
);

create index nexra_approvals_action_idx on public.nexra_approvals (project_id, action_kind, target_id, decided_at desc);

comment on table public.nexra_approvals is
  'One operator decision (approve or refuse) on one exact external action — project, kind, target and payload digest — with its expiry and, for an approval, its single use. Written by nexra_approval_record, used only by nexra_approval_consume; never deleted.';

alter table public.nexra_approvals enable row level security;

-- ---------------------------------------------------------------------------
-- Guards, for every writer.

-- A row is born unused.
create function public.nexra_approvals_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.used_at is not null or new.used_by is not null then
    raise exception 'nexra_approvals: a decision is recorded unused'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_approvals_check_insert
  before insert on public.nexra_approvals
  for each row
  execute function public.nexra_approvals_check_insert();

-- The one change: used_at and used_by, from null, inside the consume function.
create function public.nexra_approvals_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.action_kind is distinct from old.action_kind
    or new.target_id is distinct from old.target_id
    or new.payload_sha256 is distinct from old.payload_sha256
    or new.decision is distinct from old.decision
    or new.decided_by is distinct from old.decided_by
    or new.decided_at is distinct from old.decided_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'nexra_approvals: a decision never changes'
      using errcode = 'check_violation';
  end if;
  if old.used_at is not null then
    raise exception 'nexra_approvals: an approval is used once'
      using errcode = 'check_violation';
  end if;
  if coalesce(pg_catalog.current_setting('nexra.approval_consume', true), '') <> old.id::text then
    raise exception 'nexra_approvals: an approval is used only through nexra_approval_consume'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_approvals_guard_update
  before update on public.nexra_approvals
  for each row
  execute function public.nexra_approvals_guard_update();

create function public.nexra_approvals_guard_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_approvals: a decision is permanent history and is never removed'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_approvals_guard_delete
  before delete on public.nexra_approvals
  for each row
  execute function public.nexra_approvals_guard_remove();

create trigger nexra_approvals_guard_truncate
  before truncate on public.nexra_approvals
  for each statement
  execute function public.nexra_approvals_guard_remove();

-- ---------------------------------------------------------------------------
-- Recording one decision.

create function public.nexra_approval_record(
  p_project_id text,
  p_action_kind text,
  p_target_id uuid,
  p_payload_sha256 text,
  p_decision text,
  p_operator uuid,
  p_ttl_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.nexra_approvals;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_project_id is null or p_action_kind is null or p_target_id is null or p_payload_sha256 is null
    or p_decision is null or p_operator is null or p_ttl_minutes is null then
    raise exception 'nexra_approval_record: project, kind, target, digest, decision, operator and lifetime are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_action_kind not in ('article-publication') then
    raise exception 'nexra_approval_record: unknown action kind'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'nexra_approval_record: the payload digest must be a lowercase SHA-256'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_decision not in ('approve', 'refuse') then
    raise exception 'nexra_approval_record: the decision is approve or refuse'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_ttl_minutes < 1 or p_ttl_minutes > 1440 then
    raise exception 'nexra_approval_record: the lifetime is 1 to 1440 minutes'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;

  insert into public.nexra_approvals (project_id, action_kind, target_id, payload_sha256, decision, decided_by, decided_at, expires_at)
  values (p_project_id, p_action_kind, p_target_id, p_payload_sha256, p_decision, p_operator, v_now,
          v_now + pg_catalog.make_interval(mins => p_ttl_minutes))
  returning * into v_row;

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'approval', pg_catalog.to_jsonb(v_row));
end;
$$;

comment on function public.nexra_approval_record(text, text, uuid, text, text, uuid, integer) is
  'Records one operator decision (approve or refuse) on one exact action, expiring after 1 to 1440 minutes: recorded or project-not-found. Performs nothing.';

-- ---------------------------------------------------------------------------
-- Consuming one approval, once, for the exact action it names.

create function public.nexra_approval_consume(
  p_project_id text,
  p_approval_id uuid,
  p_action_kind text,
  p_target_id uuid,
  p_payload_sha256 text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.nexra_approvals;
begin
  if p_project_id is null or p_approval_id is null or p_action_kind is null or p_target_id is null
    or p_payload_sha256 is null or p_operator is null then
    raise exception 'nexra_approval_consume: project, approval, kind, target, digest and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.nexra_approvals where id = p_approval_id and project_id = p_project_id for update;
  if v_row.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'approval-not-found');
  end if;
  if v_row.decision <> 'approve' then
    return pg_catalog.jsonb_build_object('outcome', 'refused');
  end if;
  if v_row.action_kind <> p_action_kind or v_row.target_id <> p_target_id then
    return pg_catalog.jsonb_build_object('outcome', 'action-mismatch');
  end if;
  if v_row.payload_sha256 <> p_payload_sha256 then
    return pg_catalog.jsonb_build_object('outcome', 'digest-mismatch');
  end if;
  if v_row.used_at is not null then
    return pg_catalog.jsonb_build_object('outcome', 'used');
  end if;
  if pg_catalog.clock_timestamp() >= v_row.expires_at then
    return pg_catalog.jsonb_build_object('outcome', 'expired');
  end if;
  if exists (
    select 1 from public.nexra_approvals n
     where n.project_id = v_row.project_id
       and n.action_kind = v_row.action_kind
       and n.target_id = v_row.target_id
       and n.id <> v_row.id
       and (n.decided_at, n.id) > (v_row.decided_at, v_row.id)
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'superseded');
  end if;

  perform pg_catalog.set_config('nexra.approval_consume', v_row.id::text, true);
  update public.nexra_approvals
     set used_at = pg_catalog.clock_timestamp(), used_by = p_operator
   where id = v_row.id
  returning * into v_row;
  perform pg_catalog.set_config('nexra.approval_consume', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'consumed', 'approval', pg_catalog.to_jsonb(v_row));
end;
$$;

comment on function public.nexra_approval_consume(text, uuid, text, uuid, text, uuid) is
  'Uses one approval once for the exact action it names: consumed, or approval-not-found, refused, action-mismatch, digest-mismatch, used, expired or superseded, writing nothing. Performs nothing itself.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the two functions.

revoke all on table public.nexra_approvals from public;
revoke all on function public.nexra_approval_record(text, text, uuid, text, text, uuid, integer) from public;
revoke all on function public.nexra_approval_consume(text, uuid, text, uuid, text, uuid) from public;
revoke all on function public.nexra_approvals_check_insert() from public;
revoke all on function public.nexra_approvals_guard_update() from public;
revoke all on function public.nexra_approvals_guard_remove() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_approvals from %I', v_role);
      execute format('revoke all on function public.nexra_approval_record(text, text, uuid, text, text, uuid, integer) from %I', v_role);
      execute format('revoke all on function public.nexra_approval_consume(text, uuid, text, uuid, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_approvals_check_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_approvals_guard_update() from %I', v_role);
      execute format('revoke all on function public.nexra_approvals_guard_remove() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_approvals to service_role;
    grant execute on function public.nexra_approval_record(text, text, uuid, text, text, uuid, integer) to service_role;
    grant execute on function public.nexra_approval_consume(text, uuid, text, uuid, text, uuid) to service_role;
  end if;
end
$$;
