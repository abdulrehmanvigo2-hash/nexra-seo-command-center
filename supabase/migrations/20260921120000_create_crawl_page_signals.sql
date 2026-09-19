-- On-page signals: what one fetched page's HTML says about itself.
--
-- A separate table from `crawl_pages` on purpose. That table is the queue and
-- the fetch record — state, leases, attempts, status codes — and it stays that
-- way. This is the analysis layer's first tenant: one row per page, holding
-- what the document declared, and nothing about whether any of it is good.
--
-- No scores, no issues, no recommendations. A page with no description has a
-- null description; deciding that this matters belongs to a later stage.
--
-- The raw HTML is deliberately absent. Signals are extracted from the response
-- body in memory, while the fetch pass still holds it, and the body is then
-- discarded. Storing megabytes of somebody else's markup would be a liability
-- and a cost for something only the extractor ever reads.
--
-- Additive: one new table, no change to any existing one.

create table public.crawl_page_signals (
  crawl_id uuid not null,
  url text not null,

  --   parsed    HTML, read successfully
  --   not-html  the server answered with something else — a fact, not a fault
  --   empty     HTML, but nothing in the body
  --   failed    the extractor could not finish
  state text not null
    constraint crawl_page_signals_state_valid
      check (state in ('parsed', 'not-html', 'empty', 'failed')),

  -- Null where the page did not carry the value. Never a placeholder: an
  -- absent title is absent, not an empty string.
  title text
    constraint crawl_page_signals_title_length check (title is null or char_length(title) <= 1000),
  meta_description text
    constraint crawl_page_signals_description_length
      check (meta_description is null or char_length(meta_description) <= 2000),
  -- As the document wrote it, unresolved: a canonical that points somewhere
  -- unexpected is a finding, and normalising it here would hide that.
  canonical_url text
    constraint crawl_page_signals_canonical_length
      check (canonical_url is null or char_length(canonical_url) <= 2048),
  -- The generic `robots` meta only, lower-cased.
  meta_robots text
    constraint crawl_page_signals_robots_length
      check (meta_robots is null or char_length(meta_robots) <= 255),

  -- Every heading found, in document order. A page with three h1s has three;
  -- picking one would already be a judgement.
  h1 jsonb not null default '[]'::jsonb
    constraint crawl_page_signals_h1_shape check (jsonb_typeof(h1) = 'array'),
  h2 jsonb not null default '[]'::jsonb
    constraint crawl_page_signals_h2_shape check (jsonb_typeof(h2) = 'array'),

  -- Null for anything but a parsed page: a word count of zero on a PDF would
  -- be a measurement nobody made.
  word_count integer
    constraint crawl_page_signals_word_count_sane check (word_count is null or word_count >= 0),
  internal_links integer
    constraint crawl_page_signals_internal_sane
      check (internal_links is null or internal_links >= 0),
  external_links integer
    constraint crawl_page_signals_external_sane
      check (external_links is null or external_links >= 0),
  -- Fragments, mailto/tel/javascript, and hrefs that do not parse. Counted
  -- rather than forced into internal or external, which neither one is.
  other_links integer
    constraint crawl_page_signals_other_sane check (other_links is null or other_links >= 0),

  parsed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Only a parsed page carries measurements.
  constraint crawl_page_signals_counts_only_when_parsed check (
    (state = 'parsed')
    or (word_count is null and internal_links is null
        and external_links is null and other_links is null)
  ),

  primary key (crawl_id, url),
  -- One signals row per page row, and it goes when the page does.
  foreign key (crawl_id, url)
    references public.crawl_pages (crawl_id, url) on delete cascade
);

comment on table public.crawl_page_signals is
  'Factual on-page signals per fetched page. No scores, no issues, no raw HTML.';
comment on column public.crawl_page_signals.canonical_url is
  'As written in the document, unresolved.';

-- The read the analysis layer will make: one crawl''s parsed pages.
create index crawl_page_signals_parsed on public.crawl_page_signals (crawl_id)
  where state = 'parsed';

create trigger crawl_page_signals_set_updated_at
  before update on public.crawl_page_signals
  for each row
  execute function public.set_updated_at();

alter table public.crawl_page_signals enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.crawl_page_signals to service_role;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.crawl_page_signals from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.crawl_page_signals from authenticated;
  end if;
end
$$;
