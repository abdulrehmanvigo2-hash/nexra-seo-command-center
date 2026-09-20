-- Crawls: what this product actually fetched from a project's own website.
--
-- NAMING. Every table here carries a `nexra_` prefix, and so does every
-- constraint and index. The unprefixed names — crawls, crawl_pages,
-- crawl_links — are taken in this database by a separate, live crawl
-- subsystem with its own data, triggers and dependent tables
-- (crawl_page_signals, crawl_urls). That subsystem is not ours and is not
-- described anywhere in this repository. Nothing in this file may name it:
-- no create, no alter, no grant, no revoke. The prefix is what keeps the two
-- apart, and it is not cosmetic — a UNIQUE or PRIMARY KEY constraint creates
-- an index, and index names are unique per schema, so reusing a constraint
-- name would collide even when the table name did not.
--
-- The persistence half of the Crawl Foundation (Backend Phase 7, Part 1). An
-- operator starts a crawl against a stored project; the engine walks that
-- project's host inside fixed budgets and records what each URL returned.
--
-- Design decisions, and the ones that were deliberately not taken:
--
--   * **No indexation column exists, anywhere.** Whether Google has a URL in
--     its index is Search Console's to report and a crawler cannot observe it:
--     a 200 means the page answered us, not that anyone indexed it. There is
--     no column here to put a guess in, which is the only reliable way to stop
--     one being stored.
--   * **No Core Web Vitals columns exist.** Field vitals come from real user
--     measurement. Timing our own fetch would measure this server's link to
--     the origin and nothing about anybody's experience of the page.
--   * **Null means unknown.** `in_sitemap`, `robots_txt_allowed`,
--     `canonical_is_self` and `depth` are nullable because "we could not tell"
--     is a real answer and is not the same as false or zero. Nothing in the
--     application may collapse the two.
--   * **Signals are columns, not an entity-attribute table.** What a crawl
--     observes is a closed set, and columns let the database enforce it — an
--     HTTP status really is between 100 and 599, a canonical really is paired
--     with its resolution. A key/value table would keep none of that.
--   * **Pages cascade, crawls restrict.** A crawl's pages are its body and go
--     with it; a project with crawls cannot be deleted, because a crawl is an
--     audit record of what a client's site returned on a day.
--   * `created_by` is the Supabase Auth user id, with no foreign key: removing
--     an operator account must not erase the record of what it asked for.

create table public.nexra_crawls (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_crawls_project_fkey references public.projects (id) on delete restrict,

  -- Where the walk began, and the host every fetch was confined to. Both are
  -- derived from the project's stored domain, never from request input.
  start_url text not null
    constraint nexra_crawls_start_url_format check (start_url ~ '^https?://' and char_length(start_url) <= 2048),
  host_scope text not null
    constraint nexra_crawls_host_scope_length check (char_length(host_scope) between 1 and 253),

  status text not null default 'running'
    constraint nexra_crawls_status_valid
      check (status in ('running', 'completed', 'partial', 'failed', 'cancelled')),

  -- `partial` is a success that ran out of budget, so the reason it stopped is
  -- part of the result rather than an error.
  stop_reason text
    constraint nexra_crawls_stop_reason_valid
      check (stop_reason in ('completed', 'page-budget', 'time-budget', 'error', 'cancelled')),

  max_pages integer not null
    constraint nexra_crawls_max_pages_range check (max_pages between 1 and 500),
  max_depth integer not null
    constraint nexra_crawls_max_depth_range check (max_depth between 0 and 10),
  max_duration_ms integer not null
    constraint nexra_crawls_max_duration_range check (max_duration_ms between 1000 and 300000),

  -- How the crawler identified itself. Stored so a site operator's log can be
  -- matched to a crawl in here.
  user_agent text not null
    constraint nexra_crawls_user_agent_length check (char_length(user_agent) between 1 and 200),

  -- Whether the supporting documents could be read. `unavailable` is not
  -- `absent`: one means we could not check, the other means the origin said
  -- there is nothing there.
  robots_state text not null default 'unavailable'
    constraint nexra_crawls_robots_state_valid check (robots_state in ('fetched', 'absent', 'unavailable')),
  sitemap_state text not null default 'unavailable'
    constraint nexra_crawls_sitemap_state_valid check (sitemap_state in ('fetched', 'absent', 'unavailable')),

  pages_discovered integer not null default 0
    constraint nexra_crawls_pages_discovered_positive check (pages_discovered >= 0),
  pages_fetched integer not null default 0
    constraint nexra_crawls_pages_fetched_positive check (pages_fetched >= 0),
  pages_failed integer not null default 0
    constraint nexra_crawls_pages_failed_positive check (pages_failed >= 0),

  -- A fixed code and a fixed message, never an exception or a response body.
  error_code text
    constraint nexra_crawls_error_code_format
      check (error_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(error_code) <= 64),
  error_message text
    constraint nexra_crawls_error_message_length check (char_length(error_message) between 1 and 500),

  created_by uuid not null,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint nexra_crawls_error_pair check ((error_code is null) = (error_message is null)),
  constraint nexra_crawls_finished_after_started
    check (finished_at is null or finished_at >= started_at),

  -- What each state must and must not carry.
  constraint nexra_crawls_state_consistent check (
    case status
      when 'running' then finished_at is null and stop_reason is null and error_code is null
      when 'failed' then finished_at is not null and stop_reason is not null and error_code is not null
      else finished_at is not null and stop_reason is not null
    end
  )
);

