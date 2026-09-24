-- Draft publication proposals (Stage 5A, 20260922140000): security, every propose outcome,
-- the application's withdrawal UPDATE, and the guards. A regression suite for the existing
-- draft workflow; its expectations hold with or without the D3 cross-table lock.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: security.
do $$
declare f text := 'public.nexra_content_publication_propose(text,uuid,smallint,uuid,text,uuid,timestamp with time zone,text,text,text,text,uuid)';
begin
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_content_publication_proposals'::regclass), 'A RLS enabled');
  perform t.ok((select count(*) from pg_policy where polrelid = 'public.nexra_content_publication_proposals'::regclass) = 0, 'A no policies');
  perform t.ok(has_table_privilege('service_role', 'public.nexra_content_publication_proposals', 'select,update'), 'A service_role: select and update (withdrawal)');
  perform t.ok(not has_table_privilege('service_role', 'public.nexra_content_publication_proposals', 'insert') and not has_table_privilege('service_role', 'public.nexra_content_publication_proposals', 'delete')
    and not has_table_privilege('service_role', 'public.nexra_content_publication_proposals', 'truncate'), 'A service_role: no insert, delete or truncate');
  perform t.ok(not has_table_privilege('anon', 'public.nexra_content_publication_proposals', 'select,insert,update,delete') and not has_table_privilege('authenticated', 'public.nexra_content_publication_proposals', 'select,insert,update,delete'), 'A anon/authenticated: no table access');
  perform t.ok(has_function_privilege('service_role', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'), 'A propose: service_role only');
  perform t.ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = f::regprocedure), 'A propose: security definer, empty search_path');
  perform t.ok((select indexdef from pg_indexes where indexname = 'nexra_content_publication_proposals_one_active_per_slug') like '%UNIQUE%(destination, slug) WHERE (status = ''proposed''::text)', 'A one active per destination+slug (own table)');
  perform t.ok((select indexdef from pg_indexes where indexname = 'nexra_content_publication_proposals_one_active_per_draft') like '%UNIQUE%(draft_id) WHERE (status = ''proposed''::text)', 'A one active per draft');
end $$;

-- B: propose outcomes.
do $$
declare a uuid; b uuid; c uuid; r jsonb; n0 bigint;
begin
  begin perform public.nexra_content_publication_propose(null, gen_random_uuid(), 1::smallint, gen_random_uuid(), repeat('0',64), gen_random_uuid(), now(), 'x-y', 'x-y-z', 'draft-section-text/1', repeat('c',64), gen_random_uuid());
    perform t.ok(false, 'null must raise');
  exception when invalid_parameter_value then perform t.ok(true, 'B null argument raises 22023'); end;

  a := td.draft(10);
  perform t.ok(td.propose(a, 'd-ten')->>'outcome' = 'stale', 'B not approved: stale');
  perform td.approve(a, 'failed');
  perform t.ok(td.propose(a, 'd-ten')->>'outcome' = 'ineligible' and td.propose(a, 'd-ten')->>'reason' = 'fact-check-not-passed', 'B fact-check failed: ineligible');
  perform td.approve(a);
  n0 := (select count(*) from nexra_content_publication_proposals);
  perform t.ok(td.propose(a, 'd-ten', p_project => 'verdant-home')->>'outcome' = 'not-found', 'B wrong project: not-found');
  perform t.ok(td.propose(gen_random_uuid(), 'd-ten')->>'outcome' = 'not-found', 'B unknown draft: not-found');
  perform t.ok(td.propose(a, 'd-ten', p_version => 2)->>'outcome' = 'stale', 'B another version number: stale');
  perform t.ok(td.propose(a, 'd-ten', p_vid => gen_random_uuid())->>'outcome' = 'stale', 'B another version row: stale');
  perform t.ok(td.propose(a, 'd-ten', p_by => gen_random_uuid())->>'outcome' = 'stale', 'B another approver: stale');
  perform t.ok(td.propose(a, 'd-ten', p_at => now() - interval '1 day')->>'outcome' = 'stale', 'B another approval time: stale');
  perform t.ok(td.propose(a, 'd-ten', p_sha => repeat('f',64))->>'outcome' = 'content-mismatch', 'B wrong hash: content-mismatch');
  perform t.ok((select count(*) from nexra_content_publication_proposals) = n0, 'B no row written by a refusal');

  b := td.ready(11, 'Title [needs evidence: x]', 'Body');
  r := td.propose(b, 'd-eleven');
  perform t.ok(r->>'outcome' = 'ineligible' and r->>'reason' = 'unresolved-placeholders', 'B placeholder: ineligible');

  r := td.propose(a, 'd-ten');
  perform t.ok(r->>'outcome' = 'created' and r->'proposal'->>'status' = 'proposed' and r->'proposal'->>'slug' = 'd-ten', 'B created');
  perform t.ok(r->'proposal'->>'content_sha256' = td.sha('T','B') and (r->'proposal'->>'approved_by')::uuid = '00000000-0000-4000-8000-0000000000bb', 'B bound to the version hash and the approval');
  perform t.ok(td.propose(a, 'd-ten')->>'outcome' = 'exists' and td.active('d-ten') = 1, 'B identical repeat: exists, nothing written');
  perform t.ok(td.propose(a, 'd-other')->>'outcome' = 'exists' and td.active('d-other') = 0, 'B one active proposal per draft: exists');

  c := td.ready(12);
  perform t.ok(td.propose(c, 'd-ten')->>'outcome' = 'slug-taken', 'B slug held by another draft: slug-taken');
  perform t.ok(td.propose(c, 'd-ten', p_dest => 'other-site')->>'outcome' = 'created', 'B same slug at another destination: created');
