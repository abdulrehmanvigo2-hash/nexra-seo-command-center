#!/usr/bin/env bash
# The backup's connection handling (docs/RUNBOOK.md §6), shared by backup.sh and the
# workflow's masking step. It never prints the connection string, the password or any part
# of either; its messages name only which rule failed.
#
# Why this exists: the first production run (30 Sep) was given a direct-connection string
# whose password held an unencoded "@". libpq split the URL at that "@", read the password's
# tail as the host name and printed it in its error. So the URL is split here instead — the
# user info ends at the LAST "@" — and libpq is given separate settings (host, port, user,
# database, and the password in a 0600 password file), never a URL holding the password.
#
#   source scripts/backup/conn.sh   defines backup_trim, backup_split_url, backup_check_url,
#                                   backup_connect_env and backup_redact
#   bash scripts/backup/conn.sh --mask
#                                   prints GitHub "::add-mask::" lines for the password in
#                                   BACKUP_DATABASE_URL, as given and decoded, and every
#                                   prefix and suffix of four characters or more of each

# Strip leading and trailing whitespace, carriage returns and newlines included.
backup_trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# Decode %XX escapes; a "%" not followed by two hex digits is kept as it is.
backup_pct_decode() {
  local s="$1" out="" i=0 n=${#1} hex ch
  while [ "$i" -lt "$n" ]; do
    ch="${s:i:1}"
    hex="${s:i+1:2}"
    if [ "$ch" = "%" ] && [[ "$hex" =~ ^[0-9A-Fa-f]{2}$ ]]; then
      printf -v ch "\\x$hex"
      out+="$ch"
      i=$((i + 3))
    else
      out+="$ch"
      i=$((i + 1))
    fi
  done
  printf '%s' "$out"
}

# Split a postgres URL. Sets BK_USER, BK_PASS_RAW (as written), BK_PASS (decoded), BK_HOST,
# BK_PORT (may be empty) and BK_DB. The user info runs from "://" to the LAST "@", so a
# password holding "@", "#", "/", "?", ":" or brackets, encoded or not, stays whole; the
# user ends at the first ":" in it. Returns 1 with BK_ERROR set on a shape it cannot split.
backup_split_url() {
  local url rest userinfo hostpart hostport
  BK_USER="" BK_PASS_RAW="" BK_PASS="" BK_HOST="" BK_PORT="" BK_DB="" BK_ERROR=""
  url="$(backup_trim "$1")"
  case "$url" in
    postgres://*) rest="${url#postgres://}" ;;
    postgresql://*) rest="${url#postgresql://}" ;;
    *) BK_ERROR="it does not start with postgresql://"; return 1 ;;
  esac
  case "$rest" in *@*) ;; *) BK_ERROR="it has no user and password before an @"; return 1 ;; esac
  userinfo="${rest%@*}"
  hostpart="${rest##*@}"
  case "$userinfo" in *:*) ;; *) BK_ERROR="it has no password (user:password@host)"; return 1 ;; esac
  BK_USER="$(backup_pct_decode "${userinfo%%:*}")"
  BK_PASS_RAW="${userinfo#*:}"
  BK_PASS="$(backup_pct_decode "$BK_PASS_RAW")"
  [ -n "$BK_USER" ] || { BK_ERROR="its user is empty"; return 1; }
  [ -n "$BK_PASS" ] || { BK_ERROR="its password is empty"; return 1; }
  hostport="${hostpart%%/*}"
  hostport="${hostport%%\?*}"
  case "$hostpart" in
    */*) BK_DB="${hostpart#*/}"; BK_DB="${BK_DB%%\?*}"; BK_DB="${BK_DB%%#*}" ;;
  esac
  BK_DB="$(backup_pct_decode "${BK_DB:-postgres}")"
  [ -n "$BK_DB" ] || BK_DB="postgres"
  case "$hostport" in
    *:*) BK_HOST="${hostport%:*}"; BK_PORT="${hostport##*:}" ;;
    *) BK_HOST="$hostport" ;;
  esac
  return 0
}

