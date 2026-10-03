-- P-L2 publications (migration 20261023120000) on the full schema: the table and its security, request with every
-- refusal, start consuming the 6.8 approval, the steps in order, the live slugs from the records, the guards. Part of
-- the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- A: schema and security.
do $$
begin
  perform t.ok((select relrowsecurity from pg_class where oid = 'public.nexra_article_publications'::regclass)
    and not exists (select 1 from pg_policy where polrelid = 'public.nexra_article_publications'::regclass), 'A RLS on, no policies');
  perform t.ok(has_table_privilege('service_role', 'public.nexra_article_publications', 'select')
    and not has_table_privilege('service_role', 'public.nexra_article_publications', 'insert')
    and not has_table_privilege('service_role', 'public.nexra_article_publications', 'update')
    and not has_table_privilege('service_role', 'public.nexra_article_publications', 'delete')
    and not has_table_privilege('anon', 'public.nexra_article_publications', 'select')
    and not has_table_privilege('authenticated', 'public.nexra_article_publications', 'select'), 'A service_role SELECT only; nothing for anon or authenticated');
  perform t.ok((select bool_and(prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = current_user
                  and has_function_privilege('service_role', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
                  and not has_function_privilege('authenticated', oid, 'execute'))
                  from pg_proc where oid in ('public.nexra_article_publication_request(text,jsonb,text,uuid)'::regprocedure,
                    'public.nexra_article_publication_start(text,uuid,text,text,text,jsonb,uuid)'::regprocedure,
                    'public.nexra_article_publication_progress(text,uuid,text,jsonb,uuid)'::regprocedure)),
    'A request, start, progress: security definer, empty search_path, owned here, EXECUTE for service_role only');
  perform t.ok((select bool_and(not prosecdef and provolatile = 's' and proconfig = array['search_path=""'] and not has_function_privilege('service_role', oid, 'execute'))
                  from pg_proc where oid in ('public.nexra_article_publication_live_slugs(text)'::regprocedure, 'public.nexra_article_publication_live_slug_article(text,text)'::regprocedure)),
    'A the two list functions: stable, not security definer, empty search_path, executable by no API role');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_article_publication_files_valid(jsonb)', 'execute')
    and not has_function_privilege('service_role', 'public.nexra_article_publications_guard_insert()', 'execute'), 'A the helper and guards: executable by no API role');
  perform t.ok((select count(*) from pg_trigger where tgrelid = 'public.nexra_article_publications'::regclass and not tgisinternal and tgenabled = 'O') = 4, 'A four guard triggers, enabled');
  perform t.ok(public.nexra_article_publication_live_slugs('nexra-agency-website') = array['ai-lead-follow-up-automation','ai-dead-lead-reactivation','ai-sdr-tool','missed-call-text-back']
    and public.nexra_article_publication_live_slugs('x') = '{}', 'A with no publication the live slugs are the recorded four, in order');
  perform t.ok(public.nexra_article_publication_live_slug_article('nexra-agency-website','ai-sdr-tool') = '6f50f8cb-bb85-4389-a5b4-21402c739f8b'
    and public.nexra_article_publication_live_slug_article('nexra-agency-website','ai-lead-follow-up-automation') is null
    and public.nexra_article_publication_live_slug_article('nexra-agency-website','not-live') is null, 'A the recorded owners unchanged; none for the pinned slug or a slug not live');
end $$;

