-- OC1 (docs/roadmap/OC1-one-click-article.md, owner decision 15 Oct 2026, option A): an article planned by an
-- opportunity brief may be created, and saved, with no source draft. Its provenance is the brief run (the article's
-- source_plan_run_id) and the Writer's part runs; the legacy section-draft path never wrote one, so the one-click
-- pipeline can create the article itself without naming an unrelated draft. Every other article is unchanged: at least
-- one source draft, as before.
--
-- Three functions are replaced with the same signatures (`create or replace` keeps owner and privileges):
--   * `nexra_article_check_sources` — 20260923120000's body word for word except the count, now 0 to 20 (an empty list
--     is checked by the callers below);
--   * `nexra_article_create` — 20261028120000's body word for word plus one check after the sources check: an empty
--     list is refused (`source-invalid`, reason `count`, as before) unless the plan run is an `opportunity-brief`;
--   * `nexra_article_save_version` — 20260923120000's body word for word plus the same check, on the article's own plan
--     run.
-- No table, column, row, trigger or grant changes (tested).

create or replace function public.nexra_article_check_sources(p_project_id text, p_sources jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_index integer := 0;
  v_draft public.nexra_content_drafts;
  v_version public.nexra_content_draft_versions;
  v_draft_id uuid;
  v_version_id uuid;
  v_number integer;
  v_hash text;
  v_seen_rows uuid[] := array[]::uuid[];
  v_seen_numbers text[] := array[]::text[];
begin
  if p_sources is null or jsonb_typeof(p_sources) <> 'array'
    or jsonb_array_length(p_sources) not between 0 and 20
  then
    return jsonb_build_object('outcome', 'source-invalid', 'index', null, 'reason', 'count');
  end if;

  for v_entry in select value from jsonb_array_elements(p_sources) loop
    if jsonb_typeof(v_entry) <> 'object'
      or (select count(*) from jsonb_object_keys(v_entry)) <> 4
      or not (v_entry ? 'draft_id' and v_entry ? 'version' and v_entry ? 'version_id' and v_entry ? 'content_sha256')
      or jsonb_typeof(v_entry -> 'draft_id') <> 'string'
      or jsonb_typeof(v_entry -> 'version_id') <> 'string'
      or jsonb_typeof(v_entry -> 'version') <> 'number'
      or jsonb_typeof(v_entry -> 'content_sha256') <> 'string'
      or (v_entry ->> 'draft_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry ->> 'version_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_entry ->> 'version') !~ '^[1-9][0-9]{0,3}$'
      or (v_entry ->> 'content_sha256') !~ '^[0-9a-f]{64}$'
    then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'shape');
    end if;

    v_draft_id := (v_entry ->> 'draft_id')::uuid;
    v_version_id := (v_entry ->> 'version_id')::uuid;
    v_number := (v_entry ->> 'version')::integer;

    if v_version_id = any (v_seen_rows) or (v_draft_id::text || '#' || v_number::text) = any (v_seen_numbers) then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'duplicate');
    end if;
    v_seen_rows := v_seen_rows || v_version_id;
    v_seen_numbers := v_seen_numbers || (v_draft_id::text || '#' || v_number::text);

    -- The project is part of the lookup: another project's draft is not found.
    select * into v_draft from public.nexra_content_drafts where id = v_draft_id and project_id = p_project_id;
    if not found then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'not-found');
    end if;

    select * into v_version from public.nexra_content_draft_versions where draft_id = v_draft_id and version = v_number;
    if not found then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'not-found');
    end if;
    if v_version.id <> v_version_id then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'version-mismatch');
    end if;

    v_hash := encode(
      sha256(
        convert_to('nexra-content-draft-version/1', 'UTF8') || decode('00', 'hex')
        || convert_to(v_version.title, 'UTF8') || decode('00', 'hex')
        || convert_to(v_version.body, 'UTF8')
      ),
      'hex'
    );
    if v_hash <> (v_entry ->> 'content_sha256') then
      return jsonb_build_object('outcome', 'source-invalid', 'index', v_index, 'reason', 'hash-mismatch');
    end if;

    v_index := v_index + 1;
  end loop;

  return null;
end;
$$;

