-- M4 article citations (migration 20261026120000): sections A (the objects), B (the count function by format), C
-- (check_content and the versions check: format 3 accepted only with 1 to 20 citations; formats 1 and 2 refused when
-- they carry citations), D (create and save through the article functions). Runs over c4/setup.sql. Part of the local
-- PostgreSQL test harness; run only through supabase/tests/run.sh. Never run against a hosted database.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t26;
create function t26.txt(p_format int, p_att jsonb default null, p_cit jsonb default null, p_slug text default 'cited-article') returns text language sql immutable as $$
  select '{"format":"nexra-article-content/' || p_format || '","topic":"t","slug":' || to_jsonb(p_slug)::text || ',"lead":"A lead.","topicDecision":"different-angle"'
      || case when p_att is null then '' else ',"attestations":' || p_att::text end
      || case when p_cit is null then '' else ',"citations":' || p_cit::text end || '}'
$$;
create function t26.cit(n int default 1) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('url', 'https://alpha.example/' || i, 'title', 'Guide ' || i, 'publisher', 'Alpha', 'retrievedAt', '2026-10-03') order by i) from generate_series(1, n) i $$;
create function t26.sha(p text) returns text language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function t26.att() returns jsonb language sql immutable as $$ select '[{"locator":"s1/0","basis":"opinion"}]'::jsonb $$;
-- A completed content plan run of halcyon-fintech, to create an article from.
create function t26.plan() returns uuid language plpgsql security definer as $$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at, finished_at, executor, result_summary, attempt_count)
  values (v, 'halcyon-fintech', 'content-strategist', 'content-plan-review', encode(sha256(convert_to(v::text, 'UTF8')), 'hex'), 'completed', '00000000-0000-4000-8000-0000000000aa', now(), now(), 'ai', 'plan', 1);
  return v;
end $$;

grant usage on schema t26 to service_role;
grant usage on schema t to service_role;
grant execute on all functions in schema t to service_role;
grant execute on all functions in schema t26 to service_role;

-- A: the objects keep their settings.
do $$
begin
  perform t.ok((select not prosecdef and provolatile = 'i' and proconfig = array['search_path=""'] from pg_proc where proname = 'nexra_article_attested_count'), 'A count: immutable, not security definer, empty search_path');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_article_attested_count(text)', 'EXECUTE'), 'A count: executable by no API role');
  perform t.ok((select not prosecdef and proconfig = array['search_path=""'] from pg_proc where proname = 'nexra_article_check_content'), 'A check_content: not security definer, empty search_path');
  perform t.ok(not has_function_privilege('service_role', 'public.nexra_article_check_content(text,text)', 'EXECUTE'), 'A check_content: executable by no API role');
  perform t.ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'nexra_article_versions_canonical_format') like '%nexra-article-content/3%', 'A the versions check names format 3');
end $$;

-- B: the count, by format.
do $$
begin
  perform t.ok(public.nexra_article_attested_count(t26.txt(1)) = 0, 'B format 1: 0');
  perform t.ok(public.nexra_article_attested_count(t26.txt(1, p_cit => t26.cit())) is null, 'B format 1 carrying citations: refused');
  perform t.ok(public.nexra_article_attested_count(t26.txt(2, t26.att())) = 1, 'B format 2: the list length');
  perform t.ok(public.nexra_article_attested_count(t26.txt(2, t26.att(), t26.cit())) is null, 'B format 2 carrying citations: refused');
  perform t.ok(public.nexra_article_attested_count(t26.txt(3, p_cit => t26.cit(2))) = 0, 'B format 3 without attestations: 0');
  perform t.ok(public.nexra_article_attested_count(t26.txt(3, t26.att(), t26.cit())) = 1, 'B format 3 with attestations: the list length');
  perform t.ok(public.nexra_article_attested_count(t26.txt(3)) is null, 'B format 3 without citations: refused');
  perform t.ok(public.nexra_article_attested_count(t26.txt(3, p_cit => '[]')) is null, 'B format 3 with an empty list: refused');
  perform t.ok(public.nexra_article_attested_count(t26.txt(3, p_cit => t26.cit(21))) is null, 'B format 3 with 21 citations: refused');
  perform t.ok(public.nexra_article_attested_count(t26.txt(3, '[]', t26.cit())) is null, 'B format 3 with an empty attestation list: refused');
  perform t.ok(public.nexra_article_attested_count(t26.txt(4, p_cit => t26.cit())) is null, 'B an unknown format: refused');
end $$;

-- C: check_content.
do $$
declare v text;
begin
  v := t26.txt(3, p_cit => t26.cit());
  perform t.ok(public.nexra_article_check_content(v, t26.sha(v)) is null, 'C format 3 with citations: accepted');
  perform t.ok(public.nexra_article_check_content(v, repeat('0', 64)) = 'content-mismatch', 'C a wrong hash: content-mismatch');
  perform t.ok(public.nexra_article_check_content(t26.txt(3), t26.sha(t26.txt(3))) = 'invalid-content', 'C format 3 without citations: invalid-content');
  perform t.ok(public.nexra_article_check_content(t26.txt(1, p_cit => t26.cit()), t26.sha(t26.txt(1, p_cit => t26.cit()))) = 'invalid-content', 'C format 1 with citations: invalid-content');
  perform t.ok(public.nexra_article_check_content(t26.txt(1), t26.sha(t26.txt(1))) is null and public.nexra_article_check_content(t26.txt(2, t26.att()), t26.sha(t26.txt(2, t26.att()))) is null, 'C formats 1 and 2: accepted as before');
end $$;

-- D: the versions table's own check (guards bypassed with replication role, so only the check speaks).
do $$
declare v text;
begin
  set local session_replication_role = replica;
  v := t26.txt(3, p_cit => t26.cit());
  insert into nexra_article_versions (id, article_id, version, origin, canonical_content, content_sha256, created_by)
  values ('b0000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-000000000001', 30, 'operator', v, t26.sha(v), '00000000-0000-4000-8000-0000000000aa');
  perform t.ok(exists (select 1 from nexra_article_versions where id = 'b0000000-0000-4000-8000-0000000000c3'), 'D a format 3 text passes the versions check');
  perform t.ok(t.err($q$insert into nexra_article_versions (id, article_id, version, origin, canonical_content, content_sha256, created_by)
    values ('b0000000-0000-4000-8000-0000000000c4', 'a0000000-0000-4000-8000-000000000001', 31, 'operator', '{"format":"nexra-article-content/4","topic":"t"}', repeat('0', 64), '00000000-0000-4000-8000-0000000000aa')$q$) = '23514', 'D an unknown format fails the versions check (23514)');
  set local session_replication_role = origin;
end $$;