-- B: request.
do $$
declare a uuid; r jsonb; p jsonb; ap jsonb; n0 bigint; na0 bigint;
begin
  a := tp.ready(50, 'publish-me');
  n0 := tp.n(); na0 := tp.na();
  perform t.ok(tp.req(a, '{}', null, 'nope')->>'outcome' = 'project-not-found', 'B unknown project: project-not-found');
  perform t.ok(tp.req(a, jsonb_build_object('article_id', gen_random_uuid()))->>'outcome' = 'article-not-found', 'B unknown article: article-not-found');
  perform t.ok(tp.req(a, jsonb_build_object('content_sha256', repeat('0', 64)))->>'outcome' = 'version-mismatch', 'B wrong content hash: version-mismatch');
  perform t.ok(tp.req(a, jsonb_build_object('article_version_id', gen_random_uuid()))->>'outcome' = 'version-mismatch', 'B wrong version row: version-mismatch');
  perform t.ok(tp.req(a, jsonb_build_object('article_version', 2))->>'outcome' = 'not-approved', 'B another version: not-approved');
  perform t.ok(tp.req(a, jsonb_build_object('article_approval_id', gen_random_uuid()))->>'outcome' = 'approval-mismatch', 'B wrong C5 approval: approval-mismatch');
  perform t.ok(tp.req(a, jsonb_build_object('proposal_id', gen_random_uuid()))->>'outcome' = 'proposal-not-active', 'B unknown proposal: proposal-not-active');
  perform t.ok(tp.req(a, jsonb_build_object('slug', 'other-slug'))->>'outcome' = 'proposal-not-active', 'B another slug: proposal-not-active');
  perform t.ok(tp.req(a, jsonb_build_object('published_on', '2026-02-30'))->>'outcome' = 'invalid'
    and tp.req(a, jsonb_build_object('published_on', '1999-01-01'))->>'reason' = 'published', 'B an impossible or out-of-range date: invalid published');
  perform t.ok(tp.req(a, jsonb_build_object('cross_link_anchor', '<a>x</a>'))->>'reason' = 'anchor'
    and tp.req(a, jsonb_build_object('cross_link_anchor', ' padded '))->>'reason' = 'anchor'
    and tp.req(a, jsonb_build_object('cross_link_anchor', 5))->>'reason' = 'anchor', 'B markup, padding or a number as the anchor: invalid anchor');
  perform t.ok(tp.req(a, jsonb_build_object('article_id', 'nope'))->>'reason' = 'ids', 'B a malformed id: invalid ids');
  perform t.ok(tp.err($q$select public.nexra_article_publication_request('nexra-agency', '[]', repeat('a', 64), tp.op())$q$) = '22023'
    and tp.err($q$select public.nexra_article_publication_request('nexra-agency', '{}', 'X', tp.op())$q$) = '22023', 'B a non-object request or a malformed digest raises 22023');
  perform t.ok(tp.n() = n0 and tp.na() = na0, 'B every refusal wrote nothing: no publication, no approval');

  r := tp.req(a, jsonb_build_object('cross_link_anchor', 'the words to link'));
  p := r->'publication'; ap := r->'approval';
  perform t.ok(r->>'outcome' = 'requested', 'B requested');
  perform t.ok(p->>'status' = 'requested' and p->>'slug' = 'publish-me' and p->>'published_on' = '2026-10-04' and p->>'cross_link_anchor' = 'the words to link'
    and p->>'payload_sha256' = tp.dig(1) and p->'mode' = 'null'::jsonb and p->'files' = 'null'::jsonb and (p->>'article_version')::int = 1,
    'B the row: requested, the bound request, no progress');
  perform t.ok(ap->>'action_kind' = 'article-publication' and (ap->>'target_id')::uuid = a and ap->>'payload_sha256' = tp.dig(1) and ap->>'decision' = 'approve'
    and ap->'used_at' = 'null'::jsonb and (ap->>'expires_at')::timestamptz - (ap->>'decided_at')::timestamptz = interval '24 hours'
    and (p->>'approval_id') = ap->>'id', 'B the 6.8 approval: article-publication on the article, the digest, approve, unused, 24 hours, named by the row');
  perform t.ok(tp.n() = n0 + 1 and tp.na() = na0 + 1, 'B one publication and one approval');
end $$;

