#!/usr/bin/env bash
# Local PostgreSQL test harness for the Nexra database migrations (C2, C4, C5, C6, M1 Search Console snapshots).
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
#   suites: c2 c4 c5 drafts drafts-races c6 c6-races c6-d3 c6-d3-races c6-d3-preflight c6-rollback gsc gsc-races
#           (default: all, in that order)
# Needs:  bash, PostgreSQL 16 server binaries (initdb, pg_ctl, postgres, psql, createdb).
#         Set PG_BIN to their directory if `pg_config --bindir` does not find them.
#         When run as root, the server runs as the OS user NEXRA_DB_TEST_OS_USER
#         (default: postgres) through runuser, since PostgreSQL refuses to run as root.
#         Set NEXRA_DB_TEST_KEEP=1 to keep the temporary cluster for inspection.

set -euo pipefail
trap 'echo "run.sh: aborted at line $LINENO: $BASH_COMMAND" >&2' ERR

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$REPO/supabase/migrations"
SEED="$REPO/supabase/seed.sql"
C6_MIGRATION="$MIGRATIONS/20260925120000_create_article_publication_proposals.sql"
D3_MIGRATION="$MIGRATIONS/20260926120000_publication_proposals_cross_table_slug_lock.sql"

# Expected assertion counts: a suite that stops early or loses assertions fails.
declare -A EXPECTED=([c2]=54 [c4]=60 [c5]=69 [c6]=146 [drafts]=40 [c6-d3]=35 [gsc]=100)

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

