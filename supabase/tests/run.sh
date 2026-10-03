#!/usr/bin/env bash
# Local PostgreSQL test harness for the Nexra database migrations (C2, C4, C5, C6, M1 Search Console snapshots and query pages, T3 crawl findings, T5 crawl signals, M2 content signals, M3 finding triage, agent tasks, their workflow, their priority and the learning loop, curated keywords, the delete and truncate guards, approval records, operator-attested paragraphs, live slugs published after the template pin, the surplus grants revoked, the legacy crawl subsystem retired, check-result carry-forward, the live articles read from the records, and the F0 provider keyword snapshot).
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
#   suites: c2 c4 c5 drafts drafts-races c6 c6-races c6-d3 c6-d3-races c6-d3-preflight c6-rollback gsc gsc-races gsc-pairs gsc-pairs-races findings findings-races signals signals-upgrade content content-upgrade triage triage-races tasks task-workflow task-priority task-learning keywords keywords-races guards claim-races approvals approvals-races attested attested-upgrade live-slugs live-slugs-upgrade grants grants-upgrade legacy-retire legacy-retire-refusals carry carry-upgrade live-articles live-slug-2 live-slug-2-upgrade live-slug-3 live-slug-3-upgrade provider provider-races topic-maps topic-maps-upgrade pinned-keywords pinned-keywords-upgrade opportunities opportunities-upgrade
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
T5_MIGRATION="$MIGRATIONS/20260929120000_extend_crawl_page_signals.sql"
M2_MIGRATION="$MIGRATIONS/20261001120000_extend_crawl_page_content_signals.sql"
PRIORITY_MIGRATION="$MIGRATIONS/20261005120000_agent_task_priority.sql"
LEARNING_MIGRATION="$MIGRATIONS/20261008120000_task_priority_director_run.sql"
ATTESTED_MIGRATION="$MIGRATIONS/20261010120000_attested_paragraphs.sql"
LIVE_SLUGS_MIGRATION="$MIGRATIONS/20261011120000_live_slugs_after_pin.sql"
LIVE_SLUG_2_MIGRATION="$MIGRATIONS/20261017120000_live_slug_ai_sdr_tool.sql"
LIVE_SLUG_3_MIGRATION="$MIGRATIONS/20261018120000_live_slug_missed_call_text_back.sql"
TOPIC_MAPS_MIGRATION="$MIGRATIONS/20261019120000_topic_maps.sql"
PINNED_KEYWORDS_MIGRATION="$MIGRATIONS/20261020120000_pinned_article_keywords.sql"
OPPORTUNITIES_MIGRATION="$MIGRATIONS/20261021120000_opportunities.sql"
GRANTS_MIGRATION="$MIGRATIONS/20261012120000_revoke_surplus_grants.sql"
LEGACY_MIGRATION="$MIGRATIONS/20261013120000_retire_legacy_crawl_subsystem.sql"
CARRY_MIGRATION="$MIGRATIONS/20261014120000_check_unit_carry_forward.sql"

# Expected assertion counts: a suite that stops early or loses assertions fails.
declare -A EXPECTED=([c2]=54 [c4]=60 [c5]=69 [c6]=146 [drafts]=40 [c6-d3]=35 [gsc]=100 [gsc-pairs]=94 [findings]=109 [signals]=36 [signals-upgrade]=7 [content]=38 [content-upgrade]=7 [triage]=84 [tasks]=80 [task-workflow]=150 [task-priority]=69 [task-learning]=58 [keywords]=126 [guards]=38 [approvals]=63 [attested]=51 [attested-upgrade]=7 [live-slugs]=21 [live-slugs-upgrade]=10 [grants]=23 [grants-upgrade]=11 [legacy-retire]=11 [carry]=47 [carry-upgrade]=10 [live-articles]=14 [live-slug-2]=21 [live-slug-2-upgrade]=12 [live-slug-3]=22 [live-slug-3-upgrade]=12 [topic-maps]=64 [topic-maps-upgrade]=7 [pinned-keywords]=14 [pinned-keywords-upgrade]=8 [opportunities]=50 [opportunities-upgrade]=9 [provider]=163)

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