end $$;

-- C: withdrawal as the application writes it, and the guards.
do $$
declare a uuid := td.d(10); p nexra_content_publication_proposals; q nexra_content_publication_proposals; d jsonb;
begin
  select * into p from nexra_content_publication_proposals where draft_id = a and status = 'proposed';
  select to_jsonb(x) into d from nexra_content_drafts x where id = a;
  perform t.ok(td.withdraw(p.id) = 1, 'C service_role withdrawal UPDATE: one row');
  select * into q from nexra_content_publication_proposals where id = p.id;
  perform t.ok(q.status = 'withdrawn' and q.withdrawn_by = '00000000-0000-4000-8000-0000000000dd' and q.withdrawn_at = now(), 'C withdrawn by the named operator at database time');
  perform t.ok(td.withdraw(p.id) = 0, 'C a repeated withdrawal matches no row');
  perform t.ok((select to_jsonb(x) from nexra_content_drafts x where id = a) = d, 'C the draft is unchanged by withdrawal');
  begin update nexra_content_publication_proposals set withdrawn_by = gen_random_uuid() where id = p.id; perform t.ok(false, 'final');
  exception when check_violation then perform t.ok(true, 'C a withdrawn proposal is final'); end;
  perform t.ok(td.propose(a, 'd-ten')->>'outcome' = 'created', 'C after withdrawal the draft and slug are free: created');
  perform t.ok((select count(*) from nexra_content_publication_proposals where draft_id = a) = 2, 'C history keeps the withdrawn proposal');
  select * into p from nexra_content_publication_proposals where draft_id = a and status = 'proposed';
  begin update nexra_content_publication_proposals set slug = 'd-changed' where id = p.id; perform t.ok(false, 'binding');
  exception when check_violation then perform t.ok(true, 'C the binding cannot change'); end;
  begin update nexra_content_publication_proposals set status = 'withdrawn' where id = p.id; perform t.ok(false, 'unnamed');
  exception when check_violation then perform t.ok(true, 'C withdrawal needs a named operator (constraint)'); end;
  begin delete from nexra_content_publication_proposals where id = p.id; perform t.ok(false, 'delete');
  exception when check_violation then perform t.ok(true, 'C delete refused'); end;
end $$;
do $$ begin
  begin truncate nexra_content_publication_proposals; perform t.ok(false, 'truncate');
  exception when check_violation then perform t.ok(true, 'C truncate refused'); end;
end $$;
grant usage on schema t to service_role;
set role service_role;
do $$ begin
  begin insert into nexra_content_publication_proposals (project_id) values ('halcyon-fintech'); perform t.ok(false, 'insert');
  exception when insufficient_privilege then perform t.ok(true, 'C service_role insert refused'); end;
  begin delete from nexra_content_publication_proposals; perform t.ok(false, 'delete');
  exception when insufficient_privilege then perform t.ok(true, 'C service_role delete refused'); end;
end $$;
reset role;
