-- C4 article check units: record function, guards, completeness, grants.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
-- 1. identity and refusals (version 1: 9 units; version 1 is current)
do $$
declare r jsonb; b jsonb;
begin
  b := public.nexra_article_check_blocks((select txt from t.ver where n=1));
  perform t.ok(b = '[{"block":"metadata","kind":"metadata"},{"block":"lead-introduction","kind":"lead-introduction"},{"block":"section:what-it-does","kind":"section"},{"block":"section:where-it-stops","kind":"section"},{"block":"faq","kind":"faq"},{"block":"cta","kind":"cta"}]'::jsonb, 'v1 blocks in fixed order');
  perform t.ok(jsonb_array_length(public.nexra_article_check_blocks((select txt from t.ver where n=3))) = 4, 'a version without FAQs has no faq block');
  perform t.ok(public.nexra_article_check_block_of('section:what-it-does:12', 12) = 'section:what-it-does', 'block of a key');

  perform t.run(t.uid('c1',1,3),'halcyon-fintech',1,3,'queued');
  r := t.rec(1,3,'pending',t.uid('c1',1,3));
  perform t.ok(r->>'outcome'='recorded' and r->'record'->>'part'='1' and r->'record'->>'part_count'='3' and r->'record'->>'unit_count'='9', 'pending part 1 of 3 recorded with its counts');

  perform t.run(t.uid('c2',1,4),'halcyon-fintech',1,4,'completed');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_part_count => 2)->>'outcome'='count-mismatch', 'a different part count within one block: count-mismatch');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_unit_count => 10)->>'outcome'='count-mismatch', 'a different unit count within one version: count-mismatch');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_key => 'section:nope:2')->>'outcome'='unit-mismatch', 'a block the version does not have: unit-mismatch');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_kind => 'faq')->>'outcome'='unit-mismatch', 'a kind that does not match the block: unit-mismatch');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_part => 4)->>'outcome'='unit-mismatch', 'a part beyond its part count: unit-mismatch');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_key => 'section:what-it-does:3')->>'outcome'='unit-mismatch', 'a key whose suffix is not its part: unit-mismatch');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_unit_count => 5)->>'outcome' in ('unit-mismatch','count-mismatch'), 'a unit count below the block count is refused');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_unit_count => 151)->>'outcome'='unit-mismatch', 'a unit count above the 150 cap: unit-mismatch');
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_sha => t.h(9,9))->>'outcome'='run-state-mismatch', 'a hash the run did not check: run-state-mismatch');

  -- run evidence must name the same counts
  perform t.run(t.uid('c3',1,6),'halcyon-fintech',1,6,'completed', p_evidence => '{"partCount":2}');
  perform t.ok(t.rec(1,6,'passed',t.uid('c3',1,6))->>'outcome'='run-state-mismatch', 'run evidence naming another part count: run-state-mismatch');
  perform t.run(t.uid('c4',1,6),'halcyon-fintech',1,6,'completed', p_evidence => '{"unitCount":8}');
  perform t.ok(t.rec(1,6,'passed',t.uid('c4',1,6))->>'outcome'='run-state-mismatch', 'run evidence naming another unit count: run-state-mismatch');
  perform t.run(t.uid('c5',1,6),'halcyon-fintech',1,6,'completed', p_evidence => '{"unitIndex":5}');
  perform t.ok(t.rec(1,6,'passed',t.uid('c5',1,6))->>'outcome'='run-state-mismatch', 'run evidence naming another index: run-state-mismatch');
  perform t.ok(t.rec(1,6,'failed',t.uid('c5',1,6))->>'outcome'='run-state-mismatch', 'even a failed record from a completed run must match its evidence');

  -- stale / wrong version bindings
  perform t.ok(t.rec(1,4,'passed',t.uid('c2',1,4), p_vid => 'b0000000-0000-4000-8000-000000000002')->>'outcome'='version-mismatch', 'another version''s row id: version-mismatch');
  perform t.run(t.uid('c6',2,0),'halcyon-fintech',2,0,'completed');
  perform t.ok(public.nexra_article_check_unit_record('halcyon-fintech','a0000000-0000-4000-8000-000000000001',1::smallint,'b0000000-0000-4000-8000-000000000001',0::smallint,'metadata','metadata:1',1::smallint,2::smallint,9::smallint,t.h(1,0),'passed',jsonb_build_object('status','passed','checkedByRunId',t.uid('c6',2,0)::text),t.uid('c6',2,0),'00000000-0000-4000-8000-0000000000aa')->>'outcome'='run-mismatch', 'a version 2 run recorded on version 1: run-mismatch');

  -- the same key at another index is a different unit
  perform t.run(t.uid('c7',1,5),'halcyon-fintech',1,5,'completed', p_evidence => '{"unitKey":"section:what-it-does:1","part":1}');
  perform t.ok(t.rec(1,5,'passed',t.uid('c7',1,5), p_key => 'section:what-it-does:1', p_part => 1)->>'outcome'='unit-mismatch', 'a duplicated key at another index: unit-mismatch');