# C4 pins the C4 schema: the check-unit table and its one security definer function, before F8's carry columns and functions.
suite_c4() {
  fresh_db "$CARRY_MIGRATION"
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

# Runs on the schema as 20261010120000 left it (every migration before the live-slug one), which is what it pins:
# the pinned live slug only. The slugs published after the pin are the live-slugs suite's.
suite_c6() {
  fresh_db "$LIVE_SLUGS_MIGRATION"
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

# Search Console query × page rows (M1 P4c): schema, security, validation, recording, immutability.
suite_gsc_pairs() {
  fresh_db
  run_sql_suite gsc-pairs "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/gsc-pairs/setup.sql" "$HERE/gsc-pairs/tests.sql"
}

# Two sessions record the same window at once: the second waits on the advisory lock, answers exists, one set.
suite_gsc_pairs_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/gsc/setup.sql" -f "$HERE/gsc-pairs/setup.sql" >/dev/null
  local rows
  race "select t.qp()->>'outcome'" "select t.qp(p_pairs => t.pairs(5))->>'outcome'"
  rows="$(q "select count(*) from public.nexra_search_console_query_pages where project_id = 'halcyon-fintech'")"
  check "gsc-pairs race P1 same window: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows $rows" \
    "$([ "$R1" = created ] && [ "$R2" = exists ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "3" ]; echo $?)"
  race "select t.qp(p_end => t.win_end(9), p_start => t.win_start(9))->>'outcome'" "select t.qp(p_end => t.win_end(9), p_start => t.win_start(9), p_pairs => t.pairs(5))->>'outcome'" rollback
  rows="$(q "select count(*) from public.nexra_search_console_query_pages where end_date = t.win_end(9)")"
  check "gsc-pairs race P2 first rolls back: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows $rows" \
    "$([ "$R1" = created ] && [ "$R2" = created ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "5" ]; echo $?)"
  race "select t.qp(p_end => t.win_end(10), p_start => t.win_start(10))->>'outcome'" "select t.qp(p_end => t.win_end(11), p_start => t.win_start(11))->>'outcome'"
  check "gsc-pairs race P3 different windows do not wait: s1=$R1 s2=$R2, waited ${WAIT_MS} ms" \
    "$([ "$R1" = created ] && [ "$R2" = created ] && [ "$WAIT_MS" -lt 1000 ]; echo $?)"
}

# --- Main ------------------------------------------------------------------------------
# Crawl findings (T3): schema, security, validation, recording, immutability, cascade, isolation.
suite_findings() {
  fresh_db
  run_sql_suite findings "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/findings/setup.sql" "$HERE/findings/tests.sql"
}

# Two sessions record the same crawl at once: the second waits for the first, exactly one report.
suite_findings_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/findings/setup.sql" >/dev/null
  local rows
  race "select t.frec()->>'outcome'" "select t.frec(p_findings => t.findings(5), p_counts => '{\"h1-missing\": 5}')->>'outcome'"
  rows="$(q "select count(*) || '/' || sum(findings_total) from public.nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000001'")"
  check "findings race F1 same crawl: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, reports/total $rows" \
    "$([ "$R1" = created ] && [ "$R2" = exists ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/2" ]; echo $?)"
  race "select t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000002')->>'outcome'" "select t.frec(p_crawl => 'c0000000-0000-4000-8000-000000000002', p_findings => t.findings(5), p_counts => '{\"h1-missing\": 5}')->>'outcome'" rollback
  rows="$(q "select count(*) || '/' || sum(findings_total) from public.nexra_crawl_findings_reports where crawl_id = 'c0000000-0000-4000-8000-000000000002'")"
  check "findings race F2 first rolls back: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, reports/total $rows" \
    "$([ "$R1" = created ] && [ "$R2" = created ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/5" ]; echo $?)"
  race "select t.frec(p_version => 7::smallint)->>'outcome'" "select t.frec(p_version => 8::smallint)->>'outcome'"
  check "findings race F3 different rule versions do not wait: s1=$R1 s2=$R2, waited ${WAIT_MS} ms" \
    "$([ "$R1" = created ] && [ "$R2" = created ] && [ "$WAIT_MS" -lt 1000 ]; echo $?)"
}

# Crawl signals (T5): the added columns, their constraints, privileges, and the findings category set.
suite_signals() {
  fresh_db
  run_sql_suite signals "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/findings/setup.sql" "$HERE/signals/setup.sql" "$HERE/signals/tests.sql"
}

# The T5 migration applied over rows written before it: nothing lost, every new column null, new writes work.
suite_signals_upgrade() {
  fresh_db "$T5_MIGRATION"
  run_sql_suite signals-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/findings/setup.sql" "$HERE/signals/upgrade-before.sql" "$T5_MIGRATION" "$HERE/signals/upgrade-after.sql"
}

# Crawl content signals (M2): the added columns, their constraints, privileges, the findings category set, and T5 untouched.
suite_content() {
  fresh_db
  run_sql_suite content "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/findings/setup.sql" "$HERE/content/setup.sql" "$HERE/content/tests.sql"
}

# The M2 migration applied over rows written before it (through M1 P4c): nothing lost, every new column null, new writes work.
suite_content_upgrade() {
  fresh_db "$M2_MIGRATION"
  run_sql_suite content-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/findings/setup.sql" "$HERE/content/upgrade-before.sql" "$M2_MIGRATION" "$HERE/content/upgrade-after.sql"
}

