-- Article plan from a brief, upgrade (after 20261028120000): the rows recorded before are unchanged, the function keeps
-- its owner and privileges, and a brief run is now a plan. Run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b t28.before;
begin
  select * into b from t28.before;
  perform t28.ok(b.articles = (select md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from public.nexra_articles a)
    and b.versions = (select md5(string_agg(to_jsonb(v)::text, '|' order by v.id)) from public.nexra_article_versions v)
    and b.sources = (select md5(string_agg(to_jsonb(s)::text, '|' order by to_jsonb(s)::text)) from public.nexra_article_version_sources s), 'U after: every article, version and source row unchanged');
  perform t28.ok(b.acl = (select proacl::text from pg_proc where oid = 'public.nexra_article_create(text,uuid,text,text,jsonb,uuid)'::regprocedure)
    and b.owner = (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.nexra_article_create(text,uuid,text,text,jsonb,uuid)'::regprocedure), 'U after: the function keeps its owner and privileges');
end $$;
set role service_role;
do $$
begin
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000001') = 'exists', 'U after: the earlier article still answers exists');
  perform t28.ok(t28.create('halcyon-fintech', '10000000-0000-4000-8000-000000000101') = 'created', 'U after: a completed brief run is now a plan');
end $$;
reset role;
