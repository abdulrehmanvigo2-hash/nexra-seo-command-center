-- Page fetching: what each discovered URL actually answered.
--
-- Discovery wrote down the pages a site says it has. This is the stage that
-- asks each of them, and records the answer as fact: a status code, where the
-- request ended up, what came back and how big it was, or the reason there was
-- no answer at all. Nothing here is an SEO judgement — no title, no heading, no
-- score. Reading meaning out of a response is the next stage's work.
--
-- `crawl_pages` is also the queue. A crawl of ten thousand URLs cannot run
-- inside one request, so the rows themselves hold the work: `pending` is the
-- frontier, a claim leases a batch, and a worker that dies leaves leases that
-- expire rather than progress that is lost. That is the same shape
-- `agent_run_attempts` uses, applied per URL instead of per run, and it is why
-- there is no second queue table.
--
-- Additive. The only changes to an existing table widen `crawls`: one more
-- status, one more limit value, and four counters, all with defaults. Every
-- row already in `crawls` stays valid.

-- ---------------------------------------------------------------------------
-- crawls: room for the fetch stage
-- ---------------------------------------------------------------------------

alter table public.crawls
  add column pages_total integer not null default 0
    constraint crawls_pages_total_sane check (pages_total >= 0),
  add column pages_fetched integer not null default 0
    constraint crawls_pages_fetched_sane check (pages_fetched >= 0),
  add column pages_failed integer not null default 0
    constraint crawls_pages_failed_sane check (pages_failed >= 0),
  add column pages_skipped integer not null default 0
    constraint crawls_pages_skipped_sane check (pages_skipped >= 0);

comment on column public.crawls.pages_total is
  'Pages queued for fetching. Zero until discovery hands over.';
comment on column public.crawls.pages_skipped is
  'Pages not requested: refused by the URL policy, disallowed by robots, or past a limit.';

-- `fetching` sits between discovery and the end of the crawl. A crawl that
-- only ever discovers still completes straight from `discovering`, so nothing
-- already stored becomes unreachable.
alter table public.crawls drop constraint crawls_status_valid;
alter table public.crawls add constraint crawls_status_valid
  check (status in ('queued', 'discovering', 'fetching', 'completed', 'failed', 'cancelled'));

-- A pass that stopped at the page cap read part of the site, the same way one
-- that stopped at the sitemap cap did.
alter table public.crawls drop constraint crawls_limits_valid;
alter table public.crawls add constraint crawls_limits_valid
  check (limits <@ array['sitemaps', 'urls', 'depth', 'pages']::text[]);

-- The lifecycle, restated with the new state. Replaces the function the
-- previous migration created; the trigger that calls it is unchanged.
create or replace function public.crawls_guard_update()
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
      or (old.status = 'discovering'
          and new.status in ('fetching', 'completed', 'failed', 'cancelled'))
      or (old.status = 'fetching' and new.status in ('completed', 'failed', 'cancelled'))
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

-- A crawl in the fetch stage is still in flight, so it still holds the one
-- active slot for its project.
drop index public.crawls_one_active_per_project;
create unique index crawls_one_active_per_project
  on public.crawls (project_id)
  where status in ('queued', 'discovering', 'fetching');

-- ---------------------------------------------------------------------------
-- crawl_pages
-- ---------------------------------------------------------------------------

