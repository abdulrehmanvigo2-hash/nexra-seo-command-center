-- Article 3 upgrade, second half (after migration 20261018120000): every stored row is unchanged, the propose and
-- live-articles functions are byte-identical, the two replaced list functions keep their owner and privileges, the
-- owning article's active proposal stands, and the new slug is live. Part of the local PostgreSQL test harness; run
-- only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record; x uuid; l jsonb;
begin
  select * into b from t18u.before;
  perform t.ok(b.live = array['ai-lead-follow-up-automation','ai-dead-lead-reactivation','ai-sdr-tool'] and jsonb_array_length(b.read) = 3, 'U before: three live slugs');
  perform t.ok(t18u.rows() = b.r, 'U every article, version, unit, approval and proposal row is unchanged, byte for byte');
  perform t.ok(t18u.def('public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure) = b.pd, 'U propose is untouched: owner, privileges, attributes and body');
  perform t.ok(t18u.def('public.nexra_article_publication_live_articles(text)'::regprocedure) = b.rd, 'U the live-articles read is untouched: owner, privileges, attributes and body');
  perform t.ok(t18u.def('public.nexra_article_publication_live_slugs(text)'::regprocedure) - 'src' = b.ld - 'src'
    and t18u.def('public.nexra_article_publication_live_slug_article(text,text)'::regprocedure) - 'src' = b.ad - 'src', 'U the two list functions keep their owner, privileges and attributes');
  perform t.ok(public.nexra_article_publication_live_slugs('nexra-agency-website') = array['ai-lead-follow-up-automation','ai-dead-lead-reactivation','ai-sdr-tool','missed-call-text-back'], 'U after: missed-call-text-back is live, fourth');
  perform t.ok((select status from nexra_article_publication_proposals where article_id = t18.owner3()) = 'proposed', 'U the owning article''s proposal is still active (not withdrawn, not re-checked)');
  perform t.ok(t6.propose(t18.owner3(), 1)->>'outcome' = 'exists', 'U the owning article, identical repeat: exists (no slug-live-collision)');
  x := t6.ready(82, t6.txt('missed-call-text-back', 'update-existing'));
  perform t.ok(t6.propose(x, 1)->>'outcome' = 'slug-live-collision', 'U another article naming the slug: slug-live-collision');
  l := t18.live();
  perform t.ok(jsonb_array_length(l) = 4 and l->3->>'slug' = 'missed-call-text-back' and l->3->>'articleId' = t18.owner3()::text
    and l->3->>'articleVersion' = '1' and l->3->'keywords' = '["missed call text back","auto missed call text back"]'::jsonb, 'U the read lists missed-call-text-back with its article, version 1 and keywords');
end $$;