# Crawl finding triage (M3): schema, security, every outcome of the set function, guards, binding, isolation, the findings untouched.
suite_triage() {
  fresh_db
  run_sql_suite triage "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/findings/setup.sql" "$HERE/triage/setup.sql" "$HERE/triage/tests.sql"
}

# Two operators decide the same finding at once: the second waits for the first, one row, the later decision wins.
suite_triage_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/findings/setup.sql" -f "$HERE/triage/setup.sql" >/dev/null
  local rows
  race "select t.tset(p_status => 'acknowledged')->>'outcome'" "select t.tset(p_status => 'resolved')->>'previous'"
  rows="$(q "select count(*) || '/' || string_agg(status, ',') from public.nexra_crawl_finding_triage where project_id = 'halcyon-fintech'")"
  check "triage race R1 same key: s1=$R1 s2(previous)=$R2, waited ${WAIT_MS} ms, rows/status $rows" \
    "$([ "$R1" = set ] && [ "$R2" = acknowledged ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/resolved" ]; echo $?)"
  race "select t.tset(p_key => t.key2(), p_status => 'acknowledged')->>'outcome'" "select t.tset(p_key => t.key2(), p_status => 'ignored')->>'outcome'" rollback
  rows="$(q "select count(*) || '/' || string_agg(status, ',') from public.nexra_crawl_finding_triage where finding_key = t.key2()")"
  check "triage race R2 first rolls back: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows/status $rows" \
    "$([ "$R1" = set ] && [ "$R2" = set ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/ignored" ]; echo $?)"
  race "select t.tset(p_project => 'verdant-home', p_crawl => 'c0000000-0000-4000-8000-000000000005', p_key => 'title-missing:00000000000000aa')->>'outcome'" "select t.tset(p_key => t.key1(), p_status => 'open')->>'outcome'"
  check "triage race R3 different keys do not wait: s1=$R1 s2=$R2, waited ${WAIT_MS} ms" \
    "$([ "$R1" = set ] && [ "$R2" = set ] && [ "$WAIT_MS" -lt 1000 ]; echo $?)"
}

# Agent tasks (Project Manager real task core): one write function, provenance checks, guards.
suite_tasks() {
  fresh_db
  run_sql_suite tasks "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/tasks/setup.sql" "$HERE/tasks/tests.sql"
}

# Agent task workflow: events, the transition map, owner changes, handoff request and link, guards.
# Runs on the schema as 20261004120000 left it (every migration before the priority one), which is
# what it pins; the priority migration's changes to the same tables are the task-priority suite's.
suite_task_workflow() {
  fresh_db "$PRIORITY_MIGRATION"
  run_sql_suite task-workflow "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/tasks/setup.sql" "$HERE/task-workflow/tests.sql"
}

# Agent task priority (checkpoint 2.3b): the set-priority function, the priority-changed event, the guard.
# Runs on the schema as 20261005120000 left it (every migration before the learning loop's), which is what it
# pins; the learning loop's changes to the same function and table are the task-learning suite's.
suite_task_priority() {
  fresh_db "$LEARNING_MIGRATION"
  run_sql_suite task-priority "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/tasks/setup.sql" "$HERE/task-priority/tests.sql"
}

# The learning loop (checkpoint 6.7): a priority change citing a completed project Director review of the same project.
suite_task_learning() {
  fresh_db
  run_sql_suite task-learning "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/tasks/setup.sql" "$HERE/task-learning/tests.sql"
}

# Curated keywords (checkpoint 3.5): the add function, the four setters, their events, the guards.
suite_keywords() {
  fresh_db
  run_sql_suite keywords "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/keywords/setup.sql" "$HERE/keywords/tests.sql"
}

# Curated keywords under concurrency: two adds of one exact query, and two setters on one row.
suite_keywords_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/gsc/setup.sql" -f "$HERE/keywords/setup.sql" >/dev/null
  local rows
  race "select t.kadd('race query')->>'outcome'" "select t.kadd('race query')->>'outcome'"
  rows="$(q "select count(*) from public.nexra_keywords where query = 'race query'")"
  check "keywords race K1 same query: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows $rows" \
    "$([ "$R1" = added ] && [ "$R2" = exists ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = 1 ]; echo $?)"
  race "select t.kadd('rolled back')->>'outcome'" "select t.kadd('rolled back')->>'outcome'" rollback
  rows="$(q "select count(*) from public.nexra_keywords where query = 'rolled back'")"
  check "keywords race K2 first rolls back: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows $rows" \
    "$([ "$R1" = added ] && [ "$R2" = added ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = 1 ]; echo $?)"
  race "select public.nexra_keyword_set_status('halcyon-fintech', t.kid('race query'), 'paused', t.kop())->>'outcome'" \
       "select public.nexra_keyword_set_status('halcyon-fintech', t.kid('race query'), 'paused', t.kop())->>'outcome'"
  rows="$(q "select count(*) from public.nexra_keyword_events where keyword_id = t.kid('race query') and event_type = 'status-changed'")"
  check "keywords race K3 same setter: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, status events $rows" \
    "$([ "$R1" = status-changed ] && [ "$R2" = same-status ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = 1 ]; echo $?)"
  race "select t.kadd('other one')->>'outcome'" "select t.kadd('other two')->>'outcome'"
  check "keywords race K4 different queries do not wait: s1=$R1 s2=$R2, waited ${WAIT_MS} ms" \
    "$([ "$R1" = added ] && [ "$R2" = added ] && [ "$WAIT_MS" -lt 1000 ]; echo $?)"
}