# A fresh database: the API roles, then every migration in order — or, given a migration
# file, only the migrations before it.
fresh_db() {
  "$PG_BIN/dropdb" --if-exists nexra 2>/dev/null
  "$PG_BIN/createdb" nexra
  "${PSQL[@]}" -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end \$\$;"
  local stop="${1:-}" f
  for f in "$MIGRATIONS"/*.sql; do
    [ -n "$stop" ] && [ "$f" = "$stop" ] && break
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

# Session 1 runs $1 in an open transaction held for 2 s, then commits (or runs $3, e.g.
# rollback); session 2 runs $2 0.5 s later. Sets R1, R2 (answers) and WAIT_MS (how long
# session 2 took).
race() {
  local s1="$1" s2="$2" end="${3:-commit}" t0 t1
  "$PG_BIN/psql" -X -Atq -c "begin" -c "$s1" -c "select pg_sleep(2)" -c "$end" >"$OUT/race1" 2>&1 &
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

# Draft publication proposals (Stage 5A): the existing draft workflow, as a regression suite.
suite_drafts() {
  fresh_db
  run_sql_suite drafts "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/drafts/setup.sql" "$HERE/drafts/tests.sql"
}

# Two sessions on draft proposals; session 2 must wait for session 1 and answer as listed.
suite_drafts_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/drafts/setup.sql" >/dev/null
  q "select td.ready(n) from generate_series(20, 25) n" >/dev/null
  local o="->>'outcome'" final
  race "select td.propose(td.d(20), 'r-one')$o" "select td.propose(td.d(21), 'r-one')$o"
  final="$(q "select td.active('r-one')")"
  check "drafts race two drafts, one slug: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, active $final" \
    "$([ "$R1" = created ] && [ "$R2" = slug-taken ] && [ "$WAIT_MS" -ge 1000 ] && [ "$final" = 1 ]; echo $?)"
  race "select td.propose(td.d(22), 'r-two')$o" "select td.propose(td.d(22), 'r-two')$o"
  final="$(q "select count(*) from nexra_content_publication_proposals where draft_id = td.d(22)")"
  check "drafts race identical proposes: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows $final" \
    "$([ "$R1" = created ] && [ "$R2" = exists ] && [ "$WAIT_MS" -ge 1000 ] && [ "$final" = 1 ]; echo $?)"
  race "select td.propose(td.d(23), 'r-three')$o" "select public.nexra_content_draft_save_version(td.d(23), 'halcyon-fintech', 1::smallint, 'T2', 'B2', '00000000-0000-4000-8000-0000000000aa')$o"
  final="$(q "select p.version || ' ' || p.status || ' ' || d.status || ' v' || d.current_version from nexra_content_publication_proposals p join nexra_content_drafts d on d.id = p.draft_id where d.id = td.d(23)")"
  check "drafts race propose vs save: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, after: $final" \
    "$([ "$R1" = created ] && [ "$R2" = created ] && [ "$WAIT_MS" -ge 1000 ] && [ "$final" = "1 proposed drafting v2" ]; echo $?)"
  q "select td.propose(td.d(24), 'r-four')" >/dev/null
  race "select td.withdraw((select id from nexra_content_publication_proposals where draft_id = td.d(24)))" "select td.propose(td.d(25), 'r-four')$o"
  final="$(q "select string_agg(d.n::text || ':' || p.status, ',' order by d.n) from nexra_content_publication_proposals p join (values (24), (25)) d(n) on p.draft_id = td.d(d.n)")"
  check "drafts race withdraw vs propose (same slug): s1=$R1 s2=$R2, waited ${WAIT_MS} ms, after: $final" \
    "$([ "$R1" = 1 ] && [ "$R2" = created ] && [ "$WAIT_MS" -ge 1000 ] && [ "$final" = "24:withdrawn,25:proposed" ]; echo $?)"
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

# D3 (20260926120000): one active proposal per destination and slug across both tables.
d3_base() {
  c6_base
  "${PSQL[@]}" -f "$HERE/c6/d3-setup.sql" >/dev/null
}

suite_c6_d3() {
  fresh_db
  run_sql_suite c6-d3 "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/c6/d3-setup.sql" "$HERE/c6/d3-tests.sql"
}

# Two sessions contend across the draft and article tables. Session 2 must end as listed,
# and exactly one proposal per destination and slug may be active afterwards.
suite_c6_d3_races() {
  d3_base
  q "select t6.ready(n, t6.txt('r-' || n)), t6.dready(n) from generate_series(80, 89) n" >/dev/null
  local o="->>'outcome'" held
  # held <slug>: '<active article>/<active draft>'
  held() { q "select t6.held('$1')"; }
  d3_race() { # label, s1, s2, expected R1, expected R2, wait (ge|lt), slug, expected held, [end]
    race "$2" "$3" "${9:-commit}"
    local h; h="$(held "$7")"
    local waited=1
    if [ "$6" = ge ] && [ "$WAIT_MS" -ge 1000 ]; then waited=0; fi
    if [ "$6" = lt ] && [ "$WAIT_MS" -lt 1000 ]; then waited=0; fi
    check "c6-d3 race $1: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, active article/draft $h" \
      "$([ "$R1" = "$4" ] && [ "$R2" = "$5" ] && [ "$waited" = 0 ] && [ "$h" = "$8" ]; echo $?)"
  }
  d3_race "D1 draft first, article meanwhile [G2 fixed]" "select t6.dprop(t6.dd(80), 'r-80')" "select t6.propose(t6.a(80), 1)$o" created slug-taken ge r-80 "0/1"
  d3_race "D2 article first, draft meanwhile [G2, reverse order]" "select t6.propose(t6.a(81), 1)$o" "select t6.dprop(t6.dd(81), 'r-81')" created slug-taken ge r-81 "1/0"
  d3_race "D3 two drafts, one slug" "select t6.dprop(t6.dd(82), 'r-82')" "select t6.dprop(t6.dd(83), 'r-82')" created slug-taken ge r-82 "0/1"
  q "select t6.ready(90, t6.txt('r-five-a'))" >/dev/null
  d3_race "D4 different slugs, article and draft: no wait" "select t6.propose(t6.a(90), 1)$o" "select t6.dprop(t6.dd(84), 'r-five-b')" created created lt r-five-a "1/0"
  check "c6-d3 race D4 (the draft's slug): active article/draft $(held r-five-b)" "$([ "$(held r-five-b)" = "0/1" ]; echo $?)"
  d3_race "D5 draft proposes then ROLLS BACK; article meanwhile" "select t6.dprop(t6.dd(85), 'r-85')" "select t6.propose(t6.a(85), 1)$o" created created ge r-85 "1/0" rollback
  q "select t6.propose(t6.a(86), 1)" >/dev/null
  d3_race "D6 article withdrawal (open) vs draft propose" "select t6.awithdraw(t6.a(86))" "select t6.dprop(t6.dd(86), 'r-86')" withdrawn slug-taken lt r-86 "0/0"
  check "c6-d3 race D6 retry after the withdrawal commits: $(q "select t6.dprop(t6.dd(86), 'r-86')") / $(held r-86)" "$([ "$(held r-86)" = "0/1" ]; echo $?)"
  q "select t6.dprop(t6.dd(87), 'r-87')" >/dev/null
  d3_race "D7 draft withdrawal (open) vs article propose" "select t6.dwithdraw(t6.dd(87))" "select t6.propose(t6.a(87), 1)$o" 1 slug-taken lt r-87 "0/0"
  check "c6-d3 race D7 retry after the withdrawal commits: $(q "select t6.propose(t6.a(87), 1)->>'outcome'") / $(held r-87)" "$([ "$(held r-87)" = "1/0" ]; echo $?)"
  q "select t6.dprop(t6.dd(88), 'r-88')" >/dev/null
  d3_race "D8 article propose refused (open) vs withdrawal of the draft holding the slug" "select t6.propose(t6.a(88), 1)$o" "select t6.dwithdraw(t6.dd(88))" slug-taken 1 lt r-88 "0/0"
  check "c6-d3 race D8 retry after both: $(q "select t6.propose(t6.a(88), 1)->>'outcome'") / $(held r-88)" "$([ "$(held r-88)" = "1/0" ]; echo $?)"

  # Stress: 12 sessions at once, 3 articles and 3 drafts on each of two slugs.
  q "select t6.ready(n, t6.txt(case when n < 94 then 'st-a' else 'st-b' end)), t6.dready(n) from generate_series(91, 96) n" >/dev/null
  local n pids=() out log_from
  log_from=$(($(wc -c <"$LOG") + 1))
  for n in 91 92 93 94 95 96; do
    local slug=st-a; [ "$n" -ge 94 ] && slug=st-b
    "$PG_BIN/psql" -X -Atq -c "select t6.propose(t6.a($n), 1)->>'outcome'" >"$OUT/st-a$n" 2>&1 & pids+=($!)
    "$PG_BIN/psql" -X -Atq -c "select t6.dprop(t6.dd($n), '$slug')" >"$OUT/st-d$n" 2>&1 & pids+=($!)
  done
  wait "${pids[@]}" || true
  out="$(cat "$OUT"/st-* | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  local created unexpected
  created="$(cat "$OUT"/st-* | grep -cx created || true)"
  unexpected="$(cat "$OUT"/st-* | grep -cvx 'created\|slug-taken' || true)"
  local ha hb; ha="$(held st-a)"; hb="$(held st-b)"
  check "c6-d3 stress 12 sessions, 2 slugs: outcomes [$out] active article/draft st-a $ha, st-b $hb" \
    "$([ "$created" = 2 ] && [ "$unexpected" = 0 ] && [ $(( ${ha%/*} + ${ha#*/} )) = 1 ] && [ $(( ${hb%/*} + ${hb#*/} )) = 1 ]; echo $?)"
  check "c6-d3 stress: no deadlock or error in the server log during the run" "$(! tail -c +"$log_from" "$LOG" | grep -qiE 'deadlock|ERROR'; echo $?)"
}

