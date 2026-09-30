-- Live slugs published after the template pin (Phase 6, checkpoint 6.12a;
-- decision D10 of docs/website-renderer-6.9.md).
--
-- WHY. The destination's live slugs were pinned in 20260925120000 from the
-- website template `nexra-ai-blog-tsx/1` at nexra-ai a4a5722 (D2). Since then
-- one article went live: nexra-ai pull request #9, merged as
-- 9a69c8c09aff7df7ce3d676700114d6efe91d4f9, put `/blog/ai-dead-lead-reactivation`
-- live, published 2026-09-30, rendered from article
-- 1003104c-6b25-456f-9304-eefa2ba88e7d version 6 (approval 98195295…, proposal
-- ea85edb0…, which stays the record of the published intent). The pinned
-- templates are not edited; the slug is added to a short explicit list of
-- slugs published after the pin, each bound to the article it came from. The
-- application restates the same list (`src/lib/content/articles/proposals/
-- live-slugs.ts`, `LIVE_SLUGS_AFTER_PIN`); a test keeps the two in step.
--
-- THE RULE. A pinned template slug has no article behind it: a different-angle
-- proposal naming it is refused `slug-live-collision`, and update-existing is
-- allowed (D2, unchanged). A slug published after the pin belongs to the
-- article it was published from: that article is never refused for it, and
-- every other article is, whatever its topic decision.
--
-- WHAT CHANGES.
-- * `nexra_article_publication_live_slugs(text)` (replaced): the pinned slug,
--   then the slugs published after the pin.
-- * `nexra_article_publication_live_slug_article(text, text)` (new, internal,
--   immutable): the article a live slug was published from; null for a pinned
--   slug or a slug that is not live.
-- * `nexra_article_publication_propose` (replaced, same signature): its body is
--   20261010120000's word for word except the live-slug check, which asks the
--   new function who owns the slug.
-- * No table, row, column, index, trigger or grant changes: `create or
--   replace` keeps each replaced function's owner and privileges; the new
--   function is executable by no API role, as the live-slug function is.
--   Existing proposals are rows and are not re-checked: the active proposal
--   ea85edb0… is untouched.

-- ---------------------------------------------------------------------------
-- The live slugs at a destination: the pinned template's (nexra-ai-blog-tsx/1
-- at a4a572296eca5944dc29a436048a6fff68c33d5d), then those published after
-- the pin.

