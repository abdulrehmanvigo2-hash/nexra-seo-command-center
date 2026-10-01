-- F8 check-result carry-forward (migration 20261014120000): A schema and security; B carry — each condition, each
-- refusal; C the guards; D fresh check; E the approval's carried units; F the record path unchanged. Part of the local
-- PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema and security.
do $$
begin
  perform t.ok((select count(*) from information_schema.columns where table_name = 'nexra_article_check_units'
    and column_name in ('carried_from_unit_id','carried_from_version','carry_basis','carried_instructions_sha256','carried_evidence_sha256') and is_nullable = 'YES') = 5,
    'A five nullable carry columns on the unit table');
  perform t.ok((select column_default from information_schema.columns where table_name = 'nexra_article_approvals' and column_name = 'carried_units') like '''[]''::jsonb%',
    'A approvals.carried_units defaults to []');
  perform t.ok((select bool_and(prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres') from pg_proc
    where proname in ('nexra_article_check_unit_carry','nexra_article_check_unit_fresh')), 'A carry and fresh: security definer, empty search_path, owned by postgres');
  perform t.ok((select bool_and(not prosecdef and proconfig = array['search_path=""']) from pg_proc
    where proname in ('nexra_article_check_units_check_carry','nexra_article_approvals_fill_carried','nexra_article_check_units_guard_update')), 'A the trigger functions: not security definer, empty search_path');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_article_check_unit_carry(text,uuid,smallint,uuid,smallint,text,text,smallint,smallint,smallint,text,uuid,text,text,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.nexra_article_check_unit_fresh(text,uuid,uuid,smallint,uuid)', 'EXECUTE'), 'A service_role may execute carry and fresh');
  perform t.ok(not has_function_privilege('anon', 'public.nexra_article_check_unit_carry(text,uuid,smallint,uuid,smallint,text,text,smallint,smallint,smallint,text,uuid,text,text,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.nexra_article_check_unit_fresh(text,uuid,uuid,smallint,uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.nexra_article_check_units_check_carry()', 'EXECUTE'), 'A anon and authenticated may not; nobody may call the trigger function');
end $$;

-- B: carry. Article A: version 1 checked under instructions v3 with evidence 1 (unit 2 holds one SUPPORTED
-- statement); version 2 shares units 0, 1, 2 and 3 byte for byte.
create table t9.a as select t6.article(40, t6.txt('carry-a')) as article_id;
do $$
declare a uuid := (select article_id from t9.a); r jsonb;
begin
  perform t9.rec(a, 1, 0, 'passed', t9.h(0,1));
  perform t9.rec(a, 1, 1, 'passed', t9.h(1,1));
  perform t9.rec(a, 1, 2, 'passed', t9.h(2,1), 1);
  perform t9.rec(a, 1, 3, 'passed', t9.h(3,1));
  perform t.ok(t9.status(a) = 'checked', 'B setup: version 1 fully passed is checked');
  r := t6.save(a, 1, t6.txt('carry-a', 'different-angle', 'A second lead.'));
  perform t.ok(r->>'outcome' = 'created' and t9.status(a) = 'drafting', 'B setup: version 2 saved, the article back to drafting');

  r := t9.carry(a, 2, 0, 1, t9.h(0,1));
  perform t.ok(r->>'outcome' = 'carried' and r->'record'->>'carry_basis' = 'no-supported' and r->'record'->>'carried_evidence_sha256' is null
    and (r->'record'->>'carried_from_version')::int = 1 and r->'record'->>'status' = 'passed', 'B no SUPPORTED statement: carried on that basis, no evidence hash');
  perform t.ok((select checked_by_run_id = (select checked_by_run_id from nexra_article_check_units where id = t9.unit(a,1,0))
    and result = (select result from nexra_article_check_units where id = t9.unit(a,1,0)) from nexra_article_check_units where id = t9.unit(a,2,0)),
    'B the carried row keeps the source run and its result exactly');
  perform t.ok(t9.carry(a, 2, 0, 1, t9.h(0,1))->>'outcome' = 'already-recorded', 'B a unit already recorded is not carried again');

  perform t.ok(t9.carry(a, 2, 1, 1, t9.h(1,1), t9.instr(4))->>'outcome' = 'source-not-eligible', 'B other instructions: not eligible');
  perform t.ok(t9.carry(a, 2, 1, 1, t9.h(1,2))->>'outcome' = 'source-not-eligible', 'B a different unit text: not eligible');
  perform t.ok(t9.carry(a, 2, 2, 1, t9.h(2,1), t9.instr(), t9.evid(2))->>'outcome' = 'source-not-eligible', 'B a SUPPORTED statement and changed evidence: not eligible');
  perform t.ok(t9.carry(a, 2, 2, 1, t9.h(2,1), t9.instr(), null)->>'outcome' = 'source-not-eligible', 'B a SUPPORTED statement and no evidence fingerprint: not eligible');
  r := t9.carry(a, 2, 2, 1, t9.h(2,1), t9.instr(), t9.evid(1));
  perform t.ok(r->>'outcome' = 'carried' and r->'record'->>'carry_basis' = 'evidence-unchanged' and r->'record'->>'carried_evidence_sha256' = t9.evid(1),
    'B a SUPPORTED statement with the evidence unchanged: carried on that basis');
  perform t.ok(t9.carry(a, 1, 3, 1, t9.h(3,1))->>'outcome' = 'not-current', 'B a version that is not current is not carried onto');
  perform t.ok(t9.carry(a, 2, 1, 1, t9.h(1,1))->>'outcome' = 'carried', 'B unit 1 carried');
  perform t.ok(t9.status(a) = 'drafting', 'B three of four units: still drafting');
  r := t9.carry(a, 2, 3, 1, t9.h(3,1));
  perform t.ok(r->>'outcome' = 'carried' and (r->>'article_status_advanced')::boolean and t9.status(a) = 'checked', 'B the last unit carried: the version is checked');
end $$;

-- B (cont.): sources that may not be carried from.
create table t9.b as select t6.article(41, t6.txt('carry-b')) as article_id;
do $$
declare a uuid := (select article_id from t9.b); r jsonb;
begin
  perform t9.rec(a, 1, 0, 'passed', t9.h(0,9), 0, null, null);       -- recorded before F8: no instructions hash
  perform t9.rec(a, 1, 1, 'needs-review', t9.h(1,9));
  perform t9.rec(a, 1, 2, 'passed', t9.h(2,9), 1, t9.instr(), null);  -- SUPPORTED, no evidence fingerprint recorded
  perform t9.rec(a, 1, 3, 'passed', t9.h(3,9));
  r := t6.save(a, 1, t6.txt('carry-b', 'different-angle', 'B lead two.'));
  perform t.ok(t9.carry(a, 2, 0, 1, t9.h(0,9))->>'outcome' = 'source-not-eligible', 'B a result recorded before F8 (no instructions hash) is never carried');
  perform t.ok(t9.carry(a, 2, 1, 1, t9.h(1,9))->>'outcome' = 'source-not-eligible', 'B a needs-review result is never carried');
  perform t.ok(t9.carry(a, 2, 2, 1, t9.h(2,9), t9.instr(), t9.evid(1))->>'outcome' = 'source-not-eligible', 'B a SUPPORTED result whose run recorded no evidence fingerprint is not carried');
  perform t.ok(t9.carry(a, 2, 3, 1, t9.h(3,9), t9.instr(), t9.evid(), t9.unit((select article_id from t9.a), 1, 3))->>'outcome' = 'source-not-eligible', 'B another article''s unit is not a source');
  -- A carried row is never a source: carry unit 3 onto version 2, then try to carry that row onto version 3.
  perform t.ok(t9.carry(a, 2, 3, 1, t9.h(3,9))->>'outcome' = 'carried', 'B setup: unit 3 carried onto version 2');
  r := t6.save(a, 2, t6.txt('carry-b', 'different-angle', 'B lead three.'));
  perform t.ok(t9.carry(a, 3, 3, 2, t9.h(3,9))->>'outcome' = 'source-not-eligible', 'B a carried row is never a source');
  perform t.ok(t9.carry(a, 3, 3, 1, t9.h(3,9))->>'outcome' = 'carried', 'B the original run-checked row still is');
  perform t.ok(t.err(format($q$select public.nexra_article_check_unit_carry('nexra-agency', %L, 3::smallint, %L, 0::smallint, 'metadata', 'metadata:1', 1::smallint, 1::smallint, 4::smallint, 'zz', %L, %L, null, '00000000-0000-4000-8000-0000000000aa')$q$,
    a, t5.vid(a,3), t9.unit(a,1,0), t9.instr())) = '22023', 'B a malformed hash: 22023');
  perform t.ok(public.nexra_article_check_unit_carry('verdant-home', a, 3::smallint, t5.vid(a,3), 0::smallint, 'metadata', 'metadata:1', 1::smallint, 1::smallint, 4::smallint,
    t9.h(0,9), t9.unit(a,1,0), t9.instr(), null, '00000000-0000-4000-8000-0000000000aa')->>'outcome' = 'not-found', 'B another project: not found');
end $$;

-- C: the guards.
do $$
declare a uuid := (select article_id from t9.a); src uuid := t9.unit((select article_id from t9.a), 1, 0);
begin
  perform t.ok(t.err(format($q$insert into nexra_article_check_units (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count,
      unit_sha256, status, result, checked_by_run_id, recorded_by, carried_from_unit_id, carried_from_version, carry_basis, carried_instructions_sha256)
    select article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count, unit_sha256, status, result, checked_by_run_id, recorded_by,
      %L, 1, 'no-supported', %L from nexra_article_check_units where id = %L$q$, src, t9.instr(), src)) = '23514', 'C a carried row written outside the carry function is refused (23514)');
  perform t.ok(t.err(format($q$update nexra_article_check_units set carry_basis = 'evidence-unchanged' where id = %L$q$, t9.unit(a,2,0))) = '23514', 'C the carry columns cannot be changed (23514)');
  perform t.ok(t.err(format($q$update nexra_article_check_units set carried_from_unit_id = null, carried_from_version = null, carry_basis = null, carried_instructions_sha256 = null where id = %L$q$, t9.unit(a,2,0))) = '23514',
    'C a carry cannot be cleared by hand (23514)');
  perform t.ok(t.err(format($q$update nexra_article_check_units set status = 'failed' where id = %L$q$, t9.unit(a,2,0))) = '23514', 'C a carried pass cannot be failed by hand (23514)');
  perform t.ok(t.err(format($q$delete from nexra_article_check_units where id = %L$q$, t9.unit(a,2,0))) = '23514', 'C a carried row is permanent history (23514)');
  perform t.ok(t.err(format($q$update nexra_article_check_units set status = 'failed' where id = %L$q$, src)) = '23514', 'C a checked pass is still final (23514)');
end $$;

-- D: fresh check.
do $$
declare a uuid := (select article_id from t9.a); r jsonb; rid uuid;
begin
  perform t.ok(t9.fresh(a, 2, 0)->>'outcome' = 'cleared' and t9.status(a) = 'drafting', 'D a carried unit cleared; the checked article returns to drafting');
  perform t.ok((select status = 'failed' and carried_from_unit_id is null and result->>'reason' = 'fresh-check-requested'
      and (result->'carriedFrom'->>'version')::int = 1 and result->'carriedFrom'->>'basis' = 'no-supported' from nexra_article_check_units where id = t9.unit(a,2,0)),
    'D the cleared row is failed, fresh-check-requested, the carry kept in its result');
  perform t.ok(t9.fresh(a, 2, 0)->>'outcome' = 'not-carried', 'D a cleared unit is not cleared twice');
  perform t.ok(t9.fresh(a, 1, 0)->>'outcome' = 'not-current', 'D an earlier version is not touched');
  -- The normal path checks it again: a new run, pending then passed.
  r := t9.rec(a, 2, 0, 'passed', t9.h(0,1));
  perform t.ok(r->>'outcome' = 'recorded' and r->'record'->>'carried_from_unit_id' is null and t9.status(a) = 'checked',
    'D a fresh run records the unit again; the version is checked once more');
end $$;

-- E: approval lists the carried units; an approved version refuses a fresh check.
do $$
declare a uuid := (select article_id from t9.a); r jsonb; c jsonb;
begin
  r := t9.approve(a, 2);
  perform t.ok(r->>'outcome' = 'approved', 'E version 2 approved');
  c := (select carried_units from nexra_article_approvals where article_id = a and article_version = 2);
  perform t.ok(jsonb_array_length(c) = 3 and (select array_agg((e->>'unitIndex')::int order by (e->>'unitIndex')::int) from jsonb_array_elements(c) e) = array[1,2,3],
    'E the approval lists exactly the three carried units (unit 0 was checked afresh)');
  perform t.ok((select bool_and((e->>'fromVersion')::int = 1 and e->>'runId' is not null and e->>'basis' in ('no-supported','evidence-unchanged')) from jsonb_array_elements(c) e),
    'E each names its source version, run and basis');
  perform t.ok(t9.fresh(a, 2, 1)->>'outcome' = 'approved', 'E an approved version refuses a fresh check');
  perform t.ok((select carried_units = '[]'::jsonb from nexra_article_approvals where article_id = (select article_id from t9.b) limit 1) is not false, 'E (no other approval yet carries anything)');
end $$;

-- F: the record path is unchanged for checked units.
do $$
declare a uuid := t6.article(42, t6.txt('carry-f')); r jsonb;
begin
  r := t9.rec(a, 1, 0, 'needs-review', t9.h(0,7));
  perform t.ok(r->>'outcome' = 'recorded' and r->'record'->>'carried_from_unit_id' is null, 'F a checked result records as before, with no carry');
  perform t.ok(t.err(format($q$update nexra_article_check_units set status = 'passed' where id = %L$q$, t9.unit(a,1,0))) = '23514', 'F needs-review is still final (23514)');
end $$;
