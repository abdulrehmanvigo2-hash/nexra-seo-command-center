-- Article 2 fixtures (schema t17): the owning article of the second slug published after the pin, `ai-sdr-tool`,
-- created through the real create function with its production id (t12.ready_as). Runs after live-slugs/setup.sql.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh, which creates and destroys its
-- own disposable cluster. Never run against a hosted database.
\set ON_ERROR_STOP 1
create schema t17;
create function t17.owner2() returns uuid language sql as $$ select '6f50f8cb-bb85-4389-a5b4-21402c739f8b'::uuid $$;
create function t17.kw(p_slug text, p_keywords text) returns text language sql as $$
  select replace(t6.txt(p_slug), '"topic":"t"', '"topic":"t","keywords":' || p_keywords)
$$;
create function t17.live() returns jsonb language sql as $$ select public.nexra_article_publication_live_articles('nexra-agency-website') $$;
