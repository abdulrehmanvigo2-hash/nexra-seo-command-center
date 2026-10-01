-- F8 upgrade, second half (after migration 20261014120000): every stored row unchanged, the new columns empty, the
-- record and approve functions untouched, and the existing rules unchanged. Part of the local PostgreSQL test harness;
-- run only through supabase/tests/run.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare b record;
begin
  select * into b from t9u.before;
  perform t.ok(t9u.rows() = b.r, 'U every article, version, unit, approval and proposal value is unchanged');
  perform t.ok(not exists (select 1 from nexra_article_check_units where carried_from_unit_id is not null or carried_from_version is not null or carry_basis is not null
    or carried_instructions_sha256 is not null or carried_evidence_sha256 is not null), 'U no existing unit is carried');
  perform t.ok(not exists (select 1 from nexra_article_approvals where carried_units <> '[]'::jsonb), 'U every existing approval reads carried_units []');
  perform t.ok(t9u.defs() = b.d, 'U the record, approve, insert-check, completeness, propose and save functions are untouched');
  perform t.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_article_check_units'::regclass and not tgisinternal)
    = b.triggers || array['nexra_article_check_units_check_carry']::text[] or
    (select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.nexra_article_check_units'::regclass and not tgisinternal)
    = (select array_agg(x order by x) from unnest(b.triggers || array['nexra_article_check_units_check_carry']::text[]) x), 'U the unit table gains exactly one trigger');
  perform t.ok(t.err(format($q$update nexra_article_check_units set status = 'passed' where article_id = %L$q$, t6.a(51))) = '23514', 'U needs-review stays final (23514)');
  perform t.ok(t.err(format($q$update nexra_article_check_units set status = 'failed' where article_id = %L and unit_index = 0$q$, t6.a(50))) = '23514', 'U a checked pass stays final (23514)');
  perform t.ok(t.err(format($q$delete from nexra_article_approvals where article_id = %L$q$, t6.a(50))) = '23514', 'U an approval stays permanent (23514)');
end $$;
