-- Agent tasks: an operator-approved unit of work for one agent on one
-- project, recorded from something this product already holds — a completed
-- SEO Director run or an observed Search Console query (Project Manager real
-- task core).
--
-- WHY. The Project Manager screen is modelled: its task board, counts and
-- handoffs are fixture records. Nothing in the product could hold a task an
-- operator actually decided on. This table is the smallest persisted task
-- entity: one row per operator decision, naming the project, the owning
-- agent, a title, a status, a priority, and — always — the record it came
-- from. It is a record of an intention to act, not an assignment engine: no
-- agent is dispatched, no run is queued and no page is changed by a row
-- existing here.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000: the unprefixed crawl names belong to a separate live
-- subsystem this repository never touches. Nothing here names it.
--
-- PROVENANCE. `source_kind` and `source_ref` say where a task came from and
-- are checked when it is created:
--   * `director-run`: `source_ref` is the id of an `agent_runs` row that is
--     the same project's, completed, and the SEO Director's (`priority-review`
--     or `project-priority-review`). A run of another project answers
--     `run-not-found`, never which of the two.
--   * `keyword`: `source_ref` is the exact query text as Google reported it
--     and this product stored it — a `key` of a snapshot's `queries` rows
--     (20260927120000) or a `query` of a query × page row (20260930120000)
--     for the same project. The query text is the identity those immutable
--     rows already carry; no new keyword id is invented, and a query this
--     product never stored for the project answers `keyword-not-found`.
-- No uniqueness is declared on (project, source): a Director run proposes
-- several actions and an operator may record several tasks from it, and two
-- operator-approved tasks are never silently collapsed into one.
--
-- HOW IT IS WRITTEN. Only through `nexra_agent_task_create` (`security
-- definer`, `search_path` pinned empty), which validates the project, the
-- owning agent, the source kind, the source's provenance, the title and the
-- priority, and inserts one row in `backlog`. No update, delete or truncate
-- path exists in this checkpoint: the guards refuse them for every caller,
-- and a later checkpoint that changes a task's status adds its own function.
-- service_role is granted SELECT on the table and EXECUTE on that function,
-- nothing else; `anon` and `authenticated` get nothing. Row level security is
-- enabled with no policies. Additive: no existing table, column, function,
-- trigger or grant is changed.

create table public.nexra_agent_tasks (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_agent_tasks_project_fkey references public.projects (id) on delete restrict,

  title text not null
    constraint nexra_agent_tasks_title_length check (pg_catalog.char_length(title) between 1 and 200),
  constraint nexra_agent_tasks_title_trimmed check (title = pg_catalog.btrim(title)),

  -- Where the task came from; see PROVENANCE above.
  source_kind text not null
    constraint nexra_agent_tasks_source_kind_valid check (source_kind in ('director-run', 'keyword')),
  source_ref text not null
    constraint nexra_agent_tasks_source_ref_length check (pg_catalog.char_length(source_ref) between 1 and 2048),

  -- The registry agent responsible. The twelve ids are restated here (a
  -- repository test checks this list against the registry) so a row can
  -- never name an agent the product does not have.
  owning_agent text not null
    constraint nexra_agent_tasks_owning_agent_valid check (owning_agent in (
      'seo-director', 'project-manager', 'market-intelligence', 'keyword-intent',
      'content-strategist', 'research-evidence', 'writer', 'on-page-seo',
      'technical-seo', 'ai-visibility', 'authority-backlink', 'analytics-learning'
    )),

  status text not null default 'backlog'
    constraint nexra_agent_tasks_status_valid check (status in ('backlog', 'ready', 'in-progress', 'blocked', 'review', 'completed', 'cancelled')),
  priority text not null default 'medium'
    constraint nexra_agent_tasks_priority_valid check (priority in ('low', 'medium', 'high', 'critical')),

  -- The operator who recorded it (Supabase Auth user id, as on agent_runs).
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nexra_agent_tasks_updated_not_before_created check (updated_at >= created_at)
);

comment on table public.nexra_agent_tasks is
  'One operator-approved unit of work for one registry agent on one project, recorded from a completed SEO Director run or an observed Search Console query (source_kind, source_ref). A record of an intention to act: nothing here dispatches an agent, queues a run or changes a page.';

