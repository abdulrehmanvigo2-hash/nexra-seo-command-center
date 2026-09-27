-- Curated keywords: the operator's own list of queries a project tracks, with
-- a status, an optional group label, an optional target page and an optional
-- note, each change recorded as an immutable event (Phase 3, checkpoint 3.5).
--
-- WHY. Keyword Intelligence reads only what Google reported in this
-- product's stored Search Console rows (checkpoint 3.4). An operator could
-- not say which queries a project cares about: the modelled screen's lists
-- were session state over fixture keywords. This table is the smallest
-- persisted keyword entity: one row per project and exact query text, naming
-- what the operator decided about it and nothing else.
--
-- WHAT IT NEVER HOLDS. No search volume, keyword difficulty, cost per click,
-- position, rank, traffic, SERP feature, intent score or any other figure.
-- Figures stay in the stored Search Console rows; a curated keyword is linked
-- to them on read by exact query text, the same rule tasks use
-- (20261003120000), and a keyword with no match reads "not observed in
-- stored rows", never zero. A repository test pins this column list.
--
-- IDENTITY. `query` is the exact text, the join key the task source and the
-- observed rows already carry: unique per project, exact match, never
-- trimmed, case-folded or otherwise normalised (decision Q5). A query need
-- not have been observed to be curated (Q5): an operator may track a query
-- before Google reports it.
--
-- TARGET PAGE. An absolute http(s) URL on the project's own host: the host
-- of the project's stored domain, or that host with or without a leading
-- `www.` (Q5). Checked by the write functions against `projects.domain`,
-- which is canonical (lower case, no scheme, no trailing slash).
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000: the unprefixed crawl names belong to a separate live
-- subsystem this repository never touches. Nothing here names it.
--
-- EVENTS. `nexra_keyword_events` is append-only, ordered by an identity
-- `seq`: `created` (written by an AFTER INSERT trigger), `status-changed`,
-- `group-changed`, `target-changed` and `note-changed`, each carrying only
-- its own before and after values. Update, delete and truncate are refused
-- for every caller.
--
-- HOW IT IS WRITTEN. Five `security definer` functions (`search_path` pinned
-- empty), each taking the project beside the keyword so a keyword is never
-- reached through another project: `nexra_keyword_add`,
-- `nexra_keyword_set_status`, `nexra_keyword_set_group`,
-- `nexra_keyword_set_target` and `nexra_keyword_set_note`. The setters lock
-- the row, change only their own column (and updated_at) under a
-- transaction-local flag the update guard requires, and append one event.
-- There is no delete path: archiving replaces it. service_role is granted
-- SELECT on both tables and EXECUTE on the five functions, nothing else;
-- `anon` and `authenticated` get nothing. Row level security is enabled with
-- no policies. Additive: no existing table, column, function or grant
-- changes.

