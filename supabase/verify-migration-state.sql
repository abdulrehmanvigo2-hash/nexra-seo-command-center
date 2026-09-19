-- READ-ONLY migration-state verification. Temporary; delete once reconciled.
--
-- Answers one question: is the schema that migrations 20260916120000,
-- 20260917120000 and 20260918120000 create already present on the remote
-- database, in full? `supabase migration repair` is a promise to the CLI that
-- it is, and the CLI never checks again, so the promise has to be earned first.
--
-- Every statement below reads a catalog. Nothing is created, altered, dropped,
-- granted or written. It is safe to run against production.
--
-- One result table. The `SUMMARY` rows near the bottom are the answer; the
-- rows above them say which object failed when one does.

with wanted(migration, kind, name) as (values
  -- 20260916120000_add_agent_run_attempts.sql
  ('20260916120000','table','agent_run_attempts'),
  ('20260916120000','index','agent_run_attempts_one_running'),
  ('20260916120000','index','agent_run_attempts_expiring'),
  ('20260916120000','constraint','agent_run_attempts_run_fkey'),
  ('20260916120000','constraint','agent_run_attempts_number_unique'),
  ('20260916120000','constraint','agent_run_attempts_number_range'),
  ('20260916120000','constraint','agent_run_attempts_worker_id_format'),
  ('20260916120000','constraint','agent_run_attempts_outcome_valid'),
  ('20260916120000','constraint','agent_run_attempts_result_metadata_bounded'),
  ('20260916120000','constraint','agent_run_attempts_error_code_format'),
  ('20260916120000','constraint','agent_run_attempts_error_message_length'),
  ('20260916120000','constraint','agent_run_attempts_error_pair'),
  ('20260916120000','constraint','agent_run_attempts_times_ordered'),
  ('20260916120000','constraint','agent_run_attempts_state_consistent'),
  ('20260916120000','trigger','agent_run_attempts_guard'),
  ('20260916120000','trigger','agent_runs_close_cancelled_attempt'),
  ('20260916120000','function','agent_run_attempts_guard'),
  ('20260916120000','function','agent_runs_close_cancelled_attempt'),
  ('20260916120000','function','agent_run_claim'),
  ('20260916120000','function','agent_run_heartbeat'),
  ('20260916120000','function','agent_run_finish'),
  ('20260916120000','function','agent_run_recover_expired'),
  -- 20260917120000_agent_runtime_production.sql
  ('20260917120000','column','agent_runs.next_attempt_at'),
  ('20260917120000','column','agent_runs.auto_retry_count'),
  ('20260917120000','constraint','agent_runs_next_attempt_only_queued'),
  ('20260917120000','constraint','agent_runs_auto_retry_count_range'),
  ('20260917120000','index','agent_runs_queue_due'),
  ('20260917120000','index','agent_runs_failed_recent'),
  ('20260917120000','table','rate_limit_windows'),
  ('20260917120000','index','rate_limit_windows_expiry'),
  ('20260917120000','function','agent_run_schedule_retries'),
  ('20260917120000','function','agent_runtime_status'),
  ('20260917120000','function','rate_limit_consume')
),

catalog_checks as (
  select w.migration, w.kind, w.name,
    case w.kind
      when 'table' then to_regclass('public.' || w.name) is not null
      when 'index' then exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = w.name and c.relkind = 'i')
      when 'constraint' then exists (
        select 1 from pg_constraint where conname = w.name)
      when 'trigger' then exists (
        select 1 from pg_trigger where tgname = w.name and not tgisinternal)
      when 'function' then exists (
        select 1 from pg_proc
        where pronamespace = 'public'::regnamespace and proname = w.name)
      when 'column' then exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name  = split_part(w.name, '.', 1)
          and column_name = split_part(w.name, '.', 2))
      else false
    end as present
  from wanted w
),