end $$;

-- 2. direct writes (any writer): identity, counts, deletes
do $$
begin
  begin update nexra_article_check_units set part_count = 4 where unit_index = 3; perform t.ok(false,'x'); exception when check_violation then perform t.ok(true,'counts cannot change after insert'); end;
  begin delete from nexra_article_check_units; perform t.ok(false,'x'); exception when check_violation then perform t.ok(true,'rows cannot be deleted'); end;
  begin
    insert into nexra_article_check_units (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count, unit_sha256, status, checked_by_run_id, recorded_by)
    values ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',1,4,'section','section:what-it-does:2',2,2,9,repeat('a',64),'pending',t.uid('c1',1,3),'00000000-0000-4000-8000-0000000000aa');
    perform t.ok(false,'x');
  exception when check_violation then perform t.ok(true,'a direct insert with a disagreeing part count is refused'); end;
  begin
    insert into nexra_article_check_units (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count, unit_sha256, status, checked_by_run_id, recorded_by)
    values ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',1,4,'section','section:gone:1',1,1,9,repeat('a',64),'pending',t.uid('c1',1,3),'00000000-0000-4000-8000-0000000000aa');
    perform t.ok(false,'x');
  exception when check_violation then perform t.ok(true,'a direct insert for a block the version lacks is refused'); end;
  begin
    insert into nexra_article_check_units (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count, unit_sha256, status, checked_by_run_id, recorded_by)
    values ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',1,150,'cta','cta:1',1,1,151,repeat('a',64),'pending',t.uid('c1',1,3),'00000000-0000-4000-8000-0000000000aa');
    perform t.ok(false,'x');
  exception when check_violation then perform t.ok(true,'index 150 / unit count 151 violate the cap constraints'); end;