comment on table public.nexra_crawls is
  'One operator-requested walk of one project''s website. Observed data only: no indexation, no Core Web Vitals.';
comment on column public.nexra_crawls.host_scope is
  'Every fetch in this crawl was confined to this host or a subdomain of it.';
comment on column public.nexra_crawls.status is
  '"partial" is a real result that ran out of budget, not a failure.';
comment on column public.nexra_crawls.robots_state is
  '"unavailable" means robots.txt could not be read, which is never treated as permission.';

create index nexra_crawls_project_started_idx on public.nexra_crawls (project_id, started_at desc);

-- ---------------------------------------------------------------------------

create table public.nexra_crawl_pages (
  id uuid primary key default gen_random_uuid(),

  crawl_id uuid not null
    constraint nexra_crawl_pages_crawl_fkey references public.nexra_crawls (id) on delete cascade,

  -- The normalised URL. Unique within the crawl: this is what makes a page
  -- appear once however many links point at it.
  url text not null
    constraint nexra_crawl_pages_url_length check (char_length(url) between 1 and 2048),
  final_url text
    constraint nexra_crawl_pages_final_url_length check (char_length(final_url) between 1 and 2048),

  -- How the fetch ended. Every URL the crawl knew about has a row, including
  -- the ones it never reached ('budget-skipped'), because "we did not look"
  -- and "there is nothing there" are different findings.
  fetch_state text not null
    constraint nexra_crawl_pages_fetch_state_valid check (fetch_state in (
      'fetched', 'http-error', 'redirect-loop', 'too-many-redirects', 'timeout',
      'dns-error', 'connection-error', 'too-large', 'non-html',
      'blocked-by-robots', 'refused-unsafe', 'off-site', 'budget-skipped'
    )),

  http_status smallint
    constraint nexra_crawl_pages_http_status_range check (http_status between 100 and 599),
  redirect_hops smallint not null default 0
    constraint nexra_crawl_pages_redirect_hops_range check (redirect_hops between 0 and 10),
  redirect_chain text[] not null default '{}'
    constraint nexra_crawl_pages_redirect_chain_bounded check (
      cardinality(redirect_chain) <= 10 and array_position(redirect_chain, null) is null
    ),

  content_type text
    constraint nexra_crawl_pages_content_type_length check (char_length(content_type) <= 200),
  content_bytes integer
    constraint nexra_crawl_pages_content_bytes_positive check (content_bytes >= 0),

  -- observed: the directive as written on the page.
  robots_meta text
    constraint nexra_crawl_pages_robots_meta_length check (char_length(robots_meta) <= 200),
  -- derived: this crawler's reading of robots.txt. Null when it could not be read.
  robots_txt_allowed boolean,

  canonical_href text
    constraint nexra_crawl_pages_canonical_href_length check (char_length(canonical_href) <= 2048),
  canonical_resolved text
    constraint nexra_crawl_pages_canonical_resolved_length check (char_length(canonical_resolved) <= 2048),
  canonical_is_self boolean,

  title text
    constraint nexra_crawl_pages_title_length check (char_length(title) <= 1000),
  title_length integer
    constraint nexra_crawl_pages_title_length_positive check (title_length >= 0),
  meta_description text
    constraint nexra_crawl_pages_meta_description_length check (char_length(meta_description) <= 2000),
  meta_description_length integer
    constraint nexra_crawl_pages_meta_description_length_positive check (meta_description_length >= 0),
  h1_count smallint
    constraint nexra_crawl_pages_h1_count_positive check (h1_count >= 0),
  first_h1 text
    constraint nexra_crawl_pages_first_h1_length check (char_length(first_h1) <= 1000),

  schema_types text[] not null default '{}'
    constraint nexra_crawl_pages_schema_types_bounded check (
      cardinality(schema_types) <= 50 and array_position(schema_types, null) is null
    ),
  schema_blocks smallint not null default 0
    constraint nexra_crawl_pages_schema_blocks_positive check (schema_blocks >= 0),
  -- A JSON-LD block that would not parse is recorded, never silently dropped.
  schema_parse_failed boolean not null default false,

  -- Null is unknown, and stays unknown: a sitemap that could not be read
  -- leaves every page's membership null rather than false.
  in_sitemap boolean,

  -- derived: link distance from the start URL. Null when never reached.
  depth smallint
    constraint nexra_crawl_pages_depth_range check (depth between 0 and 10),
  -- derived, and only ever within this crawl. Not a site-wide count, which a
  -- bounded crawl cannot establish.
  internal_links_in integer not null default 0
    constraint nexra_crawl_pages_links_in_positive check (internal_links_in >= 0),
  internal_links_out integer not null default 0
    constraint nexra_crawl_pages_links_out_positive check (internal_links_out >= 0),

  fetched_at timestamptz,
  error_code text
    constraint nexra_crawl_pages_error_code_format
      check (error_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(error_code) <= 64),

  constraint nexra_crawl_pages_unique_url unique (crawl_id, url),

  -- A status, a content type, or a fetch time can only exist if something was
  -- actually fetched.
  constraint nexra_crawl_pages_unfetched_is_empty check (
    fetch_state <> 'budget-skipped'
    or (http_status is null and content_type is null and fetched_at is null and title is null)
  )
);

