#!/usr/bin/env bash
# Local test of the backup cycle (docs/RUNBOOK.md §6): dump → encrypt → decrypt → restore
# → compare, against a throwaway local database built from the repository's migrations.
# Never connects to a hosted database: the source cluster listens on a Unix socket with TCP
# off, and the age key is generated here and deleted with the rest.
#
#   bash scripts/backup/test-local.sh
#
# Needs PostgreSQL server binaries (PG_BIN, default the newest /usr/lib/postgresql/*/bin),
# age and tar. Run as root, the servers run as the postgres OS user.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PG_BIN PATH="$PG_BIN:$PATH"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/nexra-backup-test.XXXXXX")"
DATA="$WORK/data"; SOCK="$WORK/sock"; OUT="$WORK/out"
mkdir -p "$SOCK" "$OUT"
PORT=$((57000 + RANDOM % 900))
as_server() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cleanup() { as_server "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
if [ "$(id -u)" = "0" ]; then chown -R postgres "$WORK"; chmod 755 "$WORK"; fi

FAILED=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }

# --- A source database shaped like production ------------------------------------------
as_server "$PG_BIN/initdb" -D "$DATA" --username=postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
as_server "$PG_BIN/pg_ctl" -D "$DATA" -l "$WORK/server.log" -w -o "-c listen_addresses='' -k $SOCK -p $PORT -c fsync=off" start >/dev/null
export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1)
[ "$("$PG_BIN/psql" -X -At -d postgres -c "show listen_addresses")" = "" ] || { echo "TCP is on; stopping" >&2; exit 3; }
"${PSQL[@]}" -d postgres -c "create database source"
"${PSQL[@]}" -d source -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -d source -f "$f" >/dev/null; done
"${PSQL[@]}" -d source >/dev/null <<'SQL'
-- The platform's pieces the backup reads: migration history and the auth user table.
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations values ('20261011120000', array['select 1'], 'live_slugs_after_pin');
create schema auth;
create table auth.users (id uuid primary key, email text, encrypted_password text, confirmation_token text,
  created_at timestamptz, email_confirmed_at timestamptz, last_sign_in_at timestamptz);
insert into auth.users values ('00000000-0000-4000-8000-0000000000aa', 'operator@example.test',
  '$2a$10$drillhashdrillhashdrillhashdrillhashdrillhash', 'drill-token-value', now(), now(), now());
-- One project, one completed Director run, one task through the real function: the task's
-- insert trigger writes a 'created' event, so a restore that fired triggers would double it.
insert into public.projects (id, name, client, domain, initials, industry, type, status, goal, market, language,
  target_location, summary, competitor_domains, intake_notes, started_on)
  values ('drill-project', 'Drill Project', 'Drill Client', 'drill.example', 'DP', 'Testing', 'other', 'active',
  'leads', 'Test', 'en', 'Nowhere', 'A project for the backup drill.', '{}', '', '2026-09-01');
set session_replication_role = replica;
insert into public.agent_runs (id, project_id, agent_id, task_type, input_hash, status, created_by, started_at,
  finished_at, executor, result_summary, attempt_count)
  values ('d0000000-0000-4000-8000-000000000001', 'drill-project', 'seo-director', 'project-priority-review',
  repeat('a', 64), 'completed', '00000000-0000-4000-8000-0000000000aa', now(), now(), 'ai', 'PRIORITY 1 …', 1);
set session_replication_role = origin;
select public.nexra_agent_task_create('drill-project', 'Drill task', 'director-run',
  'd0000000-0000-4000-8000-000000000001', 'on-page-seo', 'medium', '00000000-0000-4000-8000-0000000000aa');
SQL
EVENTS="$("$PG_BIN/psql" -X -At -d source -c "select count(*) from public.nexra_agent_task_events")"
[ "$EVENTS" = "1" ] && pass "source seeded (1 project, 1 run, 1 task, $EVENTS task event from its trigger)" || fail "seed: $EVENTS task events"

URL="postgresql:///source?host=$SOCK&port=$PORT&user=postgres"
age-keygen -o "$WORK/drill.key" 2>/dev/null
RECIPIENT="$(age-keygen -y "$WORK/drill.key")"
age-keygen -o "$WORK/other.key" 2>/dev/null