# Delete and truncate guards (checkpoint 5.4): projects, runs and attempts refuse both; crawl records refuse TRUNCATE only;
# a crawl delete and the draft store's compensating delete still work.
suite_guards() {
  fresh_db
  run_sql_suite guards "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/findings/setup.sql" "$HERE/guards/tests.sql"
}

# Run claims (checkpoint 5.6): agent_run_claim locks the run row, so two workers never both claim one run.
suite_claim_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" >/dev/null
  local r1=c1000000-0000-4000-8000-000000000001 r2=c1000000-0000-4000-8000-000000000002 r3=c1000000-0000-4000-8000-000000000003 r4=c1000000-0000-4000-8000-000000000004 state
  q "insert into agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, created_at) values
    ('$r1','halcyon-fintech','technical-seo','crawl-review',repeat('a',64),'queued','00000000-0000-4000-8000-0000000000aa',now() - interval '4 minutes'),
    ('$r2','halcyon-fintech','technical-seo','crawl-review',repeat('b',64),'queued','00000000-0000-4000-8000-0000000000aa',now() - interval '3 minutes'),
    ('$r3','halcyon-fintech','technical-seo','crawl-review',repeat('c',64),'queued','00000000-0000-4000-8000-0000000000aa',now() - interval '2 minutes'),
    ('$r4','halcyon-fintech','technical-seo','crawl-review',repeat('d',64),'queued','00000000-0000-4000-8000-0000000000aa',now() - interval '1 minute')" >/dev/null
  claim() { printf "select public.agent_run_claim(%s, 'mock', '%s', 120)->>'outcome'" "$1" "$2"; }
  runstate() { q "select r.status || '/' || r.attempt_count || '/' || (select count(*) from agent_run_attempts a where a.run_id = r.id) from agent_runs r where r.id = '$1'"; }
  race "$(claim "'$r1'" w1)" "$(claim "'$r1'" w2)"
  state="$(runstate "$r1")"
  check "claim race R1 two workers, one run by id: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, status/attempt_count/attempts $state" \
    "$([ "$R1" = claimed ] && [ "$R2" = not-queued ] && [ "$WAIT_MS" -ge 1200 ] && [ "$state" = running/1/1 ]; echo $?)"
  race "$(claim "'$r2'" w1)" "$(claim "'$r2'" w2)" rollback
  state="$(runstate "$r2")"
  check "claim race R2 first claim rolls back: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, status/attempt_count/attempts $state" \
    "$([ "$R1" = claimed ] && [ "$R2" = claimed ] && [ "$WAIT_MS" -ge 1200 ] && [ "$state" = running/1/1 ]; echo $?)"
  race "select public.agent_run_claim(null, 'mock', 'w1', 120)->'run'->>'id'" "select public.agent_run_claim(null, 'mock', 'w2', 120)->'run'->>'id'"
  check "claim race R3 two queue claims take different runs, no wait: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, $(runstate "$r3") $(runstate "$r4")" \
    "$([ "$R1" = "$r3" ] && [ "$R2" = "$r4" ] && [ "$WAIT_MS" -lt 1000 ] && [ "$(runstate "$r3")" = running/1/1 ] && [ "$(runstate "$r4")" = running/1/1 ]; echo $?)"
}

# Approval records (checkpoint 6.8): recording, every consume refusal, expiry, single use, the guards, isolation.
suite_approvals() {
  fresh_db
  run_sql_suite approvals "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/approvals/tests.sql"
}

