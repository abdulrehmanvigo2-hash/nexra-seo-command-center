-- OC1 brief articles without a source draft (migration 20261030120000): an article planned by an opportunity brief may be
-- created and saved with no source draft; every other article still names at least one. Over supabase/seed.sql and
-- c2/setup.sql (runs 1–7, drafts). Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
-- Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t30;
create function t30.content() returns text language sql immutable as $f$ select $c${"format":"nexra-article-content/1","topic":"Missed-call text-back for service businesses","searchIntent":"commercial","slug":"missed-call-text-back","title":"Missed-Call Text-Back: Answering Every Lead You Could Not Pick Up","metaTitle":"Missed-Call Text-Back for Service Businesses","metaDescription":"How an automatic text reply to missed calls keeps a lead talking until someone can call back.","excerpt":"An automatic text reply to a missed call keeps the lead in the conversation.","category":"Operations","keywords":["missed call text back","missed call automation"],"lead":"A missed call is often a lead deciding where to go next.","introduction":["This article explains what a text-back does and where it stops."],"sections":[{"id":"what-it-does","heading":"What a text-back does","paragraphs":["It sends one text when a call is not answered.","The text names the business and asks how it can help."],"subsections":[{"id":"timing","heading":"Timing","paragraphs":["The reply goes out within a minute."]}]},{"id":"where-it-stops","heading":"Where it stops","paragraphs":["It does not replace calling the lead back."],"subsections":[]}],"faqs":[{"question":"Does the caller have to reply?","answer":"No. The text only opens the conversation."}],"internalLinks":[{"path":"/services#automation","anchorText":"our automation services","sectionId":"where-it-stops"}],"ctaTitle":"Stop losing missed calls","ctaBody":"Talk to us about setting up a text-back for your business.","topicDecision":"unset"}$c$ $f$;
create function t30.create(p_project text, p_run uuid, p_sources jsonb) returns jsonb language sql as $f$
  select public.nexra_article_create(p_project, p_run, t30.content(), 'a5ef8a00ec26954c1599c68a3a4b5b59bca6db95582a105db6ee5dcb647b4705', p_sources, '00000000-0000-4000-8000-0000000000aa') $f$;
create function t30.save(p_project text, p_article uuid, p_expected smallint, p_sources jsonb) returns jsonb language sql as $f$
  select public.nexra_article_save_version(p_project, p_article, p_expected, replace(t30.content(), 'Talk to us about', 'Ask us about'),
    encode(sha256(convert_to(replace(t30.content(), 'Talk to us about', 'Ask us about'), 'UTF8')), 'hex'), p_sources, '00000000-0000-4000-8000-0000000000aa') $f$;
create function t30.one() returns jsonb language sql immutable as $f$ select '[{"draft_id":"20000000-0000-4000-8000-000000000001","version":1,"version_id":"30000000-0000-4000-8000-000000000001","content_sha256":"855418bbdcb2057e9dcfd1996b4ee8acf4e2802a67431c95e3b4e882d825767c"}]'::jsonb $f$;
create function t30.ok(p boolean, label text) returns void language plpgsql as $f$
begin
  if p is not true then raise exception 'FAIL %', label; end if;
  raise notice 'ok - %', label;
end $f$;
grant usage on schema t30 to service_role;
grant execute on all functions in schema t30 to service_role;

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
declare f text;
begin
  foreach f in array array['public.nexra_article_create(text,uuid,text,text,jsonb,uuid)', 'public.nexra_article_save_version(text,uuid,smallint,text,text,jsonb,uuid)'] loop
    perform t30.ok((select prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = f::regprocedure), format('A %s: security definer, empty search_path, owned by postgres', split_part(f, '(', 1)));
    perform t30.ok(has_function_privilege('service_role', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
      and not has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('public', f, 'EXECUTE'), format('A %s: EXECUTE for service_role only', split_part(f, '(', 1)));
  end loop;
  perform t30.ok((select not prosecdef from pg_proc where oid = 'public.nexra_article_check_sources(text,jsonb)'::regprocedure)
    and not has_function_privilege('service_role', 'public.nexra_article_check_sources(text,jsonb)', 'EXECUTE'), 'A check_sources: not security definer, executable by no API role');
  perform t30.ok((select (public.nexra_article_check_sources('halcyon-fintech', (select jsonb_agg(t30.one()->0) from generate_series(1, 21))))->>'reason') = 'count', 'A more than twenty sources: still refused (count)');
  perform t30.ok((public.nexra_article_check_sources('halcyon-fintech', '[{"draft_id":"x"}]'::jsonb))->>'reason' = 'shape', 'A a malformed source: still refused (shape)');
  perform t30.ok(public.nexra_article_check_sources('halcyon-fintech', '[]'::jsonb) is null, 'A an empty list passes the shape check (the callers decide)');
  perform t30.ok((select count(*) from pg_proc where proname in ('nexra_article_create', 'nexra_article_save_version', 'nexra_article_check_sources')) = 3, 'A one function each, the same signatures');
end $$;

set role service_role;
do $$
declare r jsonb; a uuid; p uuid;
begin
  -- B: create.
  r := t30.create('halcyon-fintech', '10000000-0000-4000-8000-000000000002', '[]'::jsonb);
  perform t30.ok(r->>'outcome' = 'source-invalid' and r->>'reason' = 'count', 'B a content-plan article with no source draft: still refused (count)');
  perform t30.ok((select count(*) from public.nexra_articles where source_plan_run_id = '10000000-0000-4000-8000-000000000002') = 0, 'B the refused create wrote nothing');
  r := t30.create('halcyon-fintech', '10000000-0000-4000-8000-000000000101', '[]'::jsonb);
  perform t30.ok(r->>'outcome' = 'created' and jsonb_array_length(r->'sources') = 0, 'B a brief-planned article with no source draft: created, no source rows');
  a := (r->'article'->>'id')::uuid;
  perform t30.ok((select count(*) from public.nexra_article_version_sources s join public.nexra_article_versions v on v.id = s.article_version_id where v.article_id = a) = 0, 'B no source row is stored for it');
  r := t30.create('halcyon-fintech', '10000000-0000-4000-8000-000000000002', t30.one());
  perform t30.ok(r->>'outcome' = 'created', 'B a content-plan article with one source draft: created, as before');
  p := (r->'article'->>'id')::uuid;
  perform t30.ok((t30.create('halcyon-fintech', '10000000-0000-4000-8000-000000000101', t30.one()))->>'outcome' = 'exists', 'B one article per plan run still holds');

  -- C: save_version.
  r := t30.save('halcyon-fintech', a, 1::smallint, '[]'::jsonb);
  perform t30.ok(r->>'outcome' = 'created' and (r->'version'->>'version')::int = 2, 'C the brief-planned article saves version 2 with no source draft');
  r := t30.save('halcyon-fintech', p, 1::smallint, '[]'::jsonb);
  perform t30.ok(r->>'outcome' = 'source-invalid' and r->>'reason' = 'count', 'C the content-plan article cannot drop its source drafts');
  perform t30.ok((select current_version from public.nexra_articles where id = p) = 1, 'C the refused save wrote nothing');
  r := t30.save('halcyon-fintech', a, 2::smallint, t30.one());
  perform t30.ok(r->>'outcome' = 'created', 'C a brief-planned article may still name a source draft');
end $$;
reset role;
