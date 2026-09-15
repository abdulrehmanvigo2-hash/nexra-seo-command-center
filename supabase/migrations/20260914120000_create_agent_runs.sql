-- Agent runs: one request for one agent to carry out one task on one project.
--
-- The persistence half of the agent runtime foundation (Backend Phase 6, Part
-- 1). A run is created queued by an operator, claimed and executed by the
-- server, and ends completed, failed, or cancelled. A failed run may be put
-- back in the queue while it has attempts left.
--
-- Design decisions, smallest first:
--   * One row per run, not one per attempt. `attempt_count` and the last
--     failure are enough to decide a retry; a per-attempt history table is
--     added when something reads attempt history.
--   * Agents are not a table. The twelve agents are defined once, in the
--     application registry (src/lib/mock/agents/registry.ts); the check below
--     mirrors those ids so a row can never name an agent the product does not
--     have. Adding an agent is a deliberate migration.
--   * Task types are validated by the application, which owns their input
--     rules (src/lib/agent-runs/task-types.ts). The database checks only the
--     slug format, so a new task type needs no schema change.
--   * `input` is the validated task input, bounded in size. It never holds
--     credentials: the application rejects credential-like values before the
--     row is written, and executors receive credentials from the server
--     environment, never from a run.
--   * `result_summary` and `result_metadata` are what an executor may report
--     back, bounded and screened the same way. Failures store a fixed error
--     code and a fixed message, never a raw exception or provider response.
--   * `created_by` is the Supabase Auth user id of the operator. No foreign
--     key to auth.users: an operator account being removed must not delete or
--     block the audit record of what it asked for.
--   * `executor` says what actually ran the task. Today only `mock` exists,
--     so a simulated result can never be mistaken for a real one.
--   * Projects with runs cannot be deleted (on delete restrict): a run is an
--     audit record, and silently cascading it away would erase history.

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint agent_runs_project_fkey references public.projects (id) on delete restrict,

  agent_id text not null
    constraint agent_runs_agent_known check (agent_id in (
      'seo-director', 'project-manager', 'market-intelligence', 'keyword-intent',
      'content-strategist', 'research-evidence', 'writer', 'on-page-seo',
      'technical-seo', 'ai-visibility', 'authority-backlink', 'analytics-learning'
    )),

  task_type text not null
    constraint agent_runs_task_type_format
      check (task_type ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(task_type) <= 64),

  -- The application limits input and result metadata to 8 KB of compact JSON.
  -- The database bound is looser because jsonb renders as text with a space
  -- after every colon and comma: it is a backstop, and the application's
  -- limit is always the one a caller meets.
  input jsonb not null default '{}'::jsonb
    constraint agent_runs_input_bounded
      check (jsonb_typeof(input) = 'object' and octet_length(input::text) <= 16384),

  -- SHA-256 of the canonical input, so identical submissions can be recognised
  -- without comparing payloads.
  input_hash text not null
    constraint agent_runs_input_hash_format check (input_hash ~ '^[0-9a-f]{64}$'),

  status text not null default 'queued'
    constraint agent_runs_status_valid
      check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),

  -- What asked for the run. Only operators can today; schedules and workflows
  -- are added here when they exist.
  source text not null default 'operator'
    constraint agent_runs_source_valid check (source in ('operator')),

  -- What ran the current or last attempt; null until the first attempt starts.
  executor text
    constraint agent_runs_executor_valid check (executor in ('mock')),

  attempt_count integer not null default 0
    constraint agent_runs_attempt_count_positive check (attempt_count >= 0),
  max_attempts integer not null default 3
    constraint agent_runs_max_attempts_range check (max_attempts between 1 and 5),

  result_summary text
    constraint agent_runs_result_summary_length check (char_length(result_summary) between 1 and 2000),
  result_metadata jsonb
    constraint agent_runs_result_metadata_bounded
      check (jsonb_typeof(result_metadata) = 'object' and octet_length(result_metadata::text) <= 16384),

  -- The most recent failure. Kept when a failed run is retried, so the queue
  -- shows why it is being tried again.
  error_code text
    constraint agent_runs_error_code_format
      check (error_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(error_code) <= 64),
  error_message text
    constraint agent_runs_error_message_length check (char_length(error_message) between 1 and 500),

  created_by uuid not null,
  cancelled_by uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The current or last attempt.
  started_at timestamptz,
  finished_at timestamptz,

  constraint agent_runs_attempts_within_limit check (attempt_count <= max_attempts),
  constraint agent_runs_error_pair check ((error_code is null) = (error_message is null)),
  constraint agent_runs_cancelled_by_only_when_cancelled
    check (cancelled_by is null or status = 'cancelled'),

  -- What each state must and must not carry.
  constraint agent_runs_state_consistent check (
    case status
      when 'queued' then
        started_at is null and finished_at is null
        and result_summary is null and result_metadata is null
      when 'running' then
        started_at is not null and finished_at is null and executor is not null
        and attempt_count >= 1
        and result_summary is null and result_metadata is null
      when 'completed' then
        started_at is not null and finished_at is not null and executor is not null
        and result_summary is not null and error_code is null
      when 'failed' then
        started_at is not null and finished_at is not null and executor is not null
        and error_code is not null
        and result_summary is null and result_metadata is null
      when 'cancelled' then
        finished_at is not null and result_summary is null and result_metadata is null
      else false
    end
  )
);

comment on table public.agent_runs is
  'One request for an agent to carry out a task on a project, and how it ended. No credentials or raw provider payloads.';
comment on column public.agent_runs.agent_id is
  'An id from the application agent registry; mirrored in agent_runs_agent_known.';
comment on column public.agent_runs.input_hash is
  'SHA-256 of the canonical input. Two identical runs cannot be queued or running at once.';
comment on column public.agent_runs.executor is
  'What ran the task. "mock" results are simulated and carry no analysis.';
comment on column public.agent_runs.created_by is
  'Supabase Auth user id of the operator who created the run.';

-- The lifecycle, enforced where every writer — including the service role,
-- which bypasses row level security — has to pass:
--
--   queued  → running | cancelled
--   running → completed | failed | cancelled
--   failed  → queued          (a retry; only while attempts remain)
--   completed, cancelled      final
--
-- A run's identity — what was asked, of whom, for which project, by whom —
-- never changes after it is written, and starting an attempt counts it.
create function public.agent_runs_guard_update()
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

create trigger agent_runs_guard_update
  before update on public.agent_runs
  for each row
  execute function public.agent_runs_guard_update();

-- Duplicate protection: an identical request — same project, agent, task
-- type, and input — cannot be waiting or running twice. A double-click or a
-- replayed request gets the existing run instead of a second one.
create unique index agent_runs_one_active_request
  on public.agent_runs (project_id, agent_id, task_type, input_hash)
  where status in ('queued', 'running');

-- The two lists the runtime reads: newest runs for a project, and for an agent.
create index agent_runs_project_recent on public.agent_runs (project_id, created_at desc);
create index agent_runs_agent_recent on public.agent_runs (agent_id, created_at desc);

-- Same access model as public.projects: row level security with no policies,
-- so no client role can read or write runs; the server reads and writes them
-- with the service role. Delete is granted for maintenance only — the
-- application never deletes a run.
alter table public.agent_runs enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.agent_runs to service_role;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.agent_runs from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.agent_runs from authenticated;
  end if;
end
$$;
