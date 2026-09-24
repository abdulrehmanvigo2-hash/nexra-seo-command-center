#!/usr/bin/env bash
# Local PostgreSQL test harness for the Nexra database migrations (C2, C4, C5, C6).
#
# SAFETY. This script never connects to a hosted database. It creates its own
# PostgreSQL cluster in a new temporary directory (initdb), starts it with TCP
# disabled (listen_addresses = '') on a Unix socket inside that directory,
# clears every libpq connection variable from the environment, points psql at
# that socket only, checks that the server it reached is the cluster it just
# created, and deletes the cluster on exit. No connection string, host, port,
# password or service file is read from the environment or from any file.
#
# Usage:  bash supabase/tests/run.sh [suite ...]
#   suites: c2 c4 c5 c6 c6-races c6-d3-gap c6-rollback   (default: all, in that order)
# Needs:  bash, PostgreSQL 16 server binaries (initdb, pg_ctl, postgres, psql, createdb).
#         Set PG_BIN to their directory if `pg_config --bindir` does not find them.
#         When run as root, the server runs as the OS user NEXRA_DB_TEST_OS_USER
#         (default: postgres) through runuser, since PostgreSQL refuses to run as root.
#         Set NEXRA_DB_TEST_KEEP=1 to keep the temporary cluster for inspection.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$REPO/supabase/migrations"
SEED="$REPO/supabase/seed.sql"
C6_MIGRATION="$MIGRATIONS/20260925120000_create_article_publication_proposals.sql"

# Expected assertion counts: a suite that stops early or loses assertions fails.
declare -A EXPECTED=([c2]=54 [c4]=60 [c5]=69 [c6]=146)

# --- Isolation from any configured database -------------------------------------------
PG_BIN_OVERRIDE="${PG_BIN:-}"
for v in $(env | sed -n 's/^\(PG[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
unset DATABASE_URL SUPABASE_DB_URL POSTGRES_URL POSTGRES_PRISMA_URL POSTGRES_URL_NON_POOLING 2>/dev/null || true
export PGPASSFILE=/nonexistent/nexra-db-test/pgpass PGSERVICEFILE=/nonexistent/nexra-db-test/pg_service.conf PGSYSCONFDIR=/nonexistent/nexra-db-test

# --- PostgreSQL binaries ---------------------------------------------------------------
PG_BIN="$PG_BIN_OVERRIDE"
if [ -z "$PG_BIN" ]; then
  if command -v pg_config >/dev/null 2>&1 && [ -x "$(pg_config --bindir)/initdb" ]; then PG_BIN="$(pg_config --bindir)";
  elif [ -x /usr/lib/postgresql/16/bin/initdb ]; then PG_BIN=/usr/lib/postgresql/16/bin;
  else echo "run.sh: PostgreSQL server binaries not found; set PG_BIN" >&2; exit 2; fi
fi
for b in initdb pg_ctl postgres psql createdb dropdb; do
  [ -x "$PG_BIN/$b" ] || { echo "run.sh: $PG_BIN/$b not found" >&2; exit 2; }
done
PG_MAJOR="$("$PG_BIN/postgres" --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/')"
[ "$PG_MAJOR" = "16" ] || echo "run.sh: warning: validated on PostgreSQL 16, found $PG_MAJOR" >&2

# --- Disposable cluster ----------------------------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nexra-db-test.XXXXXX")"
DATA="$WORK/data"; SOCK="$WORK/sock"; LOG="$WORK/server.log"; OUT="$WORK/out"
mkdir -p "$SOCK" "$OUT"
PORT=$((55000 + RANDOM % 900))

as_server() {
  if [ "$(id -u)" = "0" ]; then runuser -u "${NEXRA_DB_TEST_OS_USER:-postgres}" -- "$@"; else "$@"; fi
}
if [ "$(id -u)" = "0" ]; then chown -R "${NEXRA_DB_TEST_OS_USER:-postgres}" "$WORK"; fi

cleanup() {
  as_server "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  if [ "${NEXRA_DB_TEST_KEEP:-0}" = "1" ]; then echo "kept: $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

as_server "$PG_BIN/initdb" -D "$DATA" --username=postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
as_server "$PG_BIN/pg_ctl" -D "$DATA" -l "$LOG" -w \
  -o "-c listen_addresses='' -k $SOCK -p $PORT -c fsync=off" start >/dev/null

export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=nexra
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1)

# Refuse to continue unless the server reached is the cluster created above.
REACHED="$("$PG_BIN/psql" -X -At -d postgres -c "select setting from pg_settings where name = 'data_directory'")"
[ "$(cd "$REACHED" && pwd -P)" = "$(cd "$DATA" && pwd -P)" ] || { echo "run.sh: connected to an unexpected server ($REACHED); stopping" >&2; exit 3; }
[ "$("$PG_BIN/psql" -X -At -d postgres -c "show listen_addresses")" = "" ] || { echo "run.sh: TCP is enabled; stopping" >&2; exit 3; }

# --- Helpers ---------------------------------------------------------------------------
FAILED=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }

