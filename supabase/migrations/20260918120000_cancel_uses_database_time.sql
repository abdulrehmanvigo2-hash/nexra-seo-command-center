-- Cancelled runs take their finish time from the database clock.
--
-- Final QA & security hardening. Every other lifecycle time is already set by
-- Postgres — created, updated, started and finished by agent_run_claim,
-- agent_run_finish and recovery, and retry clears the times rather than
-- setting them. A cancellation was the exception: its `finished_at` came from
-- the application server's clock, so a server whose clock drifted recorded a
-- finish before the run's own start or creation.
--
-- This re-issues the run guard from 20260917120000_agent_runtime_production.sql
-- unchanged except for the addition marked below. No table, grant, or data
-- changes; existing rows are left as they are.

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

  -- The finish time of a cancellation is the database's, whatever clock the
  -- writer sent: lifecycle times are all read from one clock.
  if new.status = 'cancelled' then
    new.finished_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;