# Two sessions consume one approval at once: the second waits on the row lock and answers used; one use recorded.
suite_approvals_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/gsc/setup.sql" >/dev/null
  local digest a b used
  digest="$(q "select encode(sha256(convert_to('race', 'UTF8')), 'hex')")"
  a="$(q "select public.nexra_approval_record('halcyon-fintech', 'article-publication', 'e0000000-0000-4000-8000-000000000001', '$digest', 'approve', '00000000-0000-4000-8000-0000000000aa', 60)->'approval'->>'id'")"
  local use="select public.nexra_approval_consume('halcyon-fintech', '$a', 'article-publication', 'e0000000-0000-4000-8000-000000000001', '$digest', '00000000-0000-4000-8000-0000000000aa')->>'outcome'"
  race "$use" "$use"
  used="$(q "select count(*) filter (where used_at is not null) || '/' || count(*) from public.nexra_approvals")"
  check "approvals race A1 two consumers of one approval: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, used/rows $used" \
    "$([ "$R1" = consumed ] && [ "$R2" = used ] && [ "$WAIT_MS" -ge 1200 ] && [ "$used" = "1/1" ]; echo $?)"
  b="$(q "select public.nexra_approval_record('halcyon-fintech', 'article-publication', 'e0000000-0000-4000-8000-000000000002', '$digest', 'approve', '00000000-0000-4000-8000-0000000000aa', 60)->'approval'->>'id'")"
  use="select public.nexra_approval_consume('halcyon-fintech', '$b', 'article-publication', 'e0000000-0000-4000-8000-000000000002', '$digest', '00000000-0000-4000-8000-0000000000aa')->>'outcome'"
  race "$use" "$use" rollback
  used="$(q "select count(*) filter (where used_at is not null) from public.nexra_approvals where id = '$b'")"
  check "approvals race A2 the first use rolls back: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, used $used" \
    "$([ "$R1" = consumed ] && [ "$R2" = consumed ] && [ "$WAIT_MS" -ge 1200 ] && [ "$used" = "1" ]; echo $?)"
}

# Operator-attested paragraphs (checkpoint 6.8b): the count function, formats, the approval gate, the guards, proposals.
suite_attested() {
  # Pins the 6.8b approval table (its columns and triggers), the schema before F8 added carried_units.
  fresh_db "$CARRY_MIGRATION"
  run_sql_suite attested "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/attested/tests.sql"
}

# The 6.8b migration over an approved, proposed format 1 article: every stored byte unchanged.
suite_attested_upgrade() {
  fresh_db "$ATTESTED_MIGRATION"
  run_sql_suite attested-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/attested/upgrade-before.sql" "$ATTESTED_MIGRATION" "$HERE/attested/upgrade-after.sql"
}

# Live slugs published after the template pin (checkpoint 6.12a, D10): the lists, the owning article, other articles.
# Pinned to the schema before 20261017120000 (article 2), which adds the third slug; that one is the live-slug-2 suite's.
suite_live_slugs() {
  fresh_db "$LIVE_SLUG_2_MIGRATION"
  run_sql_suite live-slugs "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-slugs/tests.sql"
}

# The 6.12a migration over proposed articles, the owning one included: every stored row unchanged.
suite_live_slugs_upgrade() {
  fresh_db "$LIVE_SLUGS_MIGRATION"
  run_sql_suite live-slugs-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-slugs/upgrade-before.sql" "$LIVE_SLUGS_MIGRATION" "$HERE/live-slugs/upgrade-after.sql"
}

# Surplus grants revoked (fix F5, audit A2-02, A2-11): exact privileges on the seven tables, the application's writes, refusals.
suite_grants() {
  fresh_db
  run_sql_suite grants "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/findings/setup.sql" "$HERE/grants/common.sql" "$HERE/grants/tests.sql"
}

# The F5 migration over production's grants (Supabase's default ALL, a platform rls_auto_enable): rows and every other privilege unchanged.
suite_grants_upgrade() {
  fresh_db "$GRANTS_MIGRATION"
  run_sql_suite grants-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/findings/setup.sql" "$HERE/grants/common.sql" "$HERE/grants/upgrade-before.sql" "$GRANTS_MIGRATION" "$HERE/grants/upgrade-after.sql"
}

# The legacy crawl subsystem retired (fix F6, audit A0-03, A2-03): production's legacy objects rebuilt, then dropped;
# every other row and object unchanged.
suite_legacy_retire() {
  fresh_db "$LEGACY_MIGRATION"
  run_sql_suite legacy-retire "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/findings/setup.sql" "$HERE/grants/common.sql" "$HERE/legacy/fixture.sql" "$HERE/legacy/before.sql" "$LEGACY_MIGRATION" "$HERE/legacy/after.sql"
}