# A fresh database: the API roles, then every migration in order.
fresh_db() {
  "$PG_BIN/dropdb" --if-exists nexra 2>/dev/null
  "$PG_BIN/createdb" nexra
  "${PSQL[@]}" -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end \$\$;"
  local skip="${1:-}" f
  for f in "$MIGRATIONS"/*.sql; do
    [ "$f" = "$skip" ] && continue
    "${PSQL[@]}" -f "$f" >/dev/null
  done
}

# Runs SQL files in order; checks exit status and the number of assertions reported.
run_sql_suite() {
  local name="$1" pattern="$2"; shift 2
  local log="$OUT/$name.log" count
  if "${PSQL[@]}" "${@/#/-f}" >"$log" 2>&1; then
    count="$(grep -c "$pattern" "$log" || true)"
    if [ "$count" = "${EXPECTED[$name]}" ]; then pass "$name: $count assertions"
    else fail "$name: $count assertions, expected ${EXPECTED[$name]} (set NEXRA_DB_TEST_KEEP=1 to keep $log)"; fi
  else
    fail "$name: stopped with an error"; grep -E "ERROR|FAIL" "$log" | head -5 | sed 's/^/      /'
  fi
}

ms() { date +%s%3N; }

# Session 1 runs $1 in an open transaction held for 2 s; session 2 runs $2 0.5 s later.
# Sets R1, R2 (answers) and WAIT_MS (how long session 2 took).
race() {
  local s1="$1" s2="$2" t0 t1
  "$PG_BIN/psql" -X -Atq -c "begin" -c "$s1" -c "select pg_sleep(2)" -c "commit" >"$OUT/race1" 2>&1 &
  local bg=$!
  sleep 0.5
  t0=$(ms); R2="$("$PG_BIN/psql" -X -Atq -c "$s2" 2>&1)"; t1=$(ms)
  wait "$bg" || true
  R1="$(tr -d '\n' <"$OUT/race1")"; WAIT_MS=$((t1 - t0))
}

# check <label> <condition-result> : records a pass or a failure.
check() { if [ "$2" = "0" ]; then pass "$1"; else fail "$1"; fi; }
q() { "$PG_BIN/psql" -X -Atq -v ON_ERROR_STOP=1 -c "$1"; }

# --- Suites ----------------------------------------------------------------------------
suite_c2() {
  fresh_db
  "${PSQL[@]}" -f "$SEED" >/dev/null
  run_sql_suite c2 "PASS " "$HERE/c2/setup.sql" "$HERE/c2/tests.sql"
  local t0 t1 a b
  "$PG_BIN/psql" -X -Atq -f "$HERE/c2/race-create-a.sql" >"$OUT/c2a" 2>&1 & local bg=$!
  sleep 0.5; t0=$(ms); b="$("$PG_BIN/psql" -X -Atq -f "$HERE/c2/race-create-b.sql" 2>&1)"; t1=$(ms); wait "$bg" || true; a="$(cat "$OUT/c2a")"
  check "c2 race create/create: A=${a} B=${b} (B waited $((t1 - t0)) ms)" "$([ "$a" = "A|created" ] && [ "$b" = "B|exists" ] && [ $((t1 - t0)) -ge 1000 ]; echo $?)"
  "$PG_BIN/psql" -X -Atq -f "$HERE/c2/race-save-a.sql" >"$OUT/c2a" 2>&1 & bg=$!
  sleep 0.5; t0=$(ms); b="$("$PG_BIN/psql" -X -Atq -f "$HERE/c2/race-save-b.sql" 2>&1 | grep '^B|')"; t1=$(ms); wait "$bg" || true; a="$(cat "$OUT/c2a")"
  check "c2 race save/save: A=${a} B=${b} (B waited $((t1 - t0)) ms)" "$([ "$a" = "A|created" ] && [ "$b" = "B|stale" ] && [ $((t1 - t0)) -ge 1000 ]; echo $?)"
}

suite_c4() {
  fresh_db
  run_sql_suite c4 "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c4/tests.sql"
}

suite_c5() {
  fresh_db
  run_sql_suite c5 "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c5/tests.sql"
}

c6_base() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/c5/setup.sql" -f "$HERE/c6/setup.sql" >/dev/null
}

suite_c6() {
  fresh_db
  run_sql_suite c6 "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/c6/tests.sql"
}

# Two sessions contend on proposals; session 2 must wait for session 1 and answer as listed.
suite_c6_races() {
  c6_base
  q "select t6.ready(n, t6.txt(s)) from (values (40,'k-forty'),(41,'k-fortyone'),(42,'k-fortytwo'),(43,'k-fortythree'),(44,'same-slug'),(45,'same-slug'),(46,'k-fortysix'),(47,'k-fortyseven'),(48,'other-slug'),(49,'other-slug')) v(n, s)" >/dev/null
  local o="->>'outcome'" wd="select t6.withdraw((select id from nexra_article_publication_proposals where article_id = t6.a(%s)))->>'outcome'"
  expect_race() { # label, s1, s2, expected R1, expected R2, final-state SQL, expected final state
    race "$2" "$3"
    local final; final="$(q "$6")"
    check "c6 race $1: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, after: $final" \
      "$([ "$R1" = "$4" ] && [ "$R2" = "$5" ] && [ "$WAIT_MS" -ge 1000 ] && [ "$final" = "$7" ]; echo $?)"
  }
  expect_race "E1 propose vs save" "select t6.propose(t6.a(40), 1)$o" "select t6.save(t6.a(40), 1, t6.txt('k-forty','different-angle','New.'))$o" created created \
    "select p.article_version || ' ' || p.status || ' ' || a.status || ' v' || a.current_version from nexra_article_publication_proposals p join nexra_articles a on a.id = p.article_id where a.id = t6.a(40)" "1 proposed drafting v2"
  expect_race "E2 save vs propose" "select t6.save(t6.a(41), 1, t6.txt('k-fortyone','different-angle','New.'))$o" "select t6.propose(t6.a(41), 1)$o" created not-approved \
    "select count(*) from nexra_article_publication_proposals where article_id = t6.a(41)" "0"
  expect_race "E3 identical proposes" "select t6.propose(t6.a(42), 1)$o" "select t6.propose(t6.a(42), 1)$o" created exists \
    "select count(*) from nexra_article_publication_proposals where article_id = t6.a(42)" "1"
  expect_race "E4 conflicting proposes" "select t6.propose(t6.a(43), 1)$o" "select t6.propose(t6.a(43), 1, p_pv => repeat('b',64))$o" created active-exists \
    "select count(*) || ' ' || min(preview_sha256) from nexra_article_publication_proposals where article_id = t6.a(43)" "1 $(printf 'a%.0s' {1..64})"
  expect_race "E5 two articles, one slug" "select t6.propose(t6.a(44), 1)$o" "select t6.propose(t6.a(45), 1)$o" created slug-taken \
    "select count(*) from nexra_article_publication_proposals where slug = 'same-slug' and status = 'proposed'" "1"
  expect_race "E6 two articles, one slug, reversed" "select t6.propose(t6.a(49), 1)$o" "select t6.propose(t6.a(48), 1)$o" created slug-taken \
    "select count(*) || ' ' || bool_and(article_id = t6.a(49)) from nexra_article_publication_proposals where slug = 'other-slug' and status = 'proposed'" "1 true"
  q "select t6.propose(t6.a(46), 1)" >/dev/null
  expect_race "E7 withdraw vs propose" "$(printf "$wd" 46)" "select t6.propose(t6.a(46), 1)$o" withdrawn created \
    "select string_agg(status, ',' order by created_at) from nexra_article_publication_proposals where article_id = t6.a(46)" "withdrawn,proposed"
  q "select t6.propose(t6.a(47), 1)" >/dev/null
  expect_race "E8 propose vs withdraw" "select t6.propose(t6.a(47), 1)$o" "$(printf "$wd" 47)" exists withdrawn \
    "select string_agg(status, ',') from nexra_article_publication_proposals where article_id = t6.a(47)" "withdrawn"
  expect_race "E9 withdraw vs withdraw" "$(printf "$wd" 40)" "$(printf "$wd" 40)" withdrawn already-withdrawn \
    "select string_agg(status, ',') from nexra_article_publication_proposals where article_id = t6.a(40)" "withdrawn"
}

# D3: characterises the KNOWN, DOCUMENTED gap between draft and article proposals (see the
# C6 migration header). It passes while the gap is present exactly as documented; when D3
# is fixed, G1 and G2 must be changed to expect slug-taken.
suite_c6_d3_gap() {
  c6_base
  "${PSQL[@]}" -f "$HERE/c6/d3-gap-setup.sql" >/dev/null
  local a d counts
  a="$(q "select t6.propose(t6.a(60), 1)->>'outcome'")"
  d="$(q "select t6.dprop('d6000000-0000-4000-8000-000000000001', 'gap-one')")"
  counts="$(q "select (select count(*) from nexra_article_publication_proposals where slug = 'gap-one' and status = 'proposed') || '/' || (select count(*) from nexra_content_publication_proposals where slug = 'gap-one' and status = 'proposed')")"
  check "c6 D3 G1 (reverse direction, sequential): article=$a then draft=$d; active article/draft = $counts — gap reproduced" \
    "$([ "$a" = created ] && [ "$d" = created ] && [ "$counts" = "1/1" ]; echo $?)"
  race "select t6.dprop('d6000000-0000-4000-8000-000000000002', 'gap-two')" "select t6.propose(t6.a(61), 1)->>'outcome'"
  counts="$(q "select (select count(*) from nexra_article_publication_proposals where slug = 'gap-two' and status = 'proposed') || '/' || (select count(*) from nexra_content_publication_proposals where slug = 'gap-two' and status = 'proposed')")"
  check "c6 D3 G2 (concurrent): draft=$R1, article=$R2 without waiting (${WAIT_MS} ms); active article/draft = $counts — gap reproduced" \
    "$([ "$R1" = created ] && [ "$R2" = created ] && [ "$WAIT_MS" -lt 1000 ] && [ "$counts" = "1/1" ]; echo $?)"
  q "select t6.ready(62, t6.txt('gap-two'))" >/dev/null
  a="$(q "select t6.propose(t6.a(62), 1)->>'outcome'")"
  check "c6 D3 G3 (control, forward direction): a committed draft proposal blocks an article: $a" "$([ "$a" = slug-taken ]; echo $?)"
}

# A C6 migration that fails part-way leaves nothing behind; after the conflict is removed it applies.
suite_c6_rollback() {
  fresh_db "$C6_MIGRATION"
  q "create function public.nexra_article_publication_withdraw(text, uuid, uuid) returns jsonb language sql as 'select null::jsonb'" >/dev/null
  if "${PSQL[@]}" --single-transaction -f "$C6_MIGRATION" >"$OUT/rollback.log" 2>&1; then fail "c6 rollback: the conflicting migration applied"; return; fi
  local left
  left="$(q "select (to_regclass('public.nexra_article_publication_proposals') is null)
    and not exists (select 1 from pg_proc where proname in ('nexra_article_publication_propose','nexra_article_publication_destination_allowed','nexra_article_publication_live_slugs') or proname like 'nexra_article_publication_proposals_%')
    and not exists (select 1 from pg_indexes where indexname like 'nexra_article_publication_proposals%')
    and (select count(*) = 1 and bool_and(prosrc = 'select null::jsonb') from pg_proc where proname = 'nexra_article_publication_withdraw')")"
  check "c6 rollback: a failed apply leaves no partial objects" "$([ "$left" = t ]; echo $?)"
  q "drop function public.nexra_article_publication_withdraw(text, uuid, uuid)" >/dev/null
  if "${PSQL[@]}" --single-transaction -f "$C6_MIGRATION" >/dev/null 2>&1; then pass "c6 rollback: clean apply after the conflict is removed"; else fail "c6 rollback: clean apply failed"; fi
}

# --- Main ------------------------------------------------------------------------------
SUITES=("$@"); [ ${#SUITES[@]} -eq 0 ] && SUITES=(c2 c4 c5 c6 c6-races c6-d3-gap c6-rollback)
echo "Disposable PostgreSQL $PG_MAJOR cluster at $WORK (Unix socket only)"
for s in "${SUITES[@]}"; do
  case "$s" in
    c2) suite_c2 ;; c4) suite_c4 ;; c5) suite_c5 ;; c6) suite_c6 ;;
    c6-races) suite_c6_races ;; c6-d3-gap) suite_c6_d3_gap ;; c6-rollback) suite_c6_rollback ;;
    *) echo "run.sh: unknown suite $s" >&2; exit 2 ;;
  esac
done
if [ "$FAILED" = "0" ]; then echo "ALL DATABASE SUITES PASSED"; else echo "DATABASE SUITES FAILED"; exit 1; fi
