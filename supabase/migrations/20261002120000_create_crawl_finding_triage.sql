-- Crawl finding triage: an operator's standing decision about one recorded
-- finding — open, acknowledged, resolved or ignored, with an optional note
-- (Technical SEO + On-Page SEO, milestone M3).
--
-- WHY. A recorded finding (20260928120000) is an immutable observation: what
-- fixed rules found in what one crawl fetched. An operator's decision about
-- it — "seen", "fixed on the site, confirm on the next crawl", "not worth
-- acting on" — is a different kind of thing, mutable and theirs, and it must
-- never be written into the observation. It lives here, in its own table,
-- beside the evidence and never inside it.
--
-- NAMING. Every object carries the `nexra_` prefix, for the reason given in
-- 20260920120000: the unprefixed crawl names belong to a separate live
-- subsystem this repository never touches. Nothing here names it.
--
-- ONE DECISION PER PROJECT AND FINDING KEY. The findings library gives a
-- finding a stable key (rule plus a digest of the URLs it names), the same
-- across every crawl of the same pages. Triage is keyed by the project and
-- that key, so a decision made on one crawl's finding still applies when a
-- later crawl records the same finding again — an operator does not re-triage
-- the same missing H1 every time the site is crawled. The row also names the
-- exact finding, report and crawl the decision was last made on, so it is
-- always traceable to one recorded observation.
--
-- WHAT IT IS NOT. Triage is a decision, not an observation, not a fix and not
-- a verdict about the site: `resolved` records that an operator says the
-- matter is dealt with, and the next crawl's findings — not this row — show
-- whether the page changed. Nothing here dispatches an agent, changes a page,
-- resolves anything automatically or expires.
--
-- HOW IT IS WRITTEN. Only through `nexra_crawl_finding_triage_set` (`security
-- definer`, `search_path` pinned empty), which finds the recorded finding by
-- project, crawl and key, refuses a finding that is not the project's or the
-- crawl's, and inserts or updates the one row under the unique key. The row's
-- identity (project, key, created_at) never changes; a row is never deleted
-- or truncated directly and goes only with the finding it was last set on.
-- service_role is granted SELECT on the table and EXECUTE on that function,
-- nothing else; `anon` and `authenticated` get nothing. Row level security is
-- enabled with no policies. Additive: no existing table, column, function,
-- trigger or grant is changed; the findings tables are not touched.

create table public.nexra_crawl_finding_triage (
  id uuid primary key default gen_random_uuid(),

  project_id text not null
    constraint nexra_crawl_finding_triage_project_fkey references public.projects (id) on delete restrict,

  -- The library's stable identity of the finding: rule, a colon, sixteen hex characters.
  finding_key text not null
    constraint nexra_crawl_finding_triage_key_format check (finding_key ~ '^[a-z][a-z0-9-]{2,63}:[0-9a-f]{16}$'),
  rule text not null
    constraint nexra_crawl_finding_triage_rule_format check (rule ~ '^[a-z][a-z0-9-]{2,63}$'),
  constraint nexra_crawl_finding_triage_key_names_rule check (pg_catalog.split_part(finding_key, ':', 1) = rule),

  -- The recorded observation the decision was last made on.
  finding_id uuid not null
    constraint nexra_crawl_finding_triage_finding_fkey references public.nexra_crawl_findings (id) on delete cascade,
  report_id uuid not null
    constraint nexra_crawl_finding_triage_report_fkey references public.nexra_crawl_findings_reports (id) on delete cascade,
  crawl_id uuid not null
    constraint nexra_crawl_finding_triage_crawl_fkey references public.nexra_crawls (id) on delete cascade,

  -- The operator's decision.
  status text not null
    constraint nexra_crawl_finding_triage_status_valid check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  note text
    constraint nexra_crawl_finding_triage_note_length check (note is null or pg_catalog.char_length(note) between 1 and 500),

  set_by uuid not null,
  set_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint nexra_crawl_finding_triage_one_per_key unique (project_id, finding_key)
);

