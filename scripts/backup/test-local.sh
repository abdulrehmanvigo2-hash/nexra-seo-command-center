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

# The backup connects as a password-checked role through the production URL shape: a
# session pooler host, port 5432, user postgres.<ref>, and a password holding @ # / : and
# brackets, unencoded. BACKUP_TEST_SOCKET_DIR (this test only) sends the connection to the
# local socket instead of the host; the password is still checked (scram-sha-256).
PW='Dr1ll@p#ss/w[rd]@x:9'
PW_ENC='Dr1ll%40p%23ss%2Fw%5Brd%5D%40x%3A9'
"${PSQL[@]}" -d postgres -c "create role \"postgres.drillref\" login superuser password '$PW'"
{ echo 'local all "postgres.drillref" scram-sha-256'; cat "$DATA/pg_hba.conf"; } > "$WORK/hba"
chmod 644 "$WORK/hba"
as_server cp "$WORK/hba" "$DATA/pg_hba.conf"
as_server "$PG_BIN/pg_ctl" -D "$DATA" reload >/dev/null; sleep 1
[ "$("$PG_BIN/psql" -X -At -d source -c "select count(*) from pg_hba_file_rules where auth_method = 'scram-sha-256' and user_name = '{postgres.drillref}'")" = "1" ] \
  && ! PGPASSWORD=wrong "$PG_BIN/psql" -X -At -w -U postgres.drillref -d source -c "select 1" >/dev/null 2>&1 \
  && pass "the backup role's password is checked (scram-sha-256)" || fail "password checking is not on for the backup role"
POOLER="aws-0-drill.pooler.supabase.com:5432"
URL="postgresql://postgres.drillref:$PW@$POOLER/source"
URL_ENC="postgresql://postgres.drillref:$PW_ENC@$POOLER/source"
export BACKUP_TEST_SOCKET_DIR="$SOCK" BACKUP_TEST_SOCKET_PORT="$PORT"
# Here-strings throughout, not pipes into grep -q: under pipefail the writer's SIGPIPE
# would turn a found match into "not found" at random.
leaks() { grep -qF -e "$PW" -e "$PW_ENC" -e 'p#ss' -e 'w[rd]' -e 'rd]@x' -e '@x:9' -e 'Dr1ll' <<< "$1"; }
age-keygen -o "$WORK/drill.key" 2>/dev/null
RECIPIENT="$(age-keygen -y "$WORK/drill.key")"
age-keygen -o "$WORK/other.key" 2>/dev/null

# --- 1. The backup ---------------------------------------------------------------------
# Both values padded with spaces, a carriage return and a newline, as a paste can leave them.
if SUMMARY="$(BACKUP_DATABASE_URL="  $URL"$'\r\n' BACKUP_AGE_RECIPIENT=" $RECIPIENT"$'\r\n' BACKUP_OUT_DIR="$OUT" bash "$HERE/backup.sh" 2>&1)"; then
  pass "backup (raw password with @ # / : [ ], padded with CR/LF): $SUMMARY"
else fail "backup failed: $SUMMARY"; fi
leaks "$SUMMARY" && fail "the summary holds part of the password" || pass "the summary holds no part of the password"
FILE="$(ls "$OUT"/nexra-backup-*.tar.age 2>/dev/null | head -1)"
[ -n "$FILE" ] && [ "$(head -c 21 "$FILE")" = "age-encryption.org/v1" ] && pass "the output is one age file" || fail "no age file"
grep -qF -- "$SOCK" <<< "$SUMMARY" && fail "the summary names the connection" || pass "the summary never names the connection"
grep -aq "drill-project\|operator@example.test\|drill-token-value" "$FILE" && fail "plaintext visible in the encrypted file" || pass "no plaintext in the encrypted file"

# --- 2. What is inside ------------------------------------------------------------------
mkdir "$WORK/peek"
age -d -i "$WORK/drill.key" "$FILE" | tar -C "$WORK/peek" -xf -
[ "$(head -1 "$WORK/peek/auth-users.csv")" = "id,email,created_at,email_confirmed_at,last_sign_in_at" ] && pass "auth list holds only id, email and dates" || fail "auth list header: $(head -1 "$WORK/peek/auth-users.csv")"
grep -q "drillhash\|drill-token-value" "$WORK/peek/auth-users.csv" && fail "a password hash or token was exported" || pass "no password hash or token exported"
grep -q " auth " <<< "$("$PG_BIN/pg_restore" --list "$WORK/peek/db.dump")" && fail "the dump holds the auth schema" || pass "the dump holds public and supabase_migrations only"

# --- 3. The restore drill --------------------------------------------------------------
if DRILL="$(bash "$HERE/restore-drill.sh" "$FILE" "$WORK/drill.key" 2>&1)"; then pass "drill: $DRILL"; else fail "drill failed: $DRILL"; fi