-- Checks that are not a plain "does this object exist": the executor widening
-- that proves 20260917120000 ran, the access model, and the one function body
-- that is all 20260918120000 changes.
extra_checks(migration, kind, name, present) as (
  select '20260916120000', 'rls', 'agent_run_attempts row level security',
    coalesce((select relrowsecurity from pg_class
              where oid = to_regclass('public.agent_run_attempts')), false)
  union all
  -- Privileges are read with has_table_privilege rather than
  -- information_schema.role_table_grants: the information_schema view shows
  -- only grants the *calling* role can see, so it can report a grant missing
  -- that is merely invisible. has_table_privilege answers for the named role.
  select '20260916120000', 'grant', 'service_role may select agent_run_attempts',
    coalesce((select has_table_privilege('service_role', 'public.agent_run_attempts', 'SELECT')
              where to_regclass('public.agent_run_attempts') is not null), false)
  union all
  select '20260916120000', 'grant', 'service_role may delete agent_run_attempts',
    coalesce((select has_table_privilege('service_role', 'public.agent_run_attempts', 'DELETE')
              where to_regclass('public.agent_run_attempts') is not null), false)
  union all
  select '20260916120000', 'grant', 'service_role may NOT write agent_run_attempts',
    coalesce((select not has_table_privilege('service_role', 'public.agent_run_attempts', 'INSERT')
                 and not has_table_privilege('service_role', 'public.agent_run_attempts', 'UPDATE')
              where to_regclass('public.agent_run_attempts') is not null), false)
  union all
  select '20260916120000', 'grant', 'anon/authenticated hold nothing on agent_run_attempts',
    coalesce((select not exists (
                select 1 from unnest(array['anon','authenticated']) as r(role)
                where exists (select 1 from pg_roles where rolname = r.role)
                  and has_table_privilege(r.role, 'public.agent_run_attempts',
                                          'SELECT, INSERT, UPDATE, DELETE'))
              where to_regclass('public.agent_run_attempts') is not null), false)
  union all
  select '20260917120000', 'constraint', 'agent_runs executor allows mock and ai',
    exists (select 1 from pg_constraint
            where conname = 'agent_runs_executor_valid'
              and pg_get_constraintdef(oid) like '%''ai''%')
  union all
  select '20260917120000', 'constraint', 'agent_run_attempts executor allows mock and ai',
    exists (select 1 from pg_constraint
            where conname = 'agent_run_attempts_executor_valid'
              and pg_get_constraintdef(oid) like '%''ai''%')
  union all
  select '20260917120000', 'rls', 'rate_limit_windows row level security',
    coalesce((select relrowsecurity from pg_class
              where oid = to_regclass('public.rate_limit_windows')), false)
  union all
  select '20260917120000', 'grant', 'anon/authenticated hold nothing on rate_limit_windows',
    coalesce((select not exists (
                select 1 from unnest(array['anon','authenticated']) as r(role)
                where exists (select 1 from pg_roles where rolname = r.role)
                  and has_table_privilege(r.role, 'public.rate_limit_windows',
                                          'SELECT, INSERT, UPDATE, DELETE'))
              where to_regclass('public.rate_limit_windows') is not null), false)
  union all
  -- 20260918120000 creates no object. It re-issues agent_runs_guard_update()
  -- with one addition: `new.finished_at := now()` on a cancellation. The
  -- 20260917120000 version of the same function sets only `updated_at` from
  -- now(), so that assignment is the fingerprint that tells the two apart.
  select '20260918120000', 'function-body', 'agent_runs_guard_update takes the cancel time from the database clock',
    exists (select 1 from pg_proc
            where pronamespace = 'public'::regnamespace
              and proname = 'agent_runs_guard_update'
              and prosrc ~ 'finished_at\s*:=\s*now\(\)')
),

all_checks as (
  select * from catalog_checks
  union all
  select * from extra_checks
),

summary as (
  select migration,
         bool_and(present) as ok,
         coalesce(string_agg(kind || ' ' || name, '; ')
                  filter (where not present), '') as missing_list
  from all_checks
  group by migration
)

select 1 as section,
       migration,
       kind || ': ' || name as object,
       case when present then 'OK' else '*** MISSING ***' end as status
from all_checks

union all
select 2,
       migration,
       'SUMMARY',
       case when ok then 'PASS - safe to repair'
            else 'MISSING - do not repair: ' || missing_list end
from summary

union all
select 3,
       'HISTORY',
       'supabase_migrations.schema_migrations',
       coalesce((select string_agg(version, ', ' order by version)
                 from supabase_migrations.schema_migrations),
                '*** EMPTY ***')

union all
select 3,
       'PRECONDITION',
       'agent_runs currently running (only matters if a repair is refused)',
       coalesce((select count(*)::text from public.agent_runs
                 where status = 'running'
                   and to_regclass('public.agent_runs') is not null), 'n/a')

order by 1, 2, 3;
