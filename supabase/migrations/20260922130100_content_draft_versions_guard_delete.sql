-- A content draft version is never deleted.
--
-- 20260922120000 made a version immutable against UPDATE: its identity and
-- text cannot change, and only fact_check may be written later. It did not
-- guard DELETE, so a direct `delete from nexra_content_draft_versions` would
-- remove history — including version 1, the Writer's output as generated,
-- which the product promises can always be recovered beside whatever a
-- person later saved. This closes that gap: every row-level DELETE on the
-- versions table is refused, and so is TRUNCATE.
--
-- The parent's cascade. `nexra_content_draft_versions.draft_id` references
-- the parent `on delete cascade`, and a cascade is a DELETE on this table,
-- so this guard refuses it too: a draft that has versions can no longer be
-- deleted, by anything. That is deliberate. The foreign key is left as it
-- is; the guard is the stronger rule, and the alternative — letting the
-- cascade through — would keep the same gap one table up, where deleting
-- a parent silently takes its history with it. A draft is retired by
-- setting its status to `archived`, which the edit path already respects.
--
-- What still works. The store's own compensation in Stage 1 — removing a
-- parent whose version 1 insert failed — deletes a parent with no versions,
-- so the cascade reaches no row here and is unaffected. The version-save
-- function (20260922130000) inserts and updates the parent only; it deletes
-- nothing. fact_check remains writable under the existing update guard.
--
-- Same shape as the update guard: plpgsql, search_path pinned, errcode
-- check_violation, so the application sees the failure it already knows.

create function public.nexra_content_draft_versions_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'nexra_content_draft_versions: a version is never deleted; archive the draft instead'
    using errcode = 'check_violation';
end;
$$;

create trigger nexra_content_draft_versions_guard_delete
  before delete on public.nexra_content_draft_versions
  for each row
  execute function public.nexra_content_draft_versions_guard_delete();

create trigger nexra_content_draft_versions_guard_truncate
  before truncate on public.nexra_content_draft_versions
  for each statement
  execute function public.nexra_content_draft_versions_guard_delete();

comment on function public.nexra_content_draft_versions_guard_delete() is
  'Refuses every DELETE and TRUNCATE on nexra_content_draft_versions, the cascade from a parent draft included: versions are permanent history; a draft is archived, not deleted.';
