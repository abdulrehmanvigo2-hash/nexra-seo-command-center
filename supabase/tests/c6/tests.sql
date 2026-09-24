-- C6 article publication proposals: sections A (schema), B (security), C (binding refusals), D (immutability, withdrawal, staleness).
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema.
do $$
declare cols text[];
begin
  perform t.ok(to_regclass('public.nexra_article_publication_proposals') is not null, 'A table exists');
  select array_agg(column_name::text order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'nexra_article_publication_proposals';
  perform t.ok(cols = array['id','project_id','article_id','article_version','article_version_id','content_sha256','approval_id','approved_by','approved_at','destination','slug','preview_format','preview_sha256','status','requested_by','withdrawn_by','withdrawn_at','created_at','updated_at'], 'A columns in order: ' || cols::text);
  perform t.ok((select count(*) from information_schema.columns where table_name = 'nexra_article_publication_proposals' and is_nullable = 'YES') = 2, 'A only withdrawn_by / withdrawn_at nullable');
  perform t.ok((select array_agg(conname::text order by conname) from pg_constraint where conrelid = 'public.nexra_article_publication_proposals'::regclass and contype = 'f')
    = array['nexra_article_publication_proposals_approval_fkey','nexra_article_publication_proposals_article_fkey','nexra_article_publication_proposals_project_fkey','nexra_article_publication_proposals_version_fkey','nexra_article_publication_proposals_version_number_fkey'], 'A five foreign keys');
  perform t.ok((select bool_and(confdeltype = 'r') from pg_constraint where conrelid = 'public.nexra_article_publication_proposals'::regclass and contype = 'f'), 'A every foreign key is on delete restrict');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_article_publication_proposals_version_number_fkey') like 'FOREIGN KEY (article_id, article_version) REFERENCES nexra_article_versions(article_id, version)%', 'A composite article/version foreign key');
  perform t.ok((select count(*) from pg_constraint where conrelid = 'public.nexra_article_publication_proposals'::regclass and contype = 'c') = 8, 'A eight check constraints');
  perform t.ok((select indexdef from pg_indexes where indexname = 'nexra_article_publication_proposals_one_active_per_article') like '%UNIQUE%(article_id) WHERE (status = ''proposed''::text)', 'A one active per article');
  perform t.ok((select indexdef from pg_indexes where indexname = 'nexra_article_publication_proposals_one_active_per_slug') like '%UNIQUE%(destination, slug) WHERE (status = ''proposed''::text)', 'A one active per destination+slug');
  perform t.ok((select indexdef from pg_indexes where indexname = 'nexra_article_publication_proposals_article_idx') like '%(article_id, created_at DESC)', 'A history index');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_article_publication_proposals'::regclass and not tgisinternal)
    = array['nexra_article_publication_proposals_check_insert','nexra_article_publication_proposals_guard_delete','nexra_article_publication_proposals_guard_truncate','nexra_article_publication_proposals_guard_update','nexra_article_publication_proposals_set_updated_at'], 'A five triggers');
  perform t.ok(public.nexra_article_publication_destination_allowed('nexra-agency-website','nexra-agency')
    and not public.nexra_article_publication_destination_allowed('nexra-agency-website','halcyon-fintech')
    and not public.nexra_article_publication_destination_allowed('other','nexra-agency')
    and public.nexra_article_publication_destination_allowed(null,'nexra-agency') = false, 'A registry: one destination for one project');
  perform t.ok(public.nexra_article_publication_live_slugs('nexra-agency-website') = array['ai-lead-follow-up-automation'] and public.nexra_article_publication_live_slugs('x') = '{}', 'A pinned live slugs');
end $$;

-- B: security.
do $$
declare f text; fns text[] := array[
  'public.nexra_article_publication_propose(text,uuid,smallint,uuid,text,uuid,text,text,text,text,uuid)',
  'public.nexra_article_publication_withdraw(text,uuid,uuid)',
  'public.nexra_article_publication_destination_allowed(text,text)',
  'public.nexra_article_publication_live_slugs(text)',
  'public.nexra_article_publication_proposals_check_insert()',
  'public.nexra_article_publication_proposals_guard_update()',
  'public.nexra_article_publication_proposals_guard_delete()'];
