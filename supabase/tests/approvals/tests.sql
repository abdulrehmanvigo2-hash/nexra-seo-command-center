-- Approval records (Phase 6, checkpoint 6.8, migration 20261009120000): one decision on one exact action, consumed once.
-- Sections A (schema and security), B (recording: outcomes and refusals), C (consuming: every refusal, then single use),
-- D (the guards, for any writer), E (isolation, and the claim gate untouched). Runs over c4/setup.sql and gsc/setup.sql
-- (projects halcyon-fintech and verdant-home, t.ok, t.err). Part of the local PostgreSQL test harness; run only through
-- supabase/tests/run.sh, which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

create function t.aop() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000aa'::uuid $$;
create function t.other_op() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000bb'::uuid $$;
create function t.target(n int default 1) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-00000000000' || n)::uuid $$;
create function t.digest(s text default 'payload-1') returns text language sql immutable as $$ select encode(sha256(convert_to(s, 'UTF8')), 'hex') $$;
create function t.decide(p_decision text default 'approve', p_target uuid default null, p_digest text default null, p_project text default 'halcyon-fintech', p_ttl int default 60, p_kind text default 'article-publication') returns jsonb language sql as $$
  select public.nexra_approval_record(p_project, p_kind, coalesce(p_target, t.target()), coalesce(p_digest, t.digest()), p_decision, t.aop(), p_ttl) $$;
create function t.use(p_id uuid, p_target uuid default null, p_digest text default null, p_project text default 'halcyon-fintech', p_kind text default 'article-publication') returns text language sql as $$
  select public.nexra_approval_consume(p_project, p_id, p_kind, coalesce(p_target, t.target()), coalesce(p_digest, t.digest()), t.other_op())->>'outcome' $$;
create function t.idof(r jsonb) returns uuid language sql immutable as $$ select (r->'approval'->>'id')::uuid $$;
grant execute on all functions in schema t to service_role;

create table t.runs_before as select id, status, attempt_count from agent_runs;

-- A: the schema and its security.
do $$
begin
  perform t.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'nexra_approvals')
    = array['id','project_id','action_kind','target_id','payload_sha256','decision','decided_by','decided_at','expires_at','used_at','used_by'], 'A the columns');
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_approvals'::regclass) and (select count(*) from pg_policy where polrelid = 'public.nexra_approvals'::regclass) = 0, 'A RLS on, no policies');
  perform t.ok((select array_agg(privilege_type::text order by privilege_type::text) from information_schema.table_privileges where table_name = 'nexra_approvals' and grantee = 'service_role') = array['SELECT'], 'A service_role: SELECT only on the table');
  perform t.ok((select count(*) from information_schema.table_privileges where table_name = 'nexra_approvals' and grantee in ('anon', 'authenticated', 'PUBLIC')) = 0, 'A anon, authenticated and PUBLIC: nothing on the table');
  perform t.ok((select array_agg(proname::text order by proname) from pg_proc where proname like 'nexra_approval%' and prosecdef) = array['nexra_approval_consume','nexra_approval_record'], 'A exactly the two write functions are security definer');
  perform t.ok((select bool_and(proconfig = array['search_path=""']) from pg_proc where proname like 'nexra_approval%'), 'A every approval function has an empty search_path');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_approval_record(text,text,uuid,text,text,uuid,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.nexra_approval_consume(text,uuid,text,uuid,text,uuid)', 'EXECUTE'), 'A service_role executes record and consume');
  perform t.ok(not has_function_privilege('anon', 'public.nexra_approval_record(text,text,uuid,text,text,uuid,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.nexra_approval_consume(text,uuid,text,uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('public', 'public.nexra_approval_consume(text,uuid,text,uuid,text,uuid)', 'EXECUTE'), 'A anon, authenticated and PUBLIC execute neither');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_approvals_guard_update()', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.nexra_approvals_guard_remove()', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.nexra_approvals_check_insert()', 'EXECUTE'), 'A no API role executes the guards');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_approvals'::regclass and not tgisinternal)
    = array['nexra_approvals_check_insert','nexra_approvals_guard_delete','nexra_approvals_guard_truncate','nexra_approvals_guard_update'], 'A the four triggers');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_approvals_action_kind_valid') like '%article-publication%', 'A one action kind: article-publication');