# The F6 migration fails closed: extra rows, a missing table, or an outside dependency refuses and drops nothing.
suite_legacy_retire_refusals() {
  local case setup expect out left
  for case in extra-row missing-table dependent-view; do
    fresh_db "$LEGACY_MIGRATION"
    "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/legacy/fixture.sql" >/dev/null
    case "$case" in
      extra-row) setup="insert into public.crawl_urls (crawl_id, url, source) values ('11000000-0000-4000-8000-000000000001', 'https://halcyon.example/new', 'homepage')"; expect="rows differ from the backup"; left="5 tables" ;;
      missing-table) setup="drop table public.crawl_links"; expect="4 of the five tables exist"; left="4 tables" ;;
      dependent-view) setup="create view public.legacy_probe as select id from public.crawls"; expect="depend"; left="5 tables" ;;
    esac
    q "$setup" >/dev/null
    out="$("${PSQL[@]}" -f "$LEGACY_MIGRATION" 2>&1 || true)"
    local tables fns rows
    tables="$(q "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in ('crawls','crawl_pages','crawl_urls','crawl_page_signals','crawl_links')") tables"
    fns="$(q "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('crawl_pages_claim','crawl_pages_recover_expired','crawl_pages_count_change','crawls_guard_update')")"
    check "legacy-retire refusal $case: refused ($(grep -o "$expect[^;]*" <<< "$out" | head -1)), nothing dropped ($tables, $fns functions)" \
      "$(grep -q "$expect" <<< "$out" && [ "$tables" = "$left" ] && [ "$fns" = "4" ]; echo $?)"
  done
}

# Check-result carry-forward (fix F8, audit A5-02, A3-03): each eligibility rule and refusal, the guards, fresh check, the approval's carried units.
suite_carry() {
  fresh_db
  run_sql_suite carry "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/carry/setup.sql" "$HERE/carry/tests.sql"
}

# The F8 migration over an approved, proposed article and a needs-review unit: every stored value and the write functions unchanged.
suite_carry_upgrade() {
  fresh_db "$CARRY_MIGRATION"
  run_sql_suite carry-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/carry/upgrade-before.sql" "$CARRY_MIGRATION" "$HERE/carry/upgrade-after.sql"
}

# The live articles read from the records (fix F9, audit A5-01): the function, its security, the owner's proposed version and keywords.
suite_live_articles() {
  fresh_db "$LIVE_SLUG_2_MIGRATION"
  run_sql_suite live-articles "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-articles/tests.sql"
}

# Article 2 (runbook §7, step 5; migration 20261017120000): ai-sdr-tool as the second slug published after the pin — the
# lists, the owning article, other articles, the live-articles read; and the migration over proposed rows, unchanged.
# Pinned to the schema before 20261018120000 (article 3), which adds the fourth slug; that one is the live-slug-3 suite's.
suite_live_slug_2() {
  fresh_db "$LIVE_SLUG_3_MIGRATION"
  run_sql_suite live-slug-2 "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-slug-2/setup.sql" "$HERE/live-slug-2/tests.sql"
}
suite_live_slug_2_upgrade() {
  fresh_db "$LIVE_SLUG_2_MIGRATION"
  run_sql_suite live-slug-2-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-slug-2/setup.sql" "$HERE/live-slug-2/upgrade-before.sql" "$LIVE_SLUG_2_MIGRATION" "$HERE/live-slug-2/upgrade-after.sql"
}

# Article 3 (runbook §7, step 5; migration 20261018120000): missed-call-text-back as the third slug published after the
# pin — the lists, the owning article, other articles, the live-articles read; and the migration over proposed rows.
suite_live_slug_3() {
  fresh_db
  run_sql_suite live-slug-3 "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-slug-2/setup.sql" "$HERE/live-slug-3/setup.sql" "$HERE/live-slug-3/tests.sql"
}
suite_live_slug_3_upgrade() {
  fresh_db "$LIVE_SLUG_3_MIGRATION"
  run_sql_suite live-slug-3-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-slug-2/setup.sql" "$HERE/live-slug-3/setup.sql" "$HERE/live-slug-3/upgrade-before.sql" "$LIVE_SLUG_3_MIGRATION" "$HERE/live-slug-3/upgrade-after.sql"
}

# M1 topical maps (migration 20261019120000): the three tables and their security, record as one set with its validation,
# superseding, approve, the guards; and the migration over existing provider rows, unchanged.
suite_topic_maps() {
  fresh_db
  run_sql_suite topic-maps "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/provider/setup.sql" "$HERE/topic-maps/setup.sql" "$HERE/topic-maps/tests.sql"
}
suite_topic_maps_upgrade() {
  fresh_db "$TOPIC_MAPS_MIGRATION"
  run_sql_suite topic-maps-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/provider/setup.sql" "$HERE/topic-maps/upgrade-before.sql" "$TOPIC_MAPS_MIGRATION" "$HERE/topic-maps/upgrade-after.sql"
}

