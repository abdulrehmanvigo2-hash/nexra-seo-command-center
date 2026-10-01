-- The live articles at a destination, read from the records (fix F9; audit A5-01).
--
-- WHY. The database already holds the one list of live slugs: the pinned
-- template's (20260925120000) and those published after the pin, each with the
-- article it was published from (20261011120000). The application restated the
-- same list by hand (`LIVE_SLUGS_AFTER_PIN`), and the website renderer checked
-- only the template's own slug and the template's live keywords, so a second
-- published article's slug and keywords were invisible to it. Neither of the
-- two list functions is callable by an API role, so the application could not
-- read the records it should follow.
--
-- WHAT. One read function, `nexra_article_publication_live_articles(destination)`:
-- for each live slug, in the list's own order — the slug, the article it was
-- published from (null for a pinned template slug, which has no article
-- record), the version that article proposed to that destination and slug
-- (the newest active proposal, else the newest withdrawn one), and that
-- version's keywords as stored in its canonical text (null when no version is
-- found). The application reads it for the proposal eligibility, the preview,
-- the editor's live-article notice and the renderer's slug and keyword checks.
--
-- SECURITY. `security definer` with an empty `search_path`, `stable`; EXECUTE
-- for `service_role` only. It returns slugs, ids, a version number and
-- keywords — no text, approver, hash or other row content.
--
-- Nothing else changes: no table, row, trigger or grant other than this
-- function's; the two list functions and the propose function are untouched.

create function public.nexra_article_publication_live_articles(p_destination text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', s.slug,
           'articleId', a.article_id,
           'articleVersion', p.article_version,
           'keywords', case when v.canonical_content is null then null else v.canonical_content::jsonb -> 'keywords' end
         ) order by s.ord), '[]'::jsonb)
    from unnest(public.nexra_article_publication_live_slugs(p_destination)) with ordinality as s(slug, ord)
    cross join lateral (select public.nexra_article_publication_live_slug_article(p_destination, s.slug) as article_id) a
    left join lateral (
      select pr.article_version
        from public.nexra_article_publication_proposals pr
       where pr.article_id = a.article_id and pr.destination = p_destination and pr.slug = s.slug
       order by (pr.status = 'proposed') desc, pr.created_at desc, pr.id desc
       limit 1
    ) p on true
    left join public.nexra_article_versions v
      on v.article_id = a.article_id and v.version = p.article_version
$$;

comment on function public.nexra_article_publication_live_articles(text) is
  'F9: the live articles at a destination from the records — slug, owning article (null for a pinned template slug), the version proposed for it and that version''s keywords — in the live-slug list''s order.';

revoke all on function public.nexra_article_publication_live_articles(text) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_article_publication_live_articles(text) from %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nexra_article_publication_live_articles(text) to service_role;
  end if;
end
$$;