create or replace function public.nexra_article_publication_live_slugs(p_destination text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_destination
    when 'nexra-agency-website' then array['ai-lead-follow-up-automation', 'ai-dead-lead-reactivation']::text[]
    else array[]::text[]
  end
$$;

-- ---------------------------------------------------------------------------
-- The article each slug published after the pin came from, with its source:
--   nexra-agency-website / ai-dead-lead-reactivation —
--     article 1003104c-6b25-456f-9304-eefa2ba88e7d, nexra-ai pull request #9,
--     merge 9a69c8c09aff7df7ce3d676700114d6efe91d4f9, published 2026-09-30.

create function public.nexra_article_publication_live_slug_article(p_destination text, p_slug text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_destination, p_slug) = ('nexra-agency-website', 'ai-dead-lead-reactivation')
      then '1003104c-6b25-456f-9304-eefa2ba88e7d'::uuid
    else null::uuid
  end
$$;

comment on function public.nexra_article_publication_live_slug_article(text, text) is
  'The article a live slug published after the template pin came from (D10); null for a pinned template slug or a slug that is not live.';

-- ---------------------------------------------------------------------------
-- Propose: 20261010120000's function, with the live-slug check deciding a
-- slug published after the pin by its owning article.

create or replace function public.nexra_article_publication_propose(
  p_project_id text,
  p_article_id uuid,
  p_article_version smallint,
  p_article_version_id uuid,
  p_content_sha256 text,
  p_approval_id uuid,
  p_destination text,
  p_slug text,
  p_preview_format text,
  p_preview_sha256 text,
  p_requested_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_approval public.nexra_article_approvals;
  v_active public.nexra_article_publication_proposals;
  v_proposal public.nexra_article_publication_proposals;
  v_content jsonb;
begin
  if p_project_id is null or p_article_id is null or p_article_version is null or p_article_version_id is null
    or p_content_sha256 is null or p_approval_id is null or p_destination is null or p_slug is null
    or p_preview_format is null or p_preview_sha256 is null or p_requested_by is null
  then
    raise exception 'nexra_article_publication_propose: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_article
    from public.nexra_articles
   where id = p_article_id and project_id = p_project_id
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found');
  end if;
  if v_article.status = 'archived' then
    return jsonb_build_object('outcome', 'archived');
  end if;
  if not public.nexra_article_publication_destination_allowed(p_destination, p_project_id) then
    return jsonb_build_object('outcome', 'destination-unavailable');
  end if;
  if v_article.status <> 'approved' then
    return jsonb_build_object('outcome', 'not-approved', 'status', v_article.status);
  end if;
  if v_article.current_version <> p_article_version or v_article.approved_version is distinct from p_article_version then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_article.current_version, 'approved_version', v_article.approved_version);
  end if;

  select * into v_version
    from public.nexra_article_versions
   where article_id = p_article_id and version = p_article_version;
  if not found then
    return jsonb_build_object('outcome', 'version-not-found');
  end if;
  if v_version.id <> p_article_version_id then
    return jsonb_build_object('outcome', 'version-mismatch');
  end if;
  if v_version.content_sha256 <> p_content_sha256
    or encode(sha256(convert_to(v_version.canonical_content, 'UTF8')), 'hex') <> p_content_sha256
  then
    return jsonb_build_object('outcome', 'content-mismatch');
  end if;

  select * into v_approval
    from public.nexra_article_approvals
   where id = p_approval_id;
  if not found
    or v_approval.article_id <> p_article_id
    or v_approval.article_version <> p_article_version
    or v_approval.article_version_id <> p_article_version_id
    or v_approval.content_sha256 <> p_content_sha256
    or v_approval.approved_by is distinct from v_article.approved_by
    or v_approval.approved_at is distinct from v_article.approved_at
  then
    return jsonb_build_object('outcome', 'approval-mismatch');
  end if;

  v_content := v_version.canonical_content::jsonb;
  if (v_content ->> 'slug') is distinct from p_slug
    or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) not between 3 and 80
  then
    return jsonb_build_object('outcome', 'slug-mismatch');
  end if;
  if strpos(lower(v_version.canonical_content), '[needs evidence') > 0 then
    return jsonb_build_object('outcome', 'unresolved-placeholder');
  end if;
  if p_preview_format is distinct from (case when v_content ? 'attestations' then 'article-proposal-text/2' else 'article-proposal-text/1' end)
    or p_preview_sha256 !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object('outcome', 'invalid-preview');
  end if;
  if p_slug = any (public.nexra_article_publication_live_slugs(p_destination))
    and (case
          when public.nexra_article_publication_live_slug_article(p_destination, p_slug) is null
            then (v_content ->> 'topicDecision') is distinct from 'update-existing'
          else public.nexra_article_publication_live_slug_article(p_destination, p_slug) is distinct from p_article_id
        end)
  then
    return jsonb_build_object('outcome', 'slug-live-collision');
  end if;

  -- An active proposal of this article: the same binding again writes nothing.
  select * into v_active
    from public.nexra_article_publication_proposals
   where article_id = p_article_id and status = 'proposed';
  if found then
    if v_active.article_version = p_article_version
      and v_active.article_version_id = p_article_version_id
      and v_active.content_sha256 = p_content_sha256
      and v_active.approval_id = p_approval_id
      and v_active.destination = p_destination
      and v_active.slug = p_slug
      and v_active.preview_format = p_preview_format
      and v_active.preview_sha256 = p_preview_sha256
    then
      return jsonb_build_object('outcome', 'exists', 'proposal', to_jsonb(v_active));
    end if;
    return jsonb_build_object('outcome', 'active-exists', 'proposal', to_jsonb(v_active));
  end if;

  -- The destination slug, held by another article's or a draft's active proposal.
  if exists (
    select 1 from public.nexra_article_publication_proposals
     where destination = p_destination and slug = p_slug and status = 'proposed'
  ) or exists (
    select 1 from public.nexra_content_publication_proposals
     where destination = p_destination and slug = p_slug and status = 'proposed'
  ) then
    return jsonb_build_object('outcome', 'slug-taken');
  end if;

  begin
    insert into public.nexra_article_publication_proposals
      (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at,
       destination, slug, preview_format, preview_sha256, requested_by)
    values
      (p_project_id, p_article_id, p_article_version, p_article_version_id, v_version.content_sha256, v_approval.id,
       v_approval.approved_by, v_approval.approved_at, p_destination, p_slug, p_preview_format, p_preview_sha256, p_requested_by)
    returning * into v_proposal;
  exception when unique_violation then
    -- The parent's lock rules out a second active proposal of this article;
    -- what remains is the slug, taken meanwhile by another article.
    return jsonb_build_object('outcome', 'slug-taken');
  end;

  return jsonb_build_object('outcome', 'created', 'proposal', to_jsonb(v_proposal));
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: the new function to no API role.

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
