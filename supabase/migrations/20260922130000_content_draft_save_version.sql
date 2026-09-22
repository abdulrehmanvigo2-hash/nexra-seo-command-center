-- Saving an operator's edit of a content draft as the next immutable
-- version: one function, one transaction.
--
-- Why a function. The application reaches Postgres through PostgREST, one
-- statement at a time, so "insert version N+1, then point the parent at it"
-- cannot be made atomic from the application: a second save in the same
-- instant could insert the same number (the unique key would refuse one of
-- them, but the parent could already point at a version that was never
-- written), and a crash between the two statements would leave the parent
-- behind its newest row. Here both happen in one transaction, under a row
-- lock on the parent, so concurrent saves are serialised and the second one
-- sees the first one's version and is refused as stale.
--
-- Optimistic concurrency. The caller names the version it started editing
-- from (`p_expected_version`). If the parent's current version is no longer
-- that, nothing is written and the answer says which version is current, so
-- the person can read it before deciding; edits are never silently combined
-- and never overwrite one another.
--
-- What the new row is. Always `origin = 'operator'`, with empty claims and
-- placeholders and a null fact_check: an edit is text a person wrote, and
-- nothing about the Writer's recorded claims, or any earlier check, carries
-- over to it. Version 1 and every earlier row are untouched — the version
-- guard trigger refuses any change to them, and this function makes none.
--
-- What the parent becomes. `current_version` advances. A status of
-- `fact-checked` or `approved` described the version that was current, and
-- that version is current no longer, so the status returns to `drafting`;
-- the approved-version pointer, approver and time are left exactly as they
-- were, as the record of which version was approved. `published` and its
-- pointer are likewise left as history. An `archived` draft is not edited.
-- Nothing here approves, publishes, or calls anything outside the database.
--
-- Executable by service_role only, like every runtime function here.

create function public.nexra_content_draft_save_version(
  p_draft_id uuid,
  p_project_id text,
  p_expected_version smallint,
  p_title text,
  p_body text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.nexra_content_drafts;
  v_version public.nexra_content_draft_versions;
  v_next smallint;
begin
  if p_draft_id is null or p_project_id is null or p_expected_version is null or p_created_by is null then
    raise exception 'nexra_content_draft_save_version: every argument is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The project is part of the lookup: a draft of another project is not
  -- found, and nothing about it is disclosed.
  select * into v_draft
    from public.nexra_content_drafts
   where id = p_draft_id and project_id = p_project_id
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not-found');
  end if;

  if v_draft.status = 'archived' then
    return jsonb_build_object('outcome', 'archived');
  end if;

  if v_draft.current_version <> p_expected_version then
    return jsonb_build_object('outcome', 'stale', 'current_version', v_draft.current_version);
  end if;

  v_next := v_draft.current_version + 1;

  insert into public.nexra_content_draft_versions
    (draft_id, version, origin, title, body, claims, placeholders, created_by)
  values
    (p_draft_id, v_next, 'operator', p_title, p_body, '[]'::jsonb, '[]'::jsonb, p_created_by)
  returning * into v_version;

  update public.nexra_content_drafts
     set current_version = v_next,
         status = case when status in ('fact-checked', 'approved') then 'drafting' else status end
   where id = p_draft_id
  returning * into v_draft;

  return jsonb_build_object(
    'outcome', 'created',
    'draft', to_jsonb(v_draft),
    'version', to_jsonb(v_version)
  );
end;
$$;

comment on function public.nexra_content_draft_save_version(uuid, text, smallint, text, text, uuid) is
  'Saves an operator edit as the draft''s next immutable version and advances current_version, in one transaction; refuses a stale expected version rather than combining edits.';

-- ---------------------------------------------------------------------------
-- Access: service_role only.

revoke all on function public.nexra_content_draft_save_version(uuid, text, smallint, text, text, uuid) from public;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function public.nexra_content_draft_save_version(uuid, text, smallint, text, text, uuid) from %I', v_role);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.nexra_content_draft_save_version(uuid, text, smallint, text, text, uuid) to service_role;
  end if;
end
$$;