create table public.crawl_pages (
  crawl_id uuid not null references public.crawls (id) on delete cascade,

  -- The URL as discovery recorded it. Identity within a crawl, so a page
  -- listed twice is fetched once and recorded once.
  url text not null
    constraint crawl_pages_url_shape check (
      url ~ '^https?://' and char_length(url) between 8 and 2048
    ),

  --   pending   waiting to be fetched; this is the queue
  --   fetching  leased by a worker
  --   fetched   the server answered — any status, including 404 and 500
  --   failed    no answer: timeout, connection, too large, too many redirects
  --   refused   the URL policy would not request it
  --   skipped   not requested by choice: robots.txt, or a limit was reached
  state text not null default 'pending'
    constraint crawl_pages_state_valid
      check (state in ('pending', 'fetching', 'fetched', 'failed', 'refused', 'skipped')),

  attempt_count integer not null default 0
    constraint crawl_pages_attempt_count_sane check (attempt_count >= 0),
  max_attempts integer not null default 3
    constraint crawl_pages_max_attempts_sane check (max_attempts between 1 and 10),

  -- Held only while state = 'fetching'. A worker that dies leaves a lease that
  -- expires, and recovery puts the row back in the queue.
  lease_token uuid,
  lease_expires_at timestamptz,
  constraint crawl_pages_lease_only_while_fetching check (
    (state = 'fetching') = (lease_token is not null)
    and (lease_token is null) = (lease_expires_at is null)
  ),

  -- What was observed. All null until there is something to record.
  http_status integer
    constraint crawl_pages_http_status_sane check (
      http_status is null or http_status between 100 and 599
    ),
  -- Where the request ended up, when it differs from `url` or simply confirms it.
  final_url text
    constraint crawl_pages_final_url_shape check (
      final_url is null or (final_url ~ '^https?://' and char_length(final_url) <= 2048)
    ),
  -- The hops, as observed: [{ "url": …, "status": …, "location": … }].
  redirects jsonb not null default '[]'::jsonb
    constraint crawl_pages_redirects_shape check (jsonb_typeof(redirects) = 'array'),
  content_type text
    constraint crawl_pages_content_type_length check (
      content_type is null or char_length(content_type) <= 255
    ),
  bytes integer constraint crawl_pages_bytes_sane check (bytes is null or bytes >= 0),
  duration_ms integer
    constraint crawl_pages_duration_sane check (duration_ms is null or duration_ms >= 0),

  -- Why there is no body, from src/types/crawl.ts. Fixed codes, never text a
  -- server sent: these rows outlive the request and an error string can quote
  -- a URL or a header.
  failure text
    constraint crawl_pages_failure_valid check (
      failure is null or failure in (
        'refused', 'timeout', 'network', 'too-many-redirects',
        'redirect-refused', 'too-large', 'unsupported-type',
        'robots-disallowed', 'lease-expired'
      )
    ),
  refusal text
    constraint crawl_pages_refusal_valid check (
      refusal is null or refusal in (
        'scheme', 'credentials', 'port', 'ip-literal', 'hostname',
        'too-long', 'private-address', 'dns', 'off-site'
      )
    ),
  -- Why a page was deliberately not requested.
  skip_reason text
    constraint crawl_pages_skip_reason_valid check (
      skip_reason is null or skip_reason in ('robots-disallowed', 'page-limit')
    ),

  discovered_at timestamptz not null default now(),
  fetched_at timestamptz,
  updated_at timestamptz not null default now(),

  primary key (crawl_id, url)
);

comment on table public.crawl_pages is
  'One row per discovered URL: the queue, and what the URL answered. Facts only.';
comment on column public.crawl_pages.state is
  'pending is the frontier; fetched means the server answered, whatever the status.';

-- The queue read: the next pending rows for one crawl.
create index crawl_pages_pending on public.crawl_pages (crawl_id, discovered_at)
  where state = 'pending';
-- Recovery: leases that have lapsed, across every crawl.
create index crawl_pages_expired_leases on public.crawl_pages (lease_expires_at)
  where state = 'fetching';

create trigger crawl_pages_set_updated_at
  before update on public.crawl_pages
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Counters on the parent crawl
-- ---------------------------------------------------------------------------

-- Kept by the database rather than by whichever worker happened to finish a
-- batch: the panel reads one row, and two workers recording at once cannot
-- leave the totals disagreeing with the rows.
create function public.crawl_pages_count_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_fetched integer := 0;
  v_failed integer := 0;
  v_skipped integer := 0;