create table public.nexra_keywords (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_keywords_project_fkey references public.projects (id) on delete restrict,

  -- The exact query text; see IDENTITY above.
  query text not null
    constraint nexra_keywords_query_length check (pg_catalog.char_length(query) between 1 and 2048),
  constraint nexra_keywords_query_no_control check (query !~ '[[:cntrl:]]'),
  constraint nexra_keywords_query_not_blank check (pg_catalog.btrim(query) <> ''),

  -- The operator's own label for grouping, never a derived topic.
  group_label text
    constraint nexra_keywords_group_label_length check (group_label is null or pg_catalog.char_length(group_label) between 1 and 80),
  constraint nexra_keywords_group_label_clean check (group_label is null or (group_label = pg_catalog.btrim(group_label) and group_label !~ '[[:cntrl:]]')),

  note text
    constraint nexra_keywords_note_length check (note is null or pg_catalog.char_length(note) between 1 and 500),
  constraint nexra_keywords_note_clean check (note is null or (note = pg_catalog.btrim(note) and note !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')),

  -- An absolute http(s) URL; the functions check it is on the project's host.
  target_page text
    constraint nexra_keywords_target_page_shape check (
      target_page is null
      or (pg_catalog.char_length(target_page) <= 2048 and target_page ~ '^https?://[^/?#[:space:]@]+(/[^[:space:]]*)?$')
    ),

  status text not null default 'tracked'
    constraint nexra_keywords_status_valid check (status in ('tracked', 'paused', 'archived')),

  -- The operator who added it (Supabase Auth user id, as on tasks).
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nexra_keywords_updated_not_before_created check (updated_at >= created_at),

  -- Exact text, per project (Q5).
  constraint nexra_keywords_project_query_key unique (project_id, query)
);

comment on table public.nexra_keywords is
  'One operator-curated query per project and exact query text: status (tracked, paused, archived), an optional group label, target page on the project host, and note. Holds no figure of any kind; observed figures are joined on read from the stored Search Console rows by exact query text.';

create index nexra_keywords_project_created_idx
  on public.nexra_keywords (project_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- The event table.

create table public.nexra_keyword_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null generated always as identity,

  keyword_id uuid not null
    constraint nexra_keyword_events_keyword_fkey references public.nexra_keywords (id) on delete restrict,
  project_id text not null
    constraint nexra_keyword_events_project_fkey references public.projects (id) on delete restrict,

  event_type text not null
    constraint nexra_keyword_events_type_valid check (event_type in ('created', 'status-changed', 'group-changed', 'target-changed', 'note-changed')),

  from_status text
    constraint nexra_keyword_events_from_status_valid check (from_status is null or from_status in ('tracked', 'paused', 'archived')),
  to_status text
    constraint nexra_keyword_events_to_status_valid check (to_status is null or to_status in ('tracked', 'paused', 'archived')),

  -- The group label, target page or note before and after; null means none.
  from_value text
    constraint nexra_keyword_events_from_value_length check (from_value is null or pg_catalog.char_length(from_value) <= 2048),
  to_value text
    constraint nexra_keyword_events_to_value_length check (to_value is null or pg_catalog.char_length(to_value) <= 2048),

  actor uuid not null,
  created_at timestamptz not null default now(),

  -- Each type carries exactly the fields it is about.
  constraint nexra_keyword_events_shape check (
    case event_type
      when 'created' then from_status is null and to_status is null and from_value is null and to_value is null
      when 'status-changed' then from_status is not null and to_status is not null and from_status <> to_status and from_value is null and to_value is null
      else from_status is null and to_status is null and from_value is distinct from to_value
    end
  )
);

comment on table public.nexra_keyword_events is
  'Append-only history of one curated keyword: created, status-changed, group-changed, target-changed, note-changed. Written only by the keyword functions; never updated, deleted or truncated.';

create unique index nexra_keyword_events_seq_idx
  on public.nexra_keyword_events (seq);
create index nexra_keyword_events_keyword_seq_idx
  on public.nexra_keyword_events (keyword_id, seq);

-- ---------------------------------------------------------------------------
-- Guards.

create function public.nexra_keyword_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_keyword_events: keyword history is never updated, deleted or truncated'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_keyword_events_guard_update
  before update on public.nexra_keyword_events
  for each row execute function public.nexra_keyword_events_guard();
create trigger nexra_keyword_events_guard_delete
  before delete on public.nexra_keyword_events
  for each row execute function public.nexra_keyword_events_guard();
create trigger nexra_keyword_events_guard_truncate
  before truncate on public.nexra_keyword_events
  for each statement execute function public.nexra_keyword_events_guard();

-- Only group_label, note, target_page, status and updated_at may change, only
-- while the transaction-local flag names this row — which only the setters
-- below set. Identity (id, project, query, creator, created_at) never changes.
create function public.nexra_keywords_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.project_id is distinct from old.project_id
    or new.query is distinct from old.query
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'nexra_keywords: a curated keyword''s identity never changes'
      using errcode = 'check_violation';
  end if;
  if coalesce(pg_catalog.current_setting('nexra.keyword_write', true), '') <> old.id::text then
    raise exception 'nexra_keywords: a curated keyword changes only through the nexra_keyword_set_* functions'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_keywords_guard_update
  before update on public.nexra_keywords
  for each row execute function public.nexra_keywords_guard_update();

create function public.nexra_keywords_guard_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_keywords: a curated keyword is never deleted or truncated; archive it instead'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_keywords_guard_delete
  before delete on public.nexra_keywords
  for each row execute function public.nexra_keywords_guard_remove();
create trigger nexra_keywords_guard_truncate
  before truncate on public.nexra_keywords
  for each statement execute function public.nexra_keywords_guard_remove();

-- Every curated keyword has a `created` event.
create function public.nexra_keywords_record_created()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.nexra_keyword_events (keyword_id, project_id, event_type, actor, created_at)
  values (new.id, new.project_id, 'created', new.created_by, new.created_at);
  return new;
end;
$$;

create trigger nexra_keywords_record_created
  after insert on public.nexra_keywords
  for each row execute function public.nexra_keywords_record_created();

-- ---------------------------------------------------------------------------
-- Shared checks, as immutable functions the write functions call.

-- Whether a target page is on the project's host: the host of the stored
-- domain (up to its first `/`), or that host with or without `www.`.
create function public.nexra_keyword_target_on_host(p_target text, p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_target is null or p_domain is null then false
    when p_target !~ '^https?://[^/?#[:space:]@]+(/[^[:space:]]*)?$' then false
    else (
      with h as (
        select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.substring(p_target, '^https?://([^/?#]+)'), ':[0-9]+$', '')) as target_host,
               pg_catalog.split_part(p_domain, '/', 1) as project_host
      )
      select target_host in (
               project_host,
               'www.' || project_host,
               case when project_host like 'www.%' then pg_catalog.substr(project_host, 5) else project_host end
             )
        from h
    )
  end
$$;

comment on function public.nexra_keyword_target_on_host(text, text) is
  'Whether a target page URL is an absolute http(s) URL on the project''s host: the host of the stored domain, or that host with or without a leading www.';

-- A cleaned optional text: null stays null; otherwise trimmed, and an empty result is null.
create function public.nexra_keyword_clean_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or pg_catalog.btrim(p_value) = '' then null else pg_catalog.btrim(p_value) end
$$;

-- Validates the optional fields, raising invalid_parameter_value on a shape error.
create function public.nexra_keyword_check_fields(p_group_label text, p_note text, p_target_page text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_group_label is not null and (pg_catalog.char_length(p_group_label) > 80 or p_group_label ~ '[[:cntrl:]]') then
    raise exception 'nexra_keyword: a group label is 1 to 80 characters with no control characters'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_note is not null and (pg_catalog.char_length(p_note) > 500 or p_note ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') then
    raise exception 'nexra_keyword: a note is 1 to 500 characters with no control characters but line breaks'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_target_page is not null and (pg_catalog.char_length(p_target_page) > 2048 or p_target_page !~ '^https?://[^/?#[:space:]@]+(/[^[:space:]]*)?$') then
    raise exception 'nexra_keyword: a target page is an absolute http(s) URL of at most 2048 characters'
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Adding a curated keyword: the one insert.
--
-- The query is the exact text (1 to 2048 characters, no control characters,
-- not blank) and is stored as given. The group label and note are trimmed,
-- and an empty value is none. Shape errors raise invalid_parameter_value and
-- write nothing. Then: a project that is not stored answers
-- `project-not-found`; a target page off the project's host
-- `target-off-host`; a query already curated for the project `exists`, with
-- that row, unchanged; otherwise `added` with the new row. Concurrent adds of
-- the same query are resolved by the unique key: one is added, the other
-- answers `exists`.

create function public.nexra_keyword_add(
  p_project_id text,
  p_query text,
  p_group_label text,
  p_note text,
  p_target_page text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group text := public.nexra_keyword_clean_text(p_group_label);
  v_note text := public.nexra_keyword_clean_text(p_note);
  v_target text := public.nexra_keyword_clean_text(p_target_page);
  v_domain text;
  v_row public.nexra_keywords;
begin
  if p_project_id is null or p_query is null or p_operator is null then
    raise exception 'nexra_keyword_add: project, query and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.char_length(p_query) < 1 or pg_catalog.char_length(p_query) > 2048 or p_query ~ '[[:cntrl:]]' or pg_catalog.btrim(p_query) = '' then
    raise exception 'nexra_keyword_add: a query is 1 to 2048 characters, not blank, with no control characters'
      using errcode = 'invalid_parameter_value';
  end if;
  perform public.nexra_keyword_check_fields(v_group, v_note, v_target);

  select domain into v_domain from public.projects where id = p_project_id;
  if v_domain is null then
    return pg_catalog.jsonb_build_object('outcome', 'project-not-found');
  end if;
  if v_target is not null and not public.nexra_keyword_target_on_host(v_target, v_domain) then
    return pg_catalog.jsonb_build_object('outcome', 'target-off-host');
  end if;

  insert into public.nexra_keywords (project_id, query, group_label, note, target_page, status, created_by)
  values (p_project_id, p_query, v_group, v_note, v_target, 'tracked', p_operator)
  on conflict (project_id, query) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.nexra_keywords where project_id = p_project_id and query = p_query;
    return pg_catalog.jsonb_build_object('outcome', 'exists', 'keyword', pg_catalog.to_jsonb(v_row));
  end if;
  return pg_catalog.jsonb_build_object('outcome', 'added', 'keyword', pg_catalog.to_jsonb(v_row));
end;
$$;

comment on function public.nexra_keyword_add(text, text, text, text, text, uuid) is
  'Adds one operator-curated query to one project, in tracked: added, exists, project-not-found or target-off-host. The query is stored exactly as given; it need not have been observed.';

-- ---------------------------------------------------------------------------
-- Status: tracked, paused or archived, in any direction; archiving is how a
-- keyword leaves the list, and a paused or archived keyword may be tracked
-- again. Answers `status-changed`, `keyword-not-found` (missing or another
-- project's, never which) or `same-status`.

create function public.nexra_keyword_set_status(
  p_project_id text,
  p_keyword_id uuid,
  p_status text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.nexra_keywords;
  v_from text;
  v_event public.nexra_keyword_events;
begin
  if p_project_id is null or p_keyword_id is null or p_status is null or p_operator is null then
    raise exception 'nexra_keyword_set_status: project, keyword, status and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_status not in ('tracked', 'paused', 'archived') then
    raise exception 'nexra_keyword_set_status: status must be tracked, paused or archived'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_row from public.nexra_keywords where id = p_keyword_id and project_id = p_project_id for update;
  if v_row.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'keyword-not-found');
  end if;
  if v_row.status = p_status then
    return pg_catalog.jsonb_build_object('outcome', 'same-status', 'keyword', pg_catalog.to_jsonb(v_row));
  end if;

  v_from := v_row.status;
  perform pg_catalog.set_config('nexra.keyword_write', v_row.id::text, true);
  update public.nexra_keywords set status = p_status, updated_at = pg_catalog.now() where id = v_row.id returning * into v_row;
  perform pg_catalog.set_config('nexra.keyword_write', '', true);

  insert into public.nexra_keyword_events (keyword_id, project_id, event_type, from_status, to_status, actor)
  values (v_row.id, v_row.project_id, 'status-changed', v_from, p_status, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'status-changed', 'keyword', pg_catalog.to_jsonb(v_row), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_keyword_set_status(text, uuid, text, uuid) is
  'Sets one curated keyword''s status (tracked, paused, archived) and appends a status-changed event: status-changed, keyword-not-found or same-status.';

-- ---------------------------------------------------------------------------
-- Group label: 1 to 80 characters, or none (null or blank clears it).
-- Answers `group-changed`, `keyword-not-found` or `same-group`.

create function public.nexra_keyword_set_group(
  p_project_id text,
  p_keyword_id uuid,
  p_group_label text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text := public.nexra_keyword_clean_text(p_group_label);
  v_row public.nexra_keywords;
  v_from text;
  v_event public.nexra_keyword_events;
begin
  if p_project_id is null or p_keyword_id is null or p_operator is null then
    raise exception 'nexra_keyword_set_group: project, keyword and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  perform public.nexra_keyword_check_fields(v_value, null, null);

  select * into v_row from public.nexra_keywords where id = p_keyword_id and project_id = p_project_id for update;
  if v_row.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'keyword-not-found');
  end if;
  if v_row.group_label is not distinct from v_value then
    return pg_catalog.jsonb_build_object('outcome', 'same-group', 'keyword', pg_catalog.to_jsonb(v_row));
  end if;

  v_from := v_row.group_label;
  perform pg_catalog.set_config('nexra.keyword_write', v_row.id::text, true);
  update public.nexra_keywords set group_label = v_value, updated_at = pg_catalog.now() where id = v_row.id returning * into v_row;
  perform pg_catalog.set_config('nexra.keyword_write', '', true);

  insert into public.nexra_keyword_events (keyword_id, project_id, event_type, from_value, to_value, actor)
  values (v_row.id, v_row.project_id, 'group-changed', v_from, v_value, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'group-changed', 'keyword', pg_catalog.to_jsonb(v_row), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_keyword_set_group(text, uuid, text, uuid) is
  'Sets or clears one curated keyword''s group label and appends a group-changed event: group-changed, keyword-not-found or same-group.';

-- ---------------------------------------------------------------------------
-- Target page: an absolute http(s) URL on the project's host, or none.
-- Answers `target-changed`, `keyword-not-found`, `same-target` or
-- `target-off-host`.

create function public.nexra_keyword_set_target(
  p_project_id text,
  p_keyword_id uuid,
  p_target_page text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text := public.nexra_keyword_clean_text(p_target_page);
  v_row public.nexra_keywords;
  v_domain text;
  v_from text;
  v_event public.nexra_keyword_events;
begin
  if p_project_id is null or p_keyword_id is null or p_operator is null then
    raise exception 'nexra_keyword_set_target: project, keyword and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  perform public.nexra_keyword_check_fields(null, null, v_value);

  select * into v_row from public.nexra_keywords where id = p_keyword_id and project_id = p_project_id for update;
  if v_row.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'keyword-not-found');
  end if;
  if v_row.target_page is not distinct from v_value then
    return pg_catalog.jsonb_build_object('outcome', 'same-target', 'keyword', pg_catalog.to_jsonb(v_row));
  end if;
  if v_value is not null then
    select domain into v_domain from public.projects where id = p_project_id;
    if not public.nexra_keyword_target_on_host(v_value, v_domain) then
      return pg_catalog.jsonb_build_object('outcome', 'target-off-host', 'keyword', pg_catalog.to_jsonb(v_row));
    end if;
  end if;

  v_from := v_row.target_page;
  perform pg_catalog.set_config('nexra.keyword_write', v_row.id::text, true);
  update public.nexra_keywords set target_page = v_value, updated_at = pg_catalog.now() where id = v_row.id returning * into v_row;
  perform pg_catalog.set_config('nexra.keyword_write', '', true);

  insert into public.nexra_keyword_events (keyword_id, project_id, event_type, from_value, to_value, actor)
  values (v_row.id, v_row.project_id, 'target-changed', v_from, v_value, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'target-changed', 'keyword', pg_catalog.to_jsonb(v_row), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_keyword_set_target(text, uuid, text, uuid) is
  'Sets or clears one curated keyword''s target page (on the project''s host) and appends a target-changed event: target-changed, keyword-not-found, same-target or target-off-host.';

-- ---------------------------------------------------------------------------
-- Note: 1 to 500 characters, or none. Answers `note-changed`,
-- `keyword-not-found` or `same-note`.

create function public.nexra_keyword_set_note(
  p_project_id text,
  p_keyword_id uuid,
  p_note text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text := public.nexra_keyword_clean_text(p_note);
  v_row public.nexra_keywords;
  v_from text;
  v_event public.nexra_keyword_events;
begin
  if p_project_id is null or p_keyword_id is null or p_operator is null then
    raise exception 'nexra_keyword_set_note: project, keyword and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  perform public.nexra_keyword_check_fields(null, v_value, null);

  select * into v_row from public.nexra_keywords where id = p_keyword_id and project_id = p_project_id for update;
  if v_row.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'keyword-not-found');
  end if;
  if v_row.note is not distinct from v_value then
    return pg_catalog.jsonb_build_object('outcome', 'same-note', 'keyword', pg_catalog.to_jsonb(v_row));
  end if;

  v_from := v_row.note;
  perform pg_catalog.set_config('nexra.keyword_write', v_row.id::text, true);
  update public.nexra_keywords set note = v_value, updated_at = pg_catalog.now() where id = v_row.id returning * into v_row;
  perform pg_catalog.set_config('nexra.keyword_write', '', true);

  insert into public.nexra_keyword_events (keyword_id, project_id, event_type, from_value, to_value, actor)
  values (v_row.id, v_row.project_id, 'note-changed', v_from, v_value, p_operator)
  returning * into v_event;

  return pg_catalog.jsonb_build_object('outcome', 'note-changed', 'keyword', pg_catalog.to_jsonb(v_row), 'event', pg_catalog.to_jsonb(v_event));
end;
$$;

comment on function public.nexra_keyword_set_note(text, uuid, text, uuid) is
  'Sets or clears one curated keyword''s note and appends a note-changed event: note-changed, keyword-not-found or same-note.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads both tables and executes the five functions.
-- Nothing else, for anyone.

alter table public.nexra_keywords enable row level security;
alter table public.nexra_keyword_events enable row level security;

do $$
declare
  v_role text;
  v_fn text;
  v_writers text[] := array[
    'public.nexra_keyword_add(text, text, text, text, text, uuid)',
    'public.nexra_keyword_set_status(text, uuid, text, uuid)',
    'public.nexra_keyword_set_group(text, uuid, text, uuid)',
    'public.nexra_keyword_set_target(text, uuid, text, uuid)',
    'public.nexra_keyword_set_note(text, uuid, text, uuid)'
  ];
  v_helpers text[] := array[
    'public.nexra_keywords_guard_update()',
    'public.nexra_keywords_guard_remove()',
    'public.nexra_keywords_record_created()',
    'public.nexra_keyword_events_guard()',
    'public.nexra_keyword_target_on_host(text, text)',
    'public.nexra_keyword_clean_text(text)',
    'public.nexra_keyword_check_fields(text, text, text)'
  ];
begin
  foreach v_fn in array v_writers || v_helpers loop
    execute format('revoke all on function %s from public', v_fn);
  end loop;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_keywords from %I', v_role);
      execute format('revoke all on table public.nexra_keyword_events from %I', v_role);
      foreach v_fn in array v_writers || v_helpers loop
        execute format('revoke all on function %s from %I', v_fn, v_role);
      end loop;
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_keywords to service_role;
    grant select on table public.nexra_keyword_events to service_role;
    foreach v_fn in array v_writers loop
      execute format('grant execute on function %s to service_role', v_fn);
    end loop;
  end if;
end
$$;