create or replace function public.nexra_article_create(
  p_project_id text,
  p_source_plan_run_id uuid,
  p_canonical_content text,
  p_content_sha256 text,
  p_sources jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_refusal text;
  v_source_refusal jsonb;
  v_sources jsonb;
begin
  if p_project_id is null or p_source_plan_run_id is null or p_canonical_content is null
    or p_content_sha256 is null or p_sources is null or p_created_by is null
  then
    raise exception 'nexra_article_create: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    return jsonb_build_object('outcome', 'project-not-found');
  end if;

  if not exists (
    select 1 from public.agent_runs
     where id = p_source_plan_run_id
       and project_id = p_project_id
       and agent_id = 'content-strategist'
       and task_type in ('content-plan-review', 'opportunity-brief')
       and status = 'completed'
  ) then
    return jsonb_build_object('outcome', 'plan-run-invalid');
  end if;

  select * into v_article from public.nexra_articles where source_plan_run_id = p_source_plan_run_id;
  if found then
    return jsonb_build_object('outcome', 'exists', 'article', to_jsonb(v_article));
  end if;

  v_refusal := public.nexra_article_check_content(p_canonical_content, p_content_sha256);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;

  v_source_refusal := public.nexra_article_check_sources(p_project_id, p_sources);
  if v_source_refusal is not null then
    return v_source_refusal;
  end if;

  -- OC1: only an article planned by an opportunity brief may have no source draft (its provenance is the brief run and
  -- the Writer's part runs); every other article still names at least one.
  if jsonb_array_length(p_sources) = 0 and not exists (
    select 1 from public.agent_runs where id = p_source_plan_run_id and task_type = 'opportunity-brief'
  ) then
    return jsonb_build_object('outcome', 'source-invalid', 'index', null, 'reason', 'count');
  end if;

  begin
    insert into public.nexra_articles (project_id, source_plan_run_id, status, current_version, created_by)
    values (p_project_id, p_source_plan_run_id, 'drafting', 1, p_created_by)
    returning * into v_article;
  exception when unique_violation then
    -- A concurrent create for the same plan got there first.
    select * into v_article from public.nexra_articles where source_plan_run_id = p_source_plan_run_id;
    return jsonb_build_object('outcome', 'exists', 'article', to_jsonb(v_article));
  end;

  insert into public.nexra_article_versions (article_id, version, origin, canonical_content, content_sha256, created_by)
  values (v_article.id, 1, 'operator', p_canonical_content, p_content_sha256, p_created_by)
  returning * into v_version;

  v_sources := public.nexra_article_insert_sources(v_version.id, p_sources);

  return jsonb_build_object(
    'outcome', 'created',
    'article', to_jsonb(v_article),
    'version', to_jsonb(v_version),
    'sources', v_sources
  );
end;
$$;

create or replace function public.nexra_article_save_version(
  p_project_id text,
  p_article_id uuid,
  p_expected_version smallint,
  p_canonical_content text,
  p_content_sha256 text,
  p_sources jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.nexra_articles;
  v_version public.nexra_article_versions;
  v_refusal text;
  v_source_refusal jsonb;
  v_sources jsonb;
  v_next smallint;
begin
  if p_project_id is null or p_article_id is null or p_expected_version is null or p_canonical_content is null
    or p_content_sha256 is null or p_sources is null or p_created_by is null
  then
    raise exception 'nexra_article_save_version: every argument is required'
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

  if v_article.current_version <> p_expected_version then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_article.current_version);
  end if;

  v_refusal := public.nexra_article_check_content(p_canonical_content, p_content_sha256);
  if v_refusal is not null then
    return jsonb_build_object('outcome', v_refusal);
  end if;

  v_source_refusal := public.nexra_article_check_sources(p_project_id, p_sources);
  if v_source_refusal is not null then
    return v_source_refusal;
  end if;

  -- OC1: a version may name no source draft only when its article was planned by an opportunity brief.
  if jsonb_array_length(p_sources) = 0 and not exists (
    select 1 from public.agent_runs where id = v_article.source_plan_run_id and task_type = 'opportunity-brief'
  ) then
    return jsonb_build_object('outcome', 'source-invalid', 'index', null, 'reason', 'count');
  end if;

  v_next := v_article.current_version + 1;

  insert into public.nexra_article_versions (article_id, version, origin, canonical_content, content_sha256, created_by)
  values (p_article_id, v_next, 'operator', p_canonical_content, p_content_sha256, p_created_by)
  returning * into v_version;

  v_sources := public.nexra_article_insert_sources(v_version.id, p_sources);

  update public.nexra_articles
     set current_version = v_next,
         status = 'drafting'
   where id = p_article_id
  returning * into v_article;

  return jsonb_build_object(
    'outcome', 'created',
    'article', to_jsonb(v_article),
    'version', to_jsonb(v_version),
    'sources', v_sources
  );
end;
$$;

comment on function public.nexra_article_create(text, uuid, text, text, jsonb, uuid) is
  'Creates an article, its version 1 and that version''s source rows in one transaction, after re-checking the project, the completed plan run (a Content Strategist content-plan-review or opportunity-brief run of the same project), the canonical text and its hash, and every source (at least one, unless the plan run is an opportunity brief; OC1). One article per plan run. Approves and publishes nothing.';

comment on function public.nexra_article_save_version(text, uuid, smallint, text, text, jsonb, uuid) is
  'Saves an operator edit as the article''s next immutable version with its source rows (at least one, unless the article''s plan run is an opportunity brief; OC1), advances current_version and returns the status to drafting, in one transaction under the parent''s lock; refuses a stale expected version or an archived article. Never carries an approval forward.';
