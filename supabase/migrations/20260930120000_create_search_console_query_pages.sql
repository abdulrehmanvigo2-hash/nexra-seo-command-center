-- Search Console query × page observations: for one project's property over
-- one 30-day window, which page Google showed for which query, with the four
-- metrics it reported for that pair (M1, Phase 4, checkpoint P4c).
--
-- WHY. A snapshot (20260927120000) keeps queries and pages as two separate
-- top-25 lists, so nothing in the product can say that one query surfaced
-- two of the site's pages. This table keeps Google's query × page rows for
-- the same window, so that overlap can be read from the product's own
-- records and offered for review — as an observation, never as a verdict.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000 and 20260922120000.
--
-- WHAT A ROW IS. One (query, page) pair Google reported for the project's
-- property over the exact window: clicks, impressions, click-through rate and
-- average position, nothing else. No search volume, no rank, no SERP feature,
-- no competitor, no credential. Search Console omits anonymised queries from
-- dimensioned rows, and the request is capped at a fixed number of rows, so a
-- window's set is always incomplete: it is the rows Google returned, not the
-- property's search demand.
--
-- ONE SET PER WINDOW. A capture writes a window's rows in one call, and the
-- window is then closed for that project and property: a repeated or
-- concurrent capture answers `exists` and writes nothing, so two captures
-- minutes apart cannot merge two different answers into one set. The
-- function serialises callers on a transaction advisory lock keyed by the
-- project, property, range and window end before it looks; a same-window
-- call that raced past would also fail on the unique key (23505), never
-- silently extend the set.
--
-- BOUNDED. At most 250 rows per capture — the `rowLimit` the server sends
-- with the query × page request (src/lib/search-console/query-pages) — checked
-- again here for any writer: a larger array is refused before anything is
-- written. One mapped project, one property, one window per day: at most 250
-- rows per project per day, each a few hundred bytes.
--
-- WHAT THE DATABASE CHECKS, AND WHAT IT CANNOT. Shape only: the property is
-- a Search Console property name, the window is exactly 30 days, query and
-- page are non-empty and within 2,048 characters, the page is an absolute
-- http(s) URL, the metrics are non-negative with impressions above zero and
-- clicks never above impressions. The PROJECT-TO-PROPERTY MAPPING IS NOT
-- CHECKED HERE: it is the server's private configuration, exactly as for
-- snapshots.
--
-- IMMUTABLE. A row is an observation: never updated, deleted or truncated.
--
-- HOW IT IS WRITTEN. Only through `nexra_search_console_query_pages_record`
-- (`security definer`, `search_path` pinned empty). service_role is granted
-- SELECT on the table and EXECUTE on that function, nothing else; `anon` and
-- `authenticated` get nothing. Row level security is enabled with no policies.
-- Additive: no existing table, column, function, trigger or grant is changed.

-- ---------------------------------------------------------------------------
-- The shape of a query × page list, checked by the record function before a
-- row is written: a JSON array of at most `max_rows` objects, each with
-- exactly the keys query, page, clicks, impressions, ctr and position; query
-- and page non-empty strings of at most `max_key` characters, the page an
-- absolute http(s) URL; the pair unique within the list; the four metrics
-- JSON numbers with clicks >= 0, impressions > 0, clicks <= impressions, ctr
-- in [0, 1] and position >= 0 — the same rules the provider's mapper applies.

