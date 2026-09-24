-- Search Console snapshots: one immutable record of what Google Search Console
-- reported for one project's property over one 30-day window, captured by the
-- scheduled worker (M1, Checkpoint 1a).
--
-- WHY. The Search Console provider (src/lib/search-console) reads Google
-- live and keeps its answers only in server memory, for at most a day. Nothing
-- in the product could show how a property moved over time, or ground an
-- agent's performance review in anything older than the last call. This
-- table keeps each day's observation of the 30-day window so history can be
-- read from the product's own records.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000 and 20260922120000.
--
-- WHAT A SNAPSHOT IS. The project, the property it was read for, the exact
-- window (30 calendar days ending three days before Pacific today, as
-- src/lib/search-console/date-windows.ts computes it), the state Google
-- answered in — `connected` with totals, or `no-data` when the property had no
-- impressions — the property's totals, its top 25 queries and top 25 pages as
-- the provider mapped them, which secondary reads were unavailable, when Google
-- answered and when the row was written. Nothing here is a search volume, a
-- rank, a competitor or a credential; a snapshot holds only the numbers Google
-- reported and the query and page strings it reported them for.
--
-- WHAT THE DATABASE CHECKS, AND WHAT IT CANNOT. Every row is checked for shape:
-- the property is a Search Console property name, the window is exactly 30
-- days, totals are present exactly when connected and are non-negative with
-- clicks never above impressions, the query and page lists are well-formed
-- (at most 25 rows, each exactly one key with four finite non-negative
-- metrics, no repeated keys), and the partial markers are known ones. The
-- PROJECT-TO-PROPERTY MAPPING IS NOT CHECKED HERE: it lives in the server's
-- private configuration (SEARCH_CONSOLE_PROPERTIES), which the database cannot
-- read. The server is the trusted boundary for it; the database records what
-- the server says it read and binds it to a stored project.
--
-- ONE SNAPSHOT PER WINDOW. The unique key (project, property, range, end date)
-- makes a repeated capture on the same day a no-op (`exists`) and lets two
-- concurrent captures produce exactly one row: the second insert waits on the
-- first and then conflicts.
--
-- IMMUTABLE. A snapshot is an observation; it is never updated, deleted or
-- truncated. There is no retention rule in this migration: one 30-day row per
-- mapped project per day, a few kilobytes each.
--
-- HOW IT IS WRITTEN. Only through `nexra_search_console_snapshot_record`
-- (`security definer`, `search_path` pinned empty). service_role is granted
-- SELECT on the table and EXECUTE on that function, nothing else; `anon` and
-- `authenticated` get nothing. Row level security is enabled with no policies.
-- Additive: no existing table, column, function, trigger or grant is changed.

-- ---------------------------------------------------------------------------
-- The shape of a top-queries or top-pages list, checked before the table
-- exists so the table's constraints can name it.
--
-- A list is a JSON array of at most `max_rows` objects, each with exactly the
-- keys key, clicks, impressions, ctr and position: `key` a non-empty string of
-- at most `max_key` characters, unique within the list; the four metrics JSON
-- numbers with clicks >= 0, impressions > 0, clicks <= impressions, ctr in
-- [0, 1] and position >= 0 — the same rules the provider's mapper applies
-- (src/lib/search-console/mappers.ts), so a row that would be dropped there is
-- refused here for any writer.

