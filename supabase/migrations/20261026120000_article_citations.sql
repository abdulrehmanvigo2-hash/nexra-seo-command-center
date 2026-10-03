-- M4: articles that cite outside pages — canonical format `nexra-article-content/3` (docs/roadmap/M4-research-evidence.md
-- §6, PR 9 of 9).
--
-- WHAT. An article version may carry a `citations` list — the outside pages it cites, each `{url, title, publisher,
-- retrievedAt}` — written as the canonical text's last member, and only then is the text `nexra-article-content/3`. A
-- text with no citations is format 1 or 2, byte for byte as before, so no stored version, unit, approval, proposal or
-- preview changes. Three objects are replaced so the database accepts format 3:
--   * `nexra_article_attested_count(text)` (internal, immutable): as 20261010120000's, and for format 3 the attestation
--     list's length (0 when the member is absent) — but only when `citations` is a list of 1 to 20; formats 1 and 2 may
--     not carry `citations` (null, refused, as a format 1 text carrying attestations always was).
--   * the versions table's `nexra_article_versions_canonical_format` check: format 1, 2 or 3.
--   * `nexra_article_check_content(text, text)`: format 1, 2 or 3; every other rule as before.
--
-- NOTHING ELSE CHANGES: no row, no grant, no other function. The proposal preview's format stays bound to the
-- attestations (`article-proposal-text/1` or `/2`) — a format 3 text's preview lists its citations in its own section,
-- and its hash covers them through the content hash. The check units never include citations: a citation is not a
-- statement. The application validates each citation (an https URL, its title, publisher and retrieval date); the
-- database checks the format and the list's shape.

-- ---------------------------------------------------------------------------
-- The attestations a stored text carries: 0 for format 1, the list's length for format 2, the list's length or 0 for
-- format 3 (which must cite 1 to 20 pages); null for anything else.

create or replace function public.nexra_article_attested_count(p_canonical_content text)
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
    return case when v_content ? 'attestations' or v_content ? 'citations' then null else 0 end;
  end if;
  if starts_with(p_canonical_content, '{"format":"nexra-article-content/2",') then
    if v_content ? 'citations' then
      return null;
    end if;
    if jsonb_typeof(v_content -> 'attestations') = 'array' and jsonb_array_length(v_content -> 'attestations') between 1 and 50 then
      return jsonb_array_length(v_content -> 'attestations');
    end if;
    return null;
  end if;
  if starts_with(p_canonical_content, '{"format":"nexra-article-content/3",') then
    if coalesce(jsonb_typeof(v_content -> 'citations'), '') <> 'array' or jsonb_array_length(v_content -> 'citations') not between 1 and 20 then
      return null;
    end if;
    if not (v_content ? 'attestations') then
      return 0;
    end if;
    if jsonb_typeof(v_content -> 'attestations') = 'array' and jsonb_array_length(v_content -> 'attestations') between 1 and 50 then
      return jsonb_array_length(v_content -> 'attestations');
    end if;
    return null;
  end if;
  return null;
end;
$$;

comment on function public.nexra_article_attested_count(text) is
  'The operator-attested paragraphs a stored canonical text carries: 0 for nexra-article-content/1, the list length for /2, the list length or 0 for /3 (which cites 1 to 20 pages), null for anything else. Internal.';

-- ---------------------------------------------------------------------------
-- Versions: format 1, 2 or 3.

alter table public.nexra_article_versions drop constraint nexra_article_versions_canonical_format;
alter table public.nexra_article_versions
  add constraint nexra_article_versions_canonical_format
    check (starts_with(canonical_content, '{"format":"nexra-article-content/1",')
        or starts_with(canonical_content, '{"format":"nexra-article-content/2",')
        or starts_with(canonical_content, '{"format":"nexra-article-content/3",'));

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
         or starts_with(p_canonical_content, '{"format":"nexra-article-content/2",')
         or starts_with(p_canonical_content, '{"format":"nexra-article-content/3",'))
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
