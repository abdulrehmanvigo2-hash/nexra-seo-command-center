-- 6.12a (D10): the slug published after the template pin, on the full schema. Part of the local PostgreSQL test
-- harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: the lists and the functions.
do $$
begin
  perform t.ok(public.nexra_article_publication_live_slugs('nexra-agency-website') = array['ai-lead-follow-up-automation','ai-dead-lead-reactivation']
    and public.nexra_article_publication_live_slugs('x') = '{}', 'A live slugs: the pinned slug, then the one published after the pin');
  perform t.ok(public.nexra_article_publication_live_slug_article('nexra-agency-website','ai-dead-lead-reactivation') = t12.owner(), 'A the slug published after the pin names its article 1003104c');
  perform t.ok(public.nexra_article_publication_live_slug_article('nexra-agency-website','ai-lead-follow-up-automation') is null
    and public.nexra_article_publication_live_slug_article('nexra-agency-website','not-live') is null
    and public.nexra_article_publication_live_slug_article('x','ai-dead-lead-reactivation') is null
    and public.nexra_article_publication_live_slug_article(null, null) is null, 'A no article for a pinned slug, a slug not live, another destination or nulls');
  perform t.ok((select not prosecdef and provolatile = 'i' and proconfig = array['search_path=""'] from pg_proc where oid = 'public.nexra_article_publication_live_slug_article(text,text)'::regprocedure),
    'A the new function: not security definer, immutable, empty search_path');
  perform t.ok(not has_function_privilege('anon','public.nexra_article_publication_live_slug_article(text,text)','execute')
    and not has_function_privilege('authenticated','public.nexra_article_publication_live_slug_article(text,text)','execute')
    and not has_function_privilege('service_role','public.nexra_article_publication_live_slug_article(text,text)','execute'), 'A the new function: executable by no API role');
  perform t.ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure)
    and has_function_privilege('service_role','public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)','execute')
    and not has_function_privilege('anon','public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)','execute')
    and not has_function_privilege('authenticated','public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)','execute'),
    'A propose: still security definer, empty search_path, service_role only');
  perform t.ok((select count(*) from pg_proc where proname = 'nexra_article_publication_propose') = 1, 'A one propose function, the same signature');
end $$;

-- B: rule 2 — the owning article is never refused; every other article is.
do $$
declare o uuid; x uuid; y uuid; p uuid; q uuid; r jsonb; n0 bigint;
begin
  o := t12.ready_as(t12.owner(), 70, t6.txt('ai-dead-lead-reactivation', 'different-angle'));
  x := t6.ready(71, t6.txt('ai-dead-lead-reactivation', 'different-angle'));
  y := t6.ready(72, t6.txt('ai-dead-lead-reactivation', 'update-existing'));
  perform t.ok(o = t12.owner(), 'B the owning article exists with its production id');
  n0 := t6.n();
  perform t.ok(t6.propose(x, 1)->>'outcome' = 'slug-live-collision', 'B another article, different-angle: slug-live-collision');
  perform t.ok(t6.propose(y, 1)->>'outcome' = 'slug-live-collision', 'B another article, update-existing: slug-live-collision');
  perform t.ok(t6.n() = n0, 'B the refusals wrote nothing');
  r := t6.propose(o, 1);
  perform t.ok(r->>'outcome' = 'created' and r->'proposal'->>'slug' = 'ai-dead-lead-reactivation', 'B the owning article, different-angle: created (no slug-live-collision)');
  p := (r->'proposal'->>'id')::uuid;
  perform t.ok(t6.propose(o, 1)->>'outcome' = 'exists', 'B the owning article, identical repeat: exists');
  perform t.ok(t6.propose(x, 1)->>'outcome' = 'slug-live-collision', 'B another article while the owner''s proposal is active: slug-live-collision, before slug-taken');
  perform t.ok(t6.withdraw(p)->>'outcome' = 'withdrawn', 'B the owner''s proposal withdrawn');
  perform t.ok(t6.propose(x, 1)->>'outcome' = 'slug-live-collision' and t6.propose(y, 1)->>'outcome' = 'slug-live-collision',
    'B with the slug free of proposals, other articles are still refused');
  r := t6.propose(o, 1);
  perform t.ok(r->>'outcome' = 'created', 'B the owning article proposes again: created');
  q := (r->'proposal'->>'id')::uuid;
  perform t.ok(q <> p and (select status from nexra_article_publication_proposals where id = p) = 'withdrawn', 'B a new row; the withdrawn one kept');
end $$;

-- C: the pinned slug keeps D2.
do $$
declare d uuid; u uuid;
begin
  d := t6.ready(73, t6.txt('ai-lead-follow-up-automation', 'different-angle'));
  u := t6.ready(74, t6.txt('ai-lead-follow-up-automation', 'update-existing'));
  perform t.ok(t6.propose(d, 1)->>'outcome' = 'slug-live-collision', 'C pinned slug, different-angle: slug-live-collision');
  perform t.ok(t6.propose(u, 1)->>'outcome' = 'created', 'C pinned slug, update-existing: created (D2 unchanged)');
  perform t.ok(t6.propose(t6.ready(75, t6.txt('not-live-slug')), 1)->>'outcome' = 'created', 'C a slug that is not live: created');
end $$;
