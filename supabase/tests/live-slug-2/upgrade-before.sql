-- Article 2 upgrade, first half (before migration 20261017120000): the owning article proposed as in production
-- (slug ai-sdr-tool, not yet live), and every stored row of the article and proposal tables and both list functions'
-- definitions kept aside. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t17u;
do $$
declare o uuid; a uuid;
begin
  o := t12.ready_as(t17.owner2(), 80, t17.kw('ai-sdr-tool', '["AI SDR tool","best AI SDR tools"]'));
  perform t.ok(t6.propose(o, 1)->>'outcome' = 'created', 'U setup: the owning article proposed before the migration (the slug not yet live)');
  a := t6.ready(81, t6.txt('other-article'));
  perform t.ok(t6.propose(a, 1)->>'outcome' = 'created', 'U setup: a second article proposed before the migration');
end $$;
create function t17u.rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'articles', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_articles x),
    'versions', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_versions x),
    'units', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_check_units x),
    'approvals', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_approvals x),
    'proposals', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_publication_proposals x),
    'draft_proposals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from nexra_content_publication_proposals x))
$$;
create function t17u.def(p regprocedure) returns jsonb language sql as $$
  select jsonb_build_object('owner', p.proowner, 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig, 'volatile', p.provolatile, 'src', p.prosrc)
    from pg_proc p where p.oid = $1
$$;
create table t17u.before as select t17u.rows() r,
  t17u.def('public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure) pd,
  t17u.def('public.nexra_article_publication_live_articles(text)'::regprocedure) rd,
  t17u.def('public.nexra_article_publication_live_slugs(text)'::regprocedure) ld,
  t17u.def('public.nexra_article_publication_live_slug_article(text,text)'::regprocedure) ad,
  public.nexra_article_publication_live_slugs('nexra-agency-website') live,
  t17.live() read;
