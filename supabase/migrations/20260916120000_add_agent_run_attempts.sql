-- Agent run attempts, execution leases, and stale-run recovery.
--
-- Backend Phase 6, Part 2. Part 1 ran an attempt inside one HTTP request and
-- trusted that request to record how it ended. If the process died first, the
-- run stayed `running` for ever. This migration makes an attempt something the
-- database can see, time out, and close on its own:
--
--   * `agent_run_attempts` keeps one row per attempt: which attempt, what ran
--     it, when it started, when it last proved it was alive, and how it ended.
--     `agent_runs` stays the canonical current state; an attempt row is its
--     history, and never holds the task input or the result summary.
--   * Every attempt holds a lease: a random token and an expiry. The worker
--     renews the lease with heartbeats while it works. Only the holder of the
--     token for the run's current, still-running, unexpired attempt can renew
--     it or record the outcome, so a duplicate or stale worker can never
--     overwrite newer state.
--   * An attempt whose lease has expired — the process crashed, the request was
--     killed, the server restarted — is closed by `agent_run_recover_expired`,
--     which fails the run with the fixed code `lease-expired`. Recovery never
--     marks a run completed and never re-queues it; a retry is still an
--     explicit request, within `max_attempts`.
--
-- Starting, heartbeating, finishing, and recovering are Postgres functions, so
-- each is one transaction and the lease is judged by the database clock, not
-- by whichever server's clock asked. The functions are `security definer` and
-- executable by `service_role` only; `service_role` cannot write attempt rows
-- directly, and the `agent_runs` guard now refuses to start or finish a run
-- except through them. Cancelling and retrying are unchanged.
--
-- Lock order, everywhere: the run row, then its attempt row. Heartbeats touch
-- only the attempt row. That order keeps cancel, finish, and recovery from
-- deadlocking each other.

-- Part 1 runs that are running have no attempt row, and could never be
-- finished or recovered under the new rules. Refuse rather than strand them.
do $$
begin
  if exists (select 1 from public.agent_runs where status = 'running') then
    raise exception 'agent_run_attempts: cancel or finish every running agent run before applying this migration';
  end if;
end
$$;

