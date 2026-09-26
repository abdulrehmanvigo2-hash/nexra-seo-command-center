-- Agent task workflow: an operator moves a task's status along fixed
-- transitions, changes its owning agent, and hands it off to that agent —
-- each as one bounded write with an immutable event behind it (Project
-- Manager real task status workflow + specialist handoff).
--
-- WHY. 20261003120000 records a task and refuses every later change: a task
-- was a record of an intention and nothing could act on it. This checkpoint
-- adds the smallest workflow that still keeps an operator in front of every
-- change: a status moves only along the transition map below, an owner is
-- one of the twelve registry agents and is never inferred, and a handoff is
-- recorded here as an intention and a link — the run it links to is created
-- by the application through the existing run path, and is executed only by
-- the scheduled worker or an operator's separate "Run now". Nothing in this
-- file starts an agent.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000: the unprefixed crawl names belong to a separate live
-- subsystem this repository never touches. Nothing here names it.
--
-- TRANSITIONS. From `backlog`: ready, blocked, cancelled. From `ready`:
-- in-progress, blocked, cancelled. From `in-progress`: review, blocked,
-- cancelled. From `blocked`: ready, in-progress, cancelled. From `review`:
-- in-progress, completed, blocked. `completed` and `cancelled` are terminal:
-- no further status, owner or handoff change. Anything else answers
-- `transition-not-allowed` and writes nothing.
--
-- EVENTS. `nexra_agent_task_events` is append-only: one row per change,
-- naming the task, its project, the event type (`created`,
-- `status-changed`, `owner-changed`, `handoff-requested`,
-- `handoff-run-linked`), the statuses or agents before and after where the
-- type has them, the linked run where it has one, the actor and the time.
-- Update, delete and truncate are refused for every caller. A `created`
-- event is written by an AFTER INSERT trigger on the task table, so every
-- task — including those recorded before this migration, backfilled below —
-- has one, and `nexra_agent_task_create` is unchanged.
--
-- HOW IT IS WRITTEN. Four `security definer` functions (`search_path` pinned
-- empty), each taking the project id beside the task id so a task is never
-- reached through another project: `nexra_agent_task_set_status`,
-- `nexra_agent_task_set_owner`, `nexra_agent_task_handoff_request` and
-- `nexra_agent_task_handoff_link`. Each locks the task row, checks the rule,
-- updates only the fields it owns (status or owning_agent, and updated_at)
-- under a transaction-local flag the update guard requires, and appends one
-- event. The update guard now refuses any change to the task's identity and
-- provenance (id, project, title, source, priority, creator, created_at) and
-- any update made outside those functions; there is still no UPDATE grant
-- on the table for any API role. service_role gains SELECT on the events
-- table and EXECUTE on the four functions, nothing else; `anon` and
-- `authenticated` get nothing. RLS on, no policies. Additive: no existing
-- table, column, function signature or grant changes, except that the
-- guard function's body is replaced as described.

-- ---------------------------------------------------------------------------
-- The event table.