create function public.nexra_search_console_pairs_valid(rows jsonb, max_rows integer, max_key integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_row jsonb;
  v_keys text[];
  v_seen text[] := '{}';
  v_query text;
  v_page text;
  v_pair text;
  v_clicks numeric;
  v_impressions numeric;
  v_ctr numeric;
  v_position numeric;
begin
  if rows is null or pg_catalog.jsonb_typeof(rows) <> 'array' then return false; end if;
  if pg_catalog.jsonb_array_length(rows) > max_rows then return false; end if;

  for v_row in select * from pg_catalog.jsonb_array_elements(rows) loop
    if pg_catalog.jsonb_typeof(v_row) <> 'object' then return false; end if;
    select pg_catalog.array_agg(k order by k) into v_keys from pg_catalog.jsonb_object_keys(v_row) k;
    if v_keys is distinct from array['clicks', 'ctr', 'impressions', 'page', 'position', 'query'] then return false; end if;

    if pg_catalog.jsonb_typeof(v_row -> 'query') <> 'string' or pg_catalog.jsonb_typeof(v_row -> 'page') <> 'string' then return false; end if;
    v_query := v_row ->> 'query';
    v_page := v_row ->> 'page';
    if v_query = '' or pg_catalog.length(v_query) > max_key then return false; end if;
    if v_page = '' or pg_catalog.length(v_page) > max_key or v_page !~ '^https?://[^[:space:]]+$' then return false; end if;
    -- The pair, with a separator no URL or query can contain.
    v_pair := v_query || E'\n' || v_page;
    if v_pair = any (v_seen) then return false; end if;
    v_seen := v_seen || v_pair;

    if pg_catalog.jsonb_typeof(v_row -> 'clicks') <> 'number'
      or pg_catalog.jsonb_typeof(v_row -> 'impressions') <> 'number'
      or pg_catalog.jsonb_typeof(v_row -> 'ctr') <> 'number'
      or pg_catalog.jsonb_typeof(v_row -> 'position') <> 'number'
    then return false; end if;
    v_clicks := (v_row ->> 'clicks')::numeric;
    v_impressions := (v_row ->> 'impressions')::numeric;
    v_ctr := (v_row ->> 'ctr')::numeric;
    v_position := (v_row ->> 'position')::numeric;
    if v_clicks < 0 or v_impressions <= 0 or v_clicks > v_impressions
      or v_ctr < 0 or v_ctr > 1 or v_position < 0
    then return false; end if;
  end loop;
  return true;
end;
$$;

comment on function public.nexra_search_console_pairs_valid(jsonb, integer, integer) is
  'True for a well-formed query × page list: a JSON array of at most max_rows objects with exactly query/page/clicks/impressions/ctr/position, non-empty query and absolute http(s) page of at most max_key characters, no repeated pair, and finite non-negative metrics with impressions > 0, clicks <= impressions and ctr in [0, 1].';

-- ---------------------------------------------------------------------------

create table public.nexra_search_console_query_pages (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_search_console_query_pages_project_fkey references public.projects (id) on delete restrict,

  -- The Search Console property the server read for the project, named as
  -- Search Console lists it (the same check as the snapshot table's).
  property text not null
    constraint nexra_search_console_query_pages_property_format check (
      char_length(property) between 11 and 512
      and (
        property ~ '^sc-domain:[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
        or property ~ '^https?://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?(/[^\s?#@/]+)*/$'
      )
    ),

  -- The window: the product's 30-day range only, exactly 30 calendar days,
  -- ended before today.
  range_id text not null
    constraint nexra_search_console_query_pages_range_valid check (range_id = '30d'),
  days smallint not null
    constraint nexra_search_console_query_pages_days_valid check (days = 30),
  start_date date not null,
  end_date date not null,
  constraint nexra_search_console_query_pages_window_length check (end_date - start_date + 1 = days),

  -- The pair Google reported: the query text and the page URL, verbatim.
  query text not null
    constraint nexra_search_console_query_pages_query_length check (char_length(query) between 1 and 2048),
  page text not null
    constraint nexra_search_console_query_pages_page_format check (char_length(page) between 1 and 2048 and page ~ '^https?://[^[:space:]]+$'),

  -- The four metrics for that pair over the window; nothing else.
  clicks bigint not null,
  impressions bigint not null,
  ctr numeric(7, 6) not null,
  position numeric(9, 3) not null,
  constraint nexra_search_console_query_pages_metrics_range check (
    clicks >= 0 and impressions > 0 and clicks <= impressions and ctr between 0 and 1 and position >= 0
  ),

  -- Who captured it. Only the scheduled worker in this checkpoint.
  source text not null default 'scheduled'
    constraint nexra_search_console_query_pages_source_valid check (source = 'scheduled'),

  -- When Google answered (the provider's own stamp) and when the row was written.
  fetched_at timestamptz not null,
  captured_at timestamptz not null default now(),
  constraint nexra_search_console_query_pages_fetched_before_captured check (fetched_at <= captured_at + interval '5 minutes'),

  constraint nexra_search_console_query_pages_one_per_pair unique (project_id, property, range_id, end_date, query, page)
);

comment on table public.nexra_search_console_query_pages is
  'Immutable query × page rows Google Search Console reported for one project''s property over the 30-day window: clicks, impressions, CTR and average position per pair, at most 250 per capture. Written once per window by the scheduled worker; never updated or removed. Anonymised queries are absent and the set is capped, so it is never complete. The project-to-property mapping is the server''s, not checked here.';

create index nexra_search_console_query_pages_window_idx
  on public.nexra_search_console_query_pages (project_id, range_id, end_date desc, property);

-- ---------------------------------------------------------------------------
-- A row is an observation: never changed, never removed.

create function public.nexra_search_console_query_pages_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_search_console_query_pages: a query × page observation is immutable and is never changed or removed'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_search_console_query_pages_guard_update
  before update on public.nexra_search_console_query_pages
  for each row
  execute function public.nexra_search_console_query_pages_guard_write();

create trigger nexra_search_console_query_pages_guard_delete
  before delete on public.nexra_search_console_query_pages
  for each row
  execute function public.nexra_search_console_query_pages_guard_write();

create trigger nexra_search_console_query_pages_guard_truncate
  before truncate on public.nexra_search_console_query_pages
  for each statement
  execute function public.nexra_search_console_query_pages_guard_write();

-- ---------------------------------------------------------------------------
-- Recording: the one write. Every argument is required; the list must be
-- well-formed and hold 1 to 250 pairs (`invalid_parameter_value` otherwise,
-- nothing written); the window must have ended before today; the project
-- must be stored (`not-found`). If the window already holds rows for the
-- project and property the call answers `exists` with their count and writes
-- nothing; otherwise every pair is inserted in one statement and the call
-- answers `created` with the count. Callers on one window serialise on a
-- transaction advisory lock taken before the existence check.

create function public.nexra_search_console_query_pages_record(
  p_project_id text,
  p_property text,
  p_range_id text,
  p_start_date date,
  p_end_date date,
  p_pairs jsonb,
  p_fetched_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_project_id is null or p_property is null or p_range_id is null or p_start_date is null
    or p_end_date is null or p_pairs is null or p_fetched_at is null
  then
    raise exception 'nexra_search_console_query_pages_record: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if pg_catalog.jsonb_typeof(p_pairs) <> 'array' or pg_catalog.jsonb_array_length(p_pairs) < 1 then
    raise exception 'nexra_search_console_query_pages_record: the list must hold at least one pair'
      using errcode = 'invalid_parameter_value';
  end if;

  if not public.nexra_search_console_pairs_valid(p_pairs, 250, 2048) then
    raise exception 'nexra_search_console_query_pages_record: the list is not a well-formed query × page list of at most 250 pairs'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_end_date >= current_date then
    raise exception 'nexra_search_console_query_pages_record: the window must end before today'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    return pg_catalog.jsonb_build_object('outcome', 'not-found');
  end if;

  -- One writer per window at a time: the second waits here, then sees the first's rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('nexra_search_console_query_pages'),
    pg_catalog.hashtext(p_project_id || E'\n' || p_property || E'\n' || p_range_id || E'\n' || p_end_date::text)
  );

  select count(*) into v_count
    from public.nexra_search_console_query_pages
   where project_id = p_project_id and property = p_property and range_id = p_range_id and end_date = p_end_date;
  if v_count > 0 then
    return pg_catalog.jsonb_build_object('outcome', 'exists', 'count', v_count);
  end if;

  insert into public.nexra_search_console_query_pages
    (project_id, property, range_id, days, start_date, end_date, query, page, clicks, impressions, ctr, position, fetched_at)
  select
    p_project_id, p_property, p_range_id, (p_end_date - p_start_date + 1)::smallint, p_start_date, p_end_date,
    r ->> 'query', r ->> 'page',
    (r ->> 'clicks')::bigint, (r ->> 'impressions')::bigint, (r ->> 'ctr')::numeric, (r ->> 'position')::numeric,
    p_fetched_at
  from pg_catalog.jsonb_array_elements(p_pairs) r;
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('outcome', 'created', 'count', v_count);
end;
$$;

comment on function public.nexra_search_console_query_pages_record(text, text, text, date, date, jsonb, timestamptz) is
  'Records the query × page rows of one Search Console window for a stored project in one statement: created with the count, or exists when that project, property, range and window end already hold rows (nothing written). At most 250 well-formed pairs; the project-to-property mapping is the server''s.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the record function.
-- Nothing else, for anyone.

alter table public.nexra_search_console_query_pages enable row level security;

revoke all on function public.nexra_search_console_query_pages_record(text, text, text, date, date, jsonb, timestamptz) from public;
revoke all on function public.nexra_search_console_pairs_valid(jsonb, integer, integer) from public;
revoke all on function public.nexra_search_console_query_pages_guard_write() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_search_console_query_pages from %I', v_role);
      execute format('revoke all on function public.nexra_search_console_query_pages_record(text, text, text, date, date, jsonb, timestamptz) from %I', v_role);
      execute format('revoke all on function public.nexra_search_console_pairs_valid(jsonb, integer, integer) from %I', v_role);
      execute format('revoke all on function public.nexra_search_console_query_pages_guard_write() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_search_console_query_pages to service_role;
    grant execute on function public.nexra_search_console_query_pages_record(text, text, text, date, date, jsonb, timestamptz) to service_role;
  end if;
end
$$;
