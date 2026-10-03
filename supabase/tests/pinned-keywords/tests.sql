-- M2 (migration 20261020120000): the pinned follow-up article's keywords in the live-articles read, on the full schema.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t20;
create function t20.pinned() returns jsonb language sql as $$
  select '["AI lead follow-up automation","automated lead follow-up","WhatsApp lead automation","AI lead qualification","CRM lead automation","sales follow-up automation","lead response automation","appointment booking automation","reactivate old CRM leads","dead lead follow-up"]'::jsonb
$$;

-- A: the pinned slug now carries the template's ten keywords; nothing else about it changes.
do $$
declare l jsonb;
begin
  l := public.nexra_article_publication_live_articles('nexra-agency-website');
  perform t.ok(jsonb_array_length(l) = 4 and l->0->>'slug' = 'ai-lead-follow-up-automation', 'A four live slugs, the pinned slug first');
  perform t.ok(l->0->'keywords' = t20.pinned(), 'A the pinned slug: the ten keywords its template pins, in the template''s order');
  perform t.ok(l->0->'articleId' = 'null'::jsonb and l->0->'articleVersion' = 'null'::jsonb, 'A the pinned slug: still no article and no version');
  perform t.ok(l->1->'keywords' = 'null'::jsonb and l->2->'keywords' = 'null'::jsonb and l->3->'keywords' = 'null'::jsonb,
    'A the slugs published after the pin: no keywords until their owners propose (unchanged rule)');
  perform t.ok(public.nexra_article_publication_live_articles('x') = '[]'::jsonb, 'A another destination: an empty list');
end $$;

-- B: an owning article's proposed version still gives its own keywords; the pinned entry is untouched by it.
do $$
declare o uuid; l jsonb;
begin
  o := t12.ready_as(t18.owner3(), 60, t18.kw('missed-call-text-back', '["missed call text back","auto missed call text back"]'));
  perform t.ok(t6.propose(o, 1)->>'outcome' = 'created', 'B the owner of missed-call-text-back proposes version 1');
  l := public.nexra_article_publication_live_articles('nexra-agency-website');
  perform t.ok(l->3->>'articleVersion' = '1' and l->3->'keywords' = '["missed call text back","auto missed call text back"]'::jsonb, 'B its entry: version 1 and its stored keywords');
  perform t.ok(l->0->'keywords' = t20.pinned(), 'B the pinned entry: still the template''s ten');
end $$;

-- C: proposals over the pinned slug keep D2, and the read does not change because of them.
do $$
declare d uuid; u uuid; l jsonb;
begin
  d := t6.ready(61, t6.txt('ai-lead-follow-up-automation', 'different-angle'));
  u := t6.ready(62, t6.txt('ai-lead-follow-up-automation', 'update-existing'));
  perform t.ok(t6.propose(d, 1)->>'outcome' = 'slug-live-collision', 'C pinned slug, different-angle: slug-live-collision (D2 unchanged)');
  perform t.ok(t6.propose(u, 1)->>'outcome' = 'created', 'C pinned slug, update-existing: created (D2 unchanged)');
  l := public.nexra_article_publication_live_articles('nexra-agency-website');
  perform t.ok(l->0->'articleId' = 'null'::jsonb and l->0->'keywords' = t20.pinned(), 'C an update-existing proposal does not become the pinned slug''s owner in the read');
end $$;

-- D: the function's security is as before.
do $$
begin
  perform t.ok((select prosecdef and provolatile = 's' and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = current_user
                  from pg_proc where oid = 'public.nexra_article_publication_live_articles(text)'::regprocedure),
    'D security definer, stable, empty search_path, owned by the migration''s owner');
  perform t.ok(has_function_privilege('service_role', 'public.nexra_article_publication_live_articles(text)', 'execute')
    and not has_function_privilege('anon', 'public.nexra_article_publication_live_articles(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.nexra_article_publication_live_articles(text)', 'execute'), 'D EXECUTE for service_role only');
  perform t.ok((select count(*) from pg_proc where proname = 'nexra_article_publication_live_articles') = 1, 'D one function, the same signature');
end $$;
