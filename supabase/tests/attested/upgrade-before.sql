-- 6.8b upgrade, first half (before migration 20261010120000): one format 1 article checked, approved and proposed, and
-- its stored rows kept aside. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t8u;
do $$
declare a uuid; r jsonb;
begin
  a := t6.ready(50, t6.txt('pinned-before'));
  r := t6.propose(a, 1);
  perform t.ok(r->>'outcome' = 'created', 'U setup: a format 1 article approved and proposed before the migration');
end $$;
create table t8u.before as
  select v.canonical_content, v.content_sha256,
         (select to_jsonb(u) from (select array_agg(unit_sha256 order by unit_index) h from nexra_article_check_units where article_version_id = v.id) u) units,
         (select to_jsonb(a) from nexra_article_approvals a where a.article_version_id = v.id) approval,
         (select to_jsonb(p) from nexra_article_publication_proposals p where p.article_version_id = v.id) proposal
    from nexra_article_versions v join nexra_articles x on x.id = v.article_id
   where v.canonical_content like '%pinned-before%';
