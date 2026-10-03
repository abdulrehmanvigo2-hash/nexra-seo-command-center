-- The second article published after the template pin: `ai-sdr-tool`
-- (runbook §7, step 5; the 6.12a shape, decision D10 of
-- docs/website-renderer-6.9.md).
--
-- WHY. nexra-ai pull request #12, merged as ab5f10d, put `/blog/ai-sdr-tool`
-- live on 2026-10-03, rendered under template `nexra-ai-blog-tsx/3` (pinned at
-- nexra-ai 356f38f) from article 6f50f8cb-bb85-4389-a5b4-21402c739f8b version 2
-- (content SHA-256 cdcfbc87…, approval 60268daa…, proposal 870a1af6…, which
-- stays the record of the published intent). The product keeps no list of
-- live slugs in code (fix F9): the proposal eligibility, the preview, the
-- editor's live notice and the renderer read
-- `nexra_article_publication_live_articles`, which reads the two list
-- functions below. Until this migration is applied, that read lists two
-- slugs, and a different-angle proposal by another article naming
-- `ai-sdr-tool` would be refused only by the active proposal 870a1af6…
-- (`slug-taken`), not as a live slug.
--
-- THE RULE (6.12a, unchanged). A pinned template slug has no article behind
-- it: a different-angle proposal naming it is refused `slug-live-collision`,
-- and update-existing is allowed (D2). A slug published after the pin belongs
-- to the article it was published from: that article is never refused for it,
-- and every other article is, whatever its topic decision.
--
-- WHAT CHANGES.
-- * `nexra_article_publication_live_slugs(text)` (replaced): the pinned slug,
--   then the two slugs published after the pin, in publication order.
-- * `nexra_article_publication_live_slug_article(text, text)` (replaced): the
--   article each slug published after the pin came from.
-- * Nothing else: the propose function and the live-articles read function
--   are untouched (they call the two above); no table, row, column, index,
--   trigger or grant changes. `create or replace` keeps each function's
--   owner and privileges; the article function stays executable by no API
--   role, and the revoke below only restates that. Existing proposals are
--   rows and are not re-checked: the active proposals ea85edb0… and
--   870a1af6… are untouched.

-- ---------------------------------------------------------------------------
-- The live slugs at a destination: the pinned template's (nexra-ai-blog-tsx/1
-- at a4a572296eca5944dc29a436048a6fff68c33d5d), then those published after
-- the pin, in publication order.

create or replace function public.nexra_article_publication_live_slugs(p_destination text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_destination
    when 'nexra-agency-website' then array['ai-lead-follow-up-automation', 'ai-dead-lead-reactivation', 'ai-sdr-tool']::text[]
    else array[]::text[]
  end
$$;

-- ---------------------------------------------------------------------------
-- The article each slug published after the pin came from, with its source:
--   nexra-agency-website / ai-dead-lead-reactivation —
--     article 1003104c-6b25-456f-9304-eefa2ba88e7d, nexra-ai pull request #9,
--     merge 9a69c8c09aff7df7ce3d676700114d6efe91d4f9, published 2026-09-30.
--   nexra-agency-website / ai-sdr-tool —
--     article 6f50f8cb-bb85-4389-a5b4-21402c739f8b, nexra-ai pull request #12,
--     merge ab5f10d, published 2026-10-03.

create or replace function public.nexra_article_publication_live_slug_article(p_destination text, p_slug text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_destination, p_slug) = ('nexra-agency-website', 'ai-dead-lead-reactivation')
      then '1003104c-6b25-456f-9304-eefa2ba88e7d'::uuid
    when (p_destination, p_slug) = ('nexra-agency-website', 'ai-sdr-tool')
      then '6f50f8cb-bb85-4389-a5b4-21402c739f8b'::uuid
    else null::uuid
  end
$$;

comment on function public.nexra_article_publication_live_slug_article(text, text) is
  'The article a live slug published after the template pin came from (D10); null for a pinned template slug or a slug that is not live.';

-- Restated, not changed: the article function is executable by no API role.
revoke all on function public.nexra_article_publication_live_slug_article(text, text) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_article_publication_live_slug_article(text, text) from %I', v_role);
    end if;
  end loop;
end
$$;