end $$;

-- B: recording, as service_role.
set role service_role;
do $$
declare r jsonb;
begin
  r := t.decide();
  perform t.ok(r->>'outcome' = 'recorded', 'B an approval: recorded');
  perform t.ok(r->'approval'->>'project_id' = 'halcyon-fintech' and r->'approval'->>'action_kind' = 'article-publication' and (r->'approval'->>'target_id')::uuid = t.target()
    and r->'approval'->>'payload_sha256' = t.digest() and r->'approval'->>'decision' = 'approve' and (r->'approval'->>'decided_by')::uuid = t.aop(), 'B the row binds the project, kind, target, digest, decision and operator');
  perform t.ok((r->'approval'->>'expires_at')::timestamptz = (r->'approval'->>'decided_at')::timestamptz + interval '60 minutes', 'B it expires after the lifetime given');
  perform t.ok(r->'approval'->>'used_at' is null and r->'approval'->>'used_by' is null, 'B it is recorded unused');
  perform t.ok(t.decide('refuse', t.target(2))->>'outcome' = 'recorded', 'B a refusal: recorded');
  perform t.ok(t.decide(p_project => 'no-such-project')->>'outcome' = 'project-not-found', 'B an unknown project: project-not-found');

  perform t.ok(t.err($q$select t.decide(p_kind => 'merge')$q$) = '22023', 'B an unknown action kind raises 22023');
  perform t.ok(t.err($q$select t.decide('maybe')$q$) = '22023', 'B a decision other than approve or refuse raises 22023');
  perform t.ok(t.err($q$select t.decide(p_digest => 'abc')$q$) = '22023', 'B a malformed digest raises 22023');
  perform t.ok(t.err(format($q$select t.decide(p_digest => %L)$q$, upper(t.digest()))) = '22023', 'B an uppercase digest raises 22023');
  perform t.ok(t.err($q$select t.decide(p_ttl => 0)$q$) = '22023' and t.err($q$select t.decide(p_ttl => 1441)$q$) = '22023', 'B a lifetime outside 1-1440 minutes raises 22023');
  perform t.ok(t.err($q$select public.nexra_approval_record('halcyon-fintech', 'article-publication', t.target(), t.digest(), 'approve', null, 60)$q$) = '22023', 'B a missing operator raises 22023');
  perform t.ok((select count(*) from nexra_approvals) = 2, 'B only the two recorded rows exist');
  perform t.ok(t.err($q$insert into public.nexra_approvals (project_id, action_kind, target_id, payload_sha256, decision, decided_by, expires_at) values ('halcyon-fintech', 'article-publication', t.target(), t.digest(), 'approve', t.aop(), now() + interval '1 hour')$q$) = '42501', 'B service_role cannot insert directly (42501)');
  perform t.ok(t.err($q$update public.nexra_approvals set used_at = now(), used_by = t.aop()$q$) = '42501', 'B service_role cannot update directly (42501)');
end $$;

