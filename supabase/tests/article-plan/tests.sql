-- Article plan from a brief (migration 20261028120000): an article may be created for a completed Content Strategist
-- opportunity-brief run of the same project, as well as for a content-plan-review run; one article per plan run.
-- Over supabase/seed.sql and c2/setup.sql (runs 1–7, drafts). Part of the local PostgreSQL test harness; run only
-- through supabase/tests/run.sh. Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t28;
create function t28.create(p_project text, p_run uuid) returns text language plpgsql as $f$
begin
  return (public.nexra_article_create(p_project, p_run, $c${"format":"nexra-article-content/1","topic":"Missed-call text-back for service businesses","searchIntent":"commercial","slug":"missed-call-text-back","title":"Missed-Call Text-Back: Answering Every Lead You Could Not Pick Up","metaTitle":"Missed-Call Text-Back for Service Businesses","metaDescription":"How an automatic text reply to missed calls keeps a lead talking until someone can call back.","excerpt":"An automatic text reply to a missed call keeps the lead in the conversation.","category":"Operations","keywords":["missed call text back","missed call automation"],"lead":"A missed call is often a lead deciding where to go next.","introduction":["This article explains what a text-back does and where it stops."],"sections":[{"id":"what-it-does","heading":"What a text-back does","paragraphs":["It sends one text when a call is not answered.","The text names the business and asks how it can help."],"subsections":[{"id":"timing","heading":"Timing","paragraphs":["The reply goes out within a minute."]}]},{"id":"where-it-stops","heading":"Where it stops","paragraphs":["It does not replace calling the lead back."],"subsections":[]}],"faqs":[{"question":"Does the caller have to reply?","answer":"No. The text only opens the conversation."}],"internalLinks":[{"path":"/services#automation","anchorText":"our automation services","sectionId":"where-it-stops"}],"ctaTitle":"Stop losing missed calls","ctaBody":"Talk to us about setting up a text-back for your business.","topicDecision":"unset"}$c$, 'a5ef8a00ec26954c1599c68a3a4b5b59bca6db95582a105db6ee5dcb647b4705', '[{"draft_id":"20000000-0000-4000-8000-000000000001","version":1,"version_id":"30000000-0000-4000-8000-000000000001","content_sha256":"855418bbdcb2057e9dcfd1996b4ee8acf4e2802a67431c95e3b4e882d825767c"}]'::jsonb, '00000000-0000-4000-8000-0000000000aa')) ->> 'outcome';
end $f$;
create function t28.ok(p boolean, label text) returns void language plpgsql as $f$
begin
  if p is not true then raise exception 'FAIL %', label; end if;
  raise notice 'ok - %', label;
end $f$;
grant usage on schema t28 to service_role;
grant execute on all functions in schema t28 to service_role;

set session_replication_role = replica;
insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by) values
 ('10000000-0000-4000-8000-000000000101','halcyon-fintech','content-strategist','opportunity-brief','a101a101a101a101a101a101a101a101a101a101a101a101a101a101a101a101','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000102','halcyon-fintech','content-strategist','opportunity-brief','a102a102a102a102a102a102a102a102a102a102a102a102a102a102a102a102','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000103','verdant-home','content-strategist','opportunity-brief','a103a103a103a103a103a103a103a103a103a103a103a103a103a103a103a103','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000104','halcyon-fintech','writer','article-part-draft','a104a104a104a104a104a104a104a104a104a104a104a104a104a104a104a104','queued','00000000-0000-4000-8000-0000000000aa'),
 ('10000000-0000-4000-8000-000000000105','halcyon-fintech','content-strategist','opportunity-brief','a105a105a105a105a105a105a105a105a105a105a105a105a105a105a105a105','queued','00000000-0000-4000-8000-0000000000aa');
update agent_runs set status='completed', started_at=now(), finished_at=now(), executor='ai', result_summary='done', attempt_count=1
 where id in ('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000103','10000000-0000-4000-8000-000000000104');
update agent_runs set status='failed', started_at=now(), finished_at=now(), executor='ai', error_code='rejected-output', error_message='refused', attempt_count=1 where id = '10000000-0000-4000-8000-000000000105';
set session_replication_role = origin;

do $$
declare fn text := 'public.nexra_article_create(text,uuid,text,text,jsonb,uuid)';
begin
  perform t28.ok((select prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = fn::regprocedure), 'A create: security definer, empty search_path, owned by postgres');
  perform t28.ok(has_function_privilege('service_role', fn, 'EXECUTE') and not has_function_privilege('anon', fn, 'EXECUTE')
    and not has_function_privilege('authenticated', fn, 'EXECUTE') and not has_function_privilege('public', fn, 'EXECUTE'), 'A create: EXECUTE for service_role only');
  perform t28.ok((select count(*) from pg_proc where proname = 'nexra_article_create') = 1, 'A create: one function, the same signature');
  perform t28.ok((select prosrc from pg_proc where oid = fn::regprocedure) like '%task_type in (''content-plan-review'', ''opportunity-brief'')%', 'A create: the plan check names both task types');
end $$;

set role service_role;
do $$
begin
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000101') = 'created', 'B a completed opportunity-brief run of the project is a plan: created');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000101') = 'exists', 'B one article per plan run: a second create answers exists');
  perform t28.ok((select count(*) from public.nexra_articles where source_plan_run_id = '10000000-0000-4000-8000-000000000101') = 1, 'B the brief run holds one article');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000102') = 'plan-run-invalid', 'B a queued brief run is not a plan');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000105') = 'plan-run-invalid', 'B a failed brief run is not a plan');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000103') = 'plan-run-invalid', 'B another project''s brief run is not a plan');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000104') = 'plan-run-invalid', 'B a Writer part run is not a plan');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000005') = 'plan-run-invalid', 'B a Writer section draft is still not a plan');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000002') = 'created', 'B a completed content-plan-review run is still a plan: created');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000004') = 'plan-run-invalid', 'B a content plan that is not completed is still refused');
  perform t28.ok((select count(*) from public.nexra_article_versions v join public.nexra_articles a on a.id = v.article_id where a.source_plan_run_id = '10000000-0000-4000-8000-000000000101' and v.version = 1) = 1, 'B the brief-planned article has its version 1');
end $$;
reset role;
