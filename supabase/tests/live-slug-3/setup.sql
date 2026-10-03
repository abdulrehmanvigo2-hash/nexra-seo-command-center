-- Article 3 fixtures (schema t18): the owning article of the third slug published after the pin, `missed-call-text-back`,
-- created through the real create function with its production id (t12.ready_as). Runs after live-slug-2/setup.sql.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh, which creates and destroys its
-- own disposable cluster. Never run against a hosted database.
\set ON_ERROR_STOP 1
create schema t18;
create function t18.owner3() returns uuid language sql as $$ select '339c9b60-7f4c-4c6b-8692-1bb7b9cdfc52'::uuid $$;
create function t18.kw(p_slug text, p_keywords text) returns text language sql as $$
  select replace(t6.txt(p_slug), '"topic":"t"', '"topic":"t","keywords":' || p_keywords)
$$;
create function t18.live() returns jsonb language sql as $$ select public.nexra_article_publication_live_articles('nexra-agency-website') $$;