-- C: start.
do $$
declare a uuid; p uuid; r jsonb; ap uuid; old uuid;
begin
  a := tp.ready(51, 'start-me');
  old := (tp.req(a)->'publication'->>'id')::uuid;
  p := (tp.req(a, '{}', tp.dig(2))->'publication'->>'id')::uuid;
  perform t.ok(tp.start(old)->>'outcome' = 'superseded', 'C the older request of the article: superseded');
  perform t.ok(tp.start(p, tp.dig(9))->>'outcome' = 'digest-mismatch', 'C another digest: digest-mismatch');
  perform t.ok((tp.row(p)).status = 'requested' and (select used_at is null from nexra_approvals where id = (tp.row(p)).approval_id), 'C the refusals wrote nothing: still requested, the approval unused');
  perform t.ok(tp.err(format($q$select tp.start(%L, null, 'publish')$q$, p)) = '22023'
    and tp.err(format($q$select public.nexra_article_publication_start('nexra-agency', %L, tp.dig(2), 'merge', 'abc', tp.files(), tp.op())$q$, p)) = '22023'
    and tp.err(format($q$select public.nexra_article_publication_start('nexra-agency', %L, tp.dig(2), 'merge', repeat('a', 40), '[{"path":"../x","kind":"new-file","sha256":"%s","base_sha256":null}]', tp.op())$q$, p, repeat('1', 64))) = '22023',
    'C a bad mode, commit or file path raises 22023');
  perform t.ok(tp.start(p, tp.dig(2), 'merge', 'other')->>'outcome' = 'publication-not-found', 'C another project: publication-not-found');
  r := tp.start(p, tp.dig(2));
  perform t.ok(r->>'outcome' = 'started' and r->'publication'->>'status' = 'publishing' and r->'publication'->>'mode' = 'merge'
    and r->'publication'->>'base_commit' = repeat('a', 40) and r->'publication'->'files' = tp.files(), 'C started: publishing, the mode, base commit and files');
  ap := (tp.row(p)).approval_id;
  perform t.ok((select used_at is not null and used_by = tp.op() from nexra_approvals where id = ap), 'C the approval is used, by the operator');
  perform t.ok(tp.start(p, tp.dig(2))->>'outcome' = 'resume' and (tp.row(p)).status = 'publishing', 'C a second start resumes and writes nothing');
  perform t.ok(tp.req(a, '{}', tp.dig(3))->>'outcome' = 'publication-in-progress', 'C a new request while one is publishing: publication-in-progress');
end $$;

-- D: not eligible at start — the proposal withdrawn after the request; the approval stays unused.
do $$
declare a uuid; p uuid; r jsonb;
begin
  a := tp.ready(52, 'withdrawn-later');
  p := (tp.req(a)->'publication'->>'id')::uuid;
  perform t.ok(t6.withdraw(tp.proposal(a))->>'outcome' = 'withdrawn', 'D the proposal withdrawn after the request');
  r := tp.start(p);
  perform t.ok(r->>'outcome' = 'not-eligible' and r->>'reason' = 'proposal-not-active', 'D start: not-eligible, proposal-not-active');
  perform t.ok((tp.row(p)).status = 'requested' and (select used_at is null from nexra_approvals where id = (tp.row(p)).approval_id), 'D nothing written, the approval unused');
end $$;