# --- 3b. The Windows drill (restore-drill.ps1), when PowerShell is installed --------------
# The same backup through the PowerShell script, run as the server's OS user (initdb refuses
# root): a pass, then the wrong key, a tampered file and a missing key, each one FAIL line.
if command -v pwsh >/dev/null; then
  PSD="$WORK/ps"; mkdir "$PSD"; cp "$FILE" "$WORK/drill.key" "$WORK/other.key" "$PSD/"
  (cd "$PSD" && zip -q -0 artifact.zip "$(basename "$FILE")") 2>/dev/null || true
  cp "$PSD/$(basename "$FILE")" "$PSD/tampered.tar.age"; printf 'x' | dd of="$PSD/tampered.tar.age" bs=1 seek=300 conv=notrunc 2>/dev/null
  if [ "$(id -u)" = "0" ]; then chown -R postgres "$PSD"; fi
  psdrill() { as_server pwsh -NoProfile -NonInteractive -File "$HERE/restore-drill.ps1" -PgBin "$PG_BIN" -TestMinimumMajor "$("$PG_BIN/postgres" --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/')" "$@" 2>&1; }
  KEY_TEXT="$(grep -v '^#' "$WORK/drill.key")"
  if OUTPS="$(psdrill -Backup "$PSD/$(basename "$FILE")" -KeyFile "$PSD/drill.key")" && grep -q "RESTORE DRILL: OK" <<< "$OUTPS"; then
    pass "ps1 drill (.tar.age): $(grep 'RESTORE DRILL' <<< "$OUTPS")"
  else fail "ps1 drill: $OUTPS"; fi
  grep -qF -- "$KEY_TEXT" <<< "$OUTPS" && fail "ps1 drill printed the key" || pass "ps1 drill never printed the key"
  ls -d "${TMPDIR:-/tmp}"/nexra-drill-* >/dev/null 2>&1 && fail "ps1 drill left its temporary folder" || pass "ps1 drill deleted its temporary folder"
  if [ -f "$PSD/artifact.zip" ]; then
    OUTPS="$(psdrill -Backup "$PSD/artifact.zip" -KeyFile "$PSD/drill.key")" && grep -q "RESTORE DRILL: OK" <<< "$OUTPS" \
      && pass "ps1 drill (the downloaded .zip)" || fail "ps1 drill on the zip: $OUTPS"
  fi
  OUTPS="$(psdrill -Backup "$PSD/$(basename "$FILE")" -KeyFile "$PSD/other.key")" && fail "ps1: decrypted with the wrong key" \
    || { grep -q "RESTORE DRILL: FAIL - decryption" <<< "$OUTPS" && pass "ps1: the wrong key cannot decrypt (one FAIL line)" || fail "ps1 wrong key: $OUTPS"; }
  OUTPS="$(psdrill -Backup "$PSD/tampered.tar.age" -KeyFile "$PSD/drill.key")" && fail "ps1: a tampered file restored" \
    || { grep -q "RESTORE DRILL: FAIL" <<< "$OUTPS" && pass "ps1: a tampered file is refused" || fail "ps1 tampered: $OUTPS"; }
  OUTPS="$(psdrill -Backup "$PSD/$(basename "$FILE")" -KeyFile "$PSD/nowhere.key")" && fail "ps1: ran without a key" \
    || { grep -q "RESTORE DRILL: FAIL - the key file was not found" <<< "$OUTPS" && pass "ps1: a missing key file is refused" || fail "ps1 missing key: $OUTPS"; }
  OUTPS="$(as_server pwsh -NoProfile -NonInteractive -File "$HERE/restore-drill.ps1" -Backup "$PSD/$(basename "$FILE")" -KeyFile "$PSD/drill.key" -PgBin "$WORK/nowhere" 2>&1)" && fail "ps1: ran without PostgreSQL" \
    || { grep -q "winget install --exact --id PostgreSQL.PostgreSQL.17" <<< "$OUTPS" && pass "ps1: missing PostgreSQL names the winget command" || fail "ps1 missing PostgreSQL: $OUTPS"; }
  ls -d "${TMPDIR:-/tmp}"/nexra-drill-* >/dev/null 2>&1 && fail "ps1 refusals left a temporary folder" || pass "ps1 refusals left no temporary folder"
else
  echo "SKIP  ps1 drill: pwsh is not installed"
fi