# The D3 migration refuses to apply over an existing cross-table duplicate, leaving nothing.
suite_c6_d3_preflight() {
  fresh_db "$D3_MIGRATION"
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/c5/setup.sql" -f "$HERE/c6/setup.sql" -f "$HERE/c6/d3-setup.sql" >/dev/null
  local a d
  a="$(q "select t6.propose(t6.ready(80, t6.txt('pf-dup')), 1)->>'outcome'")"
  d="$(q "select t6.dprop(t6.dready(80), 'pf-dup')")"
  check "c6-d3 preflight: without D3 the duplicate is possible (article=$a, draft=$d)" "$([ "$a" = created ] && [ "$d" = created ]; echo $?)"
  if "${PSQL[@]}" --single-transaction -f "$D3_MIGRATION" >"$OUT/preflight.log" 2>&1; then fail "c6-d3 preflight: applied over a duplicate"; return; fi
  local left; left="$(q "select to_regprocedure('public.nexra_publication_proposals_reserve_slug()') is null and not exists (select 1 from pg_trigger where tgname like '%reserve_slug')")"
  check "c6-d3 preflight: refused ($(grep -o 'nexra D3 preflight: [0-9]* destination/slug pair' "$OUT/preflight.log")), nothing created" "$([ "$left" = t ]; echo $?)"
  q "select t6.dwithdraw(t6.dd(80))" >/dev/null
  if "${PSQL[@]}" --single-transaction -f "$D3_MIGRATION" >/dev/null 2>&1; then pass "c6-d3 preflight: applies once one of the pair is withdrawn"; else fail "c6-d3 preflight: clean apply failed"; fi
}