comment on table public.nexra_crawl_pages is
  'One URL as one crawl found it. Observed and derived readings only; a null means unknown, never false or zero.';
comment on column public.nexra_crawl_pages.in_sitemap is
  'Null means the sitemap could not be read, so membership is unknown. It is never collapsed to false.';
comment on column public.nexra_crawl_pages.internal_links_in is
  'Counted within this crawl only. A bounded crawl cannot establish a site-wide count, so this must not be read as one (and so cannot decide whether a page is orphaned).';
comment on column public.nexra_crawl_pages.depth is
  'Derived: shortest link distance from the start URL within this crawl.';

create index nexra_crawl_pages_crawl_state_idx on public.nexra_crawl_pages (crawl_id, fetch_state);
create index nexra_crawl_pages_crawl_depth_idx on public.nexra_crawl_pages (crawl_id, depth);

-- ---------------------------------------------------------------------------

-- The link graph this crawl saw. Its own table because it is genuinely
-- relational: depth and the internal link counts are computed from it.
create table public.nexra_crawl_links (
  id uuid primary key default gen_random_uuid(),

  crawl_id uuid not null
    constraint nexra_crawl_links_crawl_fkey references public.nexra_crawls (id) on delete cascade,

  from_url text not null
    constraint nexra_crawl_links_from_url_length check (char_length(from_url) between 1 and 2048),
  to_url text not null
    constraint nexra_crawl_links_to_url_length check (char_length(to_url) between 1 and 2048),

  -- The rel attribute as written, so "nofollow" stays visible as the page's
  -- own statement rather than this crawler's interpretation of it.
  rel text
    constraint nexra_crawl_links_rel_length check (char_length(rel) <= 200),

  -- External links are recorded and never fetched.
  is_internal boolean not null,

  discovered_at timestamptz not null default now(),

  constraint nexra_crawl_links_unique_edge unique (crawl_id, from_url, to_url)
);

comment on table public.nexra_crawl_links is
  'Edges one crawl observed. External edges are recorded but were never fetched.';

create index nexra_crawl_links_crawl_to_idx on public.nexra_crawl_links (crawl_id, to_url);

-- ---------------------------------------------------------------------------
-- Row level security with no policies, as on every other table here: no
-- browser-side role can read or write these. The application reads them on the
-- server with the secret key, which bypasses row level security.

alter table public.nexra_crawls enable row level security;
alter table public.nexra_crawl_pages enable row level security;
alter table public.nexra_crawl_links enable row level security;