# --- 1. The backup ---------------------------------------------------------------------
if SUMMARY="$(BACKUP_DATABASE_URL="$URL" BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_OUT_DIR="$OUT" bash "$HERE/backup.sh" 2>&1)"; then
  pass "backup: $SUMMARY"
else fail "backup failed: $SUMMARY"; fi
FILE="$(ls "$OUT"/nexra-backup-*.tar.age 2>/dev/null | head -1)"
[ -n "$FILE" ] && [ "$(head -c 21 "$FILE")" = "age-encryption.org/v1" ] && pass "the output is one age file" || fail "no age file"
printf '%s' "$SUMMARY" | grep -q "$SOCK" && fail "the summary names the connection" || pass "the summary never names the connection"
grep -aq "drill-project\|operator@example.test\|drill-token-value" "$FILE" && fail "plaintext visible in the encrypted file" || pass "no plaintext in the encrypted file"

# --- 2. What is inside ------------------------------------------------------------------
mkdir "$WORK/peek"
age -d -i "$WORK/drill.key" "$FILE" | tar -C "$WORK/peek" -xf -
[ "$(head -1 "$WORK/peek/auth-users.csv")" = "id,email,created_at,email_confirmed_at,last_sign_in_at" ] && pass "auth list holds only id, email and dates" || fail "auth list header: $(head -1 "$WORK/peek/auth-users.csv")"
grep -q "drillhash\|drill-token-value" "$WORK/peek/auth-users.csv" && fail "a password hash or token was exported" || pass "no password hash or token exported"
"$PG_BIN/pg_restore" --list "$WORK/peek/db.dump" | grep -q " auth " && fail "the dump holds the auth schema" || pass "the dump holds public and supabase_migrations only"

# --- 3. The restore drill --------------------------------------------------------------
if DRILL="$(bash "$HERE/restore-drill.sh" "$FILE" "$WORK/drill.key" 2>&1)"; then pass "drill: $DRILL"; else fail "drill failed: $DRILL"; fi

# --- 4. Refusals ------------------------------------------------------------------------
bash "$HERE/restore-drill.sh" "$FILE" "$WORK/other.key" >/dev/null 2>&1 && fail "decrypted with the wrong key" || pass "the wrong key cannot decrypt"
cp "$FILE" "$WORK/tampered.age"; printf 'x' | dd of="$WORK/tampered.age" bs=1 seek=300 conv=notrunc 2>/dev/null
bash "$HERE/restore-drill.sh" "$WORK/tampered.age" "$WORK/drill.key" >/dev/null 2>&1 && fail "a tampered file restored" || pass "a tampered file is refused"
OUT2="$(BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_OUT_DIR="$OUT" bash "$HERE/backup.sh" 2>&1)" && fail "ran without a database URL" || pass "no database URL: refused ($OUT2)"
OUT2="$(BACKUP_DATABASE_URL="$URL" BACKUP_AGE_RECIPIENT="not-a-key" BACKUP_OUT_DIR="$OUT" bash "$HERE/backup.sh" 2>&1)" && fail "ran with a bad recipient" || pass "bad recipient: refused ($OUT2)"
OUT2="$(BACKUP_DATABASE_URL="$URL" BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_OUT_DIR="$OUT" BACKUP_MIN_PROJECTS=5 bash "$HERE/backup.sh" 2>&1)" && fail "stored a suspiciously small backup" || pass "too few projects: refused ($OUT2)"
BAD_URL="postgresql://postgres:drill-secret-password@127.0.0.1:1/none?connect_timeout=2"
OUT2="$(BACKUP_DATABASE_URL="$BAD_URL" BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_OUT_DIR="$OUT" bash "$HERE/backup.sh" 2>&1)" && fail "connected to nothing" || true
printf '%s' "$OUT2" | grep -q "drill-secret-password" && fail "an error printed the password" || pass "unreachable database: refused, password not printed ($OUT2)"
[ "$(ls "$OUT" | wc -l)" = "1" ] && pass "refused runs wrote no file" || fail "refused runs left files: $(ls "$OUT")"

[ "$FAILED" = "0" ] && echo "test-local: all checks passed" || { echo "test-local: FAILED" >&2; exit 1; }