create function public.nexra_search_console_rows_valid(rows jsonb, max_rows integer, max_key integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_row jsonb;
  v_keys text[];
  v_seen text[] := '{}';
  v_key text;
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
    if v_keys is distinct from array['clicks', 'ctr', 'impressions', 'key', 'position'] then return false; end if;

    if pg_catalog.jsonb_typeof(v_row -> 'key') <> 'string' then return false; end if;
    v_key := v_row ->> 'key';
    if v_key = '' or pg_catalog.length(v_key) > max_key then return false; end if;
    if v_key = any (v_seen) then return false; end if;
    v_seen := v_seen || v_key;

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

comment on function public.nexra_search_console_rows_valid(jsonb, integer, integer) is
  'True for a well-formed top-queries or top-pages list: a JSON array of at most max_rows objects with exactly key/clicks/impressions/ctr/position, unique non-empty keys of at most max_key characters, and finite non-negative metrics with impressions > 0, clicks <= impressions and ctr in [0, 1].';

-- ---------------------------------------------------------------------------

create table public.nexra_search_console_snapshots (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_search_console_snapshots_project_fkey references public.projects (id) on delete restrict,

  -- The Search Console property the server read for the project: a domain
  -- property or a URL-prefix property, named exactly as Search Console lists
  -- it (src/lib/search-console/config.ts `isSearchConsoleProperty`).
  property text not null
    constraint nexra_search_console_snapshots_property_format check (
      char_length(property) between 11 and 512
      and (
        property ~ '^sc-domain:[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
        or property ~ '^https?://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?(/[^\s?#@/]+)*/$'
      )
    ),

  -- The window: the product's 30-day range only, exactly 30 calendar days,
  -- ended before today (Search Console finalises a day days after it ends).
  range_id text not null
    constraint nexra_search_console_snapshots_range_valid check (range_id = '30d'),
  days smallint not null
    constraint nexra_search_console_snapshots_days_valid check (days = 30),
  start_date date not null,
  end_date date not null,
  constraint nexra_search_console_snapshots_window_length check (end_date - start_date + 1 = days),

  -- `connected`: the property had impressions and the totals below are set.
  -- `no-data`: it had none, and every total is null — never zero-filled.
  state text not null
    constraint nexra_search_console_snapshots_state_valid check (state in ('connected', 'no-data')),
  clicks bigint,
  impressions bigint,
  ctr numeric(7, 6),
  position numeric(9, 3),
  constraint nexra_search_console_snapshots_totals_present check (
    (state = 'connected') = (clicks is not null and impressions is not null and ctr is not null and position is not null)
    and (state = 'no-data') = (clicks is null and impressions is null and ctr is null and position is null)
  ),
  constraint nexra_search_console_snapshots_totals_range check (
    clicks is null
    or (clicks >= 0 and impressions > 0 and clicks <= impressions and ctr between 0 and 1 and position >= 0)
  ),

  -- Top 25 queries and top 25 pages, as the provider mapped them; empty when
  -- unavailable or when there was no data.
  queries jsonb not null default '[]'::jsonb
    constraint nexra_search_console_snapshots_queries_valid check (public.nexra_search_console_rows_valid(queries, 25, 2048)),
  pages jsonb not null default '[]'::jsonb
    constraint nexra_search_console_snapshots_pages_valid check (public.nexra_search_console_rows_valid(pages, 25, 2048)),
  constraint nexra_search_console_snapshots_no_data_is_empty check (
    state = 'connected' or (queries = '[]'::jsonb and pages = '[]'::jsonb and partial = '{}')
  ),

  -- Which secondary reads failed for a connected snapshot; the list is then empty.
  partial text[] not null default '{}'
    constraint nexra_search_console_snapshots_partial_valid check (
      partial <@ array['queries-unavailable', 'pages-unavailable']::text[]
      and cardinality(partial) <= 2
      and (cardinality(partial) < 2 or partial[1] <> partial[2])
    ),

  -- Who captured it. Only the scheduled worker in this checkpoint.
  source text not null default 'scheduled'
    constraint nexra_search_console_snapshots_source_valid check (source = 'scheduled'),

  -- When Google answered (the provider's own stamp) and when the row was written.
  fetched_at timestamptz not null,
  captured_at timestamptz not null default now(),
  constraint nexra_search_console_snapshots_fetched_before_captured check (fetched_at <= captured_at + interval '5 minutes'),

  constraint nexra_search_console_snapshots_one_per_window unique (project_id, property, range_id, end_date)
);

comment on table public.nexra_search_console_snapshots is
  'Immutable daily observations of one project''s Search Console property over the 30-day window: totals, top 25 queries and top 25 pages as Google reported them. Captured by the scheduled worker; never updated or removed. The project-to-property mapping is the server''s, not checked here.';

create index nexra_search_console_snapshots_project_idx
  on public.nexra_search_console_snapshots (project_id, range_id, end_date desc);

-- ---------------------------------------------------------------------------
-- A snapshot is an observation: never changed, never removed.

create function public.nexra_search_console_snapshots_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_search_console_snapshots: a snapshot is an immutable observation and is never changed or removed'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_search_console_snapshots_guard_update
  before update on public.nexra_search_console_snapshots
  for each row
  execute function public.nexra_search_console_snapshots_guard_write();

create trigger nexra_search_console_snapshots_guard_delete
  before delete on public.nexra_search_console_snapshots
  for each row
  execute function public.nexra_search_console_snapshots_guard_write();

create trigger nexra_search_console_snapshots_guard_truncate
  before truncate on public.nexra_search_console_snapshots
  for each statement
  execute function public.nexra_search_console_snapshots_guard_write();

-- ---------------------------------------------------------------------------
-- Recording: the one write. Every argument is required; the project must be
-- stored (`not-found`); the row's shape is checked by the table's constraints,
-- which raise check_violation for any writer. A snapshot of a window already
-- recorded for the project and property answers `exists` with the stored row
-- and writes nothing; two captures racing on the same window serialise on the
-- unique key, so exactly one is `created`.

create function public.nexra_search_console_snapshot_record(
  p_project_id text,
  p_property text,
  p_range_id text,
  p_start_date date,
  p_end_date date,
  p_state text,
  p_clicks bigint,
  p_impressions bigint,
  p_ctr numeric,
  p_position numeric,
  p_queries jsonb,
  p_pages jsonb,
  p_partial text[],
  p_fetched_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot public.nexra_search_console_snapshots;
begin
  if p_project_id is null or p_property is null or p_range_id is null or p_start_date is null
    or p_end_date is null or p_state is null or p_queries is null or p_pages is null
    or p_partial is null or p_fetched_at is null
  then
    raise exception 'nexra_search_console_snapshot_record: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The window ended before today: Search Console finalises a day only days
  -- after it ends, and the server never asks for one that has not. Checked
  -- here rather than as a table constraint, which must be immutable.
  if p_end_date >= current_date then
    raise exception 'nexra_search_console_snapshot_record: the window must end before today'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    return jsonb_build_object('outcome', 'not-found');
  end if;

  insert into public.nexra_search_console_snapshots
    (project_id, property, range_id, days, start_date, end_date, state,
     clicks, impressions, ctr, position, queries, pages, partial, fetched_at)
  values
    (p_project_id, p_property, p_range_id, (p_end_date - p_start_date + 1)::smallint, p_start_date, p_end_date, p_state,
     p_clicks, p_impressions, p_ctr, p_position, p_queries, p_pages, p_partial, p_fetched_at)
  on conflict on constraint nexra_search_console_snapshots_one_per_window do nothing
  returning * into v_snapshot;

  if v_snapshot.id is not null then
    return jsonb_build_object('outcome', 'created', 'snapshot', to_jsonb(v_snapshot));
  end if;

  select * into v_snapshot
    from public.nexra_search_console_snapshots
   where project_id = p_project_id and property = p_property and range_id = p_range_id and end_date = p_end_date;
  return jsonb_build_object('outcome', 'exists', 'snapshot', to_jsonb(v_snapshot));
end;
$$;

comment on function public.nexra_search_console_snapshot_record(text, text, text, date, date, text, bigint, bigint, numeric, numeric, jsonb, jsonb, text[], timestamptz) is
  'Records one immutable Search Console snapshot for a stored project: created, or exists when that project, property, range and window end are already recorded (nothing written). The row''s shape is enforced by the table''s constraints; the project-to-property mapping is the server''s.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the record function.
-- Nothing else, for anyone.

alter table public.nexra_search_console_snapshots enable row level security;

revoke all on function public.nexra_search_console_snapshot_record(text, text, text, date, date, text, bigint, bigint, numeric, numeric, jsonb, jsonb, text[], timestamptz) from public;
revoke all on function public.nexra_search_console_rows_valid(jsonb, integer, integer) from public;
revoke all on function public.nexra_search_console_snapshots_guard_write() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      -- Supabase's default privileges may already have granted everything
      -- on a new table or function; take it all back first.
      execute format('revoke all on table public.nexra_search_console_snapshots from %I', v_role);
      execute format('revoke all on function public.nexra_search_console_snapshot_record(text, text, text, date, date, text, bigint, bigint, numeric, numeric, jsonb, jsonb, text[], timestamptz) from %I', v_role);
      execute format('revoke all on function public.nexra_search_console_rows_valid(jsonb, integer, integer) from %I', v_role);
      execute format('revoke all on function public.nexra_search_console_snapshots_guard_write() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_search_console_snapshots to service_role;
    grant execute on function public.nexra_search_console_snapshot_record(text, text, text, date, date, text, bigint, bigint, numeric, numeric, jsonb, jsonb, text[], timestamptz) to service_role;
  end if;
end
$$;
