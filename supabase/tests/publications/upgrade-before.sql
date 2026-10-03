-- P-L2 publications upgrade, first half (before migration 20261023120000): two articles approved and proposed, and every
-- stored row of the article, proposal and approval tables, the live-slug lists and both list functions' owner and
-- privileges kept aside. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema tpu;
do $$
declare a uuid; b uuid;
begin
  a := t6.ready(60, t6.txt('upgrade-one'));
  b := t6.ready(61, t6.txt('upgrade-two'));
  perform t.ok(t6.propose(a, 1)->>'outcome' = 'created' and t6.propose(b, 1)->>'outcome' = 'created', 'U setup: two articles approved and proposed before the migration');
end $$;
create function tpu.rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'articles', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_articles x),
    'versions', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_versions x),
    'units', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_check_units x),
    'c5', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_approvals x),
    'proposals', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_publication_proposals x),
    'approvals', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from nexra_approvals x))
$$;
create function tpu.lists() returns jsonb language sql as $$
  select jsonb_build_object(
    'slugs', to_jsonb(public.nexra_article_publication_live_slugs('nexra-agency-website')),
    'other', to_jsonb(public.nexra_article_publication_live_slugs('x')),
    'owners', (select jsonb_agg(public.nexra_article_publication_live_slug_article('nexra-agency-website', s) order by s)
                 from unnest(array['ai-lead-follow-up-automation','ai-dead-lead-reactivation','ai-sdr-tool','missed-call-text-back','upgrade-one']) s),
    'live', public.nexra_article_publication_live_articles('nexra-agency-website'))
$$;
create function tpu.fns() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('fn', p.oid::regprocedure::text, 'owner', p.proowner, 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig) order by p.oid::regprocedure::text)
    from pg_proc p where p.oid in ('public.nexra_article_publication_live_slugs(text)'::regprocedure, 'public.nexra_article_publication_live_slug_article(text,text)'::regprocedure,
      'public.nexra_article_publication_live_articles(text)'::regprocedure, 'public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure)
$$;
create function tpu.propose_src() returns text language sql as $$
  select prosrc from pg_proc where oid = 'public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure
$$;
create table tpu.before as select tpu.rows() as rows, tpu.lists() as lists, tpu.fns() as fns, tpu.propose_src() as propose_src;
do $$ begin perform t.ok((select jsonb_array_length(rows->'proposals') from tpu.before) = 2, 'U setup: the rows kept aside'); end $$;