end $$;
-- 3. completeness on the current version (version 1)
do $$
declare r jsonb; i int;
begin

  -- the queued part-1 run completes and passes
  set local session_replication_role = replica;
  update agent_runs set status='completed', started_at=now(), finished_at=now(), executor='ai', attempt_count=1, result_summary='answer',
    result_metadata=jsonb_build_object('simulated',false,'grounded',true,'evidence',jsonb_build_object('source','article-unit','unitKey','section:what-it-does:1','unitSha256',t.h(1,3),'unitIndex',3,'part',1,'partCount',3,'unitCount',9))
   where id = t.uid('c1',1,3);
  set local session_replication_role = origin;
  perform t.ok(t.rec(1,3,'passed',t.uid('c1',1,3))->>'outcome'='recorded', 'pending part moves to passed with the same run');

  -- every unit except index 5 (section part 3) passes: a missing part keeps the article drafting
  for i in 0..8 loop
    continue when i in (3,5);
    perform t.run(t.uid('d1',1,i),'halcyon-fintech',1,i,'completed');
    r := t.rec(1,i,'passed',t.uid('d1',1,i));
    perform t.ok(r->>'outcome'='recorded' and (r->>'article_status_advanced')::boolean = false, format('unit %s passed; set not complete', i));
  end loop;
  perform t.ok(not public.nexra_article_check_version_complete('b0000000-0000-4000-8000-000000000001',(select txt from t.ver where n=1),9), 'a missing part: not complete');
  perform t.ok((select status from nexra_articles where id='a0000000-0000-4000-8000-000000000001')='drafting', 'the article stays drafting with a part missing');

  -- the last part fails: still not complete
  perform t.run(t.uid('d2',1,5),'halcyon-fintech',1,5,'failed');
  perform t.ok(t.rec(1,5,'failed',t.uid('d2',1,5))->>'outcome'='recorded', 'failed recorded');
  perform t.ok(not public.nexra_article_check_version_complete('b0000000-0000-4000-8000-000000000001',(select txt from t.ver where n=1),9), 'a failed unit: not complete');

  -- a new run passes it: the article moves to checked, once
  perform t.run(t.uid('d3',1,5),'halcyon-fintech',1,5,'completed');
  r := t.rec(1,5,'passed',t.uid('d3',1,5));
  perform t.ok(r->>'outcome'='recorded' and (r->>'article_status_advanced')::boolean and r->'article'->>'status'='checked', 'the last unit passes: complete; drafting -> checked');
  perform t.ok((select approved_version is null from nexra_articles where id='a0000000-0000-4000-8000-000000000001'), 'nothing is approved');
end $$;

-- 4. completeness helper against hand-built states (direct inserts as owner, bypassing the record function)
do $$
declare txt3 text := (select txt from t.ver where n=3);
begin
  insert into nexra_article_versions (id, article_id, version, origin, canonical_content, content_sha256, created_by)
    values ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001',3,'operator',txt3,encode(sha256(convert_to(txt3,'UTF8')),'hex'),'00000000-0000-4000-8000-0000000000aa');
  perform t.run(t.uid('e1',3,0),'halcyon-fintech',3,0,'completed');
  -- rows with a gap and a wrong position: metadata:1 idx0, lead:1 idx1, section:1 idx3 (should be 2), cta:1 idx2 (should be 3)
  insert into nexra_article_check_units (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count, unit_sha256, status, result, checked_by_run_id, recorded_by) values
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003',3,0,'metadata','metadata:1',1,1,4,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa'),
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003',3,1,'lead-introduction','lead-introduction:1',1,1,4,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa'),
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003',3,3,'section','section:what-it-does:1',1,1,4,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa'),
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003',3,2,'cta','cta:1',1,1,4,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa');
  perform t.ok(not public.nexra_article_check_version_complete('b0000000-0000-4000-8000-000000000003',txt3,4), 'indexes out of block order: not complete');
  perform t.ok(not public.nexra_article_check_version_complete('b0000000-0000-4000-8000-000000000003',txt3,5), 'a unit count the rows do not carry: not complete');
end $$;

do $$
declare txt3 text := (select txt from t.ver where n=3);
begin
  -- a version whose block has part 1 and part 3 of 3 (part 2 missing), all passed
  insert into nexra_article_versions (id, article_id, version, origin, canonical_content, content_sha256, created_by)
    values ('b0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000001',4,'operator',txt3,encode(sha256(convert_to(txt3,'UTF8')),'hex'),'00000000-0000-4000-8000-0000000000aa');
  insert into nexra_article_check_units (article_id, article_version_id, article_version, unit_index, unit_kind, unit_key, part, part_count, unit_count, unit_sha256, status, result, checked_by_run_id, recorded_by) values
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004',4,0,'metadata','metadata:1',1,1,6,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa'),
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004',4,1,'lead-introduction','lead-introduction:1',1,1,6,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa'),
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004',4,2,'section','section:what-it-does:1',1,3,6,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa'),
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004',4,4,'section','section:what-it-does:3',3,3,6,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa'),
   ('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004',4,5,'cta','cta:1',1,1,6,repeat('a',64),'passed','{"status":"passed","checkedByRunId":"e1000000-0000-4000-8000-000003000000"}',t.uid('e1',3,0),'00000000-0000-4000-8000-0000000000aa');
  perform t.ok(not public.nexra_article_check_version_complete('b0000000-0000-4000-8000-000000000004',txt3,6), 'a gap in a block''s parts: not complete');
  perform t.ok(not public.nexra_article_check_version_complete('b0000000-0000-4000-8000-000000000004',txt3,5), 'rows naming another unit count: not complete');
