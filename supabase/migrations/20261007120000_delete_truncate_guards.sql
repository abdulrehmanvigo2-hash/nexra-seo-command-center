-- Delete and truncate guards on the records the product never removes
-- (Phase 5, checkpoint 5.4, design note 5.1 part D1, decision Q7).
--
-- WHY. The hardening audit (5.1, D1) found five tables whose rows the
-- application never deletes but which nothing in the database protects:
-- `projects`, `agent_runs`, `agent_run_attempts`, `nexra_crawls` (with its
-- pages and links) and `nexra_content_drafts`. service_role holds DELETE on
-- each, granted "for maintenance" (20260913210000, 20260914120000,
-- 20260916120000, 20260920120100, 20260922120100), and no guard refuses a
-- DELETE or a TRUNCATE. Every later record table (articles and their
-- versions, check units, approvals, both proposal tables, Search Console
-- snapshots and query pages, findings, triage, tasks, task events,
-- keywords, keyword events) is already guarded. This migration closes the
-- gap as the operator decided, table by table. No grant, row, function,
-- column, constraint or existing trigger is changed; the guards are new
-- triggers only.
--
-- PER TABLE.
--
--   * `projects` — refuse DELETE and TRUNCATE. A project is the root every
--     record hangs from; every child table references it `on delete
--     restrict`, so a delete already failed wherever a child row existed,
--     but a project without children could be deleted, and a TRUNCATE ...
--     CASCADE would have reached every child. The application never
--     deletes a project. A project delete now fails with check_violation
--     (23514) before any foreign key is consulted.
--
--   * `agent_runs` — refuse DELETE and TRUNCATE. A run is the audit record
--     of an agent's work: drafts, articles, check units, task events and
--     the Director's bundles name runs by id, and the run history is how an
--     operator reads what an agent did. 20260914120000 granted DELETE "for
--     maintenance only — the application never deletes a run"; the guard
--     makes that true in the database.
--
--   * `agent_run_attempts` — refuse DELETE and TRUNCATE. An attempt is the
--     execution record of a run (who leased it, when, what it answered);
--     it has an insert and update guard (20260916120000) but no delete
--     guard, and it cascades from its run, which can no longer be deleted.
--     The worker and the recovery job update attempts; nothing deletes one.
--
--   * `nexra_crawls`, `nexra_crawl_pages`, `nexra_crawl_links` — refuse
--     TRUNCATE only. DELETE stays: removing an old crawl is a housekeeping
--     job (20260920120100), and a deleted crawl takes its pages and links
--     with it by cascade. NOTE THE CASCADE: deleting a crawl also removes
--     its findings reports and findings (20260928120000, whose own guards
--     let a cascade through) and the triage decisions made on them
--     (20261002120000) — a crawl delete is a deliberate act that erases that
--     crawl's whole record. A TRUNCATE is never housekeeping: it would empty
--     every crawl of every project at once, and is refused on all three.
--
--   * `nexra_content_drafts` — unchanged. The draft store's one delete is a
--     compensating delete of a parent draft when inserting its version 1
--     fails (src/lib/content/drafts/supabase/store.ts), and it needs the
--     DELETE path. A draft that has versions already cannot be deleted in
--     practice: its versions refuse delete and truncate, cascade included
--     (20260922130100).
--
-- ERRORS. Every guard raises check_violation (23514) with a message naming
-- the table, as the earlier guards do. A superuser who disables triggers
-- can bypass them, as with every guard in this schema.
--
-- NAMING. Every new object carries the `nexra_` prefix, for the reason given
-- in 20260920120000; the unprefixed crawl tables of the separate live
-- subsystem are not named here.

-- projects ------------------------------------------------------------------------------

create function public.nexra_projects_guard_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'projects: a project is never deleted or truncated'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_projects_guard_delete
  before delete on public.projects
  for each row execute function public.nexra_projects_guard_remove();
create trigger nexra_projects_guard_truncate
  before truncate on public.projects
  for each statement execute function public.nexra_projects_guard_remove();

-- agent_runs ----------------------------------------------------------------------------

create function public.nexra_agent_runs_guard_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'agent_runs: a run is never deleted or truncated'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_agent_runs_guard_delete
  before delete on public.agent_runs
  for each row execute function public.nexra_agent_runs_guard_remove();
create trigger nexra_agent_runs_guard_truncate
  before truncate on public.agent_runs
  for each statement execute function public.nexra_agent_runs_guard_remove();

-- agent_run_attempts --------------------------------------------------------------------

create function public.nexra_agent_run_attempts_guard_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'agent_run_attempts: an attempt is never deleted or truncated'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_agent_run_attempts_guard_delete
  before delete on public.agent_run_attempts
  for each row execute function public.nexra_agent_run_attempts_guard_remove();
create trigger nexra_agent_run_attempts_guard_truncate
  before truncate on public.agent_run_attempts
  for each statement execute function public.nexra_agent_run_attempts_guard_remove();

-- crawls, their pages and links: TRUNCATE only -------------------------------------------

create function public.nexra_crawls_guard_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%: crawl records are never truncated; delete an old crawl instead (its pages, links, findings and triage go with it)', tg_table_name
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_crawls_guard_truncate
  before truncate on public.nexra_crawls
  for each statement execute function public.nexra_crawls_guard_truncate();
create trigger nexra_crawl_pages_guard_truncate
  before truncate on public.nexra_crawl_pages
  for each statement execute function public.nexra_crawls_guard_truncate();
create trigger nexra_crawl_links_guard_truncate
  before truncate on public.nexra_crawl_links
  for each statement execute function public.nexra_crawls_guard_truncate();

-- The guard functions are trigger functions only; no API role calls them directly.
revoke all on function public.nexra_projects_guard_remove() from public;
revoke all on function public.nexra_agent_runs_guard_remove() from public;
revoke all on function public.nexra_agent_run_attempts_guard_remove() from public;
revoke all on function public.nexra_crawls_guard_truncate() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_projects_guard_remove() from %I', v_role);
      execute format('revoke all on function public.nexra_agent_runs_guard_remove() from %I', v_role);
      execute format('revoke all on function public.nexra_agent_run_attempts_guard_remove() from %I', v_role);
      execute format('revoke all on function public.nexra_crawls_guard_truncate() from %I', v_role);
    end if;
  end loop;
end;
$$;