# A C6 migration that fails part-way leaves nothing behind; after the conflict is removed it applies.
# The database holds only the migrations before C6.
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

# Search Console snapshots (M1 CP1a): schema, security, validation, recording, immutability.
suite_gsc() {
  fresh_db
  run_sql_suite gsc "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/gsc/tests.sql"
}

# Two sessions capture the same window at once: the second waits for the first, exactly one row.
suite_gsc_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/gsc/setup.sql" >/dev/null
  local rows
  race "select t.snap()->>'outcome'" "select t.snap(p_clicks => 7)->>'outcome'"
  rows="$(q "select count(*) || '/' || min(clicks) from public.nexra_search_console_snapshots where project_id = 'halcyon-fintech'")"
  check "gsc race G1 same window: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows/clicks $rows" \
    "$([ "$R1" = created ] && [ "$R2" = exists ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/120" ]; echo $?)"
  race "select t.snap(p_end => t.win_end(9), p_start => t.win_start(9))->>'outcome'" "select t.snap(p_end => t.win_end(9), p_start => t.win_start(9), p_clicks => 7)->>'outcome'" rollback
  rows="$(q "select count(*) || '/' || min(clicks) from public.nexra_search_console_snapshots where end_date = t.win_end(9)")"
  check "gsc race G2 first rolls back: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows/clicks $rows" \
    "$([ "$R1" = created ] && [ "$R2" = created ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/7" ]; echo $?)"
  race "select t.snap(p_end => t.win_end(10), p_start => t.win_start(10))->>'outcome'" "select t.snap(p_end => t.win_end(11), p_start => t.win_start(11))->>'outcome'"
  check "gsc race G3 different windows do not wait: s1=$R1 s2=$R2, waited ${WAIT_MS} ms" \
    "$([ "$R1" = created ] && [ "$R2" = created ] && [ "$WAIT_MS" -lt 1000 ]; echo $?)"
}

# --- Main ------------------------------------------------------------------------------
SUITES=("$@"); [ ${#SUITES[@]} -eq 0 ] && SUITES=(c2 c4 c5 drafts drafts-races c6 c6-races c6-d3 c6-d3-races c6-d3-preflight c6-rollback gsc gsc-races)
echo "Disposable PostgreSQL $PG_MAJOR cluster at $WORK (Unix socket only)"
for s in "${SUITES[@]}"; do
  case "$s" in
    c2) suite_c2 ;; c4) suite_c4 ;; c5) suite_c5 ;; c6) suite_c6 ;;
    drafts) suite_drafts ;; drafts-races) suite_drafts_races ;;
    c6-races) suite_c6_races ;; c6-d3) suite_c6_d3 ;; c6-d3-races) suite_c6_d3_races ;;
    c6-d3-preflight) suite_c6_d3_preflight ;; c6-rollback) suite_c6_rollback ;;
    gsc) suite_gsc ;; gsc-races) suite_gsc_races ;;
    *) echo "run.sh: unknown suite $s" >&2; exit 2 ;;
  esac
done
if [ "$FAILED" = "0" ]; then echo "ALL DATABASE SUITES PASSED"; else echo "DATABASE SUITES FAILED"; exit 1; fi