# --- 4. Refusals ------------------------------------------------------------------------
bash "$HERE/restore-drill.sh" "$FILE" "$WORK/other.key" >/dev/null 2>&1 && fail "decrypted with the wrong key" || pass "the wrong key cannot decrypt"
cp "$FILE" "$WORK/tampered.age"; printf 'x' | dd of="$WORK/tampered.age" bs=1 seek=300 conv=notrunc 2>/dev/null
bash "$HERE/restore-drill.sh" "$WORK/tampered.age" "$WORK/drill.key" >/dev/null 2>&1 && fail "a tampered file restored" || pass "a tampered file is refused"
OUT2="$(BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_OUT_DIR="$OUT" bash "$HERE/backup.sh" 2>&1)" && fail "ran without a database URL" || pass "no database URL: refused ($OUT2)"
OUT2="$(BACKUP_DATABASE_URL="$URL" BACKUP_AGE_RECIPIENT="not-a-key" BACKUP_OUT_DIR="$OUT" bash "$HERE/backup.sh" 2>&1)" && fail "ran with a bad recipient" || pass "bad recipient: refused ($OUT2)"
OUT2="$(BACKUP_DATABASE_URL="$URL" BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_OUT_DIR="$OUT" BACKUP_MIN_PROJECTS=5 bash "$HERE/backup.sh" 2>&1)" && fail "stored a suspiciously small backup" || pass "too few projects: refused ($OUT2)"
# URL shapes refused before any connection, the message naming the rule, never the value.
refuse() { # <label> <url> [extra env assignment]
  local out
  out="$(env ${3:-} BACKUP_DATABASE_URL="$2" BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_OUT_DIR="$OUT" bash "$HERE/backup.sh" 2>&1)" \
    && { fail "$1: ran"; return; }
  leaks "$out" && fail "$1: printed part of the password" || pass "$1: refused, no part of the password printed ($out)"
}
refuse "direct connection host (the 30 Sep shape)" "postgresql://postgres:$PW@db.drillref.supabase.co:5432/postgres"
refuse "transaction pooler port 6543" "postgresql://postgres.drillref:$PW@aws-0-drill.pooler.supabase.com:6543/postgres"
refuse "no port" "postgresql://postgres.drillref:$PW@aws-0-drill.pooler.supabase.com/postgres"
refuse "look-alike host" "postgresql://postgres.drillref:$PW@pooler.supabase.com.evil.example:5432/postgres"
refuse "user without the project ref" "postgresql://postgres:$PW@$POOLER/postgres"
refuse "not a postgres URL" "https://postgres.drillref:$PW@$POOLER/postgres"
refuse "wrong password (error text redacted)" "postgresql://postgres.drillref:${PW}zz@$POOLER/source"
refuse "unreachable pooler" "postgresql://postgres.drillref:$PW@$POOLER/source" "BACKUP_TEST_SOCKET_DIR=$WORK/nowhere"
[ "$(ls "$OUT" | wc -l)" = "1" ] && pass "refused runs wrote no file" || fail "refused runs left files: $(ls "$OUT")"

# The same password written %-encoded also connects.
mkdir "$WORK/out-enc"
OUT2="$(BACKUP_DATABASE_URL="$URL_ENC" BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_OUT_DIR="$WORK/out-enc" bash "$HERE/backup.sh" 2>&1)" \
  && pass "backup (the same password %-encoded): $OUT2" || fail "encoded password: $OUT2"

# --- 5. The parser, the masks and the redaction ------------------------------------------
( source "$HERE/conn.sh"
  backup_split_url "$URL" && [ "$BK_PASS" = "$PW" ] && [ "$BK_USER" = "postgres.drillref" ] \
    && [ "$BK_HOST" = "aws-0-drill.pooler.supabase.com" ] && [ "$BK_PORT" = "5432" ] && [ "$BK_DB" = "source" ] ) \
  && pass "split: the password ends at the last @ (raw)" || fail "split of the raw URL"
( source "$HERE/conn.sh"; backup_split_url "$URL_ENC" && [ "$BK_PASS" = "$PW" ] && [ "$BK_PASS_RAW" = "$PW_ENC" ] ) \
  && pass "split: %-encoded password decoded" || fail "split of the encoded URL"
MASKS="$(BACKUP_DATABASE_URL="$URL" bash "$HERE/conn.sh" --mask)"
grep -qxF "::add-mask::$PW" <<< "$MASKS" && grep -qxF "::add-mask::@x:9" <<< "$MASKS" \
  && grep -qxF "::add-mask::Dr1ll" <<< "$MASKS" && ! grep -qvE '^::add-mask::' <<< "$MASKS" \
  && pass "masks: the whole password and every prefix and suffix of 4+ characters ($(printf '%s\n' "$MASKS" | wc -l) lines)" \
  || fail "masks: $(printf '%s\n' "$MASKS" | wc -l) lines"
MASKS="$(BACKUP_DATABASE_URL="$URL_ENC" bash "$HERE/conn.sh" --mask)"
grep -qxF "::add-mask::Dr1ll%2540p%2523ss%252Fw%255Brd%255D%2540x%253A9" <<< "$MASKS" \
  && grep -qxF "::add-mask::$PW" <<< "$MASKS" \
  && pass "masks: the encoded form (with % escaped for GitHub) and the decoded form" || fail "masks for the encoded URL"
OLD_ERR="psql: error: could not translate host name \"p#ss/w[rd]@x:9@db.drillref.supabase.co\" to address"
RED="$( source "$HERE/conn.sh"; backup_split_url "$URL"; printf '%s\n' "$OLD_ERR" | backup_redact )"
leaks "$RED" && fail "redaction left a fragment: $RED" || pass "redaction: the 30 Sep error shape, no fragment left ($RED)"

[ "$FAILED" = "0" ] && echo "test-local: all checks passed" || { echo "test-local: FAILED" >&2; exit 1; }
