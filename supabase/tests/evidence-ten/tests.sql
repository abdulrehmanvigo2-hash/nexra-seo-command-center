-- OC1 ten sources (migration 20261029120000): the daily source limit is ten per opportunity; everything else of
-- nexra_evidence_source_record holds. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
-- Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$
declare fn text := 'public.nexra_evidence_source_record(text,uuid,uuid,text,text,text,integer,text,text,text,uuid)';
begin
  perform t.ok((select prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = fn::regprocedure),
    'A source_record: still security definer, empty search_path, owned by postgres');
  perform t.ok(has_function_privilege('service_role', fn, 'EXECUTE') and not has_function_privilege('anon', fn, 'EXECUTE')
    and not has_function_privilege('authenticated', fn, 'EXECUTE') and not has_function_privilege('public', fn, 'EXECUTE'), 'A source_record: EXECUTE for service_role only');
  perform t.ok(position('>= 10 then' in pg_get_functiondef(fn::regprocedure)) > 0 and position('>= 5 then' in pg_get_functiondef(fn::regprocedure)) = 0, 'A source_record: counts to ten');
  perform t.ok(obj_description(fn::regprocedure, 'pg_proc') like '%10 a UTC day per opportunity%', 'A source_record: its comment says ten');
end $$;

set role service_role;
do $$
declare o uuid; o2 uuid; a uuid; q uuid; organic uuid; i int; ok int := 0;
begin
  o := t24.opp();
  a := t.rid(t24.reserve(o, p_mode => 'sandbox'));
  q := t.qid(t24.req(a));
  perform t24.record(a, q);
  perform t.finish(a, 'completed');
  organic := (select id from public.nexra_serp_results where run_id = a and result_type = 'organic' and rank = 1);
  for i in 1..10 loop
    if t25.source(o, p_serp => case when i = 1 then organic end)->>'outcome' = 'recorded' then ok := ok + 1; end if;
  end loop;
  perform t.ok(ok = 10, 'B ten sources for one opportunity today: all recorded');
  perform t.ok(t25.source(o)->>'outcome' = 'source-limit', 'B an eleventh source today: source-limit');
  perform t.ok((select count(*) from public.nexra_evidence_sources where opportunity_id = o) = 10, 'B the refused eleventh wrote nothing');
  perform t.ok(t25.source(o, p_serp => (select id from public.nexra_serp_results where run_id = a and result_type = 'people-also-ask' limit 1))->>'outcome' in ('serp-result-not-found', 'source-limit'),
    'B a People Also Ask row is still never a source');
  o2 := t24.opp('verdant-home');
  perform t.ok(t25.source(o2, p_project => 'verdant-home')->>'outcome' = 'recorded', 'B another opportunity keeps its own ten');
  perform t.ok(t25.source(o, p_project => 'verdant-home')->>'outcome' = 'opportunity-not-found', 'B the opportunity through another project: opportunity-not-found');
end $$;
reset role;