comment on table public.nexra_crawl_finding_triage is
  'One operator decision per project and recorded finding key: open, acknowledged, resolved or ignored, with an optional note, and the exact finding, report and crawl it was last set on. A decision about an observation, never the observation; never a fix, a verdict about the site or an automatic resolution.';

create index nexra_crawl_finding_triage_project_status_idx
  on public.nexra_crawl_finding_triage (project_id, status);

-- ---------------------------------------------------------------------------
-- Binding: the decision names a recorded finding of its own project and key,
-- and that finding's report and crawl. Checked for every writer, on insert
-- and on every update.

create function public.nexra_crawl_finding_triage_check_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_finding public.nexra_crawl_findings;
begin
  select * into v_finding from public.nexra_crawl_findings where id = new.finding_id;
  if v_finding.id is null then
    raise exception 'nexra_crawl_finding_triage: finding % is not recorded', new.finding_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_finding.project_id <> new.project_id or v_finding.finding_key <> new.finding_key or v_finding.rule <> new.rule
    or v_finding.report_id <> new.report_id or v_finding.crawl_id <> new.crawl_id
  then
    raise exception 'nexra_crawl_finding_triage: a decision must name its own project''s recorded finding, that finding''s key, rule, report and crawl'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_crawl_finding_triage_check_insert
  before insert on public.nexra_crawl_finding_triage
  for each row
  execute function public.nexra_crawl_finding_triage_check_binding();

-- ---------------------------------------------------------------------------
-- Guards. An update may change the decision (status, note, who and when) and
-- the finding it was made on; never the row's identity, and never backwards
-- in time. A delete is refused unless it is the cascade a finding's own
-- removal runs (pg_trigger_depth() > 1); a truncate is always refused.

create function public.nexra_crawl_finding_triage_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.project_id <> old.project_id or new.finding_key <> old.finding_key
    or new.rule <> old.rule or new.created_at <> old.created_at
  then
    raise exception 'nexra_crawl_finding_triage: a decision''s identity (project, finding key, rule, created_at) never changes'
      using errcode = 'check_violation';
  end if;
  if new.set_at < old.set_at then
    raise exception 'nexra_crawl_finding_triage: a decision is never re-dated earlier than the one it replaces'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger nexra_crawl_finding_triage_guard_update
  before update on public.nexra_crawl_finding_triage
  for each row execute function public.nexra_crawl_finding_triage_guard_update();

-- The binding is re-checked on update as well, so a decision cannot be moved
-- onto another project's finding, or onto a finding with a different key.
create trigger nexra_crawl_finding_triage_check_update
  before update on public.nexra_crawl_finding_triage
  for each row
  execute function public.nexra_crawl_finding_triage_check_binding();

create function public.nexra_crawl_finding_triage_guard_remove()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'nexra_crawl_finding_triage: a decision is never deleted directly; it goes only with the finding it was set on'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_crawl_finding_triage_guard_delete
  before delete on public.nexra_crawl_finding_triage
  for each row execute function public.nexra_crawl_finding_triage_guard_remove();
create trigger nexra_crawl_finding_triage_guard_truncate
  before truncate on public.nexra_crawl_finding_triage
  for each statement execute function public.nexra_crawl_finding_triage_guard_remove();

-- ---------------------------------------------------------------------------
-- Setting a decision: the one write. The finding is found by the project's
-- own crawl and the finding's key, in the newest report recorded for that
-- crawl. A crawl that is not stored or not the project's answers `not-found`
-- (never which of the two); a key not recorded for that crawl answers
-- `not-recorded`; a status outside the four or a note over 500 characters
-- raises invalid_parameter_value and writes nothing. A blank note is stored
-- as null. The row is inserted or, under its unique key, updated in place, so
-- two operators deciding at once serialise on the key and the later write
-- wins; the answer carries the previous status so a caller can say what
-- changed.

