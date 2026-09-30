#!/usr/bin/env bash
# Nightly production backup (docs/RUNBOOK.md §6): dump, verify, encrypt.
#
# Reads the production database and writes one encrypted file. It never writes to the
# database: pg_dump runs in a read-only snapshot, and every other statement here is a
# SELECT. It never prints the connection string or anything read from the database
# except counts.
#
# Environment:
#   BACKUP_DATABASE_URL   libpq connection string (the Supabase session pooler). Secret.
#   BACKUP_AGE_RECIPIENT  the operator's age public key ("age1…"). Not secret; the matching
#                         private key never leaves the operator.
#   BACKUP_OUT_DIR        where the encrypted file is written (default: ./backup-out).
#   BACKUP_MIN_PROJECTS   refuse to finish if public.projects holds fewer rows (default 1).
#
# Output: $BACKUP_OUT_DIR/nexra-backup-<UTC stamp>.tar.age, and a one-line summary on
# stdout. Inside the encrypted tar:
#   db.dump        pg_dump custom format of the public and supabase_migrations schemas
#                  (schema, data, owners and grants)
#   auth-users.csv id, email, created_at, email_confirmed_at, last_sign_in_at — no
#                  password hash, no token, no session
#   manifest.txt   when, which versions, per-table row counts, and each file's SHA-256
#
# Any failure exits non-zero, so the workflow run fails and GitHub notifies.
set -euo pipefail
umask 077

fail() { echo "backup: $*" >&2; exit 1; }

[ -n "${BACKUP_DATABASE_URL:-}" ] || fail "BACKUP_DATABASE_URL is not set"
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] || fail "BACKUP_AGE_RECIPIENT is not set"
case "$BACKUP_AGE_RECIPIENT" in age1*) ;; *) fail "BACKUP_AGE_RECIPIENT is not an age public key (age1…)";; esac
for tool in pg_dump pg_restore psql age tar sha256sum; do
  command -v "$tool" >/dev/null || fail "$tool is not installed"
done

OUT_DIR="${BACKUP_OUT_DIR:-./backup-out}"
MIN_PROJECTS="${BACKUP_MIN_PROJECTS:-1}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nexra-backup.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT_DIR" "$WORK/bundle"

# One helper for every read: the URL is passed as an argument, never echoed. psql and
# pg_dump error messages name the host and user, never the password.
q() { psql "$BACKUP_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }

# 1. The client must be at least the server's major version, or pg_dump refuses anyway.
SERVER_NUM="$(q "show server_version_num")" || fail "could not connect to the database"
SERVER_MAJOR=$((SERVER_NUM / 10000))
CLIENT_MAJOR="$(pg_dump --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/')"
[ "$CLIENT_MAJOR" -ge "$SERVER_MAJOR" ] || fail "pg_dump $CLIENT_MAJOR is older than the server ($SERVER_MAJOR)"

# 2. Row counts, for the manifest and the restore drill's comparison.
COUNTS="$(q "select n.nspname || '.' || c.relname || ' ' ||
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'supabase_migrations')
  order by 1")" || fail "could not count rows"
PROJECTS="$(printf '%s\n' "$COUNTS" | awk '$1 == "public.projects" { print $2 }')"
[ -n "$PROJECTS" ] || fail "public.projects was not found"
[ "$PROJECTS" -ge "$MIN_PROJECTS" ] || fail "public.projects holds $PROJECTS rows, fewer than $MIN_PROJECTS; refusing to store a suspicious backup"

# 3. The dump: two schemas, schema and data, owners and grants kept. Supabase's own schemas
# (auth, storage, realtime, extensions…) are the platform's and a new project recreates them.
pg_dump "$BACKUP_DATABASE_URL" --format=custom --compress=9 \
  --schema=public --schema=supabase_migrations --no-subscriptions --no-publications \
  --file="$WORK/bundle/db.dump" || fail "pg_dump failed"

# 4. The operator list, safe columns only (no password hash, token or session).
psql "$BACKUP_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c \
  "\\copy (select id, email, created_at, email_confirmed_at, last_sign_in_at from auth.users order by created_at, id) to '$WORK/bundle/auth-users.csv' with (format csv, header)" \
  || fail "could not read the auth user list"

# 5. Verify before encrypting: the archive lists, and holds the tables that matter.
LISTING="$(pg_restore --list "$WORK/bundle/db.dump")" || fail "pg_restore cannot read the dump"
for needed in "TABLE DATA public projects" "TABLE DATA public agent_runs" "TABLE DATA supabase_migrations schema_migrations"; do
  printf '%s\n' "$LISTING" | grep -q "$needed" || fail "the dump has no '$needed' entry"
done

# 6. Manifest.
{
  echo "nexra-backup/1"
  echo "created_utc $STAMP"
  echo "server_version_num $SERVER_NUM"
  echo "pg_dump $(pg_dump --version)"
  echo "schemas public supabase_migrations"
  echo "counts_note row counts were read just before pg_dump's own snapshot; a write in between can differ by a row"
  echo "--- counts"
  printf '%s\n' "$COUNTS"
  echo "--- sha256"
  (cd "$WORK/bundle" && sha256sum db.dump auth-users.csv)
} > "$WORK/bundle/manifest.txt"

# 7. Encrypt to the operator's public key; only ciphertext leaves this directory.
OUT="$OUT_DIR/nexra-backup-$STAMP.tar.age"
tar -C "$WORK/bundle" -cf - manifest.txt db.dump auth-users.csv | age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT" \
  || fail "encryption failed"
[ "$(head -c 21 "$OUT")" = "age-encryption.org/v1" ] || fail "the output is not an age file"

TABLES="$(printf '%s\n' "$COUNTS" | grep -c .)"
ROWS="$(printf '%s\n' "$COUNTS" | awk '{ s += $2 } END { print s }')"
echo "backup: wrote $(basename "$OUT") ($(stat -c %s "$OUT") bytes); $TABLES tables, $ROWS rows, $PROJECTS projects; server $SERVER_NUM"