begin
  create role t6_nobody nologin;
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_article_publication_proposals'::regclass), 'B RLS enabled');
  perform t.ok((select count(*) from pg_policy where polrelid = 'public.nexra_article_publication_proposals'::regclass) = 0, 'B no policies');
  perform t.ok((select pg_get_userbyid(relowner) from pg_class where oid = 'public.nexra_article_publication_proposals'::regclass) = 'postgres', 'B table owned by the migration owner');
  foreach f in array array['anon','authenticated','t6_nobody'] loop
    perform t.ok(not has_table_privilege(f, 'public.nexra_article_publication_proposals', 'select,insert,update,delete,truncate,references,trigger'), 'B ' || f || ': no table privilege');
  end loop;
  perform t.ok(has_table_privilege('service_role', 'public.nexra_article_publication_proposals', 'select'), 'B service_role: select');
  perform t.ok(not has_table_privilege('service_role', 'public.nexra_article_publication_proposals', 'insert,update,delete,truncate,references,trigger'), 'B service_role: no direct write');
  foreach f in array fns loop
    perform t.ok(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('t6_nobody', f, 'execute'), 'B no public/anon/authenticated execute: ' || f);
    perform t.ok((select proconfig = array['search_path=""'] from pg_proc where oid = f::regprocedure), 'B empty search_path: ' || f);
    perform t.ok((select pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = f::regprocedure), 'B owner: ' || f);
  end loop;
  perform t.ok(has_function_privilege('service_role', fns[1], 'execute') and has_function_privilege('service_role', fns[2], 'execute'), 'B service_role executes propose and withdraw');
  perform t.ok(not has_function_privilege('service_role', fns[3], 'execute') and not has_function_privilege('service_role', fns[4], 'execute')
    and not has_function_privilege('service_role', fns[5], 'execute') and not has_function_privilege('service_role', fns[6], 'execute') and not has_function_privilege('service_role', fns[7], 'execute'), 'B service_role executes no helper or trigger function');
  perform t.ok((select array_agg(proname::text order by proname) from pg_proc where prosecdef and proname like 'nexra_article_publication%')
    = array['nexra_article_publication_propose','nexra_article_publication_withdraw'], 'B security definer: propose and withdraw only');
  perform t.ok((select count(*) from pg_proc where prosecdef and proname like 'nexra_article%') = 6, 'B security definer article functions: C2 two + C4 + C5 + C6 two');
  -- Existing grants unchanged.
  perform t.ok(has_table_privilege('service_role', 'public.nexra_content_publication_proposals', 'select,update') and not has_table_privilege('service_role', 'public.nexra_content_publication_proposals', 'insert,delete'), 'B draft proposal grants unchanged');
  perform t.ok(has_table_privilege('service_role', 'public.nexra_article_approvals', 'select') and not has_table_privilege('service_role', 'public.nexra_article_approvals', 'insert,update,delete'), 'B approval grants unchanged');
  drop role t6_nobody;
end $$;

-- B: service_role in practice (test schema t made usable by the roles; test harness only).
grant usage on schema t to service_role, anon;
set role service_role;
do $$ begin
  begin insert into nexra_article_publication_proposals (project_id) values ('nexra-agency'); perform t.ok(false, 'insert must fail');
  exception when insufficient_privilege then perform t.ok(true, 'B service_role insert refused'); end;
  begin update nexra_article_publication_proposals set slug = 'x'; perform t.ok(false, 'update must fail');
  exception when insufficient_privilege then perform t.ok(true, 'B service_role update refused'); end;
  begin delete from nexra_article_publication_proposals; perform t.ok(false, 'delete must fail');
  exception when insufficient_privilege then perform t.ok(true, 'B service_role delete refused'); end;
  perform t.ok((select count(*) from nexra_article_publication_proposals) >= 0, 'B service_role select allowed');
end $$;
reset role;
set role anon;
do $$ begin
  begin perform count(*) from nexra_article_publication_proposals; perform t.ok(false, 'anon select must fail');
  exception when insufficient_privilege then perform t.ok(true, 'B anon select refused'); end;
  begin perform public.nexra_article_publication_withdraw('nexra-agency', gen_random_uuid(), gen_random_uuid()); perform t.ok(false, 'anon execute must fail');
  exception when insufficient_privilege then perform t.ok(true, 'B anon execute refused'); end;
end $$;
reset role;

