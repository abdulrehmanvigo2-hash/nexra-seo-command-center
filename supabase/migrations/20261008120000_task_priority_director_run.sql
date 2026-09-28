-- The learning loop: a priority change may cite the Director run behind it
-- (Phase 6, checkpoint 6.7, decision Q7 of the 6.1 design note).
--
-- WHY. The loop the product describes — Analytics & Learning reads the
-- stored performance, the SEO Director re-prioritises, the operator acts —
-- had no recorded last step: a `priority-changed` event (20261005120000)
-- says what changed and who changed it, never why. Decision Q7 records one
-- re-prioritisation as a `priority-changed` event carrying the Director run
-- it cites. Nothing is automatic: the operator still chooses the priority
-- and chooses the run; the run is provenance, never an instruction.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000.
--
-- EVENTS. No column is added: `nexra_agent_task_events.run_id`
-- (20261004120000, a foreign key to `agent_runs`) is reused. The shape check
-- is replaced so that `priority-changed` may carry a run id or none; every
-- other type keeps exactly the shape 20261005120000 gave it. A new BEFORE
-- INSERT trigger, `nexra_agent_task_events_check_priority_run`, holds for
-- every writer, not only the function below: a `priority-changed` event
-- that names a run is refused (23514) unless that run is a `completed`
-- `project-priority-review` of the event's own project. A check constraint
-- cannot read another table, so the rule is a trigger, as the C5 approvals'
-- insert check is. The table stays append-only: its update, delete and
-- truncate guards are untouched. Existing rows all carry no run id on
-- `priority-changed` (20261005120000 required it) and keep their meaning.
--
-- THE FUNCTION. `nexra_agent_task_set_priority` gains a fifth parameter,
-- `p_run_id uuid default null`. The four-parameter function is dropped and
-- the five-parameter one created in its place (an overload beside it would
-- make every four-argument call ambiguous), so every existing call — which
-- names four arguments — behaves exactly as before and writes an event with
-- no run id. Given a run id, it answers `run-not-accepted`, writing nothing,
-- unless the run is a `completed` `project-priority-review` of the task's
-- own project (never which condition failed: an unknown run, another
-- project's, another task type's or an unfinished one read alike); the
-- check comes after `task-not-found` and before `same-priority` and
-- `terminal`, so a run is never accepted for a task the project does not
-- hold. The rest is 20261005120000's body, unchanged: the task row lock, the
-- transaction-local flag the update guard requires, one event per change.
-- Citing a run queues nothing, changes no run and tells no agent anything.
--
-- ACCESS. service_role executes the new signature, as it executed the old
-- one; `anon`, `authenticated` and PUBLIC get nothing. No table grant
-- changes. The harness's whole-database security definer inventory (c5)
-- names the new signature in place of the old one.

-- ---------------------------------------------------------------------------
-- The shape check: `priority-changed` may carry a run id.

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
      when 'priority-changed' then from_status is null and to_status is null and from_agent is null and to_agent is null
        and from_priority is not null and to_priority is not null and from_priority <> to_priority
    end
  );

comment on column public.nexra_agent_task_events.run_id is
  'On handoff-run-linked: the run the task was handed off to. On priority-changed (since 20261008120000), optionally: the completed project-priority-review of the same project the operator cited as the reason.';

-- ---------------------------------------------------------------------------
-- For every writer: a cited run is a completed project Director review of
-- the event's own project.

create function public.nexra_agent_task_events_check_priority_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type = 'priority-changed' and new.run_id is not null and not exists (
    select 1 from public.agent_runs r
     where r.id = new.run_id
       and r.project_id = new.project_id
       and r.task_type = 'project-priority-review'
       and r.status = 'completed'
  ) then
    raise exception 'nexra_agent_task_events: a priority change cites only a completed project-priority-review of the same project'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.nexra_agent_task_events_check_priority_run() from public;

create trigger nexra_agent_task_events_check_priority_run
  before insert on public.nexra_agent_task_events
  for each row
  execute function public.nexra_agent_task_events_check_priority_run();

-- ---------------------------------------------------------------------------
-- The function: the four-parameter signature gives way to five, the fifth
-- defaulting to null.

drop function public.nexra_agent_task_set_priority(text, uuid, text, uuid);

create function public.nexra_agent_task_set_priority(
  p_project_id text,
  p_task_id uuid,
  p_priority text,
  p_operator uuid,
  p_run_id uuid default null
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
  if p_run_id is not null and not exists (
    select 1 from public.agent_runs r
     where r.id = p_run_id
       and r.project_id = v_task.project_id
       and r.task_type = 'project-priority-review'
       and r.status = 'completed'
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'run-not-accepted', 'task', pg_catalog.to_jsonb(v_task));
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

  insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_priority, to_priority, run_id, actor)
  values (v_task.id, v_task.project_id, 'priority-changed', v_from, p_priority, p_run_id, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'priority-changed', 'task', pg_catalog.to_jsonb(v_task), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_agent_task_set_priority(text, uuid, text, uuid, uuid) is
  'Sets one task of one project to one of the four priorities and appends a priority-changed event, optionally citing a completed project-priority-review of the same project: priority-changed, task-not-found, run-not-accepted, same-priority or terminal. Dispatches nothing.';

-- ---------------------------------------------------------------------------
-- Access: service_role executes the new signature. Nothing else, for anyone.

revoke all on function public.nexra_agent_task_set_priority(text, uuid, text, uuid, uuid) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_agent_task_set_priority(text, uuid, text, uuid, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_events_check_priority_run() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nexra_agent_task_set_priority(text, uuid, text, uuid, uuid) to service_role;
  end if;
end
$$;