begin
  if tg_op = 'INSERT' then
    v_total := 1;
  elsif tg_op = 'DELETE' then
    v_total := -1;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.state = 'fetched' then v_fetched := v_fetched + 1; end if;
    if new.state = 'failed' then v_failed := v_failed + 1; end if;
    if new.state in ('refused', 'skipped') then v_skipped := v_skipped + 1; end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    if old.state = 'fetched' then v_fetched := v_fetched - 1; end if;
    if old.state = 'failed' then v_failed := v_failed - 1; end if;
    if old.state in ('refused', 'skipped') then v_skipped := v_skipped - 1; end if;
  end if;

  if v_total <> 0 or v_fetched <> 0 or v_failed <> 0 or v_skipped <> 0 then
    update public.crawls
       set pages_total = pages_total + v_total,
           pages_fetched = pages_fetched + v_fetched,
           pages_failed = pages_failed + v_failed,
           pages_skipped = pages_skipped + v_skipped
     where id = coalesce(new.crawl_id, old.crawl_id);
  end if;

  return null;
end;
$$;

create trigger crawl_pages_maintain_counts
  after insert or update or delete on public.crawl_pages
  for each row
  execute function public.crawl_pages_count_change();

-- ---------------------------------------------------------------------------
-- Claiming and recovery
-- ---------------------------------------------------------------------------

-- Leases a batch of pending pages for one crawl.
--
-- `for update skip locked` so overlapping workers take disjoint batches rather
-- than blocking on each other or, worse, fetching the same page twice. The
-- lease token comes back with each row and every recording is checked against
-- it, so a worker whose lease lapsed cannot write a result afterwards.
create function public.crawl_pages_claim(
  p_crawl_id uuid,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.crawl_pages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'crawl_pages_claim: the batch must be 1 to 100 pages'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 1 and 900 then
    raise exception 'crawl_pages_claim: the lease must be 1 to 900 seconds'
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  with due as (
    select p.crawl_id, p.url
      from public.crawl_pages p
     where p.crawl_id = p_crawl_id
       and p.state = 'pending'
       and p.attempt_count < p.max_attempts
     order by p.discovered_at, p.url
     limit p_limit
       for update skip locked
  )
  update public.crawl_pages target
     set state = 'fetching',
         attempt_count = target.attempt_count + 1,
         lease_token = v_token,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from due
   where target.crawl_id = due.crawl_id and target.url = due.url
  returning target.*;
end;
$$;

-- Puts lapsed leases back in the queue, or ends them when no attempt remains.
--
-- Idempotent and safe to run repeatedly: it only touches rows whose lease has
-- already expired, and a worker still holding a live lease is never disturbed.
create function public.crawl_pages_recover_expired(p_crawl_id uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recovered integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'crawl_pages_recover_expired: the limit must be 1 to 500'
      using errcode = 'invalid_parameter_value';
  end if;

  with lapsed as (
    select p.crawl_id, p.url
      from public.crawl_pages p
     where (p_crawl_id is null or p.crawl_id = p_crawl_id)
       and p.state = 'fetching'
       and p.lease_expires_at < now()
     order by p.lease_expires_at
     limit p_limit
       for update skip locked
  )
  update public.crawl_pages target
     set state = case
                   when target.attempt_count >= target.max_attempts then 'failed'
                   else 'pending'
                 end,
         failure = case
                     when target.attempt_count >= target.max_attempts then 'lease-expired'
                     else target.failure
                   end,
         fetched_at = case
                        when target.attempt_count >= target.max_attempts then now()
                        else target.fetched_at
                      end,
         lease_token = null,
         lease_expires_at = null
    from lapsed
   where target.crawl_id = lapsed.crawl_id and target.url = lapsed.url;

  get diagnostics v_recovered = row_count;
  return v_recovered;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.crawl_pages enable row level security;

revoke all on function public.crawl_pages_claim(uuid, integer, integer) from public;
revoke all on function public.crawl_pages_recover_expired(uuid, integer) from public;
revoke all on function public.crawl_pages_count_change() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.crawl_pages to service_role;
    grant execute on function public.crawl_pages_claim(uuid, integer, integer) to service_role;
    grant execute on function public.crawl_pages_recover_expired(uuid, integer) to service_role;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.crawl_pages from anon;
    revoke all on function public.crawl_pages_claim(uuid, integer, integer) from anon;
    revoke all on function public.crawl_pages_recover_expired(uuid, integer) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.crawl_pages from authenticated;
    revoke all on function public.crawl_pages_claim(uuid, integer, integer) from authenticated;
    revoke all on function public.crawl_pages_recover_expired(uuid, integer) from authenticated;
  end if;
end
$$;
