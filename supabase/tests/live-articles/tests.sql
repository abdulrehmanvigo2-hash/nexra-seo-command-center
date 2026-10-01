-- F9 (audit A5-01): the live articles at a destination, read from the records. Runs after c4, c5, c6 and live-slugs
-- setup. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh, which creates and destroys
-- its own disposable cluster. Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create function t12.kw(p_slug text, p_keywords text) returns text language sql as $$
  select replace(t6.txt(p_slug), '"topic":"t"', '"topic":"t","keywords":' || p_keywords)
$$;
create function t12.live() returns jsonb language sql as $$ select public.nexra_article_publication_live_articles('nexra-agency-website') $$;
create function t12.counts() returns text language sql as $$
  select format('%s/%s/%s/%s', (select count(*) from nexra_articles), (select count(*) from nexra_article_versions),
    (select count(*) from nexra_article_approvals), (select count(*) from nexra_article_publication_proposals))
$$;

-- A: the function and its security.
do $$
begin
  perform t.ok((select prosecdef and provolatile = 's' and proconfig = array['search_path=""'] from pg_proc
    where oid = 'public.nexra_article_publication_live_articles(text)'::regprocedure), 'A security definer, stable, empty search_path');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_article_publication_live_articles(text)', 'execute')
    and not has_function_privilege('anon', 'public.nexra_article_publication_live_articles(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.nexra_article_publication_live_articles(text)', 'execute'), 'A EXECUTE for service_role only');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_article_publication_live_slugs(text)', 'execute')
    and not has_function_privilege('service_role', 'public.nexra_article_publication_live_slug_article(text,text)', 'execute'), 'A the two list functions stay closed to API roles');
  perform t.ok(public.nexra_article_publication_live_articles('not-a-destination') = '[]'::jsonb, 'A another destination: no live article');
end $$;

-- B: before the owning article has a proposal: both slugs, in the list's order; no version or keywords yet.
do $$
declare l jsonb;
begin
  l := t12.live();
  perform t.ok(jsonb_array_length(l) = 2 and l->0->>'slug' = 'ai-lead-follow-up-automation' and l->1->>'slug' = 'ai-dead-lead-reactivation', 'B both live slugs, pinned first');
  perform t.ok(l->0->'articleId' = 'null'::jsonb and l->0->'articleVersion' = 'null'::jsonb and l->0->'keywords' = 'null'::jsonb, 'B the pinned slug: no article, version or keywords in the records');
  perform t.ok(l->1->>'articleId' = t12.owner()::text and l->1->'articleVersion' = 'null'::jsonb and l->1->'keywords' = 'null'::jsonb, 'B the published slug names its article; no proposal yet, so no version or keywords');
end $$;

-- C: the owning article's proposed version gives the keywords; a withdrawn proposal still does; the active one wins.
do $$
declare o uuid; r jsonb; p uuid; l jsonb; c0 text;
begin
  o := t12.ready_as(t12.owner(), 80, t12.kw('ai-dead-lead-reactivation', '["dead lead reactivation","ai follow up"]'));
  r := t6.propose(o, 1);
  perform t.ok(r->>'outcome' = 'created', 'C the owning article proposes version 1');
  p := (r->'proposal'->>'id')::uuid;
  l := t12.live();
  perform t.ok(l->1->>'articleVersion' = '1' and l->1->'keywords' = '["dead lead reactivation","ai follow up"]'::jsonb, 'C the published slug: version 1 and its keywords, as stored');
  perform t.ok(t6.withdraw(p)->>'outcome' = 'withdrawn', 'C the proposal withdrawn');
  l := t12.live();
  perform t.ok(l->1->>'articleVersion' = '1' and l->1->'keywords' = '["dead lead reactivation","ai follow up"]'::jsonb, 'C a withdrawn proposal still names the published version');
  c0 := t12.counts();
  l := t12.live();
  perform t.ok(t12.counts() = c0, 'C reading wrote nothing');
end $$;

-- D: another article's proposal never stands in for the owner's.
do $$
declare x uuid; l jsonb;
begin
  x := t6.ready(81, t12.kw('not-live-slug', '["something else"]'));
  perform t.ok(t6.propose(x, 1)->>'outcome' = 'created', 'D an unrelated article proposed');
  l := t12.live();
  perform t.ok(jsonb_array_length(l) = 2 and l->1->>'articleId' = t12.owner()::text and l->1->'keywords' = '["dead lead reactivation","ai follow up"]'::jsonb,
    'D the live list is unchanged by another article''s proposal');
end $$;
