-- F8 upgrade, first half (before migration 20261014120000): an approved and proposed article (as V4 / V6 are) and a
-- needs-review unit, then every article, version, unit, approval and proposal row and the record and approve
-- functions' definitions kept aside. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t9u;
do $$
declare a uuid; b uuid;
begin
  a := t6.ready(50, t6.txt('upgrade-approved'));
  perform t.ok(t6.propose(a, 1)->>'outcome' = 'created', 'U setup: an approved article proposed before the migration');
  b := t6.article(51, t6.txt('upgrade-review'));
  perform t.ok(t6.rec(b, 1, 0, 'needs-review')->>'outcome' = 'recorded', 'U setup: a needs-review unit before the migration');
end $$;
create function t9u.rows() returns jsonb language sql as $$
  select jsonb_build_object(
    'articles', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_articles x),
    'versions', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_versions x),
    'units', (select jsonb_agg(to_jsonb(x) - array['carried_from_unit_id','carried_from_version','carry_basis','carried_instructions_sha256','carried_evidence_sha256'] order by x.id) from nexra_article_check_units x),
    'approvals', (select jsonb_agg(to_jsonb(x) - 'carried_units' order by x.id) from nexra_article_approvals x),
    'proposals', (select jsonb_agg(to_jsonb(x) order by x.id) from nexra_article_publication_proposals x))
$$;
create function t9u.defs() returns jsonb language sql as $$
  select jsonb_object_agg(p.oid::regprocedure::text, jsonb_build_object('body', md5(p.prosrc), 'acl', p.proacl::text[], 'secdef', p.prosecdef, 'config', p.proconfig))
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
      ('nexra_article_check_unit_record','nexra_article_approve_version','nexra_article_check_units_check_insert','nexra_article_check_version_complete',
       'nexra_article_publication_propose','nexra_article_save_version','nexra_article_approvals_check_insert')
$$;
create table t9u.before as select t9u.rows() r, t9u.defs() d,
  (select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_article_check_units'::regclass and not tgisinternal) triggers;
