-- D3: one active publication proposal per destination and slug across the draft and article
-- proposal tables (20260926120000). Schema, security, both orders, retries, withdrawal,
-- rollback, direct privileged inserts and the isolation guard. The concurrent cases are the
-- c6-d3-races suite in run.sh.
-- Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh,
-- which creates and destroys its own disposable cluster. Never run against a hosted database.

\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- S: schema and security.
do $$
declare f text := 'public.nexra_publication_proposals_reserve_slug()'; tb text;
begin
  perform t.ok(to_regprocedure(f) is not null, 'S trigger function exists');
  perform t.ok((select not prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid = f::regprocedure), 'S not security definer; empty search_path; owned by the migration owner');
  foreach tb in array array['nexra_content_publication_proposals', 'nexra_article_publication_proposals'] loop
    perform t.ok((select count(*) = 1 and bool_and(tgenabled = 'O') and bool_and(pg_get_triggerdef(oid) like '%BEFORE INSERT ON public.' || tb || ' FOR EACH ROW WHEN ((new.status = ''proposed''::text)) EXECUTE FUNCTION nexra_publication_proposals_reserve_slug()')
      from pg_trigger where tgrelid = ('public.' || tb)::regclass and tgfoid = f::regprocedure), 'S one enabled BEFORE INSERT row trigger, for proposed rows, on ' || tb);
  end loop;
  perform t.ok('nexra_article_publication_proposals_check_insert' < 'nexra_article_publication_proposals_reserve_slug', 'S the C6 binding check fires before the lock (trigger name order)');
  create role t6_nobody nologin;
  perform t.ok(not has_function_privilege('t6_nobody', f, 'execute') and not has_function_privilege('anon', f, 'execute')
    and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('service_role', f, 'execute'), 'S no PUBLIC, anon, authenticated or service_role execute');
  drop role t6_nobody;
  perform t.ok(has_table_privilege('service_role', 'public.nexra_content_publication_proposals', 'select,update') and not has_table_privilege('service_role', 'public.nexra_content_publication_proposals', 'insert')
    and has_table_privilege('service_role', 'public.nexra_article_publication_proposals', 'select') and not has_table_privilege('service_role', 'public.nexra_article_publication_proposals', 'insert,update'), 'S table grants unchanged');
  perform t.ok(pg_catalog.hashtext('nexra-agency-website/r-five-a') <> pg_catalog.hashtext('nexra-agency-website/r-five-b'), 'S the race suite''s two different slugs have different lock keys');
end $$;

-- T: one active reservation per destination and slug, sequentially.
do $$
declare a1 uuid; a2 uuid; a3 uuid; a5 uuid; d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid;
begin
  a1 := t6.ready(70, t6.txt('s-one')); a2 := t6.ready(71, t6.txt('s-two')); a3 := t6.ready(72, t6.txt('s-three-a')); a5 := t6.ready(73, t6.txt('s-five'));
  d1 := t6.dready(70); d2 := t6.dready(71); d3 := t6.dready(72); d4 := t6.dready(73); d5 := t6.dready(74);

  perform t.ok(t6.dprop(d1, 's-one') = 'created', 'T1 draft proposal first: created');
  perform t.ok(t6.propose(a1, 1)->>'outcome' = 'slug-taken' and t6.held('s-one') = '0/1', 'T1 then an article for the same slug: slug-taken; one active (draft)');

  perform t.ok(t6.propose(a2, 1)->>'outcome' = 'created', 'T2 article proposal first: created');
  perform t.ok(t6.dprop(d2, 's-two') = 'slug-taken' and t6.held('s-two') = '1/0', 'T2 then a draft for the same slug: slug-taken; one active (article)  [G1 fixed]');

  perform t.ok(t6.propose(a3, 1)->>'outcome' = 'created' and t6.dprop(d3, 's-three-b') = 'created', 'T3 different slugs, same destination: both created');
  perform t.ok(t6.dprop(d4, 's-two', 'other-site') = 'created' and t6.held('s-two', 'other-site') = '0/1' and t6.held('s-two') = '1/0', 'T4 same slug at another destination: created (the exact pair is what is reserved)');

  perform t.ok(t6.propose(a2, 1)->>'outcome' = 'exists' and t6.dprop(d1, 's-one') = 'exists', 'T5 identical retries: exists on both sides, nothing written');
  perform t.ok(t6.held('s-one') = '0/1' and t6.held('s-two') = '1/0', 'T5 still one active each');

  perform t.ok(t6.awithdraw(a2) = 'withdrawn' and t6.held('s-two') = '0/0', 'T6 article withdrawn: the slug is free');
  perform t.ok(t6.dprop(d5, 's-two') = 'created' and t6.held('s-two') = '0/1', 'T6 then a draft for it: created');
  perform t.ok(t6.dwithdraw(d1) = 1 and t6.held('s-one') = '0/0', 'T6 draft withdrawn (application UPDATE): the slug is free');
  perform t.ok(t6.propose(a1, 1)->>'outcome' = 'created' and t6.held('s-one') = '1/0', 'T6 then an article for it: created');
  perform t.ok((select count(*) from nexra_article_publication_proposals where slug in ('s-one','s-two')) = 2
    and (select count(*) from nexra_content_publication_proposals where slug in ('s-one','s-two') and destination = 'nexra-agency-website') = 2, 'T7 withdrawn proposals stay in history (2 article rows, 2 draft rows)');
  perform t.ok(t6.propose(a5, 1)->>'outcome' = 'created', 'T8 (fixture for rollback and direct inserts)');
