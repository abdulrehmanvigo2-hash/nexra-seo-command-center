-- M8 internal links (docs/roadmap/M8-internal-links.md): what a complete own-site crawl needs kept, and the one write
-- that records an accepted link suggestion as a task. Additive: nothing is dropped, renamed, backfilled or rewritten.
--
--   * `nexra_crawl_page_texts` — one row per own-site crawl page the crawler fetched: the page's visible text as a
--     reader sees it (outside script, style, template, noscript, svg and the head; whitespace collapsed), at most
--     20,000 characters, with its length and SHA-256 computed and checked here. Keyed to its page row, so it goes when
--     its crawl is deleted (the crawl housekeeping path, as pages and links do) and never otherwise: no update, no
--     truncate, and service_role holds SELECT and INSERT only. A competitor's text is refused on insert.
--     The application writes these rows after the pages and treats a refusal as "text not kept", so it may be deployed
--     before or after this migration.
--   * `nexra_agent_tasks.source_kind` gains `internal-link`: `source_ref` is `<crawl id> <from url> <to url> <anchor>`.
--     `nexra_agent_task_create` is unchanged and still refuses that kind — only the function below creates such tasks.
--   * `nexra_link_suggestion_task_create(p_project_id, p_crawl_id, p_from_url, p_to_url, p_anchor, p_created_by)` —
--     `security definer`, empty search_path: checks the crawl is the project's own-site crawl and both URLs are pages
--     it fetched, then records one backlog task for On-Page SEO. created, project-not-found, crawl-not-found,
--     page-not-found, same-page or invalid. A task is a record of intent: nothing here edits a page.
--
-- An own-site crawl is one whose host scope is the project's stored domain (the application derives both the same
-- way: the domain lowercased, a hostname only).

-- ---------------------------------------------------------------------------
-- Page texts.

create table public.nexra_crawl_page_texts (
  crawl_id uuid not null,
  url text not null,
  visible_text text not null
    constraint nexra_crawl_page_texts_length check (pg_catalog.char_length(visible_text) <= 20000),
  text_chars integer not null,
  text_sha256 text not null,
  recorded_at timestamptz not null default pg_catalog.now(),
  constraint nexra_crawl_page_texts_pkey primary key (crawl_id, url),
  constraint nexra_crawl_page_texts_page_fkey foreign key (crawl_id, url)
    references public.nexra_crawl_pages (crawl_id, url) on delete cascade,
  constraint nexra_crawl_page_texts_chars check (text_chars = pg_catalog.char_length(visible_text)),
  constraint nexra_crawl_page_texts_sha check (text_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(visible_text, 'UTF8')), 'hex'))
);

comment on table public.nexra_crawl_page_texts is
  'Observed (M8): the visible text of one own-site page a crawl fetched, as a reader sees it, at most 20,000 characters, with its length and SHA-256. Read by the internal-link suggestions; never published and never sent to a model. Immutable; goes with its crawl.';

alter table public.nexra_crawl_page_texts enable row level security;

create function public.nexra_crawl_page_texts_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.nexra_crawls c
      join public.projects p on p.id = c.project_id
     where c.id = new.crawl_id and c.host_scope = p.domain
  ) then
    raise exception 'nexra_crawl_page_texts: only an own-site crawl''s page text is kept'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.nexra_crawl_pages pg
     where pg.crawl_id = new.crawl_id and pg.url = new.url and pg.fetch_state = 'fetched'
  ) then
    raise exception 'nexra_crawl_page_texts: only a fetched page''s text is kept'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function public.nexra_crawl_page_texts_guard_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_crawl_page_texts: a kept page text is never updated or truncated'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_crawl_page_texts_guard_insert
  before insert on public.nexra_crawl_page_texts
  for each row execute function public.nexra_crawl_page_texts_guard_insert();
create trigger nexra_crawl_page_texts_guard_update
  before update on public.nexra_crawl_page_texts
  for each row execute function public.nexra_crawl_page_texts_guard_change();
create trigger nexra_crawl_page_texts_guard_truncate
  before truncate on public.nexra_crawl_page_texts
  for each statement execute function public.nexra_crawl_page_texts_guard_change();

-- ---------------------------------------------------------------------------
-- Tasks recorded from an accepted link suggestion.

