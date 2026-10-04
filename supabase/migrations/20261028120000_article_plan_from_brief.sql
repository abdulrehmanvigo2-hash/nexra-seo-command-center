-- M6 follow-up (part 2b): an article may be assembled for a completed Content Strategist `opportunity-brief` run of the
-- same project, as well as for a completed `content-plan-review` run — the brief the Writer's parts were drafted from
-- is the article's plan, so no separate content plan run is needed.
--
-- `nexra_article_create` is replaced with the same signature. Its body is 20260923120000's word for word except the
-- plan-run check, whose task type is now one of the two (tested). Everything else holds: the run must be the same
-- project's and completed, and one article per plan run (`exists` answers a second create). No table, column, row,
-- trigger, grant or owner changes: `create or replace` keeps the function's owner and privileges.

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

comment on function public.nexra_article_create(text, uuid, text, text, jsonb, uuid) is
  'Creates an article, its version 1 and that version''s source rows in one transaction, after re-checking the project, the completed plan run (a Content Strategist content-plan-review or opportunity-brief run of the same project), the canonical text and its hash, and every source. One article per plan run. Approves and publishes nothing.';
