-- OC1 (docs/roadmap/OC1-one-click-article.md, owner decision 15 Oct 2026): an opportunity may record up to ten outside
-- sources a UTC day, not five, so Stage A can read every organic result of Google's top ten (the provider keeps
-- SERP_DEPTH = 10), less the project's own site and repeated domains.
--
-- `nexra_evidence_source_record` is replaced with the same signature. Its body is 20261025120000's word for word except
-- the daily count (`>= 10`) and its comment line (tested). Everything else holds: the opportunity's advisory lock, the
-- project, opportunity and organic-result checks, the text hash and length computed here, the guards. No table, column,
-- row, trigger, grant or owner changes: `create or replace` keeps the function's owner and privileges.

create or replace function public.nexra_evidence_source_record(
  p_project_id text,
  p_opportunity_id uuid,
  p_serp_result_id uuid,
  p_requested_url text,
  p_final_url text,
  p_fetch_state text,
  p_http_status integer,
  p_robots text,
  p_title text,
  p_page_text text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.nexra_evidence_sources;
begin
  if p_project_id is null or p_opportunity_id is null or p_requested_url is null or p_fetch_state is null or p_robots is null or p_operator is null then
    raise exception 'nexra_evidence_source_record: project, opportunity, URL, fetch state, robots verdict and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;
  if not exists (select 1 from public.nexra_opportunities where id = p_opportunity_id and project_id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'opportunity-not-found');
  end if;
  if p_serp_result_id is not null and not exists (
    select 1 from public.nexra_serp_results r
     where r.id = p_serp_result_id and r.opportunity_id = p_opportunity_id and r.project_id = p_project_id and r.result_type = 'organic') then
    return pg_catalog.jsonb_build_object('outcome', 'serp-result-not-found');
  end if;

  -- At most ten sources a UTC day per opportunity, counted under the opportunity's lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nexra-evidence-sources'), pg_catalog.hashtext(p_opportunity_id::text));
  if (select count(*) from public.nexra_evidence_sources
       where opportunity_id = p_opportunity_id
         and (fetched_at at time zone 'UTC')::date = (pg_catalog.clock_timestamp() at time zone 'UTC')::date) >= 10 then
    return pg_catalog.jsonb_build_object('outcome', 'source-limit');
  end if;

  perform pg_catalog.set_config('nexra.evidence_write', 'on', true);
  insert into public.nexra_evidence_sources (project_id, opportunity_id, serp_result_id, requested_url, final_url, fetch_state, http_status, robots,
    title, page_text, text_sha256, text_chars, fetched_by)
  values (p_project_id, p_opportunity_id, p_serp_result_id, p_requested_url, p_final_url, p_fetch_state, p_http_status, p_robots,
    p_title, p_page_text,
    case when p_page_text is null then null else pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_page_text, 'UTF8')), 'hex') end,
    case when p_page_text is null then null else char_length(p_page_text) end,
    p_operator)
  returning * into v_row;
  perform pg_catalog.set_config('nexra.evidence_write', '', true);

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'source', pg_catalog.to_jsonb(v_row) - 'page_text');
end;
$$;

comment on function public.nexra_evidence_source_record(text, uuid, uuid, text, text, text, integer, text, text, text, uuid) is
  'M4: records one fetched outside page for an accepted opportunity (the text''s SHA-256 and length computed here): recorded, project-not-found, opportunity-not-found, serp-result-not-found or source-limit (10 a UTC day per opportunity; OC1). A malformed row raises check_violation.';
