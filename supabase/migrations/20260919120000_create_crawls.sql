-- Crawls: what the product found when it asked a real website what it has.
--
-- The first table holding evidence rather than a record the agency typed. A
-- crawl is one discovery pass over one project's site: it reads robots.txt,
-- follows the sitemaps that file advertises (or the conventional location when
-- it advertises none), and writes down the page URLs the site claims to have.
--
-- Additive and self-contained. Nothing here changes an existing table, and the
-- only reference out is to public.projects, so applying this migration to a
-- deployment already serving projects changes nothing that is already there.
--
-- Deliberately absent, because the next bounded features own them:
--   * page content, titles, headings, status codes — a discovered URL has not
--     been fetched yet, and a column nobody fills is worse than no column;
--   * scores, issues and recommendations, which are read out of evidence and
--     are not evidence;
--   * a schedule. Re-crawls are a later feature and will reuse the worker the
--     agent runtime already has, not a second scheduler.
--
-- The lifecycle is enforced here, for every writer including the service role,
-- the same way public.agent_runs enforces its own.

create table public.crawls (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    references public.projects (id) on delete restrict,

  -- The host the crawl is scoped to, resolved from the project's domain when
  -- the crawl was created. Stored because a project's domain may be corrected
  -- later, and a crawl records what was actually visited.
  site text not null
    constraint crawls_site_canonical check (
      site = lower(site)
      and site ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
    ),

  --   queued      created, nothing fetched yet
  --   discovering robots.txt and sitemaps are being read
  --   completed   the pass finished; discovered_count is final
  --   failed      the pass stopped early; failure_code says why
  --   cancelled   an operator stopped it
  status text not null default 'queued'
    constraint crawls_status_valid
      check (status in ('queued', 'discovering', 'completed', 'failed', 'cancelled')),

  -- What robots.txt turned out to be. Null until the pass reads it. A site
  -- that could not serve one is crawled no further, so this is the first thing
  -- to look at when a crawl finds nothing.
  robots_state text
    constraint crawls_robots_state_valid
      check (robots_state is null or robots_state in ('parsed', 'missing', 'unavailable')),

  -- Sitemap documents read, and page URLs kept after deduplication and the URL
  -- policy. Counters rather than a join, because both are read on every list
  -- and neither is derivable once rows are pruned.
  sitemap_count integer not null default 0
    constraint crawls_sitemap_count_sane check (sitemap_count >= 0),
  discovered_count integer not null default 0
    constraint crawls_discovered_count_sane check (discovered_count >= 0),

  -- Limits the pass reached, from src/types/crawl.ts DiscoveryLimit. Empty
  -- when the site was read in full; a non-empty list means the inventory is a
  -- sample, and nothing downstream may present it as complete.
  limits text[] not null default '{}'
    constraint crawls_limits_valid check (
      limits <@ array['sitemaps', 'urls', 'depth']::text[]
    ),

  -- Why a failed crawl stopped. A fixed code, never exception text: this row
  -- outlives the request and an error message can quote a URL or a header.
  failure_code text
    constraint crawls_failure_code_valid check (
      failure_code is null or failure_code in (
        'robots-unavailable', 'site-refused', 'no-sitemap', 'store-error', 'timeout'
      )
    ),
  constraint crawls_failure_code_only_when_failed check (
    (status = 'failed') = (failure_code is not null)
  ),

  -- The Supabase Auth user id of the operator who asked. No foreign key to
  -- auth.users: removing an account must not delete or rewrite crawl history.
  created_by uuid,
  source text not null default 'operator'
    constraint crawls_source_valid check (source in ('operator', 'schedule')),

  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint crawls_finished_after_started check (
    finished_at is null or started_at is null or finished_at >= started_at
  ),
  -- A pass that has ended has an ending, and one that has not has not.
  constraint crawls_finished_when_ended check (
    (status in ('completed', 'failed', 'cancelled')) = (finished_at is not null)
  )
);

comment on table public.crawls is
  'One discovery pass over one project website. Evidence, not a score.';
comment on column public.crawls.site is
  'Host visited, resolved from the project domain when the crawl was created.';
comment on column public.crawls.limits is
  'Discovery limits reached. Non-empty means the inventory is a sample.';

-- One page URL a crawl found. The URL itself is the identity within a crawl:
-- a page listed in two sitemaps is one page, and the primary key says so
-- rather than leaving deduplication to whatever writes the rows.
create table public.crawl_urls (
  crawl_id uuid not null
    references public.crawls (id) on delete cascade,

  url text not null
    constraint crawl_urls_url_shape check (
      url ~ '^https?://' and char_length(url) between 8 and 2048
    ),

  -- Where it was listed, from src/types/crawl.ts DiscoveredUrl.
  source text not null
    constraint crawl_urls_source_valid
      check (source in ('robots', 'well-known', 'index', 'homepage')),

  discovered_at timestamptz not null default now(),

  primary key (crawl_id, url)
);

comment on table public.crawl_urls is
  'Page URLs one crawl discovered. Not yet fetched: discovery only.';

-- Keep updated_at honest. The function already exists from the projects
-- migration; this only attaches it.
create trigger crawls_set_updated_at
  before update on public.crawls
  for each row
  execute function public.set_updated_at();

-- The lifecycle, enforced for every writer.
--
-- The request a crawl was created with never changes: which project, which
-- site, who asked, and when. Everything else is the pass reporting progress.
create function public.crawls_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.project_id <> old.project_id
     or new.site <> old.site
     or new.created_at <> old.created_at
     or new.source <> old.source
     or new.created_by is distinct from old.created_by then
    raise exception 'crawls: a crawl request cannot be changed'
      using errcode = 'check_violation';
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'queued' and new.status in ('discovering', 'cancelled'))
      or (old.status = 'discovering' and new.status in ('completed', 'failed', 'cancelled'))
    ) then
      raise exception 'crawls: cannot move a crawl from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  if old.status in ('completed', 'failed', 'cancelled') and new.status <> old.status then
    raise exception 'crawls: % is final', old.status
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger crawls_guard_update
  before update on public.crawls
  for each row
  execute function public.crawls_guard_update();

-- One crawl per project at a time. A second request while one is in flight
-- gets the one already running, not a duplicate pass over the same site.
create unique index crawls_one_active_per_project
  on public.crawls (project_id)
  where status in ('queued', 'discovering');

-- The two reads the runtime makes: a project's crawl history, and the queue.
create index crawls_project_recent on public.crawls (project_id, created_at desc);
create index crawls_queued on public.crawls (created_at) where status = 'queued';

-- Row level security with no policies: no client role reaches these tables.
-- The server reads and writes them with the service role, which bypasses RLS
-- but not privileges, so the grants below are stated explicitly — the same
-- lesson as the projects grant migration.
alter table public.crawls enable row level security;
alter table public.crawl_urls enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.crawls to service_role;
    grant select, insert, update, delete on table public.crawl_urls to service_role;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.crawls from anon;
    revoke all on table public.crawl_urls from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.crawls from authenticated;
    revoke all on table public.crawl_urls from authenticated;
  end if;
end
$$;