create index nexra_agent_tasks_project_created_idx
  on public.nexra_agent_tasks (project_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- Guards. In this checkpoint a task is written once, through the function
-- below, and never changed, deleted or truncated by anyone. A later
-- checkpoint that lets an operator move a task's status adds its own
-- function and relaxes the update guard for the columns it changes; the
-- row's identity and provenance (id, project, source, creator, created_at)
-- stay immutable whatever comes later.

create function public.nexra_agent_tasks_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_agent_tasks: a task is not updated in this checkpoint; its identity and provenance never change'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_agent_tasks_guard_update
  before update on public.nexra_agent_tasks
  for each row execute function public.nexra_agent_tasks_guard_update();

create function public.nexra_agent_tasks_guard_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_agent_tasks: a task is never deleted or truncated'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_agent_tasks_guard_delete
  before delete on public.nexra_agent_tasks
  for each row execute function public.nexra_agent_tasks_guard_remove();
create trigger nexra_agent_tasks_guard_truncate
  before truncate on public.nexra_agent_tasks
  for each statement execute function public.nexra_agent_tasks_guard_remove();

-- ---------------------------------------------------------------------------
-- Creating a task: the one write.
--
-- Every argument is validated before anything is read or written. A title is
-- trimmed and must be 1 to 200 characters with no control characters; the
-- source kind, owning agent and priority must be in their fixed sets, or the
-- call raises invalid_parameter_value and writes nothing. Then the
-- provenance: a project that is not stored answers `project-not-found`; a
-- Director run that is missing or another project's answers `run-not-found`
-- (never which), one that is not completed `run-not-completed`, one that is
-- not the SEO Director's `run-not-director`; a query this product never
-- stored for the project answers `keyword-not-found`. The row is inserted in
-- `backlog` and returned whole. Nothing is dispatched.

create function public.nexra_agent_task_create(
  p_project_id text,
  p_title text,
  p_source_kind text,
  p_source_ref text,
  p_owning_agent text,
  p_priority text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_run public.agent_runs;
  v_run_id uuid;
  v_row public.nexra_agent_tasks;
begin
  if p_project_id is null or p_title is null or p_source_kind is null or p_source_ref is null
    or p_owning_agent is null or p_priority is null or p_operator is null
  then
    raise exception 'nexra_agent_task_create: project, title, source kind, source ref, owning agent, priority and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;

  v_title := pg_catalog.btrim(p_title);
  if pg_catalog.char_length(v_title) < 1 or pg_catalog.char_length(v_title) > 200 then
    raise exception 'nexra_agent_task_create: a title is 1 to 200 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_title ~ '[[:cntrl:]]' then
    raise exception 'nexra_agent_task_create: a title carries no control characters'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_source_kind not in ('director-run', 'keyword') then
    raise exception 'nexra_agent_task_create: source kind must be director-run or keyword'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.char_length(p_source_ref) < 1 or pg_catalog.char_length(p_source_ref) > 2048 then
    raise exception 'nexra_agent_task_create: a source ref is 1 to 2048 characters'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_owning_agent not in (
    'seo-director', 'project-manager', 'market-intelligence', 'keyword-intent',
    'content-strategist', 'research-evidence', 'writer', 'on-page-seo',
    'technical-seo', 'ai-visibility', 'authority-backlink', 'analytics-learning'
  ) then
    raise exception 'nexra_agent_task_create: owning agent must be one of the twelve registry agents'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'nexra_agent_task_create: priority must be low, medium, high or critical'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;

  if p_source_kind = 'director-run' then
    if p_source_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return pg_catalog.jsonb_build_object('outcome', 'run-not-found');
    end if;
    v_run_id := p_source_ref::uuid;
    select * into v_run from public.agent_runs where id = v_run_id;
    if v_run.id is null or v_run.project_id <> p_project_id then
      return pg_catalog.jsonb_build_object('outcome', 'run-not-found');
    end if;
    if v_run.status <> 'completed' then
      return pg_catalog.jsonb_build_object('outcome', 'run-not-completed');
    end if;
    if v_run.agent_id <> 'seo-director' or v_run.task_type not in ('priority-review', 'project-priority-review') then
      return pg_catalog.jsonb_build_object('outcome', 'run-not-director');
    end if;
  else
    -- The query must be one this product stored for this project: a top-row
    -- key of one of its snapshots, or a query of one of its query × page rows.
    if not exists (
      select 1
        from public.nexra_search_console_snapshots s
        cross join lateral pg_catalog.jsonb_array_elements(s.queries) q
       where s.project_id = p_project_id and s.queries is not null and q ->> 'key' = p_source_ref
    ) and not exists (
      select 1 from public.nexra_search_console_query_pages p
       where p.project_id = p_project_id and p.query = p_source_ref
    ) then
      return pg_catalog.jsonb_build_object('outcome', 'keyword-not-found');
    end if;
  end if;

  insert into public.nexra_agent_tasks
    (project_id, title, source_kind, source_ref, owning_agent, status, priority, created_by)
  values
    (p_project_id, v_title, p_source_kind, p_source_ref, p_owning_agent, 'backlog', p_priority, p_operator)
  returning * into v_row;

  return pg_catalog.jsonb_build_object('outcome', 'created', 'task', pg_catalog.to_jsonb(v_row));
end;
$$;

comment on function public.nexra_agent_task_create(text, text, text, text, text, text, uuid) is
  'Records one operator-approved task in backlog for one registry agent on one project from a completed SEO Director run of that project or a query this product stored for it: created, project-not-found, run-not-found, run-not-completed, run-not-director or keyword-not-found. Dispatches nothing.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the create function.
-- Nothing else, for anyone.

alter table public.nexra_agent_tasks enable row level security;

revoke all on function public.nexra_agent_task_create(text, text, text, text, text, text, uuid) from public;
revoke all on function public.nexra_agent_tasks_guard_update() from public;
revoke all on function public.nexra_agent_tasks_guard_remove() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_agent_tasks from %I', v_role);
      execute format('revoke all on function public.nexra_agent_task_create(text, text, text, text, text, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_agent_tasks_guard_update() from %I', v_role);
      execute format('revoke all on function public.nexra_agent_tasks_guard_remove() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_agent_tasks to service_role;
    grant execute on function public.nexra_agent_task_create(text, text, text, text, text, text, uuid) to service_role;
  end if;
end
$$;