create table public.nexra_agent_task_events (
  id uuid primary key default gen_random_uuid(),
  -- The order events were written in, which `created_at` alone cannot give
  -- inside one transaction.
  seq bigint not null generated always as identity,

  task_id uuid not null
    constraint nexra_agent_task_events_task_fkey references public.nexra_agent_tasks (id) on delete restrict,
  project_id text not null
    constraint nexra_agent_task_events_project_fkey references public.projects (id) on delete restrict,

  event_type text not null
    constraint nexra_agent_task_events_type_valid check (event_type in ('created', 'status-changed', 'owner-changed', 'handoff-requested', 'handoff-run-linked')),

  from_status text
    constraint nexra_agent_task_events_from_status_valid check (from_status is null or from_status in ('backlog', 'ready', 'in-progress', 'blocked', 'review', 'completed', 'cancelled')),
  to_status text
    constraint nexra_agent_task_events_to_status_valid check (to_status is null or to_status in ('backlog', 'ready', 'in-progress', 'blocked', 'review', 'completed', 'cancelled')),

  from_agent text
    constraint nexra_agent_task_events_from_agent_valid check (from_agent is null or from_agent in (
      'seo-director', 'project-manager', 'market-intelligence', 'keyword-intent',
      'content-strategist', 'research-evidence', 'writer', 'on-page-seo',
      'technical-seo', 'ai-visibility', 'authority-backlink', 'analytics-learning'
    )),
  to_agent text
    constraint nexra_agent_task_events_to_agent_valid check (to_agent is null or to_agent in (
      'seo-director', 'project-manager', 'market-intelligence', 'keyword-intent',
      'content-strategist', 'research-evidence', 'writer', 'on-page-seo',
      'technical-seo', 'ai-visibility', 'authority-backlink', 'analytics-learning'
    )),

  -- The run a handoff produced; only on `handoff-run-linked`.
  run_id uuid
    constraint nexra_agent_task_events_run_fkey references public.agent_runs (id) on delete restrict,

  -- The operator who made the change (Supabase Auth user id, as on the task).
  actor uuid not null,
  created_at timestamptz not null default now(),

  -- Each type carries exactly the fields it is about.
  constraint nexra_agent_task_events_shape check (
    case event_type
      when 'created' then from_status is null and to_status is null and from_agent is null and to_agent is null and run_id is null
      when 'status-changed' then from_status is not null and to_status is not null and from_status <> to_status and from_agent is null and to_agent is null and run_id is null
      when 'owner-changed' then from_status is null and to_status is null and from_agent is not null and to_agent is not null and from_agent <> to_agent and run_id is null
      when 'handoff-requested' then from_status is null and to_status is null and from_agent is null and to_agent is not null and run_id is null
      when 'handoff-run-linked' then from_status is null and to_status is null and from_agent is null and to_agent is not null and run_id is not null
    end
  )
);

comment on table public.nexra_agent_task_events is
  'Append-only history of one agent task: created, status-changed, owner-changed, handoff-requested, handoff-run-linked. Written only by the task functions; never updated, deleted or truncated.';
comment on column public.nexra_agent_task_events.run_id is
  'The agent run a handoff produced, on handoff-run-linked only. The run was created through the run path with the task id in its input; nothing here executes it.';

create unique index nexra_agent_task_events_seq_idx
  on public.nexra_agent_task_events (seq);
create index nexra_agent_task_events_task_seq_idx
  on public.nexra_agent_task_events (task_id, seq);

create function public.nexra_agent_task_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_agent_task_events: task history is never updated, deleted or truncated'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_agent_task_events_guard_update
  before update on public.nexra_agent_task_events
  for each row execute function public.nexra_agent_task_events_guard();
create trigger nexra_agent_task_events_guard_delete
  before delete on public.nexra_agent_task_events
  for each row execute function public.nexra_agent_task_events_guard();
create trigger nexra_agent_task_events_guard_truncate
  before truncate on public.nexra_agent_task_events
  for each statement execute function public.nexra_agent_task_events_guard();

-- ---------------------------------------------------------------------------
-- Every task has a `created` event: written when a task is inserted, and
-- backfilled for the tasks recorded before this migration.

create function public.nexra_agent_tasks_record_created()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.nexra_agent_task_events (task_id, project_id, event_type, actor, created_at)
  values (new.id, new.project_id, 'created', new.created_by, new.created_at);
  return new;
end;
$$;

create trigger nexra_agent_tasks_record_created
  after insert on public.nexra_agent_tasks
  for each row execute function public.nexra_agent_tasks_record_created();

insert into public.nexra_agent_task_events (task_id, project_id, event_type, actor, created_at)
select t.id, t.project_id, 'created', t.created_by, t.created_at
  from public.nexra_agent_tasks t
 where not exists (select 1 from public.nexra_agent_task_events e where e.task_id = t.id and e.event_type = 'created');

-- ---------------------------------------------------------------------------
-- The update guard, narrowed: only status, owning_agent and updated_at may
-- change, only while the transaction-local flag names this row — which only
-- the functions below set. Identity and provenance stay immutable.

