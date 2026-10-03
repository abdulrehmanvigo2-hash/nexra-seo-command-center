-- M2 opportunities upgrade, second half (after migration 20261021120000): every task, event, map and cluster row is
-- unchanged, the task create function is untouched and still refuses the new kind, and an opportunity can be accepted.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record; m uuid;
begin
  select * into b from t21u.before;
  perform t.ok(t21u.rows() = b.r, 'U every task, event, map and cluster row is unchanged, byte for byte');
  perform t.ok(t21u.def('public.nexra_agent_task_create(text,text,text,text,text,text,uuid)'::regprocedure) = b.cd, 'U the task create function is untouched');
end $$;
do $$
begin
  perform t.ok(t.err($q$select t.task(p_kind => 'opportunity', p_ref => 'x')$q$) = '22023', 'U the create function still refuses the opportunity kind (22023)');
end $$;
do $$
declare m uuid; r jsonb;
begin
  m := t21.map();
  r := t21.accept(t21.opp(m, t21.cid(m, 1)));
  perform t.ok(r->>'outcome' = 'accepted' and r->'task'->>'source_kind' = 'opportunity', 'U after: an opportunity is accepted with its task');
end $$;