end $$;

-- R: a rolled-back proposal reserves nothing.
begin;
select t.ok(t6.dprop(t6.dready(75), 's-roll') = 'created', 'R draft proposal inside a transaction: created');
rollback;
do $$ begin
  perform t.ok(t6.held('s-roll') = '0/0', 'R after rollback: nothing active');
  perform t.ok(t6.propose(t6.ready(75, t6.txt('s-roll')), 1)->>'outcome' = 'created' and t6.held('s-roll') = '1/0', 'R an article then takes the slug: created');
end $$;

-- P: direct privileged inserts are held to the rule too.
do $$
declare a uuid := t6.ready(76, t6.txt('s-direct')); d uuid := t6.dready(76); ap nexra_article_approvals; m text;
begin
  select * into ap from nexra_article_approvals where id = t6.aid(a, 1);
  begin
    insert into nexra_content_publication_proposals (project_id, draft_id, version, version_id, content_sha256, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
      values ('nexra-agency', d, 1, ('d6300000' || substr(d::text, 9))::uuid, repeat('1',64), gen_random_uuid(), now(), 'nexra-agency-website', 's-five', 'draft-section-text/1', repeat('1',64), gen_random_uuid());
    perform t.ok(false, 'direct draft insert must fail');
  exception when unique_violation then get stacked diagnostics m = message_text;
    perform t.ok(m like '%s-five is held by an active article proposal%', 'P direct draft insert over an active article slug: 23505 (' || m || ')');
  end;
  perform t.ok(t6.dprop(d, 's-direct') = 'created', 'P (a draft holds s-direct)');
  begin
    insert into nexra_article_publication_proposals (project_id, article_id, article_version, article_version_id, content_sha256, approval_id, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by)
      values ('nexra-agency', a, 1, t5.vid(a,1), t5.sha(a,1), ap.id, ap.approved_by, ap.approved_at, 'nexra-agency-website', 's-direct', 'article-proposal-text/1', repeat('a',64), gen_random_uuid());
    perform t.ok(false, 'direct article insert must fail');
  exception when unique_violation then get stacked diagnostics m = message_text;
    perform t.ok(m like '%s-direct is held by an active draft proposal%', 'P direct article insert over an active draft slug: 23505 (' || m || ')');
  end;
  insert into nexra_content_publication_proposals (project_id, draft_id, version, version_id, content_sha256, approved_by, approved_at, destination, slug, preview_format, preview_sha256, requested_by, status, withdrawn_by, withdrawn_at)
    values ('nexra-agency', d, 1, ('d6300000' || substr(d::text, 9))::uuid, repeat('1',64), gen_random_uuid(), now(), 'nexra-agency-website', 's-five', 'draft-section-text/1', repeat('1',64), gen_random_uuid(), 'withdrawn', gen_random_uuid(), now());
  perform t.ok(t6.held('s-five') = '1/0', 'P a direct insert of a withdrawn row is history only: allowed, reserves nothing');
end $$;

-- I: the isolation guard fails closed; a conflict is always an outcome, never an error, under READ COMMITTED.
do $$ begin perform t6.ready(78, t6.txt('s-iso')); perform t6.dready(78); end $$;
begin transaction isolation level repeatable read;
do $$ begin
  begin perform t6.propose(t6.a(78), 1); perform t.ok(false, 'RR article propose must fail');
  exception when feature_not_supported then perform t.ok(true, 'I article proposal under REPEATABLE READ: 0A000'); end;
  begin perform t6.dprop(t6.dd(78), 's-iso'); perform t.ok(false, 'RR draft propose must fail');
  exception when feature_not_supported then perform t.ok(true, 'I draft proposal under REPEATABLE READ: 0A000'); end;
end $$;
commit;
begin transaction isolation level serializable;
do $$ begin
  begin perform t6.propose(t6.a(78), 1); perform t.ok(false, 'SERIALIZABLE article propose must fail');
  exception when feature_not_supported then perform t.ok(true, 'I article proposal under SERIALIZABLE: 0A000'); end;
  begin perform t6.dprop(t6.dd(78), 's-iso'); perform t.ok(false, 'SERIALIZABLE draft propose must fail');
  exception when feature_not_supported then perform t.ok(true, 'I draft proposal under SERIALIZABLE: 0A000'); end;
end $$;
commit;
do $$ begin
  perform t.ok(t6.held('s-iso') = '0/0', 'I nothing written under REPEATABLE READ or SERIALIZABLE');
  perform t.ok(t6.propose(t6.a(78), 1)->>'outcome' = 'created' and t6.dprop(t6.dd(78), 's-iso') = 'slug-taken', 'I under READ COMMITTED: created, then slug-taken returned as an outcome (no error)');
end $$;
