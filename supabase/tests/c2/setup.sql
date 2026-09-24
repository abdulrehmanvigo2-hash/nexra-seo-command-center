-- C2 article persistence: fixtures (drafts, runs) on top of supabase/seed.sql.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.


set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by) values
 ('10000000-0000-4000-8000-000000000001','halcyon-fintech','content-strategist','content-plan-review','1111111111111111111111111111111111111111111111111111111111111111','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000002','halcyon-fintech','content-strategist','content-plan-review','2222222222222222222222222222222222222222222222222222222222222222','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000003','verdant-home','content-strategist','content-plan-review','3333333333333333333333333333333333333333333333333333333333333333','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000004','halcyon-fintech','content-strategist','content-plan-review','4444444444444444444444444444444444444444444444444444444444444444','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000005','halcyon-fintech','writer','section-draft','5555555555555555555555555555555555555555555555555555555555555555','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000006','verdant-home','writer','section-draft','6666666666666666666666666666666666666666666666666666666666666666','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000007','halcyon-fintech','content-strategist','content-plan-review','7777777777777777777777777777777777777777777777777777777777777777','queued','00000000-0000-4000-8000-0000000000aa');
update agent_runs set status='completed', started_at=now(), finished_at=now(), executor='mock', result_summary='done', attempt_count=1 where id <> '10000000-0000-4000-8000-000000000004';
set session_replication_role = origin;
insert into nexra_content_drafts (id, project_id, source_writer_run_id, source_plan_run_id, section_label, created_by) values
 ('20000000-0000-4000-8000-000000000001','halcyon-fintech','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','What a text-back does','00000000-0000-4000-8000-0000000000aa'),
 ('20000000-0000-4000-8000-000000000002','verdant-home','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000003','Other project','00000000-0000-4000-8000-0000000000aa');
insert into nexra_content_draft_versions (id, draft_id, version, origin, title, body, created_by) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1,'writer','What a text-back does',$q$It sends one text.
Café ✅ “quoted”.$q$,'00000000-0000-4000-8000-0000000000aa'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',2,'operator','What a text-back does v2','Edited body.','00000000-0000-4000-8000-0000000000aa'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002',1,'writer','What a text-back does',$q$It sends one text.
Café ✅ “quoted”.$q$,'00000000-0000-4000-8000-0000000000aa');
