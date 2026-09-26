-- Agent tasks (Project Manager real task core): fixtures over c4/setup.sql (projects, t.ok(), agent_runs) and gsc/setup.sql (t.snap(), t.err()).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1

-- Runs to record tasks from. Written under replica role like c4/setup.sql: the runtime's
-- lifecycle triggers are not what is under test here.
set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count, error_code, error_message) values
 ('d0000000-0000-4000-8000-000000000001','halcyon-fintech','seo-director','project-priority-review',repeat('a',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','PRIORITY 1 …',1,null,null),
 ('d0000000-0000-4000-8000-000000000002','halcyon-fintech','seo-director','priority-review',repeat('b',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','PRIORITY 1 …',1,null,null),
 ('d0000000-0000-4000-8000-000000000003','halcyon-fintech','seo-director','project-priority-review',repeat('c',64),'queued','00000000-0000-4000-8000-0000000000aa',null,null,null,null,0,null,null),
 ('d0000000-0000-4000-8000-000000000004','halcyon-fintech','seo-director','project-priority-review',repeat('d',64),'failed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai',null,1,'execution-failed','The attempt failed.'),
 ('d0000000-0000-4000-8000-000000000005','halcyon-fintech','technical-seo','crawl-review',repeat('e',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','OBSERVED …',1,null,null),
 ('d0000000-0000-4000-8000-000000000006','verdant-home','seo-director','project-priority-review',repeat('f',64),'completed','00000000-0000-4000-8000-0000000000aa',now(),now(),'ai','PRIORITY 1 …',1,null,null);
set session_replication_role = origin;

-- Stored Search Console evidence: one halcyon snapshot with two top queries, and one verdant
-- snapshot with a query halcyon never stored.
select t.ok((t.snap(p_queries => '[{"key":"business banking","clicks":40,"impressions":900,"ctr":0.0444,"position":8.2},{"key":"halcyon fintech","clicks":30,"impressions":100,"ctr":0.3,"position":1.4}]',
  p_pages => '[{"key":"https://halcyon.example/","clicks":50,"impressions":1200,"ctr":0.0417,"position":3.0}]')->>'outcome') = 'created', 'setup: halcyon snapshot recorded');
select t.ok((t.snap(p_project => 'verdant-home', p_property => 'sc-domain:verdant.example',
  p_queries => '[{"key":"garden sheds","clicks":10,"impressions":500,"ctr":0.02,"position":14.0}]',
  p_pages => '[{"key":"https://verdant.example/","clicks":10,"impressions":500,"ctr":0.02,"position":14.0}]')->>'outcome') = 'created', 'setup: verdant snapshot recorded');

create function t.op() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000aa'::uuid $$;

-- Create with sensible defaults; every argument overridable.
create function t.task(
  p_project text default 'halcyon-fintech',
  p_title text default 'Write the missing /services meta description',
  p_kind text default 'director-run',
  p_ref text default 'd0000000-0000-4000-8000-000000000001',
  p_agent text default 'on-page-seo',
  p_priority text default 'medium',
  p_operator uuid default null
) returns jsonb language sql as $$
  select public.nexra_agent_task_create(p_project, p_title, p_kind, p_ref, p_agent, p_priority, coalesce(p_operator, t.op()))
$$;

-- Section B runs one block as service_role: it may use the helpers, never a table directly.
grant execute on all functions in schema t to service_role;