# The production rule: a Supabase session pooler host on port 5432. Returns 1 with
# BK_ERROR set (naming the rule, never the value).
backup_check_url() {
  backup_split_url "$1" || return 1
  if ! [[ "$BK_HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.pooler\.supabase\.com$ ]]; then
    BK_ERROR="its host is not a Supabase session pooler host (*.pooler.supabase.com); use Dashboard → Connect → Session pooler, and write any @ in the password as %40"
    return 1
  fi
  if [ "$BK_PORT" != "5432" ]; then
    BK_ERROR="its port is not 5432 (the session pooler's; 6543 is the transaction pooler)"
    return 1
  fi
  if ! [[ "$BK_USER" =~ ^postgres\.[a-z0-9]+$ ]]; then
    BK_ERROR="its user is not postgres.<project ref>, as the session pooler string names it"
    return 1
  fi
  return 0
}

# Point libpq at the split settings, the password in a 0600 file under $1. Clears any other
# libpq setting that could redirect the connection. BACKUP_TEST_SOCKET_DIR (the local test
# only; the workflow never sets it) replaces the host with a Unix socket directory.
backup_connect_env() {
  local dir="$1" esc_user esc_pass
  unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS PGPASSWORD DATABASE_URL
  esc_user="${BK_USER//\\/\\\\}"; esc_user="${esc_user//:/\\:}"
  esc_pass="${BK_PASS//\\/\\\\}"; esc_pass="${esc_pass//:/\\:}"
  (umask 077; printf '*:*:*:%s:%s\n' "$esc_user" "$esc_pass" > "$dir/pgpass")
  export PGPASSFILE="$dir/pgpass" PGUSER="$BK_USER" PGDATABASE="$BK_DB" \
    PGCONNECT_TIMEOUT=20 PGAPPNAME=nexra-backup
  if [ -n "${BACKUP_TEST_SOCKET_DIR:-}" ]; then
    export PGHOST="$BACKUP_TEST_SOCKET_DIR" PGPORT="${BACKUP_TEST_SOCKET_PORT:-5432}" PGSSLMODE=disable
  else
    export PGHOST="$BK_HOST" PGPORT="$BK_PORT" PGSSLMODE=require
  fi
}

# Copy stdin to stdout with the password (as written and decoded) and every piece of it of
# four characters or more replaced by "[redacted]". The password is read from the
# environment, never from the command line.
backup_redact() {
  BK_R1="$BK_PASS_RAW" BK_R2="$BK_PASS" awk '
    function scrub(line, pw,   n, len, i, piece, at) {
      n = length(pw)
      for (len = n; len >= 4; len--)
        for (i = 1; i + len - 1 <= n; i++) {
          piece = substr(pw, i, len)
          while ((at = index(line, piece)) > 0)
            line = substr(line, 1, at - 1) "[redacted]" substr(line, at + len)
        }
      return line
    }
    { line = $0
      if (ENVIRON["BK_R1"] != "") line = scrub(line, ENVIRON["BK_R1"])
      if (ENVIRON["BK_R2"] != "") line = scrub(line, ENVIRON["BK_R2"])
      print line; fflush() }'
}

# --mask: GitHub masks each printed value in every later log line of the job. A workflow
# command's value is %-escaped ("%" as %25), or GitHub would unescape part of it.
backup_mask_line() { local v="${1//%/%25}"; v="${v//$'\r'/%0D}"; v="${v//$'\n'/%0A}"; echo "::add-mask::$v"; }
backup_print_masks() {
  local pw i n
  backup_split_url "${BACKUP_DATABASE_URL:-}" || return 0
  for pw in "$BK_PASS_RAW" "$BK_PASS"; do
    n=${#pw}
    [ "$n" -gt 0 ] || continue
    backup_mask_line "$pw"
    for ((i = 4; i < n; i++)); do
      backup_mask_line "${pw:0:i}"
      backup_mask_line "${pw:n-i}"
    done
  done
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --mask) backup_print_masks ;;
    *) echo "usage: bash scripts/backup/conn.sh --mask (or source it)" >&2; exit 2 ;;
  esac
fi