alter table public.nexra_agent_tasks drop constraint nexra_agent_tasks_source_kind_valid;
alter table public.nexra_agent_tasks add constraint nexra_agent_tasks_source_kind_valid
  check (source_kind in ('director-run', 'keyword', 'opportunity', 'internal-link'));

comment on table public.nexra_agent_tasks is
  'One operator-approved unit of work for one registry agent on one project, recorded from a completed SEO Director run, an observed Search Console query, an accepted opportunity or an accepted internal-link suggestion (source_kind, source_ref). A record of an intention to act: nothing here dispatches an agent, queues a run or changes a page.';

create function public.nexra_link_suggestion_task_create(
  p_project_id text,
  p_crawl_id uuid,
  p_from_url text,
  p_to_url text,
  p_anchor text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor text;
  v_ref text;
  v_title text;
  v_task public.nexra_agent_tasks;
begin
  if p_project_id is null or p_crawl_id is null or p_from_url is null or p_to_url is null or p_anchor is null or p_created_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'invalid');
  end if;
  v_anchor := pg_catalog.btrim(p_anchor);
  if pg_catalog.char_length(v_anchor) not between 1 and 200 or v_anchor ~ '[[:cntrl:]]' then
    return pg_catalog.jsonb_build_object('outcome', 'invalid');
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;
  if not exists (
    select 1
      from public.nexra_crawls c
      join public.projects p on p.id = c.project_id
     where c.id = p_crawl_id and c.project_id = p_project_id and c.host_scope = p.domain
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'crawl-not-found');
  end if;
  if (select pg_catalog.count(*) from public.nexra_crawl_pages
       where crawl_id = p_crawl_id and url in (p_from_url, p_to_url) and fetch_state = 'fetched')
     < (case when p_from_url = p_to_url then 1 else 2 end) then
    return pg_catalog.jsonb_build_object('outcome', 'page-not-found');
  end if;
  if p_from_url = p_to_url then
    return pg_catalog.jsonb_build_object('outcome', 'same-page');
  end if;

  v_ref := p_crawl_id::text || ' ' || p_from_url || ' ' || p_to_url || ' ' || v_anchor;
  if pg_catalog.char_length(v_ref) > 2048 then
    return pg_catalog.jsonb_build_object('outcome', 'invalid');
  end if;
  v_title := pg_catalog.left('Add an internal link: '
    || coalesce(pg_catalog.substring(p_from_url, '^https?://[^/]+(/.*)$'), p_from_url) || ' → '
    || coalesce(pg_catalog.substring(p_to_url, '^https?://[^/]+(/.*)$'), p_to_url), 200);
  v_title := pg_catalog.btrim(v_title);

  insert into public.nexra_agent_tasks (project_id, title, source_kind, source_ref, owning_agent, status, priority, created_by)
  values (p_project_id, v_title, 'internal-link', v_ref, 'on-page-seo', 'backlog', 'medium', p_created_by)
  returning * into v_task;

  return pg_catalog.jsonb_build_object('outcome', 'created', 'task', pg_catalog.to_jsonb(v_task));
end;
$$;

comment on function public.nexra_link_suggestion_task_create(text, uuid, text, text, text, uuid) is
  'Records one accepted internal-link suggestion (M8) as a backlog task for On-Page SEO: the crawl must be the project''s own-site crawl and both URLs pages it fetched. created, project-not-found, crawl-not-found, page-not-found, same-page or invalid. Edits no page.';

-- ---------------------------------------------------------------------------
-- Privileges: nothing for public, anon or authenticated; service_role reads and inserts page texts and executes the
-- one function.

revoke all on table public.nexra_crawl_page_texts from public;
revoke all on function public.nexra_link_suggestion_task_create(text, uuid, text, text, text, uuid) from public;
revoke all on function public.nexra_crawl_page_texts_guard_insert() from public;
revoke all on function public.nexra_crawl_page_texts_guard_change() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_crawl_page_texts from %I', v_role);
      execute format('revoke all on function public.nexra_link_suggestion_task_create(text, uuid, text, text, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_page_texts_guard_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_page_texts_guard_change() from %I', v_role);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert on table public.nexra_crawl_page_texts to service_role;
    grant execute on function public.nexra_link_suggestion_task_create(text, uuid, text, text, text, uuid) to service_role;
  end if;
end
$$;
