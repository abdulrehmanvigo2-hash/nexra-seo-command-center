-- Production agent runtime: automatic retries with backoff, shared rate
-- limits, runtime status, and the `ai` executor.
--
-- Backend Phase 6, Part 3. Additive on top of
-- 20260914120000_create_agent_runs.sql and
-- 20260916120000_add_agent_run_attempts.sql:
--
--   * `executor` may now be `ai` as well as `mock`, on runs and attempts.
--   * Automatic retry. `agent_run_schedule_retries` puts failed runs back in
--     the queue when — and only when — their failure code is on a fixed
--     retryable list and attempts remain, with exponential backoff recorded in
--     `next_attempt_at`. Terminal failures (a rejected output, a missing
--     project, a provider refusal, a missing provider configuration, a policy
--     block) are never retried automatically. `auto_retry_count` counts these
--     requeues, and cannot exceed `max_attempts - 1`, so there is no loop.
--   * The queue claim (`agent_run_claim` with no run id) skips runs whose
--     backoff has not elapsed. Claiming a named run — an operator's explicit
--     request — does not wait.
--   * Shared rate limits. `rate_limit_consume` counts hits per key in fixed
--     windows in one table, so every application instance draws on the same
--     allowance. Nothing but the function writes the table.
--   * `agent_runtime_status` returns queue and lease counts for diagnostics.
--
-- As before, every function is `security definer`, executable by
-- `service_role` only.

-- ---------------------------------------------------------------------------
-- Executors

alter table public.agent_runs drop constraint agent_runs_executor_valid;
alter table public.agent_runs
  add constraint agent_runs_executor_valid check (executor in ('mock', 'ai'));

alter table public.agent_run_attempts drop constraint agent_run_attempts_executor_valid;
alter table public.agent_run_attempts
  add constraint agent_run_attempts_executor_valid check (executor in ('mock', 'ai'));

comment on column public.agent_runs.executor is
  'What ran the task. "mock" results are simulated and carry no analysis; "ai" results are model-generated.';

-- ---------------------------------------------------------------------------
-- Retry scheduling

alter table public.agent_runs
  add column next_attempt_at timestamptz,
  add column auto_retry_count integer not null default 0;

alter table public.agent_runs
  add constraint agent_runs_next_attempt_only_queued
    check (next_attempt_at is null or status = 'queued'),
  add constraint agent_runs_auto_retry_count_range
    check (auto_retry_count >= 0 and auto_retry_count < max_attempts);

comment on column public.agent_runs.next_attempt_at is
  'Set when a run was re-queued automatically: the queue does not claim it before this instant.';
comment on column public.agent_runs.auto_retry_count is
  'How many times agent_run_schedule_retries re-queued this run.';

-- What the queue claim scans: queued runs, in due order.
create index agent_runs_queue_due
  on public.agent_runs ((coalesce(next_attempt_at, created_at)), id)
  where status = 'queued';

-- What the retry sweep scans.
create index agent_runs_failed_recent
  on public.agent_runs (finished_at, id)
  where status = 'failed';

-- The Part 2 guard, with two additions: `next_attempt_at` is cleared whenever
-- a run leaves the queue, and `auto_retry_count` moves only by one, only on a
-- failed → queued requeue made inside agent_run_schedule_retries.
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

  if new.auto_retry_count <> old.auto_retry_count
    and not (
      old.status = 'failed' and new.status = 'queued'
      and new.auto_retry_count = old.auto_retry_count + 1
      and coalesce(current_setting('nexra.agent_run_auto_retry', true), '') = new.id::text
    )
  then
    raise exception 'agent_runs: automatic retries are counted only by agent_run_schedule_retries'
      using errcode = 'check_violation';
  end if;

  if new.status <> 'queued' then
    new.next_attempt_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- The Part 2 claim, unchanged except that the queue form skips runs whose