-- C: consuming, as service_role: every refusal writes nothing; then exactly one use.
do $$
declare a uuid; b uuid; c uuid; d uuid; ref uuid;
begin
  a := t.idof(t.decide(p_target => t.target(3), p_digest => t.digest('p3')));
  perform t.ok(t.use(gen_random_uuid(), t.target(3), t.digest('p3')) = 'approval-not-found', 'C an unknown approval: approval-not-found');
  perform t.ok(t.use(a, t.target(3), t.digest('p3'), 'verdant-home') = 'approval-not-found', 'C another project''s approval: approval-not-found');
  perform t.ok(t.use(a, t.target(4), t.digest('p3')) = 'action-mismatch', 'C another target: action-mismatch');
  perform t.ok(t.use(a, t.target(3), t.digest('p3'), p_kind => 'other-kind') = 'action-mismatch', 'C another kind: action-mismatch');
  perform t.ok(t.use(a, t.target(3), t.digest('p3-changed')) = 'digest-mismatch', 'C another payload digest: digest-mismatch');
  perform t.ok((select used_at is null from nexra_approvals where id = a), 'C the refusals left it unused');
  perform t.ok(t.use(a, t.target(3), t.digest('p3')) = 'consumed', 'C the exact action: consumed');
  perform t.ok((select used_at is not null and used_by = t.other_op() and used_at < expires_at from nexra_approvals where id = a), 'C used_at and used_by are stamped, before expiry');
  perform t.ok(t.use(a, t.target(3), t.digest('p3')) = 'used', 'C a second use: used');
  perform t.ok(t.use(a, t.target(3), t.digest('p3-changed')) = 'digest-mismatch', 'C a used approval with another digest: digest-mismatch (the payload is checked first)');

  ref := t.idof(t.decide('refuse', t.target(5), t.digest('p5')));
  perform t.ok(t.use(ref, t.target(5), t.digest('p5')) = 'refused', 'C a refusal is never consumed: refused');
  perform t.ok((select used_at is null from nexra_approvals where id = ref), 'C the refusal stays unused');

  b := t.idof(t.decide(p_target => t.target(6), p_digest => t.digest('p6')));
  perform t.ok(t.decide('refuse', t.target(6), t.digest('p6'))->>'outcome' = 'recorded', 'C setup: a later refusal of the same action');
  perform t.ok(t.use(b, t.target(6), t.digest('p6')) = 'superseded', 'C an approval revoked by a later refusal: superseded');
  c := t.idof(t.decide(p_target => t.target(7), p_digest => t.digest('p7')));
  d := t.idof(t.decide(p_target => t.target(7), p_digest => t.digest('p7b')));
  perform t.ok(t.use(c, t.target(7), t.digest('p7')) = 'superseded', 'C an approval followed by a newer approval of the same action: superseded');
  perform t.ok(t.use(d, t.target(7), t.digest('p7b')) = 'consumed', 'C the newest approval is the one that is used');
  perform t.ok((select count(*) from nexra_approvals where used_at is not null) = 2, 'C exactly two approvals were used');

  perform t.ok(t.err($q$select public.nexra_approval_consume('halcyon-fintech', null, 'article-publication', t.target(), t.digest(), t.aop())$q$) = '22023', 'C a missing approval id raises 22023');
  perform t.ok(t.err($q$select public.nexra_approval_consume('halcyon-fintech', gen_random_uuid(), 'article-publication', t.target(), t.digest(), null)$q$) = '22023', 'C a missing operator raises 22023');
end $$;
reset role;

-- Expiry: an approval decided 90 minutes ago with a 60-minute lifetime. Backdated as the owner under the replica role,
-- which bypasses the guards; this is the harness's device, not a path any role has.
do $$
declare e uuid;
begin
  e := t.idof(t.decide(p_target => t.target(8), p_digest => t.digest('p8')));
  set local session_replication_role = replica;
  update nexra_approvals set decided_at = decided_at - interval '90 minutes', expires_at = expires_at - interval '90 minutes' where id = e;
  set local session_replication_role = origin;
  perform set_config('t.expired', e::text, false);
end $$;
set role service_role;
do $$
declare e uuid := current_setting('t.expired')::uuid;
begin
  perform t.ok(t.use(e, t.target(8), t.digest('p8')) = 'expired', 'C an approval past its expiry: expired');
  perform t.ok((select used_at is null from nexra_approvals where id = e), 'C the expired approval stays unused');
  perform t.ok(t.use(e, t.target(8), t.digest('p8-x')) = 'digest-mismatch', 'C an expired approval with another digest: digest-mismatch');