create or replace function public.nexra_agent_tasks_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.title is distinct from old.title
    or new.source_kind is distinct from old.source_kind
    or new.source_ref is distinct from old.source_ref
    or new.priority is distinct from old.priority
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_agent_tasks: a task''s identity, provenance and priority never change'
      using errcode = 'check_violation';
  end if;
  if coalesce(pg_catalog.current_setting('nexra.agent_task_write', true), '') <> old.id::text then
    raise exception 'nexra_agent_tasks: a task changes only through nexra_agent_task_set_status or nexra_agent_task_set_owner'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared: the transition map, as one immutable function.

create function public.nexra_agent_task_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'backlog' then p_to in ('ready', 'blocked', 'cancelled')
    when 'ready' then p_to in ('in-progress', 'blocked', 'cancelled')
    when 'in-progress' then p_to in ('review', 'blocked', 'cancelled')
    when 'blocked' then p_to in ('ready', 'in-progress', 'cancelled')
    when 'review' then p_to in ('in-progress', 'completed', 'blocked')
    else false
  end
$$;

comment on function public.nexra_agent_task_transition_allowed(text, text) is
  'The fixed status transition map of agent tasks. completed and cancelled allow nothing.';

-- ---------------------------------------------------------------------------
-- Status: one transition along the map.
--
-- Answers `transitioned` with the task and the event; `task-not-found` for a
-- task that is missing or another project's (never which); `same-status`
-- when nothing would change; `terminal` from completed or cancelled;
-- `transition-not-allowed` for any other jump. Arguments outside the fixed
-- sets raise invalid_parameter_value and write nothing.

