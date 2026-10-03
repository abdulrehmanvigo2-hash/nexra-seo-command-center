-- P-L2 publications fixtures (schema tp): approved and proposed articles through the real C5 and C6 functions, and
-- helpers that build a request from the stored rows. Runs after c6/setup.sql. Part of the local PostgreSQL test
-- harness; run only through supabase/tests/run.sh, which creates and destroys its own disposable cluster. Never run
-- against a hosted database.
\set ON_ERROR_STOP 1
create schema tp;

create function tp.err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'none';
exception when others then
  return sqlstate;
end $$;

create function tp.op() returns uuid language sql immutable as $$ select '00000000-0000-4000-8000-0000000000ee'::uuid $$;
create function tp.dig(n int) returns text language sql immutable as $$ select encode(sha256(convert_to('request-' || n, 'UTF8')), 'hex') $$;

-- Article n with the given slug: version 1, every unit passed, approved (C5) and proposed (C6). Returns the article id.
create function tp.ready(n int, p_slug text) returns uuid language plpgsql as $$
declare a uuid; r jsonb;
begin
  a := t6.ready(n, t6.txt(p_slug));
  r := t6.propose(a, 1);
  if r->>'outcome' <> 'created' then raise exception 'propose failed: %', r; end if;
  return a;
end $$;

create function tp.proposal(a uuid) returns uuid language sql as $$
  select id from nexra_article_publication_proposals where article_id = a and status = 'proposed' order by created_at desc, id desc limit 1
$$;

-- A request for article a, version 1, from the stored rows; any field may be overridden through p_patch.
create function tp.request(a uuid, p_patch jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'article_id', a, 'article_version', 1, 'article_version_id', t5.vid(a, 1), 'content_sha256', t5.sha(a, 1),
    'article_approval_id', t6.aid(a, 1), 'proposal_id', tp.proposal(a), 'destination', 'nexra-agency-website',
    'slug', (select canonical_content::jsonb->>'slug' from nexra_article_versions where article_id = a and version = 1),
    'published_on', '2026-10-04', 'cross_link_anchor', null) || p_patch
$$;

create function tp.req(a uuid, p_patch jsonb default '{}'::jsonb, p_digest text default null, p_project text default 'nexra-agency') returns jsonb language sql as $$
  select public.nexra_article_publication_request(p_project, tp.request(a, p_patch), coalesce(p_digest, tp.dig(1)), tp.op())
$$;

create function tp.files() returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('path', 'app/blog/x/page.tsx', 'kind', 'new-file', 'sha256', repeat('1', 64), 'base_sha256', null),
    jsonb_build_object('path', 'lib/blog.ts', 'kind', 'modify', 'sha256', repeat('2', 64), 'base_sha256', repeat('3', 64)))
$$;

create function tp.start(p uuid, p_digest text default null, p_mode text default 'merge', p_project text default 'nexra-agency') returns jsonb language sql as $$
  select public.nexra_article_publication_start(p_project, p, coalesce(p_digest, tp.dig(1)), p_mode, repeat('a', 40), tp.files(), tp.op())
$$;

create function tp.step(p uuid, p_step text, p_detail jsonb default '{}'::jsonb, p_project text default 'nexra-agency') returns jsonb language sql as $$
  select public.nexra_article_publication_progress(p_project, p, p_step, p_detail, tp.op())
$$;

create function tp.pr(n int default 7) returns jsonb language sql immutable as $$
  select jsonb_build_object('branch', 'nexra-publish/x-' || n, 'pull_request_number', n,
    'pull_request_url', 'https://github.com/abdulrehmanvigo2-hash/nexra-ai/pull/' || n, 'head_commit', repeat('b', 40))
$$;

create function tp.n() returns bigint language sql as $$ select count(*) from nexra_article_publications $$;
create function tp.na() returns bigint language sql as $$ select count(*) from nexra_approvals $$;
create function tp.row(p uuid) returns nexra_article_publications language sql as $$ select * from nexra_article_publications where id = p $$;

-- Section H runs as service_role: it may use the test helpers, never a table write.
grant usage on schema t, tp to service_role;
grant execute on all functions in schema t, tp to service_role;
