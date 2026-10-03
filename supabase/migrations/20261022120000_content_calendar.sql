-- M3: the content calendar — a planned date per task and a link from a task to its article
-- (docs/roadmap/M3-content-calendar.md, PR 1 of 5; docs/roadmap/NEXT-FOUR-PLAN.md).
--
-- WHY. Accepted work (M2's opportunity tasks, and any other task) has no date and no tie to the article that carries
-- it out, so the owner cannot see a plan month by month or tell how far an item has got. The plan's decision: no new
-- lifecycle. A task gains one planned date; a task and an article are tied by an event; the calendar's stage is
-- derived on read from the task's status and the linked article's own records.
--
-- WHAT.
--   * `nexra_agent_tasks.planned_for date` — nullable; 2020-01-01 to 2099-12-31.
--   * `nexra_agent_task_events` gains `from_date`, `to_date` and `article_id` (a foreign key to `nexra_articles`)
--     and two event types: `plan-date-changed` (the date set, moved or cleared: at least one of the two dates, and
--     the two different) and `article-linked` (the article). Every earlier type keeps its shape, with the three new
--     columns null. The table stays append-only: its update, delete and truncate guards are untouched.
--   * `nexra_agent_task_set_plan_date(p_project_id, p_task_id, p_planned_for, p_operator)` — `plan-date-changed`,
--     `task-not-found`, `same-date` or `terminal` (a completed or cancelled task); a null date clears the date.
--   * `nexra_agent_task_link_article(p_project_id, p_task_id, p_article_id, p_operator)` — `article-linked`,
--     `task-not-found`, `article-not-found` (unknown, another project's or archived — never which), `same-article`
--     (the newest link already names it) or `terminal`. A later link replaces an earlier one: the newest event wins.
--     The task row does not change.
--   Both are `security definer` with an empty `search_path`, take the project beside the task and lock the task row,
--   as `nexra_agent_task_set_priority` does.
--
-- ACCESS. service_role executes the two functions; no table grant changes; `anon`, `authenticated` and PUBLIC get
-- nothing. The update guard keeps its rule (any change needs the functions' transaction flag); its message now names
-- the new function. Nothing here dispatches an agent, queues a run, changes an article or publishes anything.

-- ---------------------------------------------------------------------------
-- Tasks: a planned date.

alter table public.nexra_agent_tasks
  add column planned_for date
    constraint nexra_agent_tasks_planned_for_range check (planned_for is null or planned_for between date '2020-01-01' and date '2099-12-31');

comment on column public.nexra_agent_tasks.planned_for is
  'M3: the date the owner planned this work for, or null. Set, moved or cleared only through nexra_agent_task_set_plan_date, which records a plan-date-changed event.';

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
    raise exception 'nexra_agent_tasks: a task changes only through nexra_agent_task_set_status, nexra_agent_task_set_owner, nexra_agent_task_set_priority or nexra_agent_task_set_plan_date'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Events: two new types and their columns.

alter table public.nexra_agent_task_events
  add column from_date date,
  add column to_date date,
  add column article_id uuid
    constraint nexra_agent_task_events_article_fkey references public.nexra_articles (id) on delete restrict;

alter table public.nexra_agent_task_events drop constraint nexra_agent_task_events_type_valid;
alter table public.nexra_agent_task_events
  add constraint nexra_agent_task_events_type_valid
    check (event_type in ('created', 'status-changed', 'owner-changed', 'handoff-requested', 'handoff-run-linked', 'priority-changed', 'plan-date-changed', 'article-linked'));

alter table public.nexra_agent_task_events drop constraint nexra_agent_task_events_shape;
alter table public.nexra_agent_task_events
  add constraint nexra_agent_task_events_shape check (
    case event_type
      when 'created' then from_status is null and to_status is null and from_agent is null and to_agent is null and run_id is null
        and from_priority is null and to_priority is null and from_date is null and to_date is null and article_id is null
      when 'status-changed' then from_status is not null and to_status is not null and from_status <> to_status and from_agent is null and to_agent is null and run_id is null
        and from_priority is null and to_priority is null and from_date is null and to_date is null and article_id is null
      when 'owner-changed' then from_status is null and to_status is null and from_agent is not null and to_agent is not null and from_agent <> to_agent and run_id is null
        and from_priority is null and to_priority is null and from_date is null and to_date is null and article_id is null
      when 'handoff-requested' then from_status is null and to_status is null and from_agent is null and to_agent is not null and run_id is null
        and from_priority is null and to_priority is null and from_date is null and to_date is null and article_id is null
      when 'handoff-run-linked' then from_status is null and to_status is null and from_agent is null and to_agent is not null and run_id is not null
        and from_priority is null and to_priority is null and from_date is null and to_date is null and article_id is null
      when 'priority-changed' then from_status is null and to_status is null and from_agent is null and to_agent is null
        and from_priority is not null and to_priority is not null and from_priority <> to_priority
        and from_date is null and to_date is null and article_id is null
      when 'plan-date-changed' then from_status is null and to_status is null and from_agent is null and to_agent is null and run_id is null
        and from_priority is null and to_priority is null and article_id is null
        and (from_date is not null or to_date is not null) and from_date is distinct from to_date
      when 'article-linked' then from_status is null and to_status is null and from_agent is null and to_agent is null and run_id is null
        and from_priority is null and to_priority is null and from_date is null and to_date is null and article_id is not null
    end
  );

comment on column public.nexra_agent_task_events.from_date is 'On plan-date-changed (M3): the planned date before the change, or null when none was set.';
comment on column public.nexra_agent_task_events.to_date is 'On plan-date-changed (M3): the planned date after the change, or null when it was cleared.';
comment on column public.nexra_agent_task_events.article_id is 'On article-linked (M3): the article the task was linked to; the newest such event is the task''s link.';

-- ---------------------------------------------------------------------------
-- Set, move or clear a task's planned date.

create function public.nexra_agent_task_set_plan_date(
  p_project_id text,
  p_task_id uuid,
  p_planned_for date,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.nexra_agent_tasks;
  v_from date;
  v_event public.nexra_agent_task_events;
begin
  if p_project_id is null or p_task_id is null or p_operator is null then
    raise exception 'nexra_agent_task_set_plan_date: project, task and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_planned_for is not null and p_planned_for not between date '2020-01-01' and date '2099-12-31' then
    raise exception 'nexra_agent_task_set_plan_date: a planned date is between 2020-01-01 and 2099-12-31'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_task from public.nexra_agent_tasks where id = p_task_id and project_id = p_project_id for update;
  if v_task.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'task-not-found');
  end if;
  if v_task.planned_for is not distinct from p_planned_for then
    return pg_catalog.jsonb_build_object('outcome', 'same-date', 'task', pg_catalog.to_jsonb(v_task));
  end if;
  if v_task.status in ('completed', 'cancelled') then
    return pg_catalog.jsonb_build_object('outcome', 'terminal', 'task', pg_catalog.to_jsonb(v_task));
  end if;

  v_from := v_task.planned_for;
  perform pg_catalog.set_config('nexra.agent_task_write', v_task.id::text, true);
  update public.nexra_agent_tasks
     set planned_for = p_planned_for, updated_at = pg_catalog.now()
   where id = v_task.id
  returning * into v_task;
  perform pg_catalog.set_config('nexra.agent_task_write', '', true);

  insert into public.nexra_agent_task_events (task_id, project_id, event_type, from_date, to_date, actor)
  values (v_task.id, v_task.project_id, 'plan-date-changed', v_from, p_planned_for, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'plan-date-changed', 'task', pg_catalog.to_jsonb(v_task), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_agent_task_set_plan_date(text, uuid, date, uuid) is
  'M3: sets, moves or clears one task''s planned date and appends a plan-date-changed event: plan-date-changed, task-not-found, same-date or terminal. Dispatches nothing.';

-- ---------------------------------------------------------------------------
-- Link a task to the article that carries it out.

create function public.nexra_agent_task_link_article(
  p_project_id text,
  p_task_id uuid,
  p_article_id uuid,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.nexra_agent_tasks;
  v_current uuid;
  v_event public.nexra_agent_task_events;
begin
  if p_project_id is null or p_task_id is null or p_article_id is null or p_operator is null then
    raise exception 'nexra_agent_task_link_article: project, task, article and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_task from public.nexra_agent_tasks where id = p_task_id and project_id = p_project_id for update;
  if v_task.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'task-not-found');
  end if;
  if not exists (select 1 from public.nexra_articles a where a.id = p_article_id and a.project_id = v_task.project_id and a.status <> 'archived') then
    return pg_catalog.jsonb_build_object('outcome', 'article-not-found', 'task', pg_catalog.to_jsonb(v_task));
  end if;
  select e.article_id into v_current
    from public.nexra_agent_task_events e
   where e.task_id = v_task.id and e.event_type = 'article-linked'
   order by e.seq desc
   limit 1;
  if v_current is not distinct from p_article_id then
    return pg_catalog.jsonb_build_object('outcome', 'same-article', 'task', pg_catalog.to_jsonb(v_task));
  end if;
  if v_task.status in ('completed', 'cancelled') then
    return pg_catalog.jsonb_build_object('outcome', 'terminal', 'task', pg_catalog.to_jsonb(v_task));
  end if;

  insert into public.nexra_agent_task_events (task_id, project_id, event_type, article_id, actor)
  values (v_task.id, v_task.project_id, 'article-linked', p_article_id, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'article-linked', 'task', pg_catalog.to_jsonb(v_task), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_agent_task_link_article(text, uuid, uuid, uuid) is
  'M3: links one task to one article of the same project (not archived) and appends an article-linked event; the newest link wins: article-linked, task-not-found, article-not-found, same-article or terminal. Changes no article and dispatches nothing.';

-- ---------------------------------------------------------------------------
-- Access: service_role executes the two functions. Nothing else, for anyone.

revoke all on function public.nexra_agent_task_set_plan_date(text, uuid, date, uuid) from public;
revoke all on function public.nexra_agent_task_link_article(text, uuid, uuid, uuid) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_agent_task_set_plan_date(text, uuid, date, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_link_article(text, uuid, uuid, uuid) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nexra_agent_task_set_plan_date(text, uuid, date, uuid) to service_role;
    grant execute on function public.nexra_agent_task_link_article(text, uuid, uuid, uuid) to service_role;
  end if;
end
$$;