create function public.nexra_crawl_finding_triage_set(
  p_project_id text,
  p_crawl_id uuid,
  p_finding_key text,
  p_status text,
  p_note text,
  p_operator uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_crawl public.nexra_crawls;
  v_finding public.nexra_crawl_findings;
  v_note text;
  v_previous text;
  v_row public.nexra_crawl_finding_triage;
begin
  if p_project_id is null or p_crawl_id is null or p_finding_key is null or p_status is null or p_operator is null then
    raise exception 'nexra_crawl_finding_triage_set: project, crawl, finding key, status and operator are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_status not in ('open', 'acknowledged', 'resolved', 'ignored') then
    raise exception 'nexra_crawl_finding_triage_set: status must be open, acknowledged, resolved or ignored'
      using errcode = 'invalid_parameter_value';
  end if;
  v_note := nullif(pg_catalog.btrim(p_note), '');
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    raise exception 'nexra_crawl_finding_triage_set: a note is at most 500 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_crawl from public.nexra_crawls where id = p_crawl_id;
  if v_crawl.id is null or v_crawl.project_id <> p_project_id then
    return pg_catalog.jsonb_build_object('outcome', 'not-found');
  end if;

  -- One decision at a time per project and key: a second operator waits for
  -- the first to commit, then reads the committed decision as the previous
  -- one. Without this, READ COMMITTED would let the second read "no decision"
  -- before blocking on the unique key, and answer a previous status of null
  -- for a row it then updated.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nexra_crawl_finding_triage:' || p_project_id), pg_catalog.hashtext(p_finding_key));

  select f.* into v_finding
    from public.nexra_crawl_findings f
    join public.nexra_crawl_findings_reports r on r.id = f.report_id
   where f.project_id = p_project_id and f.crawl_id = p_crawl_id and f.finding_key = p_finding_key
   order by r.rule_version desc
   limit 1;
  if v_finding.id is null then
    return pg_catalog.jsonb_build_object('outcome', 'not-recorded');
  end if;

  select status into v_previous from public.nexra_crawl_finding_triage
   where project_id = p_project_id and finding_key = p_finding_key;

  insert into public.nexra_crawl_finding_triage
    (project_id, finding_key, rule, finding_id, report_id, crawl_id, status, note, set_by, set_at)
  values
    (p_project_id, p_finding_key, v_finding.rule, v_finding.id, v_finding.report_id, v_finding.crawl_id, p_status, v_note, p_operator, now())
  on conflict on constraint nexra_crawl_finding_triage_one_per_key do update
    set finding_id = excluded.finding_id,
        report_id = excluded.report_id,
        crawl_id = excluded.crawl_id,
        status = excluded.status,
        note = excluded.note,
        set_by = excluded.set_by,
        set_at = greatest(excluded.set_at, nexra_crawl_finding_triage.set_at)
  returning * into v_row;

  return pg_catalog.jsonb_build_object('outcome', 'set', 'previous', v_previous, 'triage', pg_catalog.to_jsonb(v_row));
end;
$$;

comment on function public.nexra_crawl_finding_triage_set(text, uuid, text, text, text, uuid) is
  'Records an operator''s decision about one recorded finding of the project''s own crawl, by finding key: set (with the previous status, or null), not-found (no such crawl of this project) or not-recorded (no such finding recorded for that crawl). Never changes the finding.';

-- ---------------------------------------------------------------------------
-- Access: service_role reads the table and executes the set function.
-- Nothing else, for anyone.

alter table public.nexra_crawl_finding_triage enable row level security;

revoke all on function public.nexra_crawl_finding_triage_set(text, uuid, text, text, text, uuid) from public;
revoke all on function public.nexra_crawl_finding_triage_check_binding() from public;
revoke all on function public.nexra_crawl_finding_triage_guard_update() from public;
revoke all on function public.nexra_crawl_finding_triage_guard_remove() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on table public.nexra_crawl_finding_triage from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_finding_triage_set(text, uuid, text, text, text, uuid) from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_finding_triage_check_binding() from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_finding_triage_guard_update() from %I', v_role);
      execute format('revoke all on function public.nexra_crawl_finding_triage_guard_remove() from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.nexra_crawl_finding_triage to service_role;
    grant execute on function public.nexra_crawl_finding_triage_set(text, uuid, text, text, text, uuid) to service_role;
  end if;
end
$$;
