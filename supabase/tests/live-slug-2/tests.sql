-- Article 2 (runbook §7, step 5): `ai-sdr-tool` as the second slug published after the template pin, on the full
-- schema. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: the lists and the functions.
do $$
begin
  perform t.ok(public.nexra_article_publication_live_slugs('nexra-agency-website') = array['ai-lead-follow-up-automation','ai-dead-lead-reactivation','ai-sdr-tool']
    and public.nexra_article_publication_live_slugs('x') = '{}', 'A live slugs: the pinned slug, then the two published after the pin, in publication order');
  perform t.ok(public.nexra_article_publication_live_slug_article('nexra-agency-website','ai-sdr-tool') = t17.owner2(), 'A ai-sdr-tool names its article 6f50f8cb');
  perform t.ok(public.nexra_article_publication_live_slug_article('nexra-agency-website','ai-dead-lead-reactivation') = t12.owner(), 'A ai-dead-lead-reactivation still names its article 1003104c');
  perform t.ok(public.nexra_article_publication_live_slug_article('nexra-agency-website','ai-lead-follow-up-automation') is null
    and public.nexra_article_publication_live_slug_article('nexra-agency-website','not-live') is null
    and public.nexra_article_publication_live_slug_article('x','ai-sdr-tool') is null
    and public.nexra_article_publication_live_slug_article(null, null) is null, 'A no article for a pinned slug, a slug not live, another destination or nulls');
  perform t.ok((select not prosecdef and provolatile = 'i' and proconfig = array['search_path=""'] from pg_proc where oid = 'public.nexra_article_publication_live_slug_article(text,text)'::regprocedure)
    and (select not prosecdef and provolatile = 'i' and proconfig = array['search_path=""'] from pg_proc where oid = 'public.nexra_article_publication_live_slugs(text)'::regprocedure),
    'A both list functions: not security definer, immutable, empty search_path');
  perform t.ok(not has_function_privilege('anon','public.nexra_article_publication_live_slug_article(text,text)','execute')
    and not has_function_privilege('authenticated','public.nexra_article_publication_live_slug_article(text,text)','execute')
    and not has_function_privilege('service_role','public.nexra_article_publication_live_slug_article(text,text)','execute')
    and not has_function_privilege('service_role','public.nexra_article_publication_live_slugs(text)','execute'), 'A the list functions: executable by no API role');
  perform t.ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure)
    and (select count(*) from pg_proc where proname = 'nexra_article_publication_propose') = 1, 'A propose: untouched, one function, security definer, empty search_path');
end $$;

-- B: rule 2 for the new slug — the owning article is never refused; every other article is; the first owner keeps its slug.
do $$
declare o uuid; x uuid; y uuid; p uuid; r jsonb; n0 bigint;
begin
  o := t12.ready_as(t17.owner2(), 90, t17.kw('ai-sdr-tool', '["AI SDR tool","best AI SDR tools"]'));
  x := t6.ready(91, t6.txt('ai-sdr-tool', 'different-angle'));
  y := t6.ready(92, t6.txt('ai-sdr-tool', 'update-existing'));
  perform t.ok(o = t17.owner2(), 'B the owning article exists with its production id');
  n0 := t6.n();
  perform t.ok(t6.propose(x, 1)->>'outcome' = 'slug-live-collision', 'B another article, different-angle: slug-live-collision');
  perform t.ok(t6.propose(y, 1)->>'outcome' = 'slug-live-collision', 'B another article, update-existing: slug-live-collision');
  perform t.ok(t6.n() = n0, 'B the refusals wrote nothing');
  r := t6.propose(o, 1);
  perform t.ok(r->>'outcome' = 'created' and r->'proposal'->>'slug' = 'ai-sdr-tool', 'B the owning article, different-angle: created (no slug-live-collision)');
  p := (r->'proposal'->>'id')::uuid;
  perform t.ok(t6.propose(o, 1)->>'outcome' = 'exists', 'B the owning article, identical repeat: exists');
  perform t.ok(t6.withdraw(p)->>'outcome' = 'withdrawn' and t6.propose(x, 1)->>'outcome' = 'slug-live-collision',
    'B with the slug free of proposals, another article is still refused');
  perform t.ok(t6.propose(t12.ready_as(t12.owner(), 93, t6.txt('ai-dead-lead-reactivation', 'different-angle')), 1)->>'outcome' = 'created',
    'B the first slug''s owner still proposes its own slug: created');
  perform t.ok(t6.propose(t6.ready(94, t6.txt('ai-lead-follow-up-automation', 'update-existing')), 1)->>'outcome' = 'created', 'B the pinned slug keeps D2: update-existing created');
end $$;

-- C: the live-articles read lists the new slug with its owner's proposed version and keywords.
do $$
declare l jsonb; o uuid; r jsonb;
begin
  l := t17.live();
  perform t.ok(jsonb_array_length(l) = 3 and l->2->>'slug' = 'ai-sdr-tool' and l->2->>'articleId' = t17.owner2()::text, 'C three live slugs; the third is ai-sdr-tool owned by 6f50f8cb');
  perform t.ok(l->2->'articleVersion' = '1'::jsonb or l->2->'articleVersion' = 'null'::jsonb, 'C the owner''s version is the proposed one, or none while no proposal stands');
  o := t6.ready(95, t17.kw('ai-sdr-tool', '["ai sdr tool","best ai sdr tools"]'));
  perform t.ok(t6.propose(o, 1)->>'outcome' = 'slug-live-collision', 'C another article with keywords for the slug: refused, so it never feeds the read');
  r := t6.propose(t17.owner2(), 1);
  perform t.ok(r->>'outcome' in ('created', 'exists'), 'C the owner proposes (or already has) its version');
  l := t17.live();
  perform t.ok(l->2->>'articleVersion' = '1' and l->2->'keywords' = '["AI SDR tool","best AI SDR tools"]'::jsonb, 'C the read names the owner''s version 1 and its stored keywords');
end $$;
