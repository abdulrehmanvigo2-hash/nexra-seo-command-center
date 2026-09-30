-- 6.12a fixtures (schema t12): the owning article of the slug published after the pin, created through the real
-- create function with its production id. Runs after c6/setup.sql. Part of the local PostgreSQL test harness; run only
-- through supabase/tests/run.sh, which creates and destroys its own disposable cluster. Never run against a hosted database.
\set ON_ERROR_STOP 1
create schema t12;
-- Article n, version 1 with the given text, every unit passed, approved, created with the given id: the id column's
-- default is set for the one create call and restored at once (the harness owns the cluster; no row is written by hand).
create function t12.ready_as(p_id uuid, n int, p_txt text) returns uuid language plpgsql as $$
declare a uuid;
begin
  execute format('alter table public.nexra_articles alter column id set default %L::uuid', p_id);
  a := t6.ready(n, p_txt);
  alter table public.nexra_articles alter column id set default gen_random_uuid();
  if a <> p_id then raise exception 'ready_as: created % not %', a, p_id; end if;
  return a;
end $$;
create function t12.owner() returns uuid language sql as $$ select '1003104c-6b25-456f-9304-eefa2ba88e7d'::uuid $$;