create function public.nexra_agent_task_set_status(
  p_project_id text,
  p_task_id uuid,
  p_status text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.nexra_agent_tasks;
  v_from text;
  v_event public.nexra_agent_task_events;
begin
  if p_project_id is null or p_task_id is null or p_status is null or p_operator is null then
    raise exception 'nexra_agent_task_set_status: project, task, status and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_status not in ('backlog', 'ready', 'in-progress', 'blocked', 'review', 'completed', 'cancelled') then
    raise exception 'nexra_agent_task_set_status: status must be one of the seven task statuses'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_task from public.nexra_agent_tasks where id = p_task_id and project_id = p_project_id for update;
  if v_task.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'task-not-found');
  end if;
  if v_task.status = p_status then
    return pg_catalog.jsonb_build_object('outcome', 'same-status', 'task', pg_catalog.to_jsonb(v_task));
  end if;
  if v_task.status in ('completed', 'cancelled') then
    return pg_catalog.jsonb_build_object('outcome', 'terminal', 'task', pg_catalog.to_jsonb(v_task));
  end if;
  if not public.nexra_agent_task_transition_allowed(v_task.status, p_status) then
    return pg_catalog.jsonb_build_object('outcome', 'transition-not-allowed', 'task', pg_catalog.to_jsonb(v_task));
  end if;

  v_from := v_task.status;
  perform pg_catalog.set_config('nexra.agent_task_write', v_task.id::text, true);
  update public.nexra_agent_tasks
     set status = p_status, updated_at = pg_catalog.now()
   where id = v_task.id
  returning * into v_task;
  perform pg_catalog.set_config('nexra.agent_task_write', '', true);

  insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_status, to_status, actor)
  values (v_task.id, v_task.project_id, 'status-changed', v_from, p_status, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'transitioned', 'task', pg_catalog.to_jsonb(v_task), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_agent_task_set_status(text, uuid, text, uuid) is
  'Moves one task of one project along the fixed transition map and appends a status-changed event: transitioned, task-not-found, same-status, terminal or transition-not-allowed. Dispatches nothing.';

-- ---------------------------------------------------------------------------
-- Owner: one of the twelve registry agents, chosen by an operator.
--
-- Answers `owner-changed`, `task-not-found`, `same-owner` or `terminal`. An
-- agent outside the registry raises invalid_parameter_value. Changing the
-- owner queues nothing and tells no agent anything.

create function public.nexra_agent_task_set_owner(
  p_project_id text,
  p_task_id uuid,
  p_owning_agent text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.nexra_agent_tasks;
  v_from text;
  v_event public.nexra_agent_task_events;
begin
  if p_project_id is null or p_task_id is null or p_owning_agent is null or p_operator is null then
    raise exception 'nexra_agent_task_set_owner: project, task, owning agent and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_owning_agent not in (
    'seo-director', 'project-manager', 'market-intelligence', 'keyword-intent',
    'content-strategist', 'research-evidence', 'writer', 'on-page-seo',
    'technical-seo', 'ai-visibility', 'authority-backlink', 'analytics-learning'
  ) then
    raise exception 'nexra_agent_task_set_owner: owning agent must be one of the twelve registry agents'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_task from public.nexra_agent_tasks where id = p_task_id and project_id = p_project_id for update;
  if v_task.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'task-not-found');
  end if;
  if v_task.owning_agent = p_owning_agent then
    return pg_catalog.jsonb_build_object('outcome', 'same-owner', 'task', pg_catalog.to_jsonb(v_task));
  end if;
  if v_task.status in ('completed', 'cancelled') then
    return pg_catalog.jsonb_build_object('outcome', 'terminal', 'task', pg_catalog.to_jsonb(v_task));
  end if;

  v_from := v_task.owning_agent;
  perform pg_catalog.set_config('nexra.agent_task_write', v_task.id::text, true);
  update public.nexra_agent_tasks
     set owning_agent = p_owning_agent, updated_at = pg_catalog.now()
   where id = v_task.id
  returning * into v_task;
  perform pg_catalog.set_config('nexra.agent_task_write', '', true);

  insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_agent, to_agent, actor)
  values (v_task.id, v_task.project_id, 'owner-changed', v_from, p_owning_agent, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'owner-changed', 'task', pg_catalog.to_jsonb(v_task), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_agent_task_set_owner(text, uuid, text, uuid) is
  'Sets the owning registry agent of one task of one project and appends an owner-changed event: owner-changed, task-not-found, same-owner or terminal. Queues nothing.';

-- ---------------------------------------------------------------------------
-- Handoff, step 1: the operator's request, recorded before any run exists.
--
-- Answers `requested` with the task, `task-not-found`, `terminal`, or
-- `handoff-active` with the run id when a run this task was already handed
-- off to is still queued or running — one handoff at a time per task. Which
-- executable task type the owning agent is handed is the application's
-- knowledge (the registry and the task-type definitions); this function
-- records the intention and the agent it names.

create function public.nexra_agent_task_handoff_request(
  p_project_id text,
  p_task_id uuid,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.nexra_agent_tasks;
  v_active uuid;
  v_event public.nexra_agent_task_events;
begin
  if p_project_id is null or p_task_id is null or p_operator is null then
    raise exception 'nexra_agent_task_handoff_request: project, task and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_task from public.nexra_agent_tasks where id = p_task_id and project_id = p_project_id for update;
  if v_task.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'task-not-found');
  end if;
  if v_task.status in ('completed', 'cancelled') then
    return pg_catalog.jsonb_build_object('outcome', 'terminal', 'task', pg_catalog.to_jsonb(v_task));
  end if;

  select r.id into v_active
    from public.nexra_agent_task_events e
    join public.agent_runs r on r.id = e.run_id
   where e.task_id = v_task.id and e.event_type = 'handoff-run-linked' and r.status in ('queued', 'running')
   order by e.seq desc
   limit 1;
  if v_active is not null then
    return pg_catalog.jsonb_build_object('outcome', 'handoff-active', 'task', pg_catalog.to_jsonb(v_task), 'run_id', v_active);
  end if;

  insert into public.nexra_agent_task_events (task_id, project_id, event_type, to_agent, actor)
  values (v_task.id, v_task.project_id, 'handoff-requested', v_task.owning_agent, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'requested', 'task', pg_catalog.to_jsonb(v_task), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_agent_task_handoff_request(text, uuid, uuid) is
  'Records an operator''s request to hand one task of one project to its owning agent: requested, task-not-found, terminal or handoff-active (a linked run is still queued or running). Creates and executes no run.';

-- ---------------------------------------------------------------------------
-- Handoff, step 2: the link to the run the application created.
--
-- The run must exist, be this project's, be the owning agent's, and carry
-- this task's id as `sourceTaskId` in its input — the provenance the run
-- path stored; anything else answers `run-not-found` (never which). A run
-- already linked to this task answers `already-linked`. Nothing here reads
-- the run's result or changes the run.

create function public.nexra_agent_task_handoff_link(
  p_project_id text,
  p_task_id uuid,
  p_run_id uuid,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.nexra_agent_tasks;
  v_run public.agent_runs;
  v_event public.nexra_agent_task_events;
begin
  if p_project_id is null or p_task_id is null or p_run_id is null or p_operator is null then
    raise exception 'nexra_agent_task_handoff_link: project, task, run and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_task from public.nexra_agent_tasks where id = p_task_id and project_id = p_project_id for update;
  if v_task.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'task-not-found');
  end if;

  select * into v_run from public.agent_runs where id = p_run_id;
  if v_run.id is null or v_run.project_id <> v_task.project_id or v_run.agent_id <> v_task.owning_agent
    or (v_run.input ->> 'sourceTaskId') is distinct from v_task.id::text
  then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-found');
  end if;

  if exists (select 1 from public.nexra_agent_task_events where task_id = v_task.id and event_type = 'handoff-run-linked' and run_id = v_run.id) then
    return pg_catalog.jsonb_build_object('outcome', 'already-linked', 'task', pg_catalog.to_jsonb(v_task), 'run_id', v_run.id);
  end if;

  insert into public.nexra_agent_task_events (task_id, project_id, event_type, to_agent, run_id, actor)
  values (v_task.id, v_task.project_id, 'handoff-run-linked', v_task.owning_agent, v_run.id, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'linked', 'task', pg_catalog.to_jsonb(v_task), 'run_id', v_run.id, 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_agent_task_handoff_link(text, uuid, uuid, uuid) is
  'Links one task of one project to the run its handoff created (same project, the owning agent''s, sourceTaskId in the run input): linked, task-not-found, run-not-found or already-linked. Reads no result and changes no run.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the events and executes the four functions.
-- Nothing else, for anyone.

alter table public.nexra_agent_task_events enable row level security;

revoke all on function public.nexra_agent_task_events_guard() from public;
revoke all on function public.nexra_agent_tasks_record_created() from public;
revoke all on function public.nexra_agent_task_transition_allowed(text, text) from public;
revoke all on function public.nexra_agent_task_set_status(text, uuid, text, uuid) from public;
revoke all on function public.nexra_agent_task_set_owner(text, uuid, text, uuid) from public;
revoke all on function public.nexra_agent_task_handoff_request(text, uuid, uuid) from public;
revoke all on function public.nexra_agent_task_handoff_link(text, uuid, uuid, uuid) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_agent_task_events from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_events_guard() from %I', v_role);
      execute format('revoke all on function public.nexra_agent_tasks_record_created() from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_transition_allowed(text, text) from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_set_status(text, uuid, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_set_owner(text, uuid, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_handoff_request(text, uuid, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_handoff_link(text, uuid, uuid, uuid) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_agent_task_events to service_role;
    grant execute on function public.nexra_agent_task_set_status(text, uuid, text, uuid) to service_role;
    grant execute on function public.nexra_agent_task_set_owner(text, uuid, text, uuid) to service_role;
    grant execute on function public.nexra_agent_task_handoff_request(text, uuid, uuid) to service_role;
    grant execute on function public.nexra_agent_task_handoff_link(text, uuid, uuid, uuid) to service_role;
  end if;
end
$$;
