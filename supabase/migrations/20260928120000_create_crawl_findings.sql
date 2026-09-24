-- Crawl findings: the deterministic rules' observations over one crawl,
-- recorded once when the crawl finishes (Technical SEO + On-Page SEO,
-- checkpoint T3).
--
-- WHY. The findings library (src/lib/crawl/findings) applies fixed rules to
-- what a crawl recorded — a page's title, its status, an edge between two of
-- its pages — and yields the same findings for the same crawl every time.
-- Until now they were computed on demand and kept nowhere. Recording them
-- lets the product show what a crawl found, lets an agent be handed exactly
-- what was recorded, and lets a later crawl be compared with an earlier one.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000: the unprefixed crawl names belong to a separate live
-- subsystem this repository never touches. Nothing here names it.
--
-- WHAT IS RECORDED. One report per crawl and rule version — its coverage
-- (pages recorded, fetched, not fetched, not reached; link edges read and
-- whether that read was cut), the true count per rule, which rules were cut
-- to the library's per-rule ceiling — and under it one row per finding: the
-- library's stable key, rule, category, severity, the URLs it names (at most
-- 25, with the true count), the exact observed values as JSON scalars, one
-- sentence, and its position in the report's fixed order. Nothing here is a
-- site-wide total, an indexation status, a vital or a ranking; the columns
-- for those do not exist, which is the only reliable way to stop one being
-- stored.
--
-- BOUND TO A FINISHED CRAWL OF THE PROJECT. A report names its crawl and
-- its project, and an insert trigger checks that the crawl is that project's
-- and finished in a reviewable state (completed or partial); a finding must
-- name the same crawl and project as its report. The record function makes
-- the same checks first and answers `not-found`, `wrong-project` or
-- `not-reviewable` without writing.
--
-- ONE REPORT PER CRAWL AND RULE VERSION. The unique key makes a repeated
-- recording a no-op (`exists`) and lets two concurrent recordings produce
-- exactly one report: the second waits on the first and then conflicts.
-- A new rule version may record again beside the old report; the old one is
-- never changed.
--
-- IMMUTABLE. A report and its findings are observations of a crawl: never
-- updated, never truncated, and deleted only with their crawl (the cascade a
-- crawl's own deletion runs), never directly.
--
-- HOW IT IS WRITTEN. Only through `nexra_crawl_findings_record` (`security
-- definer`, `search_path` pinned empty), in one transaction. service_role is
-- granted SELECT on both tables and EXECUTE on that function, nothing else;
-- `anon` and `authenticated` get nothing. Row level security is enabled with
-- no policies. Additive: no existing table, column, function, trigger or
-- grant is changed.

-- ---------------------------------------------------------------------------
-- Validators, created before the tables so their constraints can name them.

-- An object of JSON scalars: at most `max_keys` keys, each a short identifier,
-- each value a string of at most `max_text` characters, a number, a boolean
-- or null. What a finding observed, and what a report counted, both fit this.
create function public.nexra_crawl_findings_scalars_valid(value jsonb, max_keys integer, max_text integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_item jsonb;
  v_type text;
begin
  if value is null or pg_catalog.jsonb_typeof(value) <> 'object' then return false; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(value)) > max_keys then return false; end if;
  for v_key, v_item in select * from pg_catalog.jsonb_each(value) loop
    if v_key !~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' then return false; end if;
    v_type := pg_catalog.jsonb_typeof(v_item);
    if v_type = 'string' then
      if pg_catalog.length(v_item #>> '{}') > max_text then return false; end if;
    elsif v_type not in ('number', 'boolean', 'null') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- A rule count map: rule id → positive whole number.
create function public.nexra_crawl_findings_counts_valid(counts jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_item jsonb;
begin
  if counts is null or pg_catalog.jsonb_typeof(counts) <> 'object' then return false; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(counts)) > 64 then return false; end if;
  for v_key, v_item in select * from pg_catalog.jsonb_each(counts) loop
    if v_key !~ '^[a-z][a-z0-9-]{2,63}$' then return false; end if;
    if pg_catalog.jsonb_typeof(v_item) <> 'number' then return false; end if;
    if (v_item #>> '{}')::numeric < 1 or (v_item #>> '{}')::numeric <> pg_catalog.floor((v_item #>> '{}')::numeric) then return false; end if;
  end loop;
  return true;
end;
$$;

-- The URLs a finding names: one to 25 distinct http(s) URLs of at most 2048 characters.
create function public.nexra_crawl_findings_urls_valid(urls text[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_url text;
  v_seen text[] := '{}';
begin
  if urls is null or pg_catalog.cardinality(urls) < 1 or pg_catalog.cardinality(urls) > 25 then return false; end if;
  foreach v_url in array urls loop
    if v_url is null or v_url !~ '^https?://' or pg_catalog.char_length(v_url) > 2048 then return false; end if;
    if v_url = any (v_seen) then return false; end if;
    v_seen := v_seen || v_url;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------

create table public.nexra_crawl_findings_reports (
  id uuid primary key default gen_random_uuid(),

  crawl_id uuid not null
    constraint nexra_crawl_findings_reports_crawl_fkey references public.nexra_crawls (id) on delete cascade,
  project_id text not null
    constraint nexra_crawl_findings_reports_project_fkey references public.projects (id) on delete restrict,

  -- Which version of the rules produced this report.
  rule_version smallint not null
    constraint nexra_crawl_findings_reports_rule_version_range check (rule_version between 1 and 32767),

  -- Coverage: what the rules could and could not look at.
  pages_total integer not null
    constraint nexra_crawl_findings_reports_pages_total_range check (pages_total between 0 and 100000),
  pages_fetched integer not null
    constraint nexra_crawl_findings_reports_pages_fetched_range check (pages_fetched between 0 and 100000),
  pages_not_fetched integer not null
    constraint nexra_crawl_findings_reports_pages_not_fetched_range check (pages_not_fetched between 0 and 100000),
  pages_not_reached integer not null
    constraint nexra_crawl_findings_reports_pages_not_reached_range check (pages_not_reached between 0 and 100000),
  constraint nexra_crawl_findings_reports_pages_sum check (pages_fetched + pages_not_fetched + pages_not_reached = pages_total),
  links_read integer not null
    constraint nexra_crawl_findings_reports_links_read_range check (links_read between 0 and 1000000),
  links_cut boolean not null default false,

  -- The true totals, before any per-rule ceiling.
  findings_total integer not null
    constraint nexra_crawl_findings_reports_findings_total_range check (findings_total between 0 and 1000000),
  counts jsonb not null default '{}'::jsonb
    constraint nexra_crawl_findings_reports_counts_valid check (public.nexra_crawl_findings_counts_valid(counts)),
  truncated_rules text[] not null default '{}'
    constraint nexra_crawl_findings_reports_truncated_rules_range check (pg_catalog.cardinality(truncated_rules) <= 64),

  recorded_at timestamptz not null default now(),

  constraint nexra_crawl_findings_reports_one_per_version unique (crawl_id, rule_version)
);

comment on table public.nexra_crawl_findings_reports is
  'One recording of the deterministic findings rules over one finished crawl of a project: coverage and true counts. Immutable; deleted only with its crawl. Never an indexation status, a vital or a ranking.';

create index nexra_crawl_findings_reports_project_idx
  on public.nexra_crawl_findings_reports (project_id, recorded_at desc);

create table public.nexra_crawl_findings (
  id uuid primary key default gen_random_uuid(),

  report_id uuid not null
    constraint nexra_crawl_findings_report_fkey references public.nexra_crawl_findings_reports (id) on delete cascade,
  crawl_id uuid not null
    constraint nexra_crawl_findings_crawl_fkey references public.nexra_crawls (id) on delete cascade,
  project_id text not null
    constraint nexra_crawl_findings_project_fkey references public.projects (id) on delete restrict,

  -- The library's stable identity: rule, a colon, sixteen hex characters.
  finding_key text not null
    constraint nexra_crawl_findings_key_format check (finding_key ~ '^[a-z][a-z0-9-]{2,63}:[0-9a-f]{16}$'),
  rule text not null
    constraint nexra_crawl_findings_rule_format check (rule ~ '^[a-z][a-z0-9-]{2,63}$'),
  constraint nexra_crawl_findings_key_names_rule check (pg_catalog.split_part(finding_key, ':', 1) = rule),
  category text not null
    constraint nexra_crawl_findings_category_valid check (category in ('metadata', 'headings', 'canonical', 'http', 'redirects', 'links', 'indexability', 'sitemap', 'structure', 'schema')),
  severity text not null
    constraint nexra_crawl_findings_severity_valid check (severity in ('critical', 'high', 'medium', 'low')),

  -- The pages the finding is about (at most 25) and how many it is really about.
  urls text[] not null
    constraint nexra_crawl_findings_urls_valid check (public.nexra_crawl_findings_urls_valid(urls)),
  url_count integer not null
    constraint nexra_crawl_findings_url_count_range check (url_count >= pg_catalog.cardinality(urls) and url_count <= 100000),

  -- Exactly what the crawl recorded that triggered the rule: scalars only.
  observed jsonb not null
    constraint nexra_crawl_findings_observed_valid check (public.nexra_crawl_findings_scalars_valid(observed, 40, 4096)),
  message text not null
    constraint nexra_crawl_findings_message_length check (pg_catalog.char_length(message) between 1 and 500),

  -- The finding's place in the report's fixed order (severity, rule, URL).
  ordinal integer not null
    constraint nexra_crawl_findings_ordinal_range check (ordinal between 0 and 1000000),

  -- One finding per key within a report; another rule version's report may hold the same key.
  constraint nexra_crawl_findings_one_per_key unique (report_id, finding_key),
  constraint nexra_crawl_findings_one_per_ordinal unique (report_id, ordinal)
);

comment on table public.nexra_crawl_findings is
  'One observation by one fixed rule over one finished crawl: the rule, the pages it names and exactly what the crawl recorded. Immutable; deleted only with its crawl.';

create index nexra_crawl_findings_report_idx
  on public.nexra_crawl_findings (report_id, ordinal);
create index nexra_crawl_findings_project_rule_idx
  on public.nexra_crawl_findings (project_id, rule);

-- ---------------------------------------------------------------------------
-- Binding: a report is of a finished crawl of its own project; a finding is
-- of its report's crawl and project. Checked for every writer.

create function public.nexra_crawl_findings_reports_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_crawl public.nexra_crawls;
begin
  select * into v_crawl from public.nexra_crawls where id = new.crawl_id;
  if v_crawl.id is null then
    raise exception 'nexra_crawl_findings_reports: crawl % is not stored', new.crawl_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_crawl.project_id <> new.project_id then
    raise exception 'nexra_crawl_findings_reports: crawl % belongs to project %, not %', new.crawl_id, v_crawl.project_id, new.project_id
      using errcode = 'check_violation';
  end if;
  if v_crawl.status not in ('completed', 'partial') then
    raise exception 'nexra_crawl_findings_reports: crawl % is %, not a finished, reviewable crawl', new.crawl_id, v_crawl.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_crawl_findings_reports_check_insert
  before insert on public.nexra_crawl_findings_reports
  for each row
  execute function public.nexra_crawl_findings_reports_check_insert();

create function public.nexra_crawl_findings_check_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_report public.nexra_crawl_findings_reports;
begin
  select * into v_report from public.nexra_crawl_findings_reports where id = new.report_id;
  if v_report.id is null then
    raise exception 'nexra_crawl_findings: report % is not stored', new.report_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_report.crawl_id <> new.crawl_id or v_report.project_id <> new.project_id then
    raise exception 'nexra_crawl_findings: a finding must name its report''s crawl and project'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_crawl_findings_check_insert
  before insert on public.nexra_crawl_findings
  for each row
  execute function public.nexra_crawl_findings_check_insert();

-- ---------------------------------------------------------------------------
-- Immutability: never updated, never truncated, deleted only by the cascade
-- a crawl's deletion runs. Inside this trigger pg_trigger_depth() is 1 for a
-- direct DELETE; a cascade runs the DELETE from inside the referential
-- action's own trigger, so this guard then fires at depth 2 or more.

create function public.nexra_crawl_findings_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '%: a recorded finding is an immutable observation; it is never changed and is removed only with its crawl', tg_table_name
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_crawl_findings_reports_guard_update
  before update on public.nexra_crawl_findings_reports
  for each row execute function public.nexra_crawl_findings_guard_write();
create trigger nexra_crawl_findings_reports_guard_delete
  before delete on public.nexra_crawl_findings_reports
  for each row execute function public.nexra_crawl_findings_guard_write();
create trigger nexra_crawl_findings_reports_guard_truncate
  before truncate on public.nexra_crawl_findings_reports
  for each statement execute function public.nexra_crawl_findings_guard_write();

create trigger nexra_crawl_findings_guard_update
  before update on public.nexra_crawl_findings
  for each row execute function public.nexra_crawl_findings_guard_write();
create trigger nexra_crawl_findings_guard_delete
  before delete on public.nexra_crawl_findings
  for each row execute function public.nexra_crawl_findings_guard_write();
create trigger nexra_crawl_findings_guard_truncate
  before truncate on public.nexra_crawl_findings
  for each statement execute function public.nexra_crawl_findings_guard_write();

-- ---------------------------------------------------------------------------
-- Recording: the one write. Every argument is required. The crawl must be
-- stored (`not-found`), the project's (`wrong-project`) and finished in a
-- reviewable state (`not-reviewable`); each finding's shape is checked by the
-- table's constraints, which raise check_violation for any writer and roll
-- the whole recording back. A report already recorded for the crawl and rule
-- version answers `exists` with the stored report and writes nothing; two
-- recordings racing on the same crawl serialise on the unique key, so
-- exactly one is `created`.

create function public.nexra_crawl_findings_record(
  p_project_id text,
  p_crawl_id uuid,
  p_rule_version smallint,
  p_pages_total integer,
  p_pages_fetched integer,
  p_pages_not_fetched integer,
  p_pages_not_reached integer,
  p_links_read integer,
  p_links_cut boolean,
  p_counts jsonb,
  p_truncated_rules text[],
  p_findings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crawl public.nexra_crawls;
  v_report public.nexra_crawl_findings_reports;
  v_finding jsonb;
  v_ordinal integer := 0;
  v_urls text[];
begin
  if p_project_id is null or p_crawl_id is null or p_rule_version is null or p_pages_total is null
    or p_pages_fetched is null or p_pages_not_fetched is null or p_pages_not_reached is null
    or p_links_read is null or p_links_cut is null or p_counts is null or p_truncated_rules is null
    or p_findings is null
  then
    raise exception 'nexra_crawl_findings_record: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;
  if pg_catalog.jsonb_typeof(p_findings) <> 'array' or pg_catalog.jsonb_array_length(p_findings) > 5000 then
    raise exception 'nexra_crawl_findings_record: findings must be an array of at most 5000'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_crawl from public.nexra_crawls where id = p_crawl_id;
  if v_crawl.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'not-found');
  end if;
  if v_crawl.project_id <> p_project_id then
    return pg_catalog.jsonb_build_object('outcome', 'wrong-project');
  end if;
  if v_crawl.status not in ('completed', 'partial') then
    return pg_catalog.jsonb_build_object('outcome', 'not-reviewable', 'status', v_crawl.status);
  end if;

  insert into public.nexra_crawl_findings_reports
    (crawl_id, project_id, rule_version, pages_total, pages_fetched, pages_not_fetched, pages_not_reached,
     links_read, links_cut, findings_total, counts, truncated_rules)
  values
    (p_crawl_id, p_project_id, p_rule_version, p_pages_total, p_pages_fetched, p_pages_not_fetched, p_pages_not_reached,
     p_links_read, p_links_cut,
     (select coalesce(pg_catalog.sum((value #>> '{}')::numeric), 0)::integer from pg_catalog.jsonb_each(p_counts)),
     p_counts, p_truncated_rules)
  on conflict on constraint nexra_crawl_findings_reports_one_per_version do nothing
  returning * into v_report;

  if v_report.id is null then
    select * into v_report from public.nexra_crawl_findings_reports
     where crawl_id = p_crawl_id and rule_version = p_rule_version;
    return pg_catalog.jsonb_build_object('outcome', 'exists', 'report', pg_catalog.to_jsonb(v_report));
  end if;

  for v_finding in select * from pg_catalog.jsonb_array_elements(p_findings) loop
    if pg_catalog.jsonb_typeof(v_finding -> 'urls') <> 'array' then
      raise exception 'nexra_crawl_findings_record: finding % has no urls array', v_ordinal
        using errcode = 'invalid_parameter_value';
    end if;
    select coalesce(pg_catalog.array_agg(u), '{}') into v_urls from pg_catalog.jsonb_array_elements_text(v_finding -> 'urls') u;
    insert into public.nexra_crawl_findings
      (report_id, crawl_id, project_id, finding_key, rule, category, severity, urls, url_count, observed, message, ordinal)
    values
      (v_report.id, p_crawl_id, p_project_id,
       v_finding ->> 'key', v_finding ->> 'rule', v_finding ->> 'category', v_finding ->> 'severity',
       v_urls, (v_finding ->> 'urlCount')::integer, v_finding -> 'observed', v_finding ->> 'message', v_ordinal);
    v_ordinal := v_ordinal + 1;
  end loop;

  return pg_catalog.jsonb_build_object('outcome', 'created', 'report', pg_catalog.to_jsonb(v_report), 'findings', v_ordinal);
end;
$$;

comment on function public.nexra_crawl_findings_record(text, uuid, smallint, integer, integer, integer, integer, integer, boolean, jsonb, text[], jsonb) is
  'Records the deterministic findings of one finished crawl of a project, once per rule version: created, exists (already recorded; nothing written), not-found, wrong-project or not-reviewable. Every finding''s shape is enforced by the table''s constraints.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads both tables and executes the record function.
-- Nothing else, for anyone.

alter table public.nexra_crawl_findings_reports enable row level security;
alter table public.nexra_crawl_findings enable row level security;

revoke all on function public.nexra_crawl_findings_record(text, uuid, smallint, integer, integer, integer, integer, integer, boolean, jsonb, text[], jsonb) from public;
revoke all on function public.nexra_crawl_findings_scalars_valid(jsonb, integer, integer) from public;
revoke all on function public.nexra_crawl_findings_counts_valid(jsonb) from public;
revoke all on function public.nexra_crawl_findings_urls_valid(text[]) from public;
revoke all on function public.nexra_crawl_findings_reports_check_insert() from public;
revoke all on function public.nexra_crawl_findings_check_insert() from public;
revoke all on function public.nexra_crawl_findings_guard_write() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_crawl_findings_reports from %I', v_role);
      execute format('revoke all on table public.nexra_crawl_findings from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_findings_record(text, uuid, smallint, integer, integer, integer, integer, integer, boolean, jsonb, text[], jsonb) from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_findings_scalars_valid(jsonb, integer, integer) from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_findings_counts_valid(jsonb) from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_findings_urls_valid(text[]) from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_findings_reports_check_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_findings_check_insert() from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_findings_guard_write() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_crawl_findings_reports to service_role;
    grant select on table public.nexra_crawl_findings to service_role;
    grant execute on function public.nexra_crawl_findings_record(text, uuid, smallint, integer, integer, integer, integer, integer, boolean, jsonb, text[], jsonb) to service_role;
  end if;
end
$$;