create table public.agent_run_attempts (
  id uuid primary key default gen_random_uuid(),

  -- An attempt is part of its run's record: deleting a run (maintenance only)
  -- takes its history with it.
  run_id uuid not null
    constraint agent_run_attempts_run_fkey references public.agent_runs (id) on delete cascade,

  -- Mirrors agent_runs.attempt_count at the moment the attempt started, so
  -- numbering is 1, 2, 3 … with no gaps or repeats (unique below).
  attempt_number integer not null
    constraint agent_run_attempts_number_range check (attempt_number between 1 and 5),

  executor text not null
    constraint agent_run_attempts_executor_valid check (executor in ('mock')),

  -- A label the worker process chose for itself, for diagnosing which process
  -- held an attempt. Not an identity and not a credential.
  worker_id text not null
    constraint agent_run_attempts_worker_id_format check (worker_id ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'),

  -- The lease. Only the worker that started the attempt knows the token; the
  -- application never returns it from an endpoint.
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null,

  outcome text not null default 'running'
    constraint agent_run_attempts_outcome_valid
      check (outcome in ('running', 'completed', 'failed', 'cancelled')),

  -- Screened executor metadata for a completed attempt; the same bound as
  -- agent_runs.result_metadata.
  result_metadata jsonb
    constraint agent_run_attempts_result_metadata_bounded
      check (jsonb_typeof(result_metadata) = 'object' and octet_length(result_metadata::text) <= 16384),

  error_code text
    constraint agent_run_attempts_error_code_format
      check (error_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(error_code) <= 64),
  error_message text
    constraint agent_run_attempts_error_message_length check (char_length(error_message) between 1 and 500),

  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agent_run_attempts_number_unique unique (run_id, attempt_number),
  constraint agent_run_attempts_error_pair check ((error_code is null) = (error_message is null)),
  constraint agent_run_attempts_times_ordered
    check (heartbeat_at >= started_at and lease_expires_at > started_at
      and (finished_at is null or finished_at >= started_at)),

  constraint agent_run_attempts_state_consistent check (
    case outcome
      when 'running' then
        finished_at is null and error_code is null and result_metadata is null
      when 'completed' then
        finished_at is not null and error_code is null
      when 'failed' then
        finished_at is not null and error_code is not null and result_metadata is null
      when 'cancelled' then
        finished_at is not null and error_code is null and result_metadata is null
      else false
    end
  )
);

comment on table public.agent_run_attempts is
  'One execution attempt of an agent run: its lease, heartbeats, and outcome. No task input, result text, or credentials.';
comment on column public.agent_run_attempts.lease_token is
  'Known only to the worker that started the attempt. Never returned by the application.';
comment on column public.agent_run_attempts.lease_expires_at is
  'The attempt is abandoned once this passes without a heartbeat; agent_run_recover_expired then fails it.';

-- One attempt at a time per run.
create unique index agent_run_attempts_one_running
  on public.agent_run_attempts (run_id)
  where outcome = 'running';

-- What recovery scans: running attempts by lease expiry.
create index agent_run_attempts_expiring
  on public.agent_run_attempts (lease_expires_at)
  where outcome = 'running';

-- Attempt rows, for every writer. Only the functions below write them, but the
-- rules hold even for a writer that skips those functions.
create function public.agent_run_attempts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run public.agent_runs;
begin
  if tg_op = 'INSERT' then
    select * into v_run from public.agent_runs where id = new.run_id;
    if not found
      or v_run.status <> 'running'
      or v_run.attempt_count <> new.attempt_number
      or v_run.executor is distinct from new.executor
      or new.outcome <> 'running'
    then
      raise exception 'agent_run_attempts: an attempt starts with its run, as the run''s current attempt'
        using errcode = 'check_violation';
    end if;
    new.started_at := now();
    new.heartbeat_at := now();
    new.created_at := now();
    new.updated_at := now();
    if new.lease_expires_at <= now() then
      raise exception 'agent_run_attempts: a lease must expire in the future'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.run_id is distinct from old.run_id
    or new.attempt_number is distinct from old.attempt_number
    or new.executor is distinct from old.executor
    or new.worker_id is distinct from old.worker_id
    or new.lease_token is distinct from old.lease_token
    or new.started_at is distinct from old.started_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'agent_run_attempts: an attempt''s identity cannot be changed'
      using errcode = 'check_violation';
  end if;

  if old.outcome <> 'running' then
    raise exception 'agent_run_attempts: a finished attempt cannot be changed'
      using errcode = 'check_violation';
  end if;

  if new.outcome = 'running' then
    -- A heartbeat: time only moves forward.
    if new.heartbeat_at < old.heartbeat_at or new.lease_expires_at < old.lease_expires_at then
      raise exception 'agent_run_attempts: a heartbeat cannot move a lease backwards'
        using errcode = 'check_violation';
    end if;
  elsif new.outcome in ('completed', 'failed') then
    if coalesce(current_setting('nexra.agent_run_finish', true), '') <> new.run_id::text then
      raise exception 'agent_run_attempts: an attempt finishes only through agent_run_finish or recovery'
        using errcode = 'check_violation';
    end if;
  elsif not exists (
    select 1 from public.agent_runs where id = new.run_id and status = 'cancelled'
  ) then
    raise exception 'agent_run_attempts: an attempt is cancelled only with its run'
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger agent_run_attempts_guard
  before insert or update on public.agent_run_attempts
  for each row
  execute function public.agent_run_attempts_guard();

-- The run lifecycle guard from Part 1, with two additions: a run moves to
-- `running` only inside agent_run_claim, and moves from `running` to
-- `completed` or `failed` only inside agent_run_finish or recovery. Each of
-- those sets a transaction-local marker naming the run just before it writes;
-- no other path sets it. Everything else is unchanged.
create or replace function public.agent_runs_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.agent_id is distinct from old.agent_id
    or new.task_type is distinct from old.task_type
    or new.input is distinct from old.input
    or new.input_hash is distinct from old.input_hash
    or new.source is distinct from old.source
    or new.max_attempts is distinct from old.max_attempts
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'agent_runs: a run''s request cannot be changed after it is created'
      using errcode = 'check_violation';
  end if;

  if old.status in ('completed', 'cancelled')
    or (old.status = 'failed' and new.status <> 'queued')
    or (old.status = new.status)
    or not (
      (old.status = 'queued' and new.status in ('running', 'cancelled'))
      or (old.status = 'running' and new.status in ('completed', 'failed', 'cancelled'))
      or (old.status = 'failed' and new.status = 'queued')
    )
  then
    raise exception 'agent_runs: % → % is not a valid transition', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'running'
    and coalesce(current_setting('nexra.agent_run_claim', true), '') <> new.id::text
  then
    raise exception 'agent_runs: a run starts only through agent_run_claim'
      using errcode = 'check_violation';
  end if;
  if old.status = 'running' and new.status in ('completed', 'failed')
    and coalesce(current_setting('nexra.agent_run_finish', true), '') <> new.id::text
  then
    raise exception 'agent_runs: a running run finishes only through its current attempt'
      using errcode = 'check_violation';
  end if;

  if new.status = 'running' and new.attempt_count <> old.attempt_count + 1 then
    raise exception 'agent_runs: starting a run must count one attempt'
      using errcode = 'check_violation';
  end if;
  if new.status <> 'running' and new.attempt_count <> old.attempt_count then
    raise exception 'agent_runs: attempts are counted only when a run starts'
      using errcode = 'check_violation';
  end if;
  if old.status = 'failed' and old.attempt_count >= old.max_attempts then
    raise exception 'agent_runs: no attempts remain for this run'
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Cancelling a running run (an ordinary update, as in Part 1) closes its
-- attempt in the same statement. The worker's next heartbeat is then refused,
-- which is how it learns to stop.
create function public.agent_runs_close_cancelled_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agent_run_attempts
     set outcome = 'cancelled', finished_at = now()
   where run_id = new.id and outcome = 'running';
  return null;
end;
$$;

create trigger agent_runs_close_cancelled_attempt
  after update of status on public.agent_runs
  for each row
  when (old.status = 'running' and new.status = 'cancelled')
  execute function public.agent_runs_close_cancelled_attempt();

-- Starts the next attempt of a queued run and hands back its lease.
--
-- With a run id, claims that run, waiting for any concurrent writer so exactly
-- one claim wins. With null, claims the oldest queued run that no other worker
-- is claiming (skip locked), which is what a queue worker calls.
--
-- Returns { outcome: 'claimed', run, attempt } — `attempt` includes the lease
-- token — or { outcome: 'empty' | 'not-found' } or
-- { outcome: 'not-queued' | 'exhausted', run }.
create function public.agent_run_claim(
  p_run_id uuid,
  p_executor text,
  p_worker_id text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_runs;
  v_attempt public.agent_run_attempts;
begin
  if p_lease_seconds is null or p_lease_seconds not between 1 and 900 then
    raise exception 'agent_run_claim: the lease must be 1 to 900 seconds'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_run_id is null then
    select * into v_run
      from public.agent_runs
     where status = 'queued' and attempt_count < max_attempts
     order by created_at, id
     limit 1
       for update skip locked;
    if not found then
      return jsonb_build_object('outcome', 'empty');
    end if;
  else
    select * into v_run from public.agent_runs where id = p_run_id for update;
    if not found then
      return jsonb_build_object('outcome', 'not-found');
    end if;
    if v_run.status <> 'queued' then
      return jsonb_build_object('outcome', 'not-queued', 'run', to_jsonb(v_run) - 'input_hash');
    end if;
    if v_run.attempt_count >= v_run.max_attempts then
      return jsonb_build_object('outcome', 'exhausted', 'run', to_jsonb(v_run) - 'input_hash');
    end if;
  end if;

  perform set_config('nexra.agent_run_claim', v_run.id::text, true);
  update public.agent_runs
     set status = 'running',
         executor = p_executor,
         attempt_count = attempt_count + 1,
         started_at = now(),
         finished_at = null
   where id = v_run.id
  returning * into v_run;
  perform set_config('nexra.agent_run_claim', '', true);

  insert into public.agent_run_attempts (run_id, attempt_number, executor, worker_id, lease_expires_at)
  values (v_run.id, v_run.attempt_count, p_executor, p_worker_id, now() + make_interval(secs => p_lease_seconds))
  returning * into v_attempt;

  return jsonb_build_object(
    'outcome', 'claimed',
    'run', to_jsonb(v_run) - 'input_hash',
    'attempt', to_jsonb(v_attempt)
  );
end;
$$;

-- Renews a lease. Refused — { outcome: 'lost' } — unless the token matches, the
-- attempt is still running, and its lease has not already expired: a worker
-- that let its lease lapse has lost the attempt, even before recovery runs.
create function public.agent_run_heartbeat(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds not between 1 and 900 then
    raise exception 'agent_run_heartbeat: the lease must be 1 to 900 seconds'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.agent_run_attempts
     set heartbeat_at = now(),
         lease_expires_at = greatest(lease_expires_at, now() + make_interval(secs => p_lease_seconds))
   where id = p_attempt_id
     and lease_token = p_lease_token
     and outcome = 'running'
     and lease_expires_at > now()
  returning lease_expires_at into v_expires;

  if not found then
    return jsonb_build_object('outcome', 'lost');
  end if;
  return jsonb_build_object('outcome', 'renewed', 'lease_expires_at', v_expires);
end;
$$;

-- Records how an attempt ended, on the attempt and on its run, together.
-- Accepted only from the lease holder of the run's current attempt while the
-- lease is live; otherwise nothing changes and the run as it now stands comes
-- back with { outcome: 'lost' }.
create function public.agent_run_finish(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_result_summary text,
  p_result_metadata jsonb,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_run public.agent_runs;
  v_attempt public.agent_run_attempts;
begin
  if p_outcome is null or p_outcome not in ('completed', 'failed') then
    raise exception 'agent_run_finish: the outcome must be completed or failed'
      using errcode = 'invalid_parameter_value';
  end if;

  select run_id into v_run_id from public.agent_run_attempts where id = p_attempt_id;
  if not found then
    return jsonb_build_object('outcome', 'lost');
  end if;

  select * into v_run from public.agent_runs where id = v_run_id for update;
  select * into v_attempt from public.agent_run_attempts where id = p_attempt_id for update;

  if v_attempt.lease_token is distinct from p_lease_token
    or v_attempt.outcome <> 'running'
    or v_attempt.lease_expires_at <= now()
    or v_run.status <> 'running'
    or v_run.attempt_count <> v_attempt.attempt_number
  then
    return jsonb_build_object('outcome', 'lost', 'run', to_jsonb(v_run) - 'input_hash');
  end if;

  perform set_config('nexra.agent_run_finish', v_run.id::text, true);

  update public.agent_run_attempts
     set outcome = p_outcome,
         finished_at = now(),
         result_metadata = case when p_outcome = 'completed' then p_result_metadata end,
         error_code = case when p_outcome = 'failed' then p_error_code end,
         error_message = case when p_outcome = 'failed' then p_error_message end
   where id = v_attempt.id;

  update public.agent_runs
     set status = p_outcome,
         finished_at = now(),
         result_summary = case when p_outcome = 'completed' then p_result_summary end,
         result_metadata = case when p_outcome = 'completed' then p_result_metadata end,
         error_code = case when p_outcome = 'failed' then p_error_code end,
         error_message = case when p_outcome = 'failed' then p_error_message end
   where id = v_run.id
  returning * into v_run;

  perform set_config('nexra.agent_run_finish', '', true);

  return jsonb_build_object('outcome', 'finished', 'run', to_jsonb(v_run) - 'input_hash');
end;
$$;

-- Closes up to p_limit attempts whose lease has expired, failing each attempt
-- and its run with `lease-expired`. Idempotent: an attempt it has closed is no
-- longer running, so a second call finds nothing. A run another transaction
-- holds (a cancel, a finish) is skipped and left for the next call.
--
-- Returns { recovered: [{ run_id, attempt_number }] }.
create function public.agent_run_recover_expired(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_code constant text := 'lease-expired';
  -- Mirrors AGENT_RUN_ERROR_MESSAGES['lease-expired'] in src/lib/agent-runs/lifecycle.ts.
  c_message constant text := 'The attempt stopped reporting progress before it finished, so it was abandoned.';
  v_candidate record;
  v_run public.agent_runs;
  v_attempt public.agent_run_attempts;
  v_recovered jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'agent_run_recover_expired: the limit must be 1 to 100'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_candidate in
    select id, run_id
      from public.agent_run_attempts
     where outcome = 'running' and lease_expires_at <= now()
     order by lease_expires_at, id
     limit p_limit
  loop
    select * into v_run from public.agent_runs where id = v_candidate.run_id for update skip locked;
    continue when not found;

    select * into v_attempt from public.agent_run_attempts where id = v_candidate.id for update;
    -- A heartbeat or a finish may have landed since the scan.
    continue when v_attempt.outcome <> 'running' or v_attempt.lease_expires_at > now();

    perform set_config('nexra.agent_run_finish', v_run.id::text, true);

    update public.agent_run_attempts
       set outcome = 'failed', finished_at = now(), error_code = c_code, error_message = c_message
     where id = v_attempt.id;

    if v_run.status = 'running' then
      update public.agent_runs
         set status = 'failed', finished_at = now(), error_code = c_code, error_message = c_message
       where id = v_run.id;
    end if;

    perform set_config('nexra.agent_run_finish', '', true);

    v_recovered := v_recovered || jsonb_build_array(
      jsonb_build_object('run_id', v_run.id, 'attempt_number', v_attempt.attempt_number)
    );
  end loop;

  return jsonb_build_object('recovered', v_recovered);
end;
$$;

-- Access. Attempt rows are readable by the server; nothing but the functions
-- above writes them. Delete is for maintenance, like agent_runs. The functions
-- are callable by service_role only: Postgres grants EXECUTE to PUBLIC by
-- default, and Supabase's default privileges grant it to anon and
-- authenticated, so all three are revoked explicitly.
alter table public.agent_run_attempts enable row level security;

revoke all on function public.agent_run_claim(uuid, text, text, integer) from public;
revoke all on function public.agent_run_heartbeat(uuid, uuid, integer) from public;
revoke all on function public.agent_run_finish(uuid, uuid, text, text, jsonb, text, text) from public;
revoke all on function public.agent_run_recover_expired(integer) from public;
revoke all on function public.agent_run_attempts_guard() from public;
revoke all on function public.agent_runs_close_cancelled_attempt() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.agent_run_attempts from %I', v_role);
      execute format('revoke all on function public.agent_run_claim(uuid, text, text, integer) from %I', v_role);
      execute format('revoke all on function public.agent_run_heartbeat(uuid, uuid, integer) from %I', v_role);
      execute format('revoke all on function public.agent_run_finish(uuid, uuid, text, text, jsonb, text, text) from %I', v_role);
      execute format('revoke all on function public.agent_run_recover_expired(integer) from %I', v_role);
      execute format('revoke all on function public.agent_run_attempts_guard() from %I', v_role);
      execute format('revoke all on function public.agent_runs_close_cancelled_attempt() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.agent_run_attempts from service_role;
    grant select, delete on table public.agent_run_attempts to service_role;
    grant execute on function public.agent_run_claim(uuid, text, text, integer) to service_role;
    grant execute on function public.agent_run_heartbeat(uuid, uuid, integer) to service_role;
    grant execute on function public.agent_run_finish(uuid, uuid, text, text, jsonb, text, text) to service_role;
    grant execute on function public.agent_run_recover_expired(integer) to service_role;
  end if;
end
$$;
