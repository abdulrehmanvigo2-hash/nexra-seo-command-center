-- Operator-attested paragraphs (Phase 6, checkpoint 6.8b; the approved 6.1b
-- design note).
--
-- WHY. The article check (C4) passes only statements the project's own
-- records hold, so a first-hand or opinion passage was UNVERIFIABLE and an
-- article carrying one could never be approved. The operator may now attest
-- H2 and H3 body paragraphs — `experience` (first-hand client work) or
-- `opinion` (the agency's view) — within fixed limits the application
-- validates: at most 40% of the body's sentences and half of any one
-- section's, and no number in an attested paragraph. The approval records
-- the operator's attestation tick, and the approval gate requires it and at
-- least three supported statements. Option (b), external sources, is after
-- V1.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000.
--
-- FORMAT 1 IS UNTOUCHED. An article with no attestation is still written as
-- `nexra-article-content/1`, its check units as `nexra-article-check-unit/1`
-- and its proposal preview as `article-proposal-text/1`, byte for byte as
-- before. No stored row is rewritten: the verification article's Version 4
-- (content e9db287f…, its four unit hashes, approval 5f02d149…, proposal
-- 5f229630… and its preview bbf3fae3…) keeps every byte; the new approval
-- columns read 0 and false for it.
--
-- WHAT CHANGES.
-- * `nexra_article_attested_count(text)` (new, internal, immutable): the
--   number of attestations a stored canonical text carries — 0 for format 1
--   with no `attestations` member; the list's length for format 2 with a
--   non-empty list; null (invalid) for any other combination.
-- * Articles: the version table's format check and
--   `nexra_article_check_content` accept format 1 or format 2; the latter
--   refuses a text the count function calls invalid. Everything else the
--   create and save functions check is unchanged.
-- * Approvals: two columns, `attested_count` (0–50) and
--   `attested_confirmed`, with `attested_confirmed = (attested_count > 0)`;
--   the insert check also requires the count to be the stored version's.
--   `nexra_article_approve_version` gains a ninth parameter,
--   `p_attestation_confirmed boolean default false` (the eight-parameter
--   function is dropped; every existing call is unchanged). After every
--   earlier check, when the version attests any paragraph it answers
--   `attestation-unconfirmed` without the tick and `too-few-supported` when
--   the version's check units record fewer than three supported statements;
--   it computes the count from the stored text and writes it with the tick.
-- * Proposals: `preview_format` accepts `article-proposal-text/2`, and the
--   propose function requires the format the stored content implies — /2
--   exactly when it attests a paragraph.
-- * No grant changes: `create or replace` keeps each replaced function's
--   privileges; the recreated approval function is granted to service_role
--   as the old one was. The harness's security definer inventory (c5) names
--   its new signature.

-- ---------------------------------------------------------------------------
-- The attestations a stored text carries: 0 for format 1 (no member), the
-- list's length for format 2 (a non-empty list), null for anything else.

create function public.nexra_article_attested_count(p_canonical_content text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_content jsonb;
begin
  if p_canonical_content is null then
    return null;
  end if;
  begin
    v_content := p_canonical_content::jsonb;
  exception when others then
    return null;
  end;
  if starts_with(p_canonical_content, '{"format":"nexra-article-content/1",') then
    return case when v_content ? 'attestations' then null else 0 end;
  end if;
  if starts_with(p_canonical_content, '{"format":"nexra-article-content/2",') then
    if jsonb_typeof(v_content -> 'attestations') = 'array' and jsonb_array_length(v_content -> 'attestations') between 1 and 50 then
      return jsonb_array_length(v_content -> 'attestations');
    end if;
    return null;
  end if;
  return null;
end;
$$;

comment on function public.nexra_article_attested_count(text) is
  'The operator-attested paragraphs a stored canonical text carries: 0 for nexra-article-content/1, the list length for /2, null for anything else. Internal.';

-- ---------------------------------------------------------------------------
-- Articles: format 1 or format 2.

alter table public.nexra_article_versions drop constraint nexra_article_versions_canonical_format;
alter table public.nexra_article_versions
  add constraint nexra_article_versions_canonical_format
    check (starts_with(canonical_content, '{"format":"nexra-article-content/1",') or starts_with(canonical_content, '{"format":"nexra-article-content/2",'));

create or replace function public.nexra_article_check_content(p_canonical_content text, p_content_sha256 text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_canonical_content is null
    or char_length(p_canonical_content) not between 2 and 1000000
    or not (starts_with(p_canonical_content, '{"format":"nexra-article-content/1",')
         or starts_with(p_canonical_content, '{"format":"nexra-article-content/2",'))
  then
    return 'invalid-content';
  end if;
  begin
    if jsonb_typeof(p_canonical_content::jsonb) <> 'object' then
      return 'invalid-content';
    end if;
    if public.nexra_article_attested_count(p_canonical_content) is null then
      return 'invalid-content';
    end if;
  exception when others then
    return 'invalid-content';
  end;
  if p_content_sha256 is null or encode(sha256(convert_to(p_canonical_content, 'UTF8')), 'hex') <> p_content_sha256 then
    return 'content-mismatch';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approvals: the attested count and the operator's tick.

alter table public.nexra_article_approvals
  add column attested_count smallint not null default 0
    constraint nexra_article_approvals_attested_count_range check (attested_count between 0 and 50),
  add column attested_confirmed boolean not null default false;
alter table public.nexra_article_approvals
  add constraint nexra_article_approvals_attested_confirmed check (attested_confirmed = (attested_count > 0));

comment on column public.nexra_article_approvals.attested_count is
  'Operator-attested paragraphs in the approved version (6.8b), computed from its stored text; 0 for format 1.';
comment on column public.nexra_article_approvals.attested_confirmed is
  'The operator''s attestation tick for this approval (6.8b): true exactly when the version attests any paragraph.';

create or replace function public.nexra_article_approvals_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.nexra_article_versions v
     where v.id = new.article_version_id
       and v.article_id = new.article_id
       and v.version = new.article_version
       and v.content_sha256 = new.content_sha256
  ) then
    raise exception 'nexra_article_approvals: the version row, number and content hash do not name one stored version of this article'
      using errcode = 'check_violation';
  end if;
  -- 6.8b: the attested count is the stored version's own.
  if new.attested_count is distinct from (
    select public.nexra_article_attested_count(v.canonical_content) from public.nexra_article_versions v where v.id = new.article_version_id
  ) then
    raise exception 'nexra_article_approvals: the attested count is not the stored version''s'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid);

create function public.nexra_article_approve_version(
  p_project_id text,
  p_article_id uuid,
  p_article_version smallint,
  p_article_version_id uuid,
  p_content_sha256 text,
  p_units jsonb,
  p_units_sha256 text,
  p_approved_by uuid,
  p_attestation_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_existing public.nexra_article_approvals;
  v_approval public.nexra_article_approvals;
  v_unit_count integer;
  v_digest text;
  v_topic text;
  v_attested integer;
  v_supported integer;
begin
  if p_project_id is null or p_article_id is null or p_article_version is null or p_article_version_id is null
    or p_content_sha256 is null or p_units is null or p_units_sha256 is null or p_approved_by is null
  then
    raise exception 'nexra_article_approve_version: every argument is required'
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
  if v_article.current_version <> p_article_version then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_article.current_version);
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

  -- The same version approved again: the existing record, and no write.
  select * into v_existing
    from public.nexra_article_approvals
   where article_id = p_article_id and article_version = p_article_version;
  if found then
    return jsonb_build_object('outcome', 'exists', 'approval', to_jsonb(v_existing), 'article', to_jsonb(v_article));
  end if;

  if v_article.status <> 'checked' then
    return jsonb_build_object('outcome', 'status-unexpected', 'status', v_article.status);
  end if;

  -- The units the server regenerated must be exactly the stored rows of this version.
  if jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) < 1 or jsonb_array_length(p_units) > 150 then
    return jsonb_build_object('outcome', 'units-mismatch');
  end if;
  v_unit_count := jsonb_array_length(p_units);
  if exists (
    select 1 from jsonb_array_elements(p_units) with ordinality as e(value, ordinality)
     where jsonb_typeof(e.value) <> 'object'
        or jsonb_typeof(e.value -> 'index') <> 'number'
        or jsonb_typeof(e.value -> 'key') <> 'string'
        or jsonb_typeof(e.value -> 'sha256') <> 'string'
        or case when (e.value ->> 'index') ~ '^[0-9]{1,3}$' then (e.value ->> 'index')::integer <> e.ordinality - 1 else true end
  ) then
    return jsonb_build_object('outcome', 'units-mismatch');
  end if;
  if exists (
    select 1
      from (
        select (e.value ->> 'index')::integer as unit_index, e.value ->> 'key' as unit_key, e.value ->> 'sha256' as unit_sha256
          from jsonb_array_elements(p_units) as e(value)
      ) expected
      full join (
        select u.unit_index::integer as unit_index, u.unit_key, u.unit_sha256, u.unit_count
          from public.nexra_article_check_units u
         where u.article_version_id = p_article_version_id
      ) stored
        on stored.unit_index = expected.unit_index
     where expected.unit_index is null
        or stored.unit_index is null
        or stored.unit_key <> expected.unit_key
        or stored.unit_sha256 <> expected.unit_sha256
        or stored.unit_count <> v_unit_count
  ) then
    return jsonb_build_object('outcome', 'units-mismatch');
  end if;

  select encode(sha256(convert_to(
           'nexra-article-approval-units/1' || chr(10) ||
           string_agg(u.unit_index::text || ' ' || u.unit_key || ' ' || u.unit_sha256 || chr(10), '' order by u.unit_index),
           'UTF8')), 'hex')
    into v_digest
    from public.nexra_article_check_units u
   where u.article_version_id = p_article_version_id;
  if v_digest is distinct from p_units_sha256 then
    return jsonb_build_object('outcome', 'units-mismatch');
  end if;

  if exists (
    select 1 from public.nexra_article_check_units u
     where u.article_version_id = p_article_version_id and u.status <> 'passed'
  ) then
    return jsonb_build_object(
      'outcome', 'units-not-passed',
      'pending', (select count(*) from public.nexra_article_check_units u where u.article_version_id = p_article_version_id and u.status = 'pending'),
      'needs_review', (select count(*) from public.nexra_article_check_units u where u.article_version_id = p_article_version_id and u.status = 'needs-review'),
      'failed', (select count(*) from public.nexra_article_check_units u where u.article_version_id = p_article_version_id and u.status = 'failed')
    );
  end if;
  if not public.nexra_article_check_version_complete(p_article_version_id, v_version.canonical_content, v_unit_count) then
    return jsonb_build_object('outcome', 'units-incomplete');
  end if;

  v_topic := v_version.canonical_content::jsonb ->> 'topicDecision';
  if v_topic is null or v_topic not in ('update-existing', 'different-angle') then
    return jsonb_build_object('outcome', 'topic-decision', 'topic_decision', v_topic);
  end if;

  if strpos(lower(v_version.canonical_content), '[needs evidence') > 0 then
    return jsonb_build_object('outcome', 'unresolved-placeholder');
  end if;

  -- 6.8b: an article with attested paragraphs needs the operator's tick for
  -- this approval, and its check must have found at least three supported
  -- statements. The count is the stored text's own, never the caller's.
  v_attested := public.nexra_article_attested_count(v_version.canonical_content);
  if v_attested is null then
    return jsonb_build_object('outcome', 'content-mismatch');
  end if;
  if v_attested > 0 then
    if p_attestation_confirmed is distinct from true then
      return jsonb_build_object('outcome', 'attestation-unconfirmed', 'attested_count', v_attested);
    end if;
    select coalesce(sum(case when (u.result -> 'counts' ->> 'supported') ~ '^[0-9]{1,4}$' then (u.result -> 'counts' ->> 'supported')::integer else 0 end), 0)
      into v_supported
      from public.nexra_article_check_units u
     where u.article_version_id = p_article_version_id;
    if v_supported < 3 then
      return jsonb_build_object('outcome', 'too-few-supported', 'supported', v_supported, 'attested_count', v_attested);
    end if;
  end if;

  insert into public.nexra_article_approvals
    (article_id, article_version, article_version_id, content_sha256, unit_count, units_sha256, approved_by, attested_count, attested_confirmed)
  values
    (p_article_id, p_article_version, p_article_version_id, v_version.content_sha256, v_unit_count, v_digest, p_approved_by, v_attested, v_attested > 0)
  returning * into v_approval;

  update public.nexra_articles
     set status = 'approved',
         approved_version = p_article_version,
         approved_by = p_approved_by,
         approved_at = v_approval.approved_at
   where id = p_article_id and status = 'checked' and current_version = p_article_version
  returning * into v_article;
  if not found then
    raise exception 'nexra_article_approve_version: the article changed under its own lock'
      using errcode = 'serialization_failure';
  end if;

  return jsonb_build_object('outcome', 'approved', 'approval', to_jsonb(v_approval), 'article', to_jsonb(v_article));