end $$;

-- 5. version safety: v2 current, v1 history
do $$
declare r jsonb; i int;
begin
  update nexra_articles set current_version = 4, status = 'drafting' where id='a0000000-0000-4000-8000-000000000001';
  perform t.ok((select count(*) from nexra_article_check_units where article_version=2)=0, 'version 2 has no rows: nothing carried forward');
  for i in 0..5 loop
    perform t.run(t.uid('f1',2,i),'halcyon-fintech',2,i,'completed');
    r := t.rec(2,i,'passed',t.uid('f1',2,i));
    perform t.ok(r->>'outcome'='recorded' and (r->>'article_status_advanced')::boolean = false, format('older version 2 unit %s passed; parent untouched', i));
  end loop;
  perform t.ok(public.nexra_article_check_version_complete('b0000000-0000-4000-8000-000000000002',(select txt from t.ver where n=2),6), 'version 2 is complete as history');
  perform t.ok((select status from nexra_articles where id='a0000000-0000-4000-8000-000000000001')='drafting', 'an older complete version never marks the article checked');
end $$;

-- 6. grants and RLS
do $$
begin
  perform t.ok((select relrowsecurity from pg_class where oid='public.nexra_article_check_units'::regclass) and not exists (select 1 from pg_policies where tablename='nexra_article_check_units'), 'RLS on, no policies');
  perform t.ok(has_table_privilege('service_role','public.nexra_article_check_units','select') and not has_table_privilege('service_role','public.nexra_article_check_units','insert') and not has_table_privilege('service_role','public.nexra_article_check_units','update') and not has_table_privilege('service_role','public.nexra_article_check_units','delete'), 'service_role: select only');
  perform t.ok(not has_table_privilege('anon','public.nexra_article_check_units','select') and not has_table_privilege('authenticated','public.nexra_article_check_units','select'), 'anon/authenticated: nothing');
  perform t.ok(has_function_privilege('service_role','public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, text, jsonb, uuid, uuid)','execute'), 'service_role executes the record function');
  perform t.ok(not has_function_privilege('anon','public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, text, jsonb, uuid, uuid)','execute') and not has_function_privilege('authenticated','public.nexra_article_check_unit_record(text, uuid, smallint, uuid, smallint, text, text, smallint, smallint, smallint, text, text, jsonb, uuid, uuid)','execute'), 'anon/authenticated cannot execute it');
  perform t.ok(not has_function_privilege('service_role','public.nexra_article_check_blocks(text)','execute') and not has_function_privilege('service_role','public.nexra_article_check_block_of(text, integer)','execute') and not has_function_privilege('service_role','public.nexra_article_check_version_complete(uuid, text, integer)','execute'), 'helpers executable by no API role');
  perform t.ok((select count(*) from pg_proc where prosecdef and proname like 'nexra_article_check%') = 1, 'only the record function is security definer');
  perform t.ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc where proname in ('nexra_article_check_unit_record','nexra_article_check_blocks','nexra_article_check_block_of','nexra_article_check_version_complete','nexra_article_check_units_check_insert','nexra_article_check_units_guard_update','nexra_article_check_units_guard_delete')), 'every C4 function pins an empty search_path');
end $$;