-- C: binding refusals. Article 10 is approved (v1, slug a-ten).
do $$
declare a uuid; b uuid; c uuid; d uuid; e uuid; h uuid; l uuid; s uuid; u uuid; r jsonb; n0 bigint;
begin
  a := t6.ready(10, t6.txt('a-ten'));
  n0 := t6.n();
  begin perform public.nexra_article_publication_propose(null, a, 1::smallint, t5.vid(a,1), t5.sha(a,1), t6.aid(a,1), 'nexra-agency-website', 'a-ten', 'article-proposal-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'null must raise');
  exception when invalid_parameter_value then perform t.ok(true, 'C null argument raises 22023'); end;
  perform t.ok(t6.propose(a, 1, p_project => 'halcyon-fintech')->>'outcome' = 'not-found', 'C wrong project: not-found');
  perform t.ok(t6.propose(gen_random_uuid(), 1, p_slug => 'a-ten')->>'outcome' = 'not-found', 'C unknown article: not-found');
  perform t.ok(t6.propose(a, 1, p_dest => 'other-site')->>'outcome' = 'destination-unavailable', 'C unregistered destination');
  -- A halcyon article, approved, to the nexra destination.
  h := t5.article(0, t5.txt('different-angle')); perform t5.passall(h, 1); perform t5.approve(h, 1);
  perform t.ok((select status from nexra_articles where id = h) = 'approved', 'C halcyon article approved');
  perform t.ok(t6.propose(h, 1, p_project => 'halcyon-fintech', p_slug => 'h-one')->>'outcome' = 'destination-unavailable', 'C destination not registered for the project');
  -- Not approved: drafting, and checked.
  b := t6.article(11, t6.txt('b-eleven'));
  perform t.ok(t6.propose(b, 1)->>'outcome' = 'not-approved', 'C drafting: not-approved');
  perform t6.passall(b, 1);
  perform t.ok((select status from nexra_articles where id = b) = 'checked', 'C b checked');
  perform t.ok(t6.propose(b, 1)->>'outcome' = 'not-approved', 'C checked but not approved: not-approved');
  perform t.ok(t6.propose(a, 1, p_vid => t5.vid(b, 1))->>'outcome' = 'version-mismatch', 'C another version row: version-mismatch');
  perform t.ok(t6.propose(a, 1, p_sha => repeat('f',64))->>'outcome' = 'content-mismatch', 'C wrong hash: content-mismatch');
  perform t.ok(t6.propose(a, 1, p_aid => gen_random_uuid())->>'outcome' = 'approval-mismatch', 'C unknown approval: approval-mismatch');
  c := t6.ready(12, t6.txt('c-twelve'));
  perform t.ok(t6.propose(a, 1, p_aid => t6.aid(c, 1))->>'outcome' = 'approval-mismatch', 'C another article''s approval: approval-mismatch');
  perform t.ok(t6.propose(a, 1, p_slug => 'a-other')->>'outcome' = 'slug-mismatch', 'C slug not the content''s: slug-mismatch');
  perform t.ok(t6.propose(a, 1, p_slug => 'A-TEN')->>'outcome' = 'slug-mismatch', 'C slug case differs: slug-mismatch');
  perform t.ok(t6.propose(a, 1, p_fmt => 'draft-section-text/1')->>'outcome' = 'invalid-preview', 'C wrong preview format: invalid-preview');
  perform t.ok(t6.propose(a, 1, p_pv => 'ABC')->>'outcome' = 'invalid-preview', 'C malformed preview hash: invalid-preview');
  perform t.ok(t6.n() = n0, 'C no row written by any refusal');
  -- Stale: version 2 saved, checked and approved.
  s := t6.ready(13, t6.txt('s-thirteen'));
  perform t.ok(t6.save(s, 1, t6.txt('s-thirteen', 'different-angle', 'Edited lead.'))->>'outcome' = 'created', 'C s saved v2');
  perform t.ok(t6.propose(s, 1)->>'outcome' = 'not-approved', 'C after a save the article is drafting: not-approved');
  perform t6.passall(s, 2);
  perform t.ok(t6.approve(s, 2)->>'outcome' = 'approved', 'C s v2 approved');
  perform t.ok(t6.propose(s, 1)->>'outcome' = 'stale', 'C older version: stale');
  perform t.ok(t6.propose(s, 2, p_aid => t6.aid(s, 1))->>'outcome' = 'approval-mismatch', 'C v1 approval for v2: approval-mismatch');
  perform t.ok(t6.propose(s, 2, p_vid => t5.vid(s, 1))->>'outcome' = 'version-mismatch', 'C v1 row for v2: version-mismatch');
  perform t.ok(t6.propose(s, 2, p_sha => t5.sha(s, 1))->>'outcome' = 'content-mismatch', 'C v1 hash for v2: content-mismatch');
  perform t.ok(t6.propose(s, 3)->>'outcome' = 'stale', 'C future version: stale');
  perform t.ok(t6.n() = n0, 'C still no row written');
  -- Live slug (D2).
  l := t6.ready(16, t6.txt('ai-lead-follow-up-automation', 'different-angle'));
  perform t.ok(t6.propose(l, 1)->>'outcome' = 'slug-live-collision', 'C live slug, different-angle: slug-live-collision');
  u := t6.ready(17, t6.txt('ai-lead-follow-up-automation', 'update-existing'));
  r := t6.propose(u, 1);
  perform t.ok(r->>'outcome' = 'created', 'C live slug, update-existing: created (warning is the application''s)');
  -- Created, identical repeat, conflicting repeat.
  r := t6.propose(a, 1);
  perform t.ok(r->>'outcome' = 'created' and r->'proposal'->>'status' = 'proposed' and r->'proposal'->>'withdrawn_at' is null, 'C created');
  perform t.ok((r->'proposal'->>'approval_id')::uuid = t6.aid(a, 1) and (r->'proposal'->>'approved_by')::uuid = (select approved_by from nexra_article_approvals where id = t6.aid(a, 1))
    and (r->'proposal'->>'approved_at')::timestamptz = (select approved_at from nexra_article_approvals where id = t6.aid(a, 1)), 'C approver and time copied from the approval row');
  perform t.ok((r->'proposal'->>'article_version_id')::uuid = t5.vid(a, 1) and r->'proposal'->>'content_sha256' = t5.sha(a, 1) and r->'proposal'->>'slug' = 'a-ten', 'C bound to the exact version, hash and slug');
  n0 := t6.n();
  perform t.ok(t6.propose(a, 1)->>'outcome' = 'exists' and t6.n() = n0, 'C identical repeat: exists, nothing written');
  perform t.ok(t6.propose(a, 1, p_by => '00000000-0000-4000-8000-0000000000ee')->>'outcome' = 'exists', 'C identical binding by another operator: exists');
  perform t.ok(t6.propose(a, 1, p_pv => repeat('b',64))->>'outcome' = 'active-exists' and t6.n() = n0, 'C different preview: active-exists');
  -- Slug held by another article's active proposal.
  d := t6.ready(18, t6.txt('a-ten'));
  perform t.ok(t6.propose(d, 1)->>'outcome' = 'slug-taken', 'C slug held by another article: slug-taken');
  perform t.ok(t6.propose(d, 1, p_dest => 'other-site')->>'outcome' = 'destination-unavailable', 'C (destination is checked first)');
  -- Slug held by a draft proposal (D3).
  insert into nexra_content_publication_proposals (project_id, draft_id, version, version_id, content_sha256, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
    values ('nexra-agency', 'd6000000-0000-4000-8000-000000000001', 1, 'd6100000-0000-4000-8000-000000000001', repeat('1',64), gen_random_uuid(), now(), 'nexra-agency-website', 'dr-slug', 'draft-section-text/1', repeat('1',64), gen_random_uuid());
  e := t6.ready(19, t6.txt('dr-slug'));
  perform t.ok(t6.propose(e, 1)->>'outcome' = 'slug-taken', 'C slug held by a draft proposal: slug-taken');
  update nexra_content_publication_proposals set status = 'withdrawn', withdrawn_by = gen_random_uuid() where slug = 'dr-slug';
  perform t.ok(t6.propose(e, 1)->>'outcome' = 'created', 'C draft proposal withdrawn: created');
end $$;

-- C: tampered pointer and placeholder (defence in depth; triggers off only to fabricate the state).
set session_replication_role = replica;
update nexra_articles set approved_by = '00000000-0000-4000-8000-0000000000ef' where id = t6.a(12);
set session_replication_role = origin;
do $$ begin
  perform t.ok(t6.propose(t6.a(12), 1)->>'outcome' = 'approval-mismatch', 'C parent approver differs from the approval row: approval-mismatch');
end $$;
set session_replication_role = replica;
update nexra_articles set approved_by = '00000000-0000-4000-8000-0000000000bb', approved_at = approved_at + interval '1 second' where id = t6.a(12);
set session_replication_role = origin;
do $$ begin
  perform t.ok(t6.propose(t6.a(12), 1)->>'outcome' = 'approval-mismatch', 'C parent approval time differs: approval-mismatch');
end $$;
do $$
declare p uuid; r jsonb;
begin
  p := t6.article(15, t6.txt('ph-fifteen', 'different-angle', 'Lead [needs Evidence: a figure].'));
  perform t6.passall(p, 1);
  perform t.ok(t6.approve(p, 1)->>'outcome' = 'unresolved-placeholder', 'C C5 refuses to approve a placeholder');
end $$;
set session_replication_role = replica;
insert into nexra_article_approvals (article_id, article_version, article_version_id, content_sha256, unit_count, units_sha256, approved_by, approved_at)
  values (t6.a(15), 1, t5.vid(t6.a(15), 1), t5.sha(t6.a(15), 1), 4, t5.digest(t6.a(15), 1), '00000000-0000-4000-8000-0000000000bb', '2026-09-24 12:00:00+00');
update nexra_articles set status = 'approved', approved_version = 1, approved_by = '00000000-0000-4000-8000-0000000000bb', approved_at = '2026-09-24 12:00:00+00' where id = t6.a(15);
set session_replication_role = origin;
do $$ begin
  perform t.ok(t6.propose(t6.a(15), 1)->>'outcome' = 'unresolved-placeholder', 'C fabricated approval of a placeholder: unresolved-placeholder');
  update nexra_articles set status = 'archived' where id = t6.a(10);
  perform t.ok(t6.propose(t6.a(10), 1)->>'outcome' = 'archived', 'C archived article: archived');
  perform t.ok(t6.propose(t6.a(10), 1)->'proposal' is null, 'C archived answer carries no proposal');
end $$;

-- C: the insert trigger holds for a privileged writer.
do $$
declare a uuid := t6.ready(30, t6.txt('ins-thirty')); good record; ap nexra_article_approvals;
begin
  select * into ap from nexra_article_approvals where id = t6.aid(a, 1);
  begin insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
    values ('nexra-agency', a, 1, t5.vid(a,1), repeat('f',64), ap.id, ap.approved_by, ap.approved_at, 'nexra-agency-website', 'ins-thirty', 'article-proposal-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'wrong hash insert must fail');
  exception when check_violation then perform t.ok(true, 'C direct insert: wrong hash refused'); end;
  begin insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
    values ('nexra-agency', a, 1, t5.vid(a,1), t5.sha(a,1), t6.aid(t6.a(12),1), ap.approved_by, ap.approved_at, 'nexra-agency-website', 'ins-thirty', 'article-proposal-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'foreign approval insert must fail');
  exception when check_violation then perform t.ok(true, 'C direct insert: another article''s approval refused'); end;
  begin insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
    values ('nexra-agency', a, 1, t5.vid(a,1), t5.sha(a,1), ap.id, gen_random_uuid(), ap.approved_at, 'nexra-agency-website', 'ins-thirty', 'article-proposal-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'approver insert must fail');
  exception when check_violation then perform t.ok(true, 'C direct insert: approver not the approval''s refused'); end;
  begin insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
    values ('nexra-agency', a, 1, t5.vid(a,1), t5.sha(a,1), ap.id, ap.approved_by, ap.approved_at - interval '1 second', 'nexra-agency-website', 'ins-thirty', 'article-proposal-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'time insert must fail');
  exception when check_violation then perform t.ok(true, 'C direct insert: approval time not the approval''s refused'); end;
  begin insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
    values ('halcyon-fintech', a, 1, t5.vid(a,1), t5.sha(a,1), ap.id, ap.approved_by, ap.approved_at, 'nexra-agency-website', 'ins-thirty', 'article-proposal-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'project insert must fail');
  exception when check_violation then perform t.ok(true, 'C direct insert: another project refused'); end;
  begin insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
    values ('nexra-agency', a, 1, t5.vid(t6.a(12),1), t5.sha(a,1), ap.id, ap.approved_by, ap.approved_at, 'nexra-agency-website', 'ins-thirty', 'article-proposal-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'version row insert must fail');
  exception when check_violation then perform t.ok(true, 'C direct insert: another version row refused'); end;
  begin insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by, status, withdrawn_by, withdrawn_at)
    values ('nexra-agency', a, 1, t5.vid(a,1), t5.sha(a,1), ap.id, ap.approved_by, ap.approved_at, 'nexra-agency-website', 'ins-thirty', 'article-proposal-text/1', repeat('a',64), gen_random_uuid(), 'withdrawn', gen_random_uuid(), now());
    perform t.ok(false, 'withdrawn insert must fail');
  exception when check_violation then perform t.ok(true, 'C direct insert: created withdrawn refused'); end;
  begin insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
    values ('nexra-agency', a, 1, t5.vid(a,1), t5.sha(a,1), ap.id, ap.approved_by, ap.approved_at, 'nexra-agency-website', 'ins-thirty', 'draft-section-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'preview format insert must fail');
  exception when check_violation then perform t.ok(true, 'C direct insert: preview format refused by constraint'); end;
end $$;

-- D: immutability, withdrawal, staleness.
do $$
declare a uuid := t6.a(19); p nexra_article_publication_proposals; q nexra_article_publication_proposals; r jsonb; art jsonb; nap bigint; ndp jsonb; t0 timestamptz;
begin
  select * into p from nexra_article_publication_proposals where article_id = a and status = 'proposed';
  foreach r in array array[
    '{"c":"slug","v":"x-y-z"}','{"c":"preview_sha256","v":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}','{"c":"destination","v":"other-site"}',
    '{"c":"requested_by","v":"00000000-0000-4000-8000-000000000001"}','{"c":"approved_by","v":"00000000-0000-4000-8000-000000000001"}',
    '{"c":"content_sha256","v":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}','{"c":"created_at","v":"2000-01-01"}']::jsonb[] loop
    begin
      execute format('update nexra_article_publication_proposals set %I = %L, status = ''withdrawn'', withdrawn_by = gen_random_uuid() where id = %L', r->>'c', r->>'v', p.id);
      perform t.ok(false, 'binding change must fail: ' || (r->>'c'));
    exception when check_violation then perform t.ok(true, 'D binding field fixed: ' || (r->>'c')); end;
  end loop;
  begin update nexra_article_publication_proposals set approval_id = t6.aid(t6.a(12), 1) where id = p.id; perform t.ok(false, 'approval change must fail');
  exception when check_violation then perform t.ok(true, 'D binding field fixed: approval_id'); end;
  begin update nexra_article_publication_proposals set article_version = 2 where id = p.id; perform t.ok(false, 'version change must fail');
  exception when check_violation or foreign_key_violation then perform t.ok(true, 'D binding field fixed: article_version'); end;
  begin update nexra_article_publication_proposals set status = 'proposed' where id = p.id; perform t.ok(false, 'no-op update must fail');
  exception when check_violation then perform t.ok(true, 'D a no-op update is refused (the only change is withdrawal)'); end;
  begin update nexra_article_publication_proposals set status = 'withdrawn' where id = p.id; perform t.ok(false, 'unnamed withdrawal must fail');
  exception when check_violation then perform t.ok(true, 'D withdrawal needs a named operator'); end;
  begin update nexra_article_publication_proposals set withdrawn_by = gen_random_uuid() where id = p.id; perform t.ok(false, 'withdrawn_by alone must fail');
  exception when check_violation then perform t.ok(true, 'D withdrawn_by without withdrawal refused'); end;

  -- Withdraw through the function; the article and approvals are not touched.
  select to_jsonb(x) into art from nexra_articles x where id = a;
  nap := (select count(*) from nexra_article_approvals);
  select jsonb_agg(to_jsonb(x) order by id) into ndp from nexra_content_publication_proposals x;
  perform t.ok(t6.withdraw(p.id, 'halcyon-fintech')->>'outcome' = 'not-found', 'D withdraw, wrong project: not-found');
  perform t.ok(t6.withdraw(gen_random_uuid())->>'outcome' = 'not-found', 'D withdraw, unknown: not-found');
  begin perform public.nexra_article_publication_withdraw('nexra-agency', p.id, null); perform t.ok(false, 'null must raise');
  exception when invalid_parameter_value then perform t.ok(true, 'D withdraw null operator raises 22023'); end;
  r := t6.withdraw(p.id);
  select * into q from nexra_article_publication_proposals where id = p.id;
  perform t.ok(r->>'outcome' = 'withdrawn' and q.status = 'withdrawn' and q.withdrawn_by = '00000000-0000-4000-8000-0000000000dd' and q.withdrawn_at = now(), 'D withdrawn by the named operator at database time');
  perform t.ok(q.updated_at = now() and q.created_at = p.created_at and q.slug = p.slug and q.approval_id = p.approval_id, 'D withdrawal changes nothing else');
  r := t6.withdraw(p.id);
  perform t.ok(r->>'outcome' = 'already-withdrawn' and (r->'proposal'->>'withdrawn_at')::timestamptz = q.withdrawn_at, 'D repeat: already-withdrawn, unchanged');
  perform t.ok((select to_jsonb(x) from nexra_articles x where id = a) = art, 'D the article row is unchanged by propose/withdraw');
  perform t.ok((select count(*) from nexra_article_approvals) = nap, 'D no approval row written');
  perform t.ok((select jsonb_agg(to_jsonb(x) order by id) from nexra_content_publication_proposals x) = ndp, 'D no draft proposal touched');
  begin update nexra_article_publication_proposals set withdrawn_by = gen_random_uuid() where id = p.id; perform t.ok(false, 'final');
  exception when check_violation then perform t.ok(true, 'D a withdrawn proposal is final'); end;
  begin update nexra_article_publication_proposals set status = 'proposed', withdrawn_by = null, withdrawn_at = null where id = p.id; perform t.ok(false, 'final');
  exception when check_violation then perform t.ok(true, 'D withdrawn cannot return to proposed'); end;
  begin delete from nexra_article_publication_proposals where id = p.id; perform t.ok(false, 'delete must fail');
  exception when check_violation then perform t.ok(true, 'D delete refused'); end;
  perform t.ok(t6.propose(a, 1)->>'outcome' = 'created', 'D a new proposal after withdrawal: created');
  perform t.ok((select count(*) from nexra_article_publication_proposals where article_id = a) = 2, 'D history keeps the withdrawn proposal');
end $$;
do $$ begin
  begin truncate nexra_article_publication_proposals; perform t.ok(false, 'truncate must fail');
  exception when check_violation then perform t.ok(true, 'D truncate refused'); end;
end $$;
-- D: a supplied withdrawn_at is replaced by the database's time (direct, privileged update).
begin;
select t.ok((select withdrawn_at from nexra_article_publication_proposals where article_id = t6.a(17)) is null, 'D (u proposal active)');
update nexra_article_publication_proposals set status = 'withdrawn', withdrawn_by = gen_random_uuid(), withdrawn_at = '2000-01-01' where article_id = t6.a(17);
select t.ok((select withdrawn_at from nexra_article_publication_proposals where article_id = t6.a(17)) = now(), 'D withdrawn_at is the database''s time, not the writer''s');
commit;

-- D: a proposal stays bound to its version; a new version needs it withdrawn first.
do $$
declare a uuid := t6.a(30); p uuid; r jsonb;
begin
  r := t6.propose(a, 1); p := (r->'proposal'->>'id')::uuid;
  perform t.ok(r->>'outcome' = 'created', 'D proposal on v1');
  perform t.ok(t6.save(a, 1, t6.txt('ins-thirty', 'different-angle', 'New lead.'))->>'outcome' = 'created', 'D v2 saved with a proposal active (a save is never blocked)');
  perform t.ok((select status = 'proposed' and article_version = 1 from nexra_article_publication_proposals where id = p), 'D old proposal still names v1 (stale to the application)');
  perform t.ok((select status = 'drafting' and current_version = 2 and approved_version = 1 from nexra_articles where id = a), 'D article drafting at v2; v2 inherits no approval');
  perform t.ok(t6.propose(a, 1)->>'outcome' = 'not-approved', 'D v1 no longer proposable');
  perform t6.passall(a, 2);
  perform t.ok(t6.approve(a, 2)->>'outcome' = 'approved', 'D v2 approved');
  perform t.ok(t6.propose(a, 2)->>'outcome' = 'active-exists', 'D v2 while v1 proposal active: active-exists');
  perform t.ok(t6.withdraw(p)->>'outcome' = 'withdrawn', 'D v1 proposal withdrawn');
  r := t6.propose(a, 2);
  perform t.ok(r->>'outcome' = 'created' and (r->'proposal'->>'article_version')::int = 2 and (r->'proposal'->>'approval_id')::uuid = t6.aid(a, 2), 'D v2 proposal created, bound to the v2 approval');
  perform t.ok((select count(*) from nexra_article_approvals where article_id = a) = 2, 'D approvals only from C5 (two)');
end $$;
select 'DONE' as result;
