-- M4 evidence (migration 20261025120000): sections A (schema and security), B (source_record), C (units_record: the run
-- rule and the quote check in the database), D (decide), E (guards). Part of the local PostgreSQL test harness; run only
-- through supabase/tests/run.sh. Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$
declare t_ text; fn text;
begin
  foreach t_ in array array['nexra_evidence_sources', 'nexra_evidence_units'] loop
    perform t.ok((select relrowsecurity from pg_class where oid = ('public.' || t_)::regclass) and (select count(*) from pg_policy where polrelid = ('public.' || t_)::regclass) = 0, format('A %s: RLS on, no policies', t_));
    perform t.ok((select array_agg(privilege_type::text) from information_schema.table_privileges where table_name = t_ and grantee = 'service_role') = array['SELECT'], format('A %s: service_role holds SELECT only', t_));
    perform t.ok((select count(*) from information_schema.table_privileges where table_name = t_ and grantee in ('anon', 'authenticated', 'PUBLIC')) = 0, format('A %s: no other API role holds anything', t_));
    perform t.ok((select count(*) from pg_trigger where tgrelid = ('public.' || t_)::regclass and not tgisinternal and tgenabled = 'O') = 4, format('A %s: four guard triggers, enabled', t_));
  end loop;
  perform t.ok((select array_agg(proname::text order by proname) from pg_proc where proname like 'nexra_evidence%' and prosecdef)
    = array['nexra_evidence_source_record', 'nexra_evidence_unit_decide', 'nexra_evidence_units_record'], 'A exactly the three write functions are security definer');
  perform t.ok((select bool_and(proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres') from pg_proc where proname like 'nexra_evidence%'), 'A every evidence function: empty search_path, owned by postgres');
  foreach fn in array array['public.nexra_evidence_source_record(text,uuid,uuid,text,text,text,integer,text,text,text,uuid)', 'public.nexra_evidence_units_record(text,uuid,uuid,jsonb,uuid)', 'public.nexra_evidence_unit_decide(text,uuid,text,uuid)'] loop
    perform t.ok(has_function_privilege('service_role', fn, 'EXECUTE') and not has_function_privilege('anon', fn, 'EXECUTE') and not has_function_privilege('authenticated', fn, 'EXECUTE')
      and not has_function_privilege('public', fn, 'EXECUTE'), format('A %s: EXECUTE for service_role only', split_part(fn, '(', 1)));
  end loop;
  foreach fn in array array['public.nexra_evidence_collapse(text)', 'public.nexra_evidence_guard_insert()', 'public.nexra_evidence_guard_immutable()', 'public.nexra_evidence_units_guard_update()'] loop
    perform t.ok(not has_function_privilege('service_role', fn, 'EXECUTE') and not has_function_privilege('public', fn, 'EXECUTE'), format('A %s: executable by no API role', split_part(fn, '(', 1)));
  end loop;
end $$;

-- B: sources, as service_role.
create table t25.ctx (opp uuid, src uuid, other_opp uuid);
grant all on t25.ctx to service_role;
set role service_role;
do $$
declare o uuid; a uuid; q uuid; organic uuid; question uuid; r jsonb; s uuid;
begin
  o := t24.opp();
  a := t.rid(t24.reserve(o, p_mode => 'sandbox'));
  q := t.qid(t24.req(a));
  perform t24.record(a, q);
  perform t.finish(a, 'completed');
  organic := (select id from public.nexra_serp_results where run_id = a and result_type = 'organic' and rank = 1);
  question := (select id from public.nexra_serp_results where run_id = a and result_type = 'people-also-ask' and rank = 2);
  r := t25.source(o, p_serp => organic);
  perform t.ok(r->>'outcome' = 'recorded' and not (r->'source' ? 'page_text'), 'B a fetched source from an organic result: recorded (the answer carries no text)');
  s := t25.sid(r);
  perform t.ok((select text_sha256 = encode(sha256(convert_to(t25.text(), 'UTF8')), 'hex') and text_chars = char_length(t25.text()) and serp_result_id = organic from public.nexra_evidence_sources where id = s),
    'B the text''s SHA-256 and length are computed in the database');
  perform t.ok(t25.source(o, p_serp => question)->>'outcome' = 'serp-result-not-found', 'B a People Also Ask row is not a source''s SERP result: serp-result-not-found');
  perform t.ok(t25.source(gen_random_uuid())->>'outcome' = 'opportunity-not-found', 'B an unknown opportunity: opportunity-not-found');
  perform t.ok(t25.source(o, p_project => 'verdant-home')->>'outcome' = 'opportunity-not-found', 'B the opportunity through another project: opportunity-not-found');
  perform t.ok(t25.source(o, p_state => 'robots-disallowed', p_robots => 'disallowed')->>'outcome' = 'recorded', 'B a page robots.txt disallows: recorded with no text');
  perform t.ok(t.err(format($q$select t25.source(%L, p_state => 'robots-disallowed', p_robots => 'allowed')$q$, o)) = '23514', 'B a robots verdict that does not match the state raises 23514');
  perform t.ok(t.err(format($q$select public.nexra_evidence_source_record('halcyon-fintech', %L, null, 'https://x.example', null, 'http-error', 404, 'allowed', null, 'some text', t.pop())$q$, o)) = '23514', 'B text on a page that was not fetched raises 23514');
  perform t.ok(t.err(format($q$select t25.source(%L, p_text => repeat('x', 20001))$q$, o)) = '23514', 'B text over 20,000 characters raises 23514');
  perform t.ok(t.err(format($q$select t25.source(%L, p_url => 'file:///etc/passwd')$q$, o)) = '23514', 'B a non-http URL raises 23514');
  perform t.ok(t25.source(o, p_state => 'timeout')->>'outcome' = 'recorded', 'B a timeout: recorded, no text');
  perform t.ok(t25.source(o, p_state => 'http-error')->>'outcome' = 'recorded', 'B an HTTP error: recorded, no text');
  perform t.ok(t25.source(o, p_state => 'non-html')->>'outcome' = 'recorded', 'B a page that is not HTML: recorded, no text (the fifth source today)');
  perform t.ok(t25.source(o)->>'outcome' = 'source-limit', 'B a sixth source for the opportunity today: source-limit');
  insert into t25.ctx values (o, s, t24.opp('verdant-home'));
end $$;
reset role;

-- C: units, as service_role.
set role service_role;
do $$
declare o uuid; s uuid; r jsonb; run uuid; bad uuid; nofetch uuid;
begin
  select opp, src into o, s from t25.ctx;
  perform t.ok(t25.record(s, t25.run(s, p_executor => 'mock'))->>'outcome' = 'run-not-accepted', 'C a simulated (mock) run: run-not-accepted');
  perform t.ok(t25.record(s, t25.run(s, p_status => 'running'))->>'outcome' = 'run-not-accepted', 'C a run not completed: run-not-accepted');
  perform t.ok(t25.record(s, t25.run(s, p_task => 'article-check-unit'))->>'outcome' = 'run-not-accepted', 'C a run of another task: run-not-accepted');
  perform t.ok(t25.record(s, t25.run(gen_random_uuid()))->>'outcome' = 'run-not-accepted', 'C a run naming another source: run-not-accepted');
  perform t.ok(t25.record(s, t25.run(s, p_project => 'verdant-home'))->>'outcome' = 'run-not-accepted', 'C another project''s run: run-not-accepted');
  nofetch := (select id from public.nexra_evidence_sources where fetch_state = 'timeout');
  perform t.ok(t25.record(nofetch, t25.run(nofetch))->>'outcome' = 'source-not-fetched', 'C a source with no text: source-not-fetched');
  perform t.ok(t25.record(s, t25.run(s), p_project => 'verdant-home')->>'outcome' = 'source-not-found', 'C the source through another project: source-not-found');
  run := t25.run(s);
  perform t.ok(t25.record(s, run, '[]')->>'outcome' = 'invalid-unit', 'C no units: invalid-unit');
  perform t.ok(t25.record(s, run, (select jsonb_agg(e) from jsonb_array_elements(t25.units() || t25.units()) e))->>'outcome' = 'invalid-unit', 'C ten units: invalid-unit');
  perform t.ok(t25.record(s, run, '[{"claim":"x","quote":"y","verdict":"true"}]')->>'outcome' = 'invalid-unit', 'C an unknown verdict: invalid-unit');
  perform t.ok(t25.record(s, run, jsonb_build_array(jsonb_build_object('claim', 'x', 'quote', repeat('q', 301), 'verdict', 'supported')))->>'outcome' = 'invalid-unit', 'C a quote over 300 characters: invalid-unit');
  perform t.ok(t25.record(s, run, '[{"claim":"x","quote":"y","verdict":"supported","extra":1}]')->>'outcome' = 'invalid-unit', 'C an extra key: invalid-unit');
  perform t.ok(not exists (select 1 from public.nexra_evidence_units), 'C nothing written by a refused set');
  r := t25.record(s, run);
  perform t.ok(r->>'outcome' = 'recorded' and (r->>'units')::int = 5 and (r->>'found')::int = 3 and (r->>'supported')::int = 2, 'C five units recorded: three quotes found, two supported');
  perform t.ok((select quote_found and status = 'supported' from public.nexra_evidence_units where id = t25.unit(s, 1)), 'C a quote found word for word (whitespace collapsed in the page): supported');
  perform t.ok((select quote_found and status = 'supported' from public.nexra_evidence_units where id = t25.unit(s, 2)), 'C a quote broken across lines still matches the collapsed text: supported');
  perform t.ok((select not quote_found and status = 'needs-review' and run_verdict = 'supported' from public.nexra_evidence_units where id = t25.unit(s, 3)), 'C a quote not in the page: needs review, whatever the run said');
  perform t.ok((select quote_found and status = 'needs-review' from public.nexra_evidence_units where id = t25.unit(s, 4)), 'C the run''s needs-review stands even when the quote is found');
  perform t.ok((select not quote_found and status = 'unsupported' from public.nexra_evidence_units where id = t25.unit(s, 5)), 'C case is kept: a lower-case quote is not found; the run''s unsupported stands');
  perform t.ok((select bool_and(opportunity_id = o and decision = 'pending') from public.nexra_evidence_units), 'C every unit carries the source''s opportunity and starts pending');
  perform t.ok(t25.record(s, run)->>'outcome' = 'exists', 'C the same source and run again: exists');
end $$;
reset role;

-- D: decide, as service_role.
set role service_role;
do $$
declare s uuid; r jsonb;
begin
  select src into s from t25.ctx;
  r := t25.decide(t25.unit(s, 1), 'admitted');
  perform t.ok(r->>'outcome' = 'admitted' and r->'unit'->>'decided_by' = t.pop()::text, 'D a supported unit with its quote found: admitted, by the operator');
  perform t.ok(t25.decide(t25.unit(s, 1), 'rejected')->>'outcome' = 'already-decided', 'D a decided unit: already-decided');
  perform t.ok(t25.decide(t25.unit(s, 3), 'admitted')->>'outcome' = 'not-admissible', 'D a quote not found: not-admissible');
  perform t.ok(t25.decide(t25.unit(s, 4), 'admitted')->>'outcome' = 'not-admissible', 'D a needs-review unit: not-admissible');
  perform t.ok(t25.decide(t25.unit(s, 3), 'rejected')->>'outcome' = 'rejected', 'D any pending unit may be rejected');
  perform t.ok(t25.decide(t25.unit(s, 2), 'admitted', 'verdant-home')->>'outcome' = 'unit-not-found', 'D a unit through another project: unit-not-found');
  perform t.ok(t.err(format($q$select t25.decide(%L, 'pending')$q$, t25.unit(s, 2))) = '22023', 'D a decision other than admitted or rejected raises 22023');
end $$;
reset role;

-- E: guards, as the owner.
do $$
declare s uuid; u uuid;
begin
  select src into s from t25.ctx;
  u := t25.unit(s, 2);
  perform t.ok(t.err(format($q$update public.nexra_evidence_units set decision = 'admitted', decided_by = t.pop(), decided_at = now() where id = %L$q$, u)) = '23514', 'E a direct decision is refused (23514)');
  perform set_config('nexra.evidence_write', 'decide', true);
  perform t.ok(t.err(format($q$update public.nexra_evidence_units set claim = 'changed', decision = 'admitted', decided_by = t.pop(), decided_at = now() where id = %L$q$, u)) = '23514', 'E under the flag, a claim still never changes (23514)');
  perform t.ok(t.err(format($q$update public.nexra_evidence_units set decision = 'pending', decided_by = null, decided_at = null where id = %L$q$, t25.unit(s, 1))) = '23514', 'E a decided unit never returns to pending (23514)');
  perform set_config('nexra.evidence_write', '', true);
  perform t.ok(t.err($q$update public.nexra_evidence_sources set title = 'x'$q$) = '23514', 'E a source never changes (23514)');
  perform t.ok(t.err($q$delete from public.nexra_evidence_units$q$) = '23514' and t.err($q$delete from public.nexra_evidence_sources$q$) = '23514', 'E deletes are refused (23514)');
  perform t.ok(t.err($q$truncate public.nexra_evidence_units$q$) = '23514', 'E a truncate of units is refused (23514)');
  perform t.ok(t.err($q$truncate public.nexra_evidence_sources$q$) in ('23514', '0A000'), 'E a truncate of sources is refused');
  perform t.ok(t.err($q$insert into public.nexra_evidence_sources (project_id, opportunity_id, requested_url, fetch_state, robots, fetched_by) select project_id, opportunity_id, 'https://x.example', 'timeout', 'allowed', t.pop() from public.nexra_evidence_sources limit 1$q$) = '23514', 'E a direct insert is refused (23514)');
end $$;
set role service_role;
do $$
begin
  perform t.ok(t.err($q$update public.nexra_evidence_units set claim = 'x'$q$) = '42501', 'E service_role cannot update units (42501)');
  perform t.ok(t.err($q$select public.nexra_evidence_collapse('x')$q$) = '42501', 'E service_role cannot run the internal collapse (42501)');
end $$;
reset role;
