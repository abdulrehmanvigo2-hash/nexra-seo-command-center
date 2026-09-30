-- The legacy, unprefixed crawl subsystem as production holds it (read-only from production, 30 Sep): the five tables
-- with their keys, foreign keys, triggers and grants, the four functions with their signatures, security and grants,
-- and 135 rows (crawls 9, crawl_pages 43, crawl_urls 43, crawl_page_signals 40, crawl_links 0). Column lists are
-- trimmed to what the keys, triggers and counts need; bodies are stand-ins. Part of the local PostgreSQL test harness;
-- run only through supabase/tests/run.sh. Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create table public.crawls (
  id uuid primary key default gen_random_uuid(),
  project_id text not null constraint crawls_project_id_fkey references public.projects (id) on delete restrict,
  site text not null, status text not null default 'queued',
  created_at timestamptz not null default now(), finished_at timestamptz, updated_at timestamptz not null default now(),
  pages_total integer not null default 0);
create index crawls_project_recent on public.crawls (project_id, created_at desc);
create table public.crawl_urls (
  crawl_id uuid not null constraint crawl_urls_crawl_id_fkey references public.crawls (id) on delete cascade,
  url text not null, source text not null, discovered_at timestamptz not null default now(),
  primary key (crawl_id, url));
create table public.crawl_pages (
  crawl_id uuid not null constraint crawl_pages_crawl_id_fkey references public.crawls (id) on delete cascade,
  url text not null, state text not null default 'pending', fetched_at timestamptz, updated_at timestamptz not null default now(),
  primary key (crawl_id, url));
create table public.crawl_page_signals (
  crawl_id uuid not null, url text not null, state text not null, parsed_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (crawl_id, url),
  constraint crawl_page_signals_crawl_id_url_fkey foreign key (crawl_id, url) references public.crawl_pages (crawl_id, url) on delete cascade);
create index crawl_page_signals_parsed on public.crawl_page_signals (crawl_id) where state = 'parsed';
create table public.crawl_links (
  id uuid primary key default gen_random_uuid(),
  crawl_id uuid not null constraint crawl_links_crawl_fkey references public.crawls (id) on delete cascade,
  from_url text not null, to_url text not null, is_internal boolean not null, discovered_at timestamptz not null default now());
create index crawl_links_crawl_to_idx on public.crawl_links (crawl_id, to_url);

create function public.crawls_guard_update() returns trigger language plpgsql set search_path = '' as $$ begin return new; end $$;
create function public.crawl_pages_count_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin update public.crawls set pages_total = pages_total where id = coalesce(new.crawl_id, old.crawl_id); return null; end $$;
create function public.crawl_pages_claim(p_crawl uuid, p_limit integer, p_lease integer) returns setof public.crawl_pages
  language plpgsql security definer set search_path = '' as $$ begin return query select * from public.crawl_pages where crawl_id = p_crawl limit p_limit; end $$;
create function public.crawl_pages_recover_expired(p_crawl uuid, p_limit integer) returns integer
  language plpgsql security definer set search_path = '' as $$ begin return 0; end $$;

create trigger crawls_set_updated_at before update on public.crawls for each row execute function public.set_updated_at();
create trigger crawls_guard_update before update on public.crawls for each row execute function public.crawls_guard_update();
create trigger crawl_pages_set_updated_at before update on public.crawl_pages for each row execute function public.set_updated_at();
create trigger crawl_pages_maintain_counts after insert or delete or update on public.crawl_pages for each row execute function public.crawl_pages_count_change();
create trigger crawl_page_signals_set_updated_at before update on public.crawl_page_signals for each row execute function public.set_updated_at();

alter table public.crawls enable row level security;
alter table public.crawl_urls enable row level security;
alter table public.crawl_pages enable row level security;
alter table public.crawl_page_signals enable row level security;
alter table public.crawl_links enable row level security;
revoke all on function public.crawl_pages_count_change() from public;
revoke all on function public.crawl_pages_claim(uuid, integer, integer) from public;
revoke all on function public.crawl_pages_recover_expired(uuid, integer) from public;
grant execute on function public.crawl_pages_claim(uuid, integer, integer), public.crawl_pages_recover_expired(uuid, integer) to service_role;
grant all on public.crawls, public.crawl_urls, public.crawl_pages, public.crawl_page_signals to service_role;
grant truncate, references, trigger on public.crawl_links to anon, authenticated, service_role;

-- 135 rows: 9 crawls; 43 urls and 43 pages over the first crawl; 40 signals over 40 of those pages.
insert into public.crawls (id, project_id, site)
  select ('11000000-0000-4000-8000-00000000000' || n)::uuid, 'halcyon-fintech', 'halcyon.example' from generate_series(1, 9) n;
insert into public.crawl_urls (crawl_id, url, source)
  select '11000000-0000-4000-8000-000000000001', 'https://halcyon.example/p' || n, 'homepage' from generate_series(1, 43) n;
insert into public.crawl_pages (crawl_id, url, state)
  select '11000000-0000-4000-8000-000000000001', 'https://halcyon.example/p' || n, 'fetched' from generate_series(1, 43) n;
insert into public.crawl_page_signals (crawl_id, url, state)
  select '11000000-0000-4000-8000-000000000001', 'https://halcyon.example/p' || n, 'parsed' from generate_series(1, 40) n;
