-- M2 upgrade, second half (after migration 20261020120000): only the pinned entry's keywords changed in the read; every
-- stored row, the propose function and the read's owner, privileges and attributes are unchanged. Part of the local
-- PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record; l jsonb;
begin
  select * into b from t20u.before;
  l := public.nexra_article_publication_live_articles('nexra-agency-website');
  perform t.ok(t20u.rows() = b.r, 'U every article, version, unit, approval and proposal row is unchanged, byte for byte');
  perform t.ok(t20u.def('public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure) = b.pd, 'U propose is untouched');
  perform t.ok(t20u.def('public.nexra_article_publication_live_articles(text)'::regprocedure) - 'src' = b.rd - 'src', 'U the read keeps its owner, privileges and attributes');
  perform t.ok(jsonb_array_length(l) = jsonb_array_length(b.read), 'U the same number of entries');
  perform t.ok((l->0) - 'keywords' = (b.read->0) - 'keywords' and jsonb_array_length(l->0->'keywords') = 10 and l->0->>'slug' = 'ai-lead-follow-up-automation',
    'U the pinned entry: the same slug, article and version, now with ten keywords');
  perform t.ok((select bool_and(l->i = b.read->i) from generate_series(1, jsonb_array_length(l) - 1) i), 'U every other entry is identical');
end $$;
