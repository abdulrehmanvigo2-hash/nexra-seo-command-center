-- M2: the pinned follow-up article's keywords in the live-articles read (docs/roadmap/M2-opportunities.md, PR 2 of 6;
-- docs/roadmap/NEXT-FOUR-PLAN.md, decision "record the pinned article's keywords before scoring").
--
-- WHY. `nexra_article_publication_live_articles` (fix F9, 20261015120000) returns, for each live slug, the keywords of
-- the version its owning article proposed. The pinned template slug `ai-lead-follow-up-automation` has no article
-- record — it was live before the product kept articles — so the read answers `keywords: null` for it, and the
-- topical map (M1) cannot see the page: the approved map of 3 Oct reads 7 gaps, four of them topics that page
-- covers ("automated lead follow-up", "WhatsApp lead automation", "appointment booking automation", "reactivate old
-- CRM leads"). Scoring opportunities over that map would recommend new articles that compete with the page holding
-- 38 of the site's 44 stored query x page impressions.
--
-- WHAT. The read is replaced with the same signature, return type and security. For the pinned template slug at
-- `nexra-agency-website` with no owning article it now returns the ten keywords the website template pins for that
-- page (`NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.keywords`, nexra-ai `1a688bd`; a repository test checks this list
-- against the template). Every other entry is computed exactly as before.
--
-- WHAT DOES NOT CHANGE. The proposal eligibility and the preview read slugs only; the website renderer already
-- checks the pinned slug against the template's own keyword set and skips its entry in this read. So no proposal,
-- preview hash or render changes. No table, row, trigger or other function changes; the two list functions and the
-- propose function are untouched. EXECUTE stays with `service_role` only.

create or replace function public.nexra_article_publication_live_articles(p_destination text)
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
           'keywords', case
             when a.article_id is null and p_destination = 'nexra-agency-website' and s.slug = 'ai-lead-follow-up-automation'
               then '["AI lead follow-up automation","automated lead follow-up","WhatsApp lead automation","AI lead qualification","CRM lead automation","sales follow-up automation","lead response automation","appointment booking automation","reactivate old CRM leads","dead lead follow-up"]'::jsonb
             when v.canonical_content is null then null
             else v.canonical_content::jsonb -> 'keywords'
           end
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
  'F9 and M2: the live articles at a destination from the records — slug, owning article (null for a pinned template slug), the version proposed for it and that version''s keywords (for the pinned template slug, the keywords its template pins) — in the live-slug list''s order.';

-- Restated, not changed: EXECUTE for service_role only.
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