end $$;
reset role;

-- D: the guards, for any writer (the owner here).
do $$
declare a uuid := (select id from nexra_approvals where used_at is not null order by decided_at limit 1);
        f uuid := (select id from nexra_approvals where used_at is null and decision = 'approve' and target_id = t.target() limit 1);
begin
  perform t.ok(t.err(format($q$update public.nexra_approvals set payload_sha256 = %L where id = %L$q$, t.digest('x'), f)) = '23514', 'D the digest never changes (23514)');
  perform t.ok(t.err(format($q$update public.nexra_approvals set decision = 'refuse' where id = %L$q$, f)) = '23514', 'D a decision never changes (23514)');
  perform t.ok(t.err(format($q$update public.nexra_approvals set expires_at = expires_at + interval '1 minute' where id = %L$q$, f)) = '23514', 'D the expiry never moves (23514)');
  perform t.ok(t.err(format($q$update public.nexra_approvals set used_at = now(), used_by = t.aop() where id = %L$q$, f)) = '23514', 'D an approval is used only through consume (23514)');
  perform set_config('nexra.approval_consume', a::text, true);
  perform t.ok(t.err(format($q$update public.nexra_approvals set used_at = null, used_by = null where id = %L$q$, a)) = '23514', 'D even under the flag, a used approval is never unused (23514)');
  perform set_config('nexra.approval_consume', '', true);
  perform t.ok(t.err(format($q$delete from public.nexra_approvals where id = %L$q$, f)) = '23514', 'D a decision is never deleted (23514)');
  perform t.ok(t.err($q$truncate public.nexra_approvals$q$) = '23514', 'D the table is never truncated (23514)');
  perform t.ok(t.err($q$insert into public.nexra_approvals (project_id, action_kind, target_id, payload_sha256, decision, decided_by, expires_at, used_at, used_by) values ('halcyon-fintech', 'article-publication', t.target(), t.digest(), 'approve', t.aop(), now() + interval '1 hour', now(), t.aop())$q$) = '23514', 'D a decision is never recorded already used (23514)');
  perform t.ok(t.err($q$insert into public.nexra_approvals (project_id, action_kind, target_id, payload_sha256, decision, decided_by, expires_at) values ('halcyon-fintech', 'article-publication', t.target(), t.digest(), 'approve', t.aop(), now() + interval '25 hours')$q$) = '23514', 'D an expiry beyond 24 hours is refused (23514)');
  perform t.ok(t.err($q$insert into public.nexra_approvals (project_id, action_kind, target_id, payload_sha256, decision, decided_by, expires_at) values ('halcyon-fintech', 'article-publication', t.target(), t.digest(), 'approve', t.aop(), now())$q$) = '23514', 'D an expiry under one minute is refused (23514)');
  perform t.ok(t.err($q$insert into public.nexra_approvals (project_id, action_kind, target_id, payload_sha256, decision, decided_by, expires_at) values ('no-such-project', 'article-publication', t.target(), t.digest(), 'approve', t.aop(), now() + interval '1 hour')$q$) = '23503', 'D a row names a stored project (23503)');
  perform t.ok(t.err($q$delete from public.projects where id = 'halcyon-fintech'$q$) in ('23503', '23514'), 'D a project with decisions is never deleted');
end $$;

-- E: isolation, and the claim gate untouched.
do $$
begin
  perform t.ok((select count(*) from nexra_approvals where project_id = 'verdant-home') = 0, 'E verdant holds no decision: nothing crossed projects');
  perform t.ok((select count(*) from (select id, status, attempt_count from agent_runs except select * from t.runs_before) d) = 0, 'E no run was queued, claimed or changed');
  perform t.ok(position('nexra_approval' in (select prosrc from pg_proc where proname = 'agent_run_claim')) = 0, 'E the run-claim gate does not read approvals');
end $$;