end;
$$;

comment on function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid, boolean) is
  'Approves one exact article version under the parent''s row lock, after re-checking the project, archive state, current version, version row, content hash, the exact stored check-unit set (all passed and complete), the topic decision, unresolved placeholders and, for a version that attests paragraphs (6.8b), the operator''s tick and at least three supported statements; writes one immutable approval row, with the attested count, and the parent''s approval pointer together. Publishes nothing.';

-- ---------------------------------------------------------------------------
-- Proposals: preview format 2 for a version that attests paragraphs.

alter table public.nexra_article_publication_proposals drop constraint nexra_article_publication_proposals_preview_format_valid;
alter table public.nexra_article_publication_proposals
  add constraint nexra_article_publication_proposals_preview_format_valid
    check (preview_format in ('article-proposal-text/1', 'article-proposal-text/2'));

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
    and (v_content ->> 'topicDecision') is distinct from 'update-existing'
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
-- Access: the recreated approval function to service_role, as before; the
-- count function to no API role.

revoke all on function public.nexra_article_attested_count(text) from public;
revoke all on function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid, boolean) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_article_attested_count(text) from %I', v_role);
      execute format('revoke all on function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid, boolean) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nexra_article_approve_version(text, uuid, smallint, uuid, text, jsonb, text, uuid, boolean) to service_role;
  end if;
end
$$;