# M2 (migration 20261020120000): the pinned follow-up article's keywords in the live-articles read — the pinned entry,
# the owners' entries, D2 unchanged, the function's security; and the migration over proposed rows, every other entry unchanged.
suite_pinned_keywords() {
  fresh_db
  run_sql_suite pinned-keywords "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-slug-2/setup.sql" "$HERE/live-slug-3/setup.sql" "$HERE/pinned-keywords/tests.sql"
}
suite_pinned_keywords_upgrade() {
  fresh_db "$PINNED_KEYWORDS_MIGRATION"
  run_sql_suite pinned-keywords-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/c5/setup.sql" "$HERE/c6/setup.sql" "$HERE/live-slugs/setup.sql" "$HERE/live-slug-2/setup.sql" "$HERE/live-slug-3/setup.sql" "$HERE/pinned-keywords/upgrade-before.sql" "$PINNED_KEYWORDS_MIGRATION" "$HERE/pinned-keywords/upgrade-after.sql"
}

# M2 opportunities (migration 20261021120000): the table and its security, accept with every refusal, the derived priority
# and owner, the task it creates, the guards; and the migration over existing tasks, events and maps, unchanged.
suite_opportunities() {
  fresh_db
  run_sql_suite opportunities "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/tasks/setup.sql" "$HERE/provider/setup.sql" "$HERE/topic-maps/setup.sql" "$HERE/opportunities/setup.sql" "$HERE/opportunities/tests.sql"
}
suite_opportunities_upgrade() {
  fresh_db "$OPPORTUNITIES_MIGRATION"
  run_sql_suite opportunities-upgrade "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/tasks/setup.sql" "$HERE/provider/setup.sql" "$HERE/topic-maps/setup.sql" "$HERE/opportunities/upgrade-before.sql" "$OPPORTUNITIES_MIGRATION" "$HERE/opportunities/setup.sql" "$HERE/opportunities/upgrade-after.sql"
}

# F0 provider keyword snapshot (migration 20261016120000): the three tables and their security, reserve against the daily
# cap (the $5.00 ceiling, sandbox never counted), request and metric records, finish, resume (Q4), the guards, isolation.
suite_provider() {
  fresh_db
  run_sql_suite provider "NOTICE:  ok - " "$HERE/c4/setup.sql" "$HERE/gsc/setup.sql" "$HERE/provider/setup.sql" "$HERE/provider/tests.sql"
}

# Two sessions reserve at once: the day's advisory lock serialises them, so two reservations never both pass the cap;
# two on one project never both open; two records of one seq never both write.
suite_provider_races() {
  fresh_db
  "${PSQL[@]}" -f "$HERE/c4/setup.sql" -f "$HERE/gsc/setup.sql" -f "$HERE/provider/setup.sql" >/dev/null
  local o="->>'outcome'" rows a
  race "select t.reserve('halcyon-fintech', 'live', 0.6, 1.00)$o" "select t.reserve('verdant-home', 'live', 0.6, 1.00)$o"
  rows="$(q "select count(*) || '/' || coalesce(sum(estimate_usd), 0) from public.nexra_provider_runs where mode = 'live'")"
  check "provider race V1 two live reserves, different projects, one cap: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, live runs/estimates $rows" \
    "$([ "$R1" = reserved ] && [ "$R2" = cap-reached ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/0.6000" ]; echo $?)"
  q "select t.finish(id, 'failed', 0, 0, 'abandoned') from public.nexra_provider_runs where status = 'reserved'" >/dev/null
  race "select t.reserve('halcyon-fintech', 'live', 0.6, 1.00)$o" "select t.reserve('verdant-home', 'live', 0.6, 1.00)$o" rollback
  rows="$(q "select count(*) || '/' || coalesce(sum(estimate_usd), 0) from public.nexra_provider_runs where status = 'reserved'")"
  check "provider race V2 the first reserve rolls back: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, open runs/estimates $rows" \
    "$([ "$R1" = reserved ] && [ "$R2" = reserved ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/0.6000" ]; echo $?)"
  q "select t.finish(id, 'failed', 0, 0, 'abandoned') from public.nexra_provider_runs where status = 'reserved'" >/dev/null
  race "select t.reserve('halcyon-fintech', 'live', 0.1, 1.00)$o" "select t.reserve('halcyon-fintech', 'live', 0.1, 1.00)$o"
  rows="$(q "select count(*) from public.nexra_provider_runs where project_id = 'halcyon-fintech' and status = 'reserved'")"
  check "provider race V3 two reserves on one project: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, open runs $rows" \
    "$([ "$R1" = reserved ] && [ "$R2" = run-active ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = 1 ]; echo $?)"
  race "select t.reserve('halcyon-fintech', 'sandbox', 0.1, 1.00)$o" "select t.reserve('verdant-home', 'sandbox', 0.1, 1.00)$o"
  check "provider race V4 two sandbox reserves on different projects do not wait: s1=$R1 s2=$R2, waited ${WAIT_MS} ms" \
    "$([ "$R1" = run-active ] && [ "$R2" = reserved ] && [ "$WAIT_MS" -lt 1000 ]; echo $?)"
  a="$(q "select id from public.nexra_provider_runs where project_id = 'halcyon-fintech' and status = 'reserved'")"
  race "select t.req('$a', 0, 'succeeded', 0.013)$o" "select t.req('$a', 0, 'succeeded', 0.5)$o"
  rows="$(q "select count(*) || '/' || min(cost_usd) from public.nexra_provider_requests where run_id = '$a'")"
  check "provider race V5 two records of one seq: s1=$R1 s2=$R2, waited ${WAIT_MS} ms, rows/cost $rows" \
    "$([ "$R1" = recorded ] && [ "$R2" = exists ] && [ "$WAIT_MS" -ge 1200 ] && [ "$rows" = "1/0.0130" ]; echo $?)"
}

