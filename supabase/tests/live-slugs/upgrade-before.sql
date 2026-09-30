-- 6.12a upgrade, first half (before migration 20261011120000): the owning article proposed as in production, a second
-- article proposed, and every stored row of the article and proposal tables and the propose function's definition
-- kept aside. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t12u;
do $$
declare o uuid; a uuid;
begin
  o := t12.ready_as(t12.owner(), 80, t6.txt('ai-dead-lead-reactivation', 'different-angle'));
  perform t.ok(t6.propose(o, 1)->>'outcome' = 'created', 'U setup: the owning article proposed before the migration (the slug not yet live)');
  a := t6.ready(81, t6.txt('pinned-before-live'));
  perform t.ok(t6.propose(a, 1)->>'outcome' = 'created', 'U setup: a second article proposed before the migration');
end $$;
create function t12u.rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'articles', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_articles x),
    'versions', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_versions x),
    'units', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_check_units x),
    'approvals', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_approvals x),
    'proposals', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_publication_proposals x),
    'draft_proposals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from nexra_content_publication_proposals x))
$$;
create function t12u.propose_def() returns jsonb language sql as $$
  select jsonb_build_object('owner', p.proowner, 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig)
    from pg_proc p where p.oid = 'public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure
$$;
create function t12u.live_def() returns jsonb language sql as $$
  select jsonb_build_object('owner', p.proowner, 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig, 'volatile', p.provolatile)
    from pg_proc p where p.oid = 'public.nexra_article_publication_live_slugs(text)'::regprocedure
$$;
create table t12u.before as select t12u.rows() r, t12u.propose_def() pd, t12u.live_def() ld,
  public.nexra_article_publication_live_slugs('nexra-agency-website') live;
