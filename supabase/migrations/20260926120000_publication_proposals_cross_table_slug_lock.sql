-- One active publication proposal per destination and slug, across BOTH proposal tables
-- (Stage 5, milestone C6, decision D3, Option A).
--
-- THE GAP THIS CLOSES. Draft proposals (`nexra_content_publication_proposals`,
-- 20260922140000) and article proposals (`nexra_article_publication_proposals`,
-- 20260925120000) each keep one active proposal per destination and slug with their own
-- partial unique index. No index spans two tables, the two propose functions lock
-- different parent rows, and the draft function never looks at article proposals. So an
-- article proposal followed by a draft proposal, or the two created at the same moment,
-- could both hold one destination and slug.
--
-- THE RULE. For every exact (destination, slug), at most one row with
-- `status = 'proposed'` exists across both tables. A withdrawn proposal stays in history and
-- reserves nothing.
--
-- HOW. A reservation is only ever created by an INSERT: neither table's update guard lets a
-- row change its destination or slug, or return from `withdrawn` to `proposed`, and
-- withdrawal only releases. So one BEFORE INSERT trigger on each table, sharing one function,
-- covers every way a reservation is made — through either propose function or a direct
-- privileged insert. For a row inserted as `proposed`, the function:
--
--   1. refuses a transaction that is not READ COMMITTED (0A000). Step 3 relies on each
--      statement seeing rows committed while step 2 waited; under REPEATABLE READ or
--      SERIALIZABLE the snapshot is older, so the check could pass wrongly. It fails closed;
--   2. takes a transaction-level advisory lock on (20260926, hashtext(destination/slug)).
--      Every insert of that destination and slug, in either table, queues here until the
--      holder commits or rolls back. The two-key form keeps these locks apart from any
--      single-key advisory lock elsewhere in the database. Two different pairs whose hashes
--      collide only wait for each other; the check below compares the exact values;
--   3. checks the OTHER table for an active proposal with the same destination and slug, and
--      raises unique_violation (23505) if one exists. Each table's own unique index still
--      refuses a duplicate within the table.
--
-- Both propose functions already turn unique_violation from their INSERT into
-- `slug-taken`, so neither function, nor any application code, changes. New draft-side
-- behaviour: a draft proposal is refused `slug-taken` while an active ARTICLE proposal holds
-- its destination and slug.
--
-- Lock order is always: the parent row (draft or article, taken by the propose function),
-- then this lock, then the unique index. Withdrawal takes neither; a proposal racing a
-- withdrawal sees the proposal still active until the withdrawal commits, and is refused
-- `slug-taken` — safe, and a retry succeeds.
--
-- Additive: one function, two triggers. No table, column, index, constraint, function body,
-- grant or row level security setting changes. The migration refuses to apply if any
-- destination and slug is already held in both tables; such a pair is never resolved
-- automatically.

do $$
declare
  v_pairs bigint;
begin
  select count(*) into v_pairs
    from (
      select destination, slug from public.nexra_content_publication_proposals where status = 'proposed'
      intersect
      select destination, slug from public.nexra_article_publication_proposals where status = 'proposed'
    ) duplicate;
  if v_pairs > 0 then
    raise exception 'nexra D3 preflight: % destination/slug pair(s) are held by both an active draft proposal and an active article proposal; withdraw one of each before applying', v_pairs
      using errcode = 'unique_violation';
  end if;
end
$$;

create function public.nexra_publication_proposals_reserve_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'nexra publication proposals: a proposal is created only in a READ COMMITTED transaction (this one is %)',
      pg_catalog.current_setting('transaction_isolation')
      using errcode = 'feature_not_supported';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(20260926, pg_catalog.hashtext(new.destination || '/' || new.slug));

  if tg_table_name = 'nexra_content_publication_proposals' then
    if exists (
      select 1 from public.nexra_article_publication_proposals
       where destination = new.destination and slug = new.slug and status = 'proposed'
    ) then
      raise exception 'nexra publication proposals: % / % is held by an active article proposal', new.destination, new.slug
        using errcode = 'unique_violation';
    end if;
  elsif tg_table_name = 'nexra_article_publication_proposals' then
    if exists (
      select 1 from public.nexra_content_publication_proposals
       where destination = new.destination and slug = new.slug and status = 'proposed'
    ) then
      raise exception 'nexra publication proposals: % / % is held by an active draft proposal', new.destination, new.slug
        using errcode = 'unique_violation';
    end if;
  else
    raise exception 'nexra_publication_proposals_reserve_slug: attached to an unexpected table %', tg_table_name
      using errcode = 'feature_not_supported';
  end if;

  return new;
end;
$$;

comment on function public.nexra_publication_proposals_reserve_slug() is
  'BEFORE INSERT on both proposal tables: for a row inserted as proposed, refuses a non-READ COMMITTED transaction, takes a transaction advisory lock on its destination and slug, and raises unique_violation if the other table holds an active proposal for them.';

-- Sorts after nexra_article_publication_proposals_check_insert, so the binding is
-- validated before the lock is taken.
create trigger nexra_article_publication_proposals_reserve_slug
  before insert on public.nexra_article_publication_proposals
  for each row
  when (new.status = 'proposed')
  execute function public.nexra_publication_proposals_reserve_slug();

create trigger nexra_content_publication_proposals_reserve_slug
  before insert on public.nexra_content_publication_proposals
  for each row
  when (new.status = 'proposed')
  execute function public.nexra_publication_proposals_reserve_slug();

-- A trigger function, executable by no API role.
revoke all on function public.nexra_publication_proposals_reserve_slug() from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_publication_proposals_reserve_slug() from %I', v_role);
    end if;
  end loop;
end
$$;