SUITES=("$@"); [ ${#SUITES[@]} -eq 0 ] && SUITES=(c2 c4 c5 drafts drafts-races c6 c6-races c6-d3 c6-d3-races c6-d3-preflight c6-rollback gsc gsc-races gsc-pairs gsc-pairs-races findings findings-races signals signals-upgrade content content-upgrade triage triage-races tasks task-workflow task-priority task-learning keywords keywords-races guards claim-races approvals approvals-races attested attested-upgrade live-slugs live-slugs-upgrade grants grants-upgrade legacy-retire legacy-retire-refusals carry carry-upgrade live-articles live-slug-2 live-slug-2-upgrade live-slug-3 live-slug-3-upgrade provider provider-races topic-maps topic-maps-upgrade pinned-keywords pinned-keywords-upgrade opportunities opportunities-upgrade)
echo "Disposable PostgreSQL $PG_MAJOR cluster at $WORK (Unix socket only)"
for s in "${SUITES[@]}"; do
  case "$s" in
    c2) suite_c2 ;; c4) suite_c4 ;; c5) suite_c5 ;; c6) suite_c6 ;;
    drafts) suite_drafts ;; drafts-races) suite_drafts_races ;;
    c6-races) suite_c6_races ;; c6-d3) suite_c6_d3 ;; c6-d3-races) suite_c6_d3_races ;;
    c6-d3-preflight) suite_c6_d3_preflight ;; c6-rollback) suite_c6_rollback ;;
    gsc) suite_gsc ;; gsc-races) suite_gsc_races ;;
    gsc-pairs) suite_gsc_pairs ;; gsc-pairs-races) suite_gsc_pairs_races ;;
    findings) suite_findings ;; findings-races) suite_findings_races ;;
    signals) suite_signals ;; signals-upgrade) suite_signals_upgrade ;;
    content) suite_content ;; content-upgrade) suite_content_upgrade ;;
    triage) suite_triage ;; triage-races) suite_triage_races ;;
    tasks) suite_tasks ;; task-workflow) suite_task_workflow ;; task-priority) suite_task_priority ;; task-learning) suite_task_learning ;;
    keywords) suite_keywords ;; keywords-races) suite_keywords_races ;;
    guards) suite_guards ;; claim-races) suite_claim_races ;;
    approvals) suite_approvals ;; approvals-races) suite_approvals_races ;;
    attested) suite_attested ;; attested-upgrade) suite_attested_upgrade ;;
    live-slugs) suite_live_slugs ;; live-slugs-upgrade) suite_live_slugs_upgrade ;;
    grants) suite_grants ;; grants-upgrade) suite_grants_upgrade ;;
    legacy-retire) suite_legacy_retire ;; legacy-retire-refusals) suite_legacy_retire_refusals ;;
    carry) suite_carry ;; carry-upgrade) suite_carry_upgrade ;;
    live-articles) suite_live_articles ;;
    live-slug-2) suite_live_slug_2 ;; live-slug-2-upgrade) suite_live_slug_2_upgrade ;;
    live-slug-3) suite_live_slug_3 ;; live-slug-3-upgrade) suite_live_slug_3_upgrade ;;
    provider) suite_provider ;; provider-races) suite_provider_races ;;
    topic-maps) suite_topic_maps ;; topic-maps-upgrade) suite_topic_maps_upgrade ;;
    pinned-keywords) suite_pinned_keywords ;; pinned-keywords-upgrade) suite_pinned_keywords_upgrade ;;
    opportunities) suite_opportunities ;; opportunities-upgrade) suite_opportunities_upgrade ;;
    *) echo "run.sh: unknown suite $s" >&2; exit 2 ;;
  esac
done
if [ "$FAILED" = "0" ]; then echo "ALL DATABASE SUITES PASSED"; else echo "DATABASE SUITES FAILED"; exit 1; fi
