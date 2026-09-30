#!/usr/bin/env bash
# Restore drill (docs/RUNBOOK.md §6.4): decrypt one backup and restore it into a throwaway
# local PostgreSQL, then compare every table's row count with the backup's manifest.
#
#   scripts/backup/restore-drill.sh <nexra-backup-….tar.age> <age identity file>
#
# Local only: the cluster is created in a temporary directory, listens on a Unix socket
# with TCP off, and is deleted at the end (NEXRA_DRILL_KEEP=1 keeps it). Nothing here
# connects to a hosted database. The decrypted files stay in that directory and are
# deleted with it.
#
# Needs PostgreSQL server binaries of the backup's major version or newer: set PG_BIN
# (default: the newest /usr/lib/postgresql/*/bin), plus age and tar. When run as root,
# the server runs as NEXRA_DRILL_OS_USER (default postgres).
set -euo pipefail
umask 077

fail() { echo "restore-drill: $*" >&2; exit 1; }
[ $# -eq 2 ] || fail "usage: restore-drill.sh <backup.tar.age> <age identity file>"
BACKUP="$1"; IDENTITY="$2"
[ -f "$BACKUP" ] || fail "no such backup: $BACKUP"
[ -f "$IDENTITY" ] || fail "no such identity file: $IDENTITY"

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/initdb" ] || fail "no PostgreSQL server binaries (set PG_BIN)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/nexra-drill.XXXXXX")"
DATA="$WORK/data"; SOCK="$WORK/sock"; FILES="$WORK/files"
mkdir -p "$SOCK" "$FILES"
PORT=$((56000 + RANDOM % 900))
as_server() { if [ "$(id -u)" = "0" ]; then runuser -u "${NEXRA_DRILL_OS_USER:-postgres}" -- "$@"; else "$@"; fi; }
cleanup() {
  as_server "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  if [ "${NEXRA_DRILL_KEEP:-0}" = "1" ]; then echo "kept: $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

# 1. Decrypt and unpack.
age -d -i "$IDENTITY" "$BACKUP" | tar -C "$FILES" -xf - || fail "could not decrypt or unpack the backup"
for f in manifest.txt db.dump auth-users.csv; do [ -f "$FILES/$f" ] || fail "the backup has no $f"; done
head -1 "$FILES/manifest.txt" | grep -qx "nexra-backup/1" || fail "unknown manifest format"
(cd "$FILES" && sed -n '/^--- sha256$/,$p' manifest.txt | tail -n +2 | sha256sum -c --quiet) || fail "a file does not match its manifest hash"

SERVER_NUM="$(awk '$1 == "server_version_num" { print $2 }' "$FILES/manifest.txt")"
LOCAL_MAJOR="$("$PG_BIN/postgres" --version | sed -E 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/')"
[ "$LOCAL_MAJOR" -ge $((SERVER_NUM / 10000)) ] || fail "local PostgreSQL $LOCAL_MAJOR is older than the backup's server ($SERVER_NUM); set PG_BIN"

# 2. A throwaway cluster: Unix socket only.
if [ "$(id -u)" = "0" ]; then chown -R "${NEXRA_DRILL_OS_USER:-postgres}" "$WORK"; fi
as_server "$PG_BIN/initdb" -D "$DATA" --username=postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
as_server "$PG_BIN/pg_ctl" -D "$DATA" -l "$WORK/server.log" -w -o "-c listen_addresses='' -k $SOCK -p $PORT -c fsync=off" start >/dev/null
export PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1)
[ "$("$PG_BIN/psql" -X -At -d postgres -c "show listen_addresses")" = "" ] || fail "TCP is on; stopping"
"${PSQL[@]}" -d postgres -c "create database drill"

# 3. Every role the dump names (owners and grantees) must exist; create the missing ones
# without login. A new Supabase project already has them.
ROLES="$("$PG_BIN/pg_restore" --schema-only -f - "$FILES/db.dump" \
  | grep -oE '(OWNER TO|TO|FROM) [a-z_][a-z0-9_]*;' | awk '{ print $NF }' | tr -d ';' | sort -u)"
for role in $ROLES; do
  [ "$role" = "postgres" ] || [ "$role" = "public" ] && continue
  "${PSQL[@]}" -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$role') then create role $role nologin; end if; end \$\$;"
done

# 4. Restore: schemas, then data, then constraints, indexes and triggers (pg_restore's own
# order, so the guard triggers are created after the rows are loaded and never fire).
# The public schema exists in every new database (and every new Supabase project), so its
# own CREATE and COMMENT entries are left out of the restore list; everything in it is kept.
"$PG_BIN/pg_restore" --list "$FILES/db.dump" | grep -vE ' (SCHEMA|COMMENT) - (SCHEMA )?public ' > "$WORK/restore.list"
"$PG_BIN/pg_restore" --dbname=drill --exit-on-error --single-transaction --use-list="$WORK/restore.list" "$FILES/db.dump" \
  || fail "pg_restore failed"

# 5. Compare every table's row count with the manifest.
EXPECTED="$(sed -n '/^--- counts$/,/^--- sha256$/p' "$FILES/manifest.txt" | sed '1d;$d')"
MISMATCH=0; TABLES=0
while read -r table count; do
  [ -n "$table" ] || continue
  TABLES=$((TABLES + 1))
  got="$("$PG_BIN/psql" -X -At -d drill -c "select count(*) from $table")" || { echo "  missing: $table"; MISMATCH=1; continue; }
  if [ "$got" != "$count" ]; then echo "  differs: $table manifest $count, restored $got"; MISMATCH=1; fi
done <<< "$EXPECTED"

USERS=$(($(wc -l < "$FILES/auth-users.csv") - 1))
[ "$MISMATCH" = "0" ] || fail "row counts differ from the manifest (see above)"
echo "restore-drill: OK — $TABLES tables restored, every row count equals the manifest; $USERS auth users listed; $(awk '$1 == "created_utc" { print $2 }' "$FILES/manifest.txt") backup, server $SERVER_NUM, restored on PostgreSQL $LOCAL_MAJOR"
