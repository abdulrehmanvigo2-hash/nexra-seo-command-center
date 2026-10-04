-- Article plan from a brief, upgrade (before 20261028120000): an article and brief runs recorded on the earlier schema;
-- the fingerprints and privileges are kept for upgrade-after.sql. An article may be created for a completed Content Strategist
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

set role service_role;
do $$
begin
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000001') = 'created', 'U before: a content plan run makes an article');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000101') = 'plan-run-invalid', 'U before: a brief run is refused');
end $$;
reset role;
create table t28.before as
select (select md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from public.nexra_articles a) articles,
       (select md5(string_agg(to_jsonb(v)::text, '|' order by v.id)) from public.nexra_article_versions v) versions,
       (select md5(string_agg(to_jsonb(s)::text, '|' order by to_jsonb(s)::text)) from public.nexra_article_version_sources s) sources,
       (select proacl::text from pg_proc where oid = 'public.nexra_article_create(text,uuid,text,text,jsonb,uuid)'::regprocedure) acl,
       (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.nexra_article_create(text,uuid,text,text,jsonb,uuid)'::regprocedure) owner;