-- E: the steps, in order; the slug becomes live from the records.
do $$
declare a uuid; b uuid; p uuid; r jsonb; live jsonb;
begin
  a := tp.ready(53, 'goes-live');
  p := (tp.req(a)->'publication'->>'id')::uuid;
  perform t.ok(tp.step(p, 'pull-request-open', tp.pr())->>'outcome' = 'out-of-order', 'E a pull request before start: out-of-order');
  perform t.ok(tp.step(p, 'error', '{"code":"x","step":"render"}')->>'outcome' = 'out-of-order', 'E an error before start: out-of-order');
  perform tp.start(p);
  perform t.ok(tp.step(p, 'merged', jsonb_build_object('merge_commit', repeat('c', 40)))->>'outcome' = 'out-of-order', 'E merged before a pull request: out-of-order');
  perform t.ok(tp.step(p, 'shipped')->>'reason' = 'step' and tp.step(p, 'pull-request-open', tp.pr() || '{"pull_request_url":"https://evil.example/x"}')->>'reason' = 'pull-request'
    and tp.step(p, 'error', '{"code":"Bad Code","step":"x"}')->>'reason' = 'error', 'E an unknown step, a non-GitHub URL or a malformed error code: invalid');
  r := tp.step(p, 'error', '{"code":"github-unavailable","step":"commit"}');
  perform t.ok(r->>'outcome' = 'recorded' and r->'publication'->>'status' = 'publishing' and r->'publication'->>'last_error_code' = 'github-unavailable'
    and r->'publication'->>'last_error_step' = 'commit', 'E an error is recorded without changing the status');
  r := tp.step(p, 'pull-request-open', tp.pr());
  perform t.ok(r->>'outcome' = 'recorded' and r->'publication'->>'status' = 'pull-request-open' and (r->'publication'->>'pull_request_number')::int = 7
    and r->'publication'->'last_error_code' = 'null'::jsonb, 'E pull-request-open: recorded, the error cleared');
  perform t.ok(tp.step(p, 'pull-request-open', tp.pr())->>'outcome' = 'same', 'E the same pull request again: same');
  perform t.ok(not ('goes-live' = any (public.nexra_article_publication_live_slugs('nexra-agency-website'))), 'E an open pull request is not live');
  r := tp.step(p, 'merged', jsonb_build_object('merge_commit', repeat('c', 40)));
  perform t.ok(r->>'outcome' = 'recorded' and r->'publication'->>'status' = 'merged' and r->'publication'->>'merged_at' is not null, 'E merged: recorded');
  perform t.ok(public.nexra_article_publication_live_slugs('nexra-agency-website') = array['ai-lead-follow-up-automation','ai-dead-lead-reactivation','ai-sdr-tool','missed-call-text-back','goes-live']
    and public.nexra_article_publication_live_slug_article('nexra-agency-website', 'goes-live') = a, 'E the merged slug is live, after the recorded four, owned by its article');
  live := public.nexra_article_publication_live_articles('nexra-agency-website');
  perform t.ok(exists (select 1 from jsonb_array_elements(live) e where e->>'slug' = 'goes-live' and (e->>'articleId')::uuid = a and (e->>'articleVersion')::int = 1),
    'E the live-articles read lists it with its article and version');
  b := t6.ready(54, t6.txt('goes-live'));
  perform t.ok(t6.propose(b, 1)->>'outcome' = 'slug-live-collision', 'E another article naming the published slug: slug-live-collision');
  perform t.ok(tp.req(a, '{}', tp.dig(4))->>'outcome' = 'already-published', 'E a new request for the published article: already-published');
  perform t.ok(tp.step(p, 'merged', jsonb_build_object('merge_commit', repeat('c', 40)))->>'outcome' = 'same', 'E merged again: same');
  perform t.ok(tp.step(p, 'live')->>'outcome' = 'recorded' and (tp.row(p)).status = 'live' and (tp.row(p)).live_checked_at is not null, 'E live: recorded');
  perform t.ok(tp.step(p, 'live')->>'outcome' = 'same' and tp.step(p, 'error', '{"code":"x","step":"live"}')->>'outcome' = 'out-of-order', 'E live again: same; an error after live: out-of-order');
end $$;

-- F: dry-run — the owner merges on GitHub; the merge is recorded the same way.
do $$
declare a uuid; p uuid;
begin
  a := tp.ready(55, 'dry-run-one');
  p := (tp.req(a)->'publication'->>'id')::uuid;
  perform t.ok(tp.start(p, null, 'dry-run')->>'outcome' = 'started' and (tp.row(p)).mode = 'dry-run', 'F started in dry-run');
  perform t.ok(tp.step(p, 'pull-request-open', tp.pr(8))->>'outcome' = 'recorded', 'F the pull request recorded');
  perform t.ok(tp.step(p, 'merged', jsonb_build_object('merge_commit', repeat('d', 40)))->>'outcome' = 'recorded', 'F the owner''s merge recorded');
  perform t.ok('dry-run-one' = any (public.nexra_article_publication_live_slugs('nexra-agency-website')), 'F the slug is live');