-- backoff has not elapsed and takes runs in due order.
create or replace function public.agent_run_claim(
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
     where status = 'queued'
       and attempt_count < max_attempts
       and coalesce(next_attempt_at, created_at) <= now()
     order by coalesce(next_attempt_at, created_at), id
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

-- Re-queues up to p_limit failed runs whose failure is retryable and which
-- have attempts left, each after a backoff of 2, 4, 8 … minutes (capped at 30)
-- by the number of attempts already made. The retryable codes mirror
-- RETRYABLE_ERROR_CODES in src/lib/agent-runs/retry-policy.ts; every other
-- code is terminal. A run whose identical request is already queued or running
-- is left failed. Idempotent: a re-queued run is no longer failed.
--
-- Returns { scheduled: [{ run_id, attempt_count, error_code, next_attempt_at }] }.
create function public.agent_run_schedule_retries(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_retryable constant text[] := array['timeout', 'execution-failed', 'lease-expired', 'provider-unavailable'];
  c_base_seconds constant integer := 120;
  c_max_seconds constant integer := 1800;
  v_run public.agent_runs;
  v_due timestamptz;
  v_scheduled jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'agent_run_schedule_retries: the limit must be 1 to 100'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_run in
    select *
      from public.agent_runs
     where status = 'failed'
       and error_code = any (c_retryable)
       and attempt_count < max_attempts
       and auto_retry_count < max_attempts - 1
     order by finished_at, id
     limit p_limit
       for update skip locked
  loop
    v_due := now() + make_interval(
      secs => least(c_max_seconds, c_base_seconds * power(2, greatest(v_run.attempt_count, 1) - 1))
    );
    begin
      perform set_config('nexra.agent_run_auto_retry', v_run.id::text, true);
      update public.agent_runs
         set status = 'queued',
             started_at = null,
             finished_at = null,
             next_attempt_at = v_due,
             auto_retry_count = auto_retry_count + 1
       where id = v_run.id;
      perform set_config('nexra.agent_run_auto_retry', '', true);

      v_scheduled := v_scheduled || jsonb_build_array(jsonb_build_object(
        'run_id', v_run.id,
        'attempt_count', v_run.attempt_count,
        'error_code', v_run.error_code,
        'next_attempt_at', v_due
      ));
    exception when unique_violation then
      -- An identical request is already queued or running: leave this one failed.
      null;
    end;
  end loop;

  return jsonb_build_object('scheduled', v_scheduled);
end;
$$;

-- Queue and lease counts, for status diagnostics. No row contents.
create function public.agent_runtime_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'queued_due', (select count(*) from public.agent_runs
                    where status = 'queued' and coalesce(next_attempt_at, created_at) <= now()),
    'queued_waiting', (select count(*) from public.agent_runs
                        where status = 'queued' and coalesce(next_attempt_at, created_at) > now()),
    'running', (select count(*) from public.agent_runs where status = 'running'),
    'expired_leases', (select count(*) from public.agent_run_attempts
                        where outcome = 'running' and lease_expires_at <= now()),
    'failed', (select count(*) from public.agent_runs where status = 'failed'),
    'oldest_due_queued_at', (select min(coalesce(next_attempt_at, created_at)) from public.agent_runs
                              where status = 'queued' and coalesce(next_attempt_at, created_at) <= now()),
    'checked_at', now()
  );
$$;

-- ---------------------------------------------------------------------------
-- Shared rate limits

create table public.rate_limit_windows (
  key text not null
    constraint rate_limit_windows_key_format
      check (char_length(key) between 1 and 200 and key ~ '^[a-z0-9][a-z0-9:._-]*$'),
  window_start timestamptz not null,
  hits integer not null constraint rate_limit_windows_hits_positive check (hits >= 1),
  primary key (key, window_start)
);

comment on table public.rate_limit_windows is
  'Hit counts per key per fixed window, shared by every application instance. Keys name an action and an operator id; no request content.';

create index rate_limit_windows_expiry on public.rate_limit_windows (window_start);

-- Records one hit for p_key if the current window still has room.
-- Returns { allowed: true, remaining } or { allowed: false, retry_after_ms }.
-- Fixed windows: a caller can spend up to twice the limit across a window
-- boundary, which is acceptable for abuse protection.
create function public.rate_limit_consume(p_key text, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit is null or p_limit not between 1 and 10000 then
    raise exception 'rate_limit_consume: the limit must be 1 to 10000'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'rate_limit_consume: the window must be 1 to 86400 seconds'
      using errcode = 'invalid_parameter_value';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_windows as w (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update
     set hits = w.hits + 1
   where w.hits < p_limit
  returning w.hits into v_hits;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_ms', greatest(0, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())) * 1000))::bigint
    );
  end if;

  -- Housekeeping: this key's past windows, and now and then everyone's stale ones.
  delete from public.rate_limit_windows where key = p_key and window_start < v_window;
  if random() < 0.02 then
    delete from public.rate_limit_windows where window_start < now() - interval '2 days';
  end if;

  return jsonb_build_object('allowed', true, 'remaining', p_limit - v_hits);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access

alter table public.rate_limit_windows enable row level security;

revoke all on function public.agent_run_schedule_retries(integer) from public;
revoke all on function public.agent_runtime_status() from public;
revoke all on function public.rate_limit_consume(text, integer, integer) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.rate_limit_windows from %I', v_role);
      execute format('revoke all on function public.agent_run_schedule_retries(integer) from %I', v_role);
      execute format('revoke all on function public.agent_runtime_status() from %I', v_role);
      execute format('revoke all on function public.rate_limit_consume(text, integer, integer) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.rate_limit_windows from service_role;
    -- Read and delete for maintenance, as on agent_runs; only the function writes.
    grant select, delete on table public.rate_limit_windows to service_role;
    grant execute on function public.agent_run_schedule_retries(integer) to service_role;
    grant execute on function public.agent_runtime_status() to service_role;
    grant execute on function public.rate_limit_consume(text, integer, integer) to service_role;
  end if;
end
$$;
