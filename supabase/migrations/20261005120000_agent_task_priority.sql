-- Agent task priority: an operator changes a task's priority, as one bounded
-- write with an immutable event behind it (Phase 2, checkpoint 2.3b).
--
-- WHY. 20261003120000 records a task's priority (low, medium, high,
-- critical; default medium) and 20261004120000 keeps it immutable: the
-- update guard refuses any change to it. The Phase 2 design note (2.1, part
-- B3) found no way to change a priority without a schema change — the
-- guard refuses it and the event types have no `priority-changed` — and the
-- operator approved this one migration for it. Nothing else changes: the
-- status, owner and handoff functions, the transition map and every grant
-- they hold stay as 20261004120000 wrote them.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000: the unprefixed crawl names belong to a separate live
-- subsystem this repository never touches. Nothing here names it.
--
-- EVENTS. `nexra_agent_task_events` gains two nullable columns,
-- `from_priority` and `to_priority` (each one of the four priorities), and a
-- sixth event type, `priority-changed`, which carries exactly those two
-- (different) values and nothing else. Every earlier type now also requires
-- both to be null, so no existing row changes meaning; the shape check and
-- the type list are replaced to say so. The table stays append-only: its
-- update, delete and truncate guards are untouched.
--
-- HOW IT IS WRITTEN. One `security definer` function (`search_path` pinned
-- empty), `nexra_agent_task_set_priority`, shaped exactly like
-- `nexra_agent_task_set_owner`: it takes the project id beside the task id so
-- a task is never reached through another project, locks the task row,
-- answers `task-not-found`, `same-priority` or `terminal` without writing,
-- and otherwise updates only `priority` and `updated_at` under the
-- transaction-local flag the update guard requires and appends one
-- `priority-changed` event. A priority outside the four raises
-- invalid_parameter_value and writes nothing. The update guard is replaced
-- so that `priority` is no longer immutable; it still refuses any change to
-- the task's identity and provenance (id, project, title, source, creator,
-- created_at) and any update made outside the task functions, and there is
-- still no UPDATE grant on the table for any API role. service_role gains
-- EXECUTE on the one new function and nothing else; `anon` and
-- `authenticated` get nothing. Changing a priority tells no agent anything
-- and queues nothing.

-- ---------------------------------------------------------------------------
-- The event table: two priority columns and a sixth event type.

alter table public.nexra_agent_task_events
  add column from_priority text
    constraint nexra_agent_task_events_from_priority_valid check (from_priority is null or from_priority in ('low', 'medium', 'high', 'critical')),
  add column to_priority text
    constraint nexra_agent_task_events_to_priority_valid check (to_priority is null or to_priority in ('low', 'medium', 'high', 'critical'));

alter table public.nexra_agent_task_events drop constraint nexra_agent_task_events_type_valid;
alter table public.nexra_agent_task_events
  add constraint nexra_agent_task_events_type_valid
    check (event_type in ('created', 'status-changed', 'owner-changed', 'handoff-requested', 'handoff-run-linked', 'priority-changed'));

alter table public.nexra_agent_task_events drop constraint nexra_agent_task_events_shape;
alter table public.nexra_agent_task_events
  add constraint nexra_agent_task_events_shape check (
    case event_type
      when 'created' then from_status is null and to_status is null and from_agent is null and to_agent is null and run_id is null
        and from_priority is null and to_priority is null
      when 'status-changed' then from_status is not null and to_status is not null and from_status <> to_status and from_agent is null and to_agent is null and run_id is null
        and from_priority is null and to_priority is null
      when 'owner-changed' then from_status is null and to_status is null and from_agent is not null and to_agent is not null and from_agent <> to_agent and run_id is null
        and from_priority is null and to_priority is null
      when 'handoff-requested' then from_status is null and to_status is null and from_agent is null and to_agent is not null and run_id is null
        and from_priority is null and to_priority is null
      when 'handoff-run-linked' then from_status is null and to_status is null and from_agent is null and to_agent is not null and run_id is not null
        and from_priority is null and to_priority is null
      when 'priority-changed' then from_status is null and to_status is null and from_agent is null and to_agent is null and run_id is null
        and from_priority is not null and to_priority is not null and from_priority <> to_priority
    end
  );

comment on table public.nexra_agent_task_events is
  'Append-only history of one agent task: created, status-changed, owner-changed, handoff-requested, handoff-run-linked, priority-changed. Written only by the task functions; never updated, deleted or truncated.';
comment on column public.nexra_agent_task_events.from_priority is
  'The priority before the change, on priority-changed only.';
comment on column public.nexra_agent_task_events.to_priority is
  'The priority after the change, on priority-changed only.';

-- ---------------------------------------------------------------------------
-- The update guard: priority joins status and owning_agent as a field only
-- the task functions change, under the transaction-local flag. Identity and
-- provenance stay immutable.

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
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_agent_tasks: a task''s identity and provenance never change'
      using errcode = 'check_violation';
  end if;
  if coalesce(pg_catalog.current_setting('nexra.agent_task_write', true), '') <> old.id::text then
    raise exception 'nexra_agent_tasks: a task changes only through nexra_agent_task_set_status, nexra_agent_task_set_owner or nexra_agent_task_set_priority'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Priority: one of the four, chosen by an operator.
--
-- Answers `priority-changed` with the task and the event; `task-not-found`
-- for a task that is missing or another project's (never which);
-- `same-priority` when nothing would change; `terminal` from completed or
-- cancelled. A priority outside the four raises invalid_parameter_value.
-- Changing the priority queues nothing and tells no agent anything.

create function public.nexra_agent_task_set_priority(
  p_project_id text,
  p_task_id uuid,
  p_priority text,
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
  if p_project_id is null or p_task_id is null or p_priority is null or p_operator is null then
    raise exception 'nexra_agent_task_set_priority: project, task, priority and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'nexra_agent_task_set_priority: priority must be one of the four task priorities'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_task from public.nexra_agent_tasks where id = p_task_id and project_id = p_project_id for update;
  if v_task.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'task-not-found');
  end if;
  if v_task.priority = p_priority then
    return pg_catalog.jsonb_build_object('outcome', 'same-priority', 'task', pg_catalog.to_jsonb(v_task));
  end if;
  if v_task.status in ('completed', 'cancelled') then
    return pg_catalog.jsonb_build_object('outcome', 'terminal', 'task', pg_catalog.to_jsonb(v_task));
  end if;

  v_from := v_task.priority;
  perform pg_catalog.set_config('nexra.agent_task_write', v_task.id::text, true);
  update public.nexra_agent_tasks
     set priority = p_priority, updated_at = pg_catalog.now()
   where id = v_task.id
  returning * into v_task;
  perform pg_catalog.set_config('nexra.agent_task_write', '', true);

  insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, actor)
  values (v_task.id, v_task.project_id, 'priority-changed', v_from, p_priority, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'priority-changed', 'task', pg_catalog.to_jsonb(v_task), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_agent_task_set_priority(text, uuid, text, uuid) is
  'Sets one task of one project to one of the four priorities and appends a priority-changed event: priority-changed, task-not-found, same-priority or terminal. Dispatches nothing.';

-- ---------------------------------------------------------------------------
-- Access: service_role executes the new function. Nothing else, for anyone.

revoke all on function public.nexra_agent_task_set_priority(text, uuid, text, uuid) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_agent_task_set_priority(text, uuid, text, uuid) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nexra_agent_task_set_priority(text, uuid, text, uuid) to service_role;
  end if;
end
$$;
