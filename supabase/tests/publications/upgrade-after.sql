-- P-L2 publications upgrade, second half (after migration 20261023120000): every stored row, the live-slug lists and
-- reads, and the functions' owner and privileges are as before; the two list functions are now stable; the table is
-- empty. Part of the local PostgreSQL test harness; run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
begin
  perform t.ok(tpu.rows() = (select rows from tpu.before), 'U every article, version, unit, C5 approval, proposal and 6.8 approval row unchanged');
  perform t.ok(tpu.lists() = (select lists from tpu.before), 'U the live slugs, their owners and the live-articles read unchanged');
  perform t.ok(tpu.fns() = (select fns from tpu.before), 'U the list, read and propose functions keep their owner, privileges, security and search_path');
  perform t.ok(tpu.propose_src() = (select propose_src from tpu.before), 'U propose: its body untouched');
  perform t.ok((select bool_and(provolatile = 's') from pg_proc where oid in ('public.nexra_article_publication_live_slugs(text)'::regprocedure,
    'public.nexra_article_publication_live_slug_article(text,text)'::regprocedure)), 'U the two list functions are now stable');
  perform t.ok((select count(*) from nexra_article_publications) = 0, 'U the publications table starts empty');
end $$;