end $$;

-- G: the guards, for every writer.
do $$
declare p uuid := (select id from nexra_article_publications where slug = 'goes-live');
begin
  perform t.ok(tp.err($q$insert into nexra_article_publications (project_id, article_id, article_version, article_version_id, content_sha256, article_approval_id, proposal_id, destination, slug, published_on, payload_sha256, approval_id, requested_by)
    select project_id, article_id, article_version, article_version_id, content_sha256, article_approval_id, proposal_id, destination, 'x-y-z', published_on, payload_sha256, gen_random_uuid(), requested_by
      from nexra_article_publications limit 1$q$) = '23514', 'G a direct insert: refused (23514)');
  perform t.ok(tp.err(format($q$update nexra_article_publications set status = 'requested' where id = %L$q$, p)) = '23514', 'G a direct update: refused (23514)');
  perform t.ok(tp.err(format($q$select set_config('nexra.publication_write', %L, true); update nexra_article_publications set slug = 'changed-slug' where id = %L$q$, p, p)) = '23514',
    'G a bound column changed even under the flag: refused (23514)');
  perform t.ok(tp.err(format($q$delete from nexra_article_publications where id = %L$q$, p)) = '23514', 'G delete: refused (23514)');
  perform t.ok(tp.err($q$truncate nexra_article_publications$q$) in ('23514', '0A000'), 'G truncate: refused');
  perform t.ok(tp.n() = 6, 'G nothing was added or removed');
end $$;

-- H: as service_role, the table is read-only.
set role service_role;
do $$
begin
  perform t.ok(tp.err($q$update nexra_article_publications set mode = 'merge'$q$) = '42501'
    and tp.err($q$delete from nexra_article_publications$q$) = '42501', 'H service_role: no direct update or delete (42501)');
  perform t.ok((select count(*) from nexra_article_publications) = 6, 'H service_role reads the table');
end $$;
reset role;

-- I: abandon — a publication that never merged (its pull request closed, or its head moved) can be abandoned; its
-- article may then be requested again. A requested, merged or live publication cannot be abandoned.
do $$
declare a uuid; p uuid; q uuid; r jsonb;
begin
  a := tp.ready(56, 'abandon-me');
  p := (tp.req(a)->'publication'->>'id')::uuid;
  perform t.ok(tp.step(p, 'abandon')->>'outcome' = 'out-of-order', 'I a requested publication cannot be abandoned');
  perform tp.start(p);
  perform tp.step(p, 'pull-request-open', tp.pr(9));
  r := tp.step(p, 'abandon');
  perform t.ok(r->>'outcome' = 'recorded' and r->'publication'->>'status' = 'abandoned' and (r->'publication'->>'pull_request_number')::int = 9,
    'I abandoned from pull-request-open, its pull request kept on the row');
  perform t.ok(tp.step(p, 'abandon')->>'outcome' = 'same' and tp.step(p, 'merged', jsonb_build_object('merge_commit', repeat('e', 40)))->>'outcome' = 'out-of-order'
    and tp.step(p, 'error', '{"code":"x","step":"merge"}')->>'outcome' = 'out-of-order', 'I abandoned is final: same again; no merge or error after it');
  perform t.ok(not ('abandon-me' = any (public.nexra_article_publication_live_slugs('nexra-agency-website'))), 'I an abandoned publication is not live');
  r := tp.req(a, '{}', tp.dig(5));
  perform t.ok(r->>'outcome' = 'requested', 'I the article may be requested again');
  q := (r->'publication'->>'id')::uuid;
  perform t.ok(tp.start(q, tp.dig(5))->>'outcome' = 'started', 'I and the new request starts');
  perform t.ok(tp.step((select id from nexra_article_publications where slug = 'goes-live'), 'abandon')->>'outcome' = 'out-of-order', 'I a live publication cannot be abandoned');
end $$;
