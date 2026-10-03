-- M2 upgrade, first half (before migration 20261020120000): an owner proposed, every stored article and proposal row,
-- the live-articles read and its definition kept aside. Part of the local PostgreSQL test harness; run only through
-- supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t20u;
do $$
declare o uuid;
begin
  o := t12.ready_as(t18.owner3(), 70, t18.kw('missed-call-text-back', '["missed call text back","auto missed call text back"]'));
  perform t.ok(t6.propose(o, 1)->>'outcome' = 'created', 'U setup: the owner of missed-call-text-back proposed before the migration');
  perform t.ok(public.nexra_article_publication_live_articles('nexra-agency-website')->0->'keywords' = 'null'::jsonb, 'U before: the pinned slug has no keywords in the read');
end $$;
create function t20u.rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'articles', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_articles x),
    'versions', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_versions x),
    'units', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from nexra_article_check_units x),
    'approvals', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_approvals x),
    'proposals', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_publication_proposals x))
$$;
create function t20u.def(p regprocedure) returns jsonb language sql as $$
  select jsonb_build_object('owner', p.proowner, 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig, 'volatile', p.provolatile, 'src', p.prosrc)
    from pg_proc p where p.oid = $1
$$;
create table t20u.before as select t20u.rows() r,
  t20u.def('public.nexra_article_publication_live_articles(text)'::regprocedure) rd,
  t20u.def('public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure) pd,
  public.nexra_article_publication_live_articles('nexra-agency-website') read;
