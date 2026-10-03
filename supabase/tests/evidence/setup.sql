-- M4 evidence (migration 20261025120000): helpers over the c4 … serp setups (t.ok, t.err, t.pop, t24.*). Part of the
-- local PostgreSQL test harness; run only through supabase/tests/run.sh. Never run against a hosted database.
\set ON_ERROR_STOP 1
create schema t25;

create function t25.text() returns text language sql immutable as $$
  select 'Alpha Corp says that   AI SDRs reply to inbound leads within one minute.' || chr(10) || 'They book meetings on the calendar. Pricing starts at 500 dollars a month.' $$;
create function t25.source(p_opp uuid, p_project text default 'halcyon-fintech', p_state text default 'fetched', p_text text default null, p_serp uuid default null,
  p_robots text default 'allowed', p_url text default 'https://alpha.example/guide') returns jsonb language sql as $$
  select public.nexra_evidence_source_record(p_project, p_opp, p_serp, p_url, case when p_state = 'fetched' then p_url end, p_state,
    case when p_state in ('fetched', 'http-error') then 200 end, p_robots, case when p_state = 'fetched' then 'Alpha guide' end,
    case when p_state = 'fetched' then coalesce(p_text, t25.text()) end, t.pop()) $$;
create function t25.sid(r jsonb) returns uuid language sql immutable as $$ select (r->'source'->>'id')::uuid $$;

-- An evidence-extract run for a source (completed and model-executed unless told otherwise).
create function t25.run(p_source uuid, p_project text default 'halcyon-fintech', p_status text default 'completed', p_executor text default 'ai',
  p_task text default 'evidence-extract', p_agent text default 'research-evidence') returns uuid language plpgsql security definer as $$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into agent_runs (id, project_id, agent_id, task_type, input, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count)
  values (v, p_project, p_agent, p_task, jsonb_build_object('sourceId', p_source::text), encode(sha256(convert_to(v::text, 'UTF8')), 'hex'), p_status, t.pop(),
    now(), case when p_status in ('completed', 'failed') then now() end, case when p_status = 'queued' then null else p_executor end,
    case when p_status = 'completed' then 'answer' end, 1);
  return v;
end $$;
create function t25.units() returns jsonb language sql immutable as $$
  select '[{"claim":"AI SDRs reply to inbound leads within one minute.","quote":"AI SDRs reply to inbound leads within one minute.","verdict":"supported"},
           {"claim":"They book meetings.","quote":"They book meetings on the\ncalendar.","verdict":"supported"},
           {"claim":"They never miss a lead.","quote":"They never miss a lead.","verdict":"supported"},
           {"claim":"Pricing is unclear.","quote":"Pricing starts at 500 dollars a month.","verdict":"needs-review"},
           {"claim":"They replace a sales team.","quote":"ai sdrs reply to inbound leads","verdict":"unsupported"}]'::jsonb $$;
create function t25.record(p_source uuid, p_run uuid, p_units jsonb default null, p_project text default 'halcyon-fintech') returns jsonb language sql as $$
  select public.nexra_evidence_units_record(p_project, p_source, p_run, coalesce(p_units, t25.units()), t.pop()) $$;
create function t25.unit(p_source uuid, p_pos int) returns uuid language sql as $$ select id from public.nexra_evidence_units where source_id = p_source and position = p_pos $$;
create function t25.decide(p_unit uuid, p_decision text, p_project text default 'halcyon-fintech') returns jsonb language sql as $$
  select public.nexra_evidence_unit_decide(p_project, p_unit, p_decision, t.pop()) $$;

grant usage on schema t25 to service_role;
grant execute on all functions in schema t25 to service_role;
