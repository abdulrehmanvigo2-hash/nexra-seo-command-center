-- 6.8b upgrade, second half (after migration 20261010120000): every stored byte of the format 1 article is unchanged;
-- its approval reads count 0 and no tick. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record; v nexra_article_versions; ap jsonb; pr jsonb;
begin
  select * into b from t8u.before;
  select * into v from nexra_article_versions where canonical_content like '%pinned-before%';
  perform t.ok(v.canonical_content = b.canonical_content and v.content_sha256 = b.content_sha256, 'U the version''s text and hash are unchanged');
  perform t.ok((select to_jsonb(u) from (select array_agg(unit_sha256 order by unit_index) h from nexra_article_check_units where article_version_id = v.id) u) = b.units, 'U its unit hashes are unchanged');
  ap := (select to_jsonb(a) from nexra_article_approvals a where a.article_version_id = v.id);
  perform t.ok(ap - 'attested_count' - 'attested_confirmed' = b.approval, 'U its approval row is unchanged apart from the two new columns');
  perform t.ok((ap->>'attested_count')::int = 0 and (ap->>'attested_confirmed')::boolean = false, 'U the new columns read 0 and false');
  pr := (select to_jsonb(p) from nexra_article_publication_proposals p where p.article_version_id = v.id);
  perform t.ok(pr = b.proposal and pr->>'preview_format' = 'article-proposal-text/1', 'U its proposal row, preview format 1, is unchanged');
  perform t.ok(public.nexra_article_attested_count(v.canonical_content) = 0, 'U the count function reads it as format 1, count 0');
end $$;
