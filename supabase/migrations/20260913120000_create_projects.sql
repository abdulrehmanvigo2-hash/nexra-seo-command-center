-- Projects: the client engagements the agency runs.
--
-- One row per project, holding what the agency itself records about the
-- engagement — who it is for, what it targets, where it stands. Everything the
-- screens show beyond that (health scores, traffic, keywords, issues, tasks,
-- the assigned team) is reporting data, not part of the project record, and is
-- not stored here. Until a source for it exists it stays derived in the
-- application (see src/lib/projects/fixture-analytics.ts).
--
-- Deliberately absent:
--   * The mock analytics generator's inputs (scale, health offset, seed). They
--     are simulation parameters, not facts about a client, and do not belong in
--     a real database.
--   * The "All Projects" roll-up. It is a view over projects, not a project;
--     its id is reserved below so no row can impersonate it.
--   * Ownership or tenancy columns. There is no authentication yet, and a
--     column nobody can fill correctly is worse than adding it with the auth
--     work that gives it meaning.
--   * A separate settings table. A project's editable settings are a subset of
--     these columns, one-to-one with the row.

create table public.projects (
  -- A readable slug that doubles as the route segment: /projects/<id>.
  id text primary key
    constraint projects_id_format
      check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(id) between 2 and 64)
    constraint projects_id_not_reserved
      check (id <> 'portfolio'),

  name text not null
    constraint projects_name_length check (char_length(btrim(name)) between 2 and 120),
  client text not null
    constraint projects_client_length check (char_length(btrim(client)) between 1 and 120),

  -- Stored canonical — lower case, no scheme, no trailing slash — so one site
  -- cannot be registered twice under different spellings.
  domain text not null
    constraint projects_domain_key unique
    constraint projects_domain_canonical check (
      domain = lower(domain)
      and domain ~ '^([a-z0-9-]+\.)+[a-z]{2,}(/[^[:space:]]*)?$'
      and domain !~ '/$'
    ),

  -- Two-letter monogram. Stored rather than derived because it is editorial:
  -- "Atlas Industrial" is AT, not AI.
  initials text not null
    constraint projects_initials_length check (char_length(initials) between 1 and 3),

  industry text not null
    constraint projects_industry_length check (char_length(btrim(industry)) between 1 and 80),

  type text not null
    constraint projects_type_valid
      check (type in ('saas', 'ecommerce', 'local', 'lead-gen', 'publisher', 'enterprise', 'other')),
  status text not null default 'onboarding'
    constraint projects_status_valid
      check (status in ('active', 'onboarding', 'monitoring', 'paused', 'needs-attention')),
  goal text not null
    constraint projects_goal_valid
      check (goal in ('organic-traffic', 'leads', 'rankings', 'ecommerce-revenue', 'local-visibility', 'ai-visibility', 'technical-recovery')),

  market text not null
    constraint projects_market_length check (char_length(btrim(market)) between 1 and 80),
  language text not null
    constraint projects_language_length check (char_length(btrim(language)) between 1 and 80),
  target_location text not null
    constraint projects_target_location_length check (char_length(btrim(target_location)) between 1 and 120),

  summary text not null default ''
    constraint projects_summary_length check (char_length(summary) <= 500),

  -- What the intake form collects beyond the record itself: the rivals to
  -- track (at most five, canonical domains) and a note for the team. Kept on
  -- the row, not in tables of their own, because nothing yet reads them
  -- individually; when competitor tracking is persisted they move out.
  competitor_domains text[] not null default '{}'
    constraint projects_competitor_domains_count check (
      cardinality(competitor_domains) <= 5
      and array_position(competitor_domains, null) is null
    ),
  intake_notes text not null default ''
    constraint projects_intake_notes_length check (char_length(intake_notes) <= 2000),

  -- The day the engagement began. A date, because that is all it is.
  started_on date not null default current_date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.projects is
  'Client engagements. The project record only: reporting data is not stored here.';
comment on column public.projects.id is
  'Readable slug, also the /projects/<id> route segment. "portfolio" is reserved for the roll-up.';
comment on column public.projects.domain is
  'Canonical: lower case, no scheme, no trailing slash. Unique.';
comment on column public.projects.competitor_domains is
  'Rival domains entered at intake, canonical form, at most five.';

-- Keep updated_at honest on every change. Inserts keep the value they are
-- given, so imported history is preserved.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();

-- Access pattern today: every row for the roster, one row by id for a
-- workspace. The primary key and the unique domain index cover both; the table
-- is sized in the tens of rows, so nothing further is warranted yet.

-- Row level security with no policies: until authentication exists, no client
-- role can read or write this table. The application reads it on the server
-- with the service role, which bypasses RLS.
alter table public.projects enable row level security;
