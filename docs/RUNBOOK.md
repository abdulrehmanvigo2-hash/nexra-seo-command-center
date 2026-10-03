# Nexra SEO Command Center — Operations Runbook

How production is changed, checked and recovered. Written for the operator and for Claude
sessions acting on the operator's explicit approval (CLAUDE.md §6). Nothing here is a standing
permission: every production write, migration apply, redeploy or rollback is approved on its own.

Production:

- Database: Supabase project `nmseedcgtxelufewvbvr` (PostgreSQL 17, READ COMMITTED).
- App: Vercel project `nexra-seo-command-center`, production alias
  `nexra-seo-command-center.vercel.app`. Every push to `master` deploys to production, so a
  merge is a deployment.

---

## 1. Applying a migration

A migration reaches production only after it is merged to `master` with green CI and its apply
is separately approved. Existing migrations are never edited; a change is a new file.

### 1.1 Preflight (read-only)

Before any write, read and record:

- `select version(), current_setting('default_transaction_isolation');` — expect PostgreSQL 17
  and `read committed`.
- The version is absent: `select count(*) from supabase_migrations.schema_migrations where version = '<version>';` → 0.
- The latest recorded version and the history row count.
- Every table, column or function the migration depends on exists; none of the objects it
  creates exists yet.
- The row counts of the tables it touches (they are checked again afterwards).

Stop and report if anything differs from what the migration expects.

### 1.2 Apply and record

**With the Supabase CLI** (linked to the project): apply the file unmodified as one
transaction in the SQL editor, then record it with
`supabase migration repair --status applied <version> --linked` and confirm with
`supabase migration list --linked`. This is how C6 and D3 were recorded.

**Without the CLI** (the method used for `20261006120000` and `20261007120000`): one
transaction that writes the history row and executes the recorded text only if it is,
byte for byte, the repository file.

1. Compute the file's SHA-256 locally (`sha256sum supabase/migrations/<file>`).
2. Check that the file contains neither dollar-quote tag used below.
3. Run, as one statement batch:

```sql
begin;
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('<version>', '<name>', array[$nexra_mig_<version>$<the file's exact text>$nexra_mig_<version>$]);
do $nexra_apply$
declare v_text text;
begin
  select statements[1] into v_text from supabase_migrations.schema_migrations where version = '<version>';
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_text, 'UTF8')), 'hex') <> '<sha256>' then
    raise exception 'nexra apply: the recorded text is not the repository file';
  end if;
  execute v_text;
end
$nexra_apply$;
commit;
```

A mismatch raises and the whole transaction, history row included, is rolled back: nothing is
written. Test the exact statement first on a disposable local cluster (every earlier migration
applied, then this batch; a tampered hash must fail closed and leave no history row).

4. If the migration adds a table, view or function the API reads, run
   `NOTIFY pgrst, 'reload schema';` on its own afterwards. A migration of triggers only (such
   as `20261007120000`) needs none.

### 1.3 Verify

Read-only, then in a block that is always rolled back:

- The recorded text's hash equals the file's; the history row count went up by one.
- Every new object exists with the intended security: `security definer` only where
  intended, `search_path` empty, owner `postgres`, EXECUTE only for the roles the migration
  grants, triggers enabled (`tgenabled = 'O'`).
- **Rolled-back probes**: exercise each new refusal and each path that must keep working inside
  one `do` block that ends with `raise exception '…%', <collected results>;`. The raise rolls
  everything back and returns the results in its message. Probe as `service_role`
  (`set local role service_role`) and, where the role lacks a privilege, as the owner as well —
  PostgreSQL may refuse before a trigger fires (for example `0A000` for a TRUNCATE of a table
  another table references, `42501` for a missing TRUNCATE grant), and that is a refusal too;
  the owner probe shows the guard itself.
- Row counts are unchanged afterwards.

Record the result in CLAUDE.md §0 and mark the migration applied in `supabase/README.md`.

### 1.4 Forward-fix only

Never down-migrate, drop or hand-edit a recorded migration. If an applied migration is wrong,
write a new migration that corrects it and apply it the same way. A failed apply that rolled
back leaves nothing to repair: fix the cause and apply again.

### 1.5 History repair notes

- A migration applied but not recorded: record it with `supabase migration repair --status
  applied <version> --linked`, or, without the CLI, insert its history row in a transaction
  that also checks the row's text hash equals the file — never re-execute it.
- A history row with no applied schema: do not delete it without the operator's decision;
  report it.
- **Known differences between the history and the files, left as they are** (audit A0-01, verified by A2-01, 30
  Sep 2026). The schema in production is the repository's in every case; only the record differs. Do not repair,
  rename or delete any of these rows without the operator's decision under §6, and never re-execute a migration:

  | # | Production history | Repository file | What it is |
  |---|---|---|---|
  | 1 | `20260919120000 create_crawls` | — | The legacy, unprefixed crawl subsystem (not this repository's). Its objects were dropped by `20261013120000` (F6); the row stays as history. |
  | 2 | `20260920120000 create_crawl_pages` | `20260920120000_create_crawls.sql` | Same version, different content: the row is the legacy subsystem's; the file (this product's `nexra_crawls`, `nexra_crawl_pages`, `nexra_crawl_links`) was applied with no row of its own. Its objects are identical to the file. |
  | 3 | `20260921120000 create_crawl_page_signals` | — | Legacy subsystem, as #1 (objects dropped by F6). |
  | 4 | — | `20260920120100_grant_crawls_to_service_role.sql` | Applied, never recorded; its grants are present. |
  | 5 | `20260922111302`, `20260922111312`, `20260922133139`, `20260922133152`, `20260922172606` | `20260922120000`, `…120100`, `…130000`, `…130100`, `…140000` (content drafts) | Renumbered. Tables, constraints, indexes, triggers and grants identical; three functions differ from the files in whitespace and comments only. |
  | 6 | `20260923043554 create_articles` | `20260923120000_create_articles.sql` | Renumbered (decision Q10). Every article object hash-identical. |
  | 7 | `20260923180000` (no statement text) | `20260923180000_create_article_check_units.sql` | Recorded by `migration repair`, text absent; objects identical. |
  | 8 | `20260924120000` (no statement text) | `20260924120000_create_article_approvals.sql` | As #7. |

  Every version from `20260925120000` on matches its file; the single-statement rows from `20261005120000` on hash
  exactly to their files. A CLI `migration list` therefore shows unmatched versions, which is expected, and `db push`
  against production would try to apply files again — never run `db push` or `db reset` against production.

### 1.6 Migration version convention

**Each new migration = the previous version + 1 day at `120000`; versions are a sequence, not wall-clock dates.**
Since `20261004120000` every migration has taken the newest existing version and added one day
(`20261015120000` → `20261016120000`), whatever the calendar says — the F0 schema was written on 1 Oct 2026 as
`20261016120000`. Migrations apply in filename order, the harness pins "the schema before version X" by that order,
and the production preflight checks that the newest recorded version is the one expected, so a version lower than
an applied one would sort into the past. Never date a new file to today if that is earlier than the newest file;
take the newest version and add a day (operator decision, 1 Oct 2026, PR #97).

---

## 2. Deployments

### 2.1 Confirm the deployment after every merge

Before any live run after a merge, confirm:

1. A Vercel deployment exists for the merge commit (Vercel → Deployments, or the deployment
   list filtered by the commit SHA), target production.
2. Its state is **READY**.
3. It holds the production alias `nexra-seo-command-center.vercel.app`.
4. `master` CI for the same commit is green (GitHub Actions, workflow *CI*, event push).

Record the deployment id and the CI run id in CLAUDE.md §0.

**Why:** on 27 Sep the push of `ddc6cbb4` (PR #43) to `master` left no Vercel deployment record
at all — not even a CANCELED one — so production kept serving the previous build. No project
setting explained it; the likeliest cause is a push event Vercel never received.

**One-redeploy rule:** if no deployment for the merge commit appears, trigger **one** manual
redeploy of that same commit (it is a deployment, so approved like one), then confirm the four
points above. If it still fails, stop and report; do not keep redeploying.

### 2.2 Rolling back

Rollback is to promote the previous production deployment; the code is then fixed forward on
`master`.

1. Find the previous deployment's id: CLAUDE.md §0 names the current production deployment and
   the one before it (for example "previous: `dpl_…` at `<commit>`"); the Vercel dashboard's
   Deployments list, filtered to Production, shows every earlier production build with its
   commit.
2. In Vercel, open that deployment and use **Promote to Production** (Instant Rollback).
3. Confirm it is READY and holds the production alias, and check `/api/health`.
4. A rollback does not undo a migration. Code that depends on a newer schema keeps working on
   the older build only if the migration was additive — which every migration here is.
5. Fix forward on `master`; the next merge deploys over the rollback. Note that a promoted
   rollback can pause automatic production updates in Vercel until it is undone; after the fix
   merges, confirm the new deployment actually serves the alias (2.1).

---

## 3. Health and uptime

`GET /api/health` (also `HEAD`) is public and returns no data:

| Answer | Meaning |
|---|---|
| 200 `{ "status": "ok", "time": …, "database": "reachable" }` | the app and the database answer |
| 503 `{ "status": "degraded", "time": …, "database": "unreachable" }` | the database erred or took over 2 s |
| 200 `{ "status": "ok", "time": …, "database": "not-configured" }` | a deployment without a database (not production) |
| 429 with `Retry-After` | over 120 requests a minute on one instance |

The body never carries an id, a count, an error message or a configuration name. The answer is
never cached.

**Uptime monitor:** point any external monitor at
`https://nexra-seo-command-center.vercel.app/api/health`, once a minute or slower (well under
the 120-a-minute cap), alerting on any non-200 answer and on timeouts. Treat a 503 as a
database incident (check Supabase status and the project's logs); a timeout or 5xx other than
503 as an app incident (check the Vercel deployment and its runtime logs; roll back per 2.2 if
the latest deployment is the cause). Adding a monitor is an external service and needs its own
approval (§6).

Verified in production on 28 Sep by the operator: `{"status":"ok","database":"reachable"}`.

---

## 4. Daily run caps

Agent runs are capped per UTC day: **40 per project and 100 across all projects**, counted
separately for runs created and attempts started (`src/lib/agent-runs/daily-caps.ts`).

What happens when a cap is reached:

- **Creating a run** (a review control, a task handoff): refused with HTTP 429 `daily-cap` and
  a Retry-After until midnight UTC. Nothing is queued. The control says so in words.
- **The scheduled worker:** a capped project's queued runs are passed over and never claimed;
  they stay queued, unchanged, and run after midnight UTC. A global cap stops the batch
  (`stoppedBy: "daily-cap"`, `heldByCap` in the job's answer).
- **Run Now** on a capped run answers 429 `daily-cap` and claims nothing.

What to do:

1. Nothing is broken and nothing failed: wait for midnight UTC. Do not retry, re-queue or
   cancel held runs to work around the cap.
2. To see today's use, read (read-only) the shared counter rows:

   ```sql
   select key, window_start, hits from public.rate_limit_windows
    where key like 'agent-runs.daily-%' and window_start >= date_trunc('day', now() at time zone 'utc')
    order by key;
   ```

   Keys are `agent-runs.daily-<create|execute>-<project|global>:<project id or all>:<YYYY-MM-DD>`.
   Counts can only overstate use (a hit is not returned when a later check refuses, or when
   another worker claimed the run first).
3. Reaching the cap without a matching amount of operator activity is a signal to investigate
   (a loop, a misbehaving client), not to raise the cap.
4. Changing the caps is a code change to `DAILY_CAPS`, reviewed and merged like any other; it
   is never done by editing or deleting counter rows in production.

---

## 5. Run claims

A run is claimed only through `agent_run_claim` (`20260917120000`). By id (Run Now, and the
worker when caps are on) it locks the run row (`for update`), rechecks that the run is queued
and has attempts left, then marks it running and inserts the attempt in the same transaction; a
second worker claiming the same run waits on the lock and answers `not-queued` (HTTP 409). The
queue form takes the next due run with `for update skip locked`, so two workers take different
runs without waiting. Harness suite `claim-races` (R1–R3) proves both.

---

## 6. Backups and restore

The Supabase project is on the Free plan, which keeps **no backups and no point-in-time
recovery** (audit A2-05, A6-01). The product's own nightly backup is the only copy of the
database outside Supabase.

### 6.1 What is backed up, when, where

| | |
|---|---|
| Job | `.github/workflows/backup.yml`, "Nightly backup" — daily at 03:17 UTC, and by hand (Run workflow) |
| Reads | production through the Supabase session pooler, read-only: `pg_dump` in a read-only snapshot, the rest `SELECT`s |
| Holds | the `public` and `supabase_migrations` schemas (every table, row, function, trigger, index, grant and the migration history), plus `auth-users.csv` with each user's id, email, created, confirmed and last-sign-in time — **no password hash, token or session** |
| Leaves out | Supabase's own schemas (`auth`, `storage`, `realtime`, `extensions`, …), which a new project recreates |
| Checks before storing | `public.projects` holds at least one row, and the dump lists the projects, runs and migration-history tables; any failure fails the job |
| Encryption | [age](https://age-encryption.org), to the operator's public key; the private key is never in GitHub, Vercel, Supabase or a Claude session |
| Stored | as a GitHub Actions artifact of this **public** repository (see *Public repository* below), one per run, kept **30 days** (`nexra-backup-<run id>`, containing `nexra-backup-<UTC>.tar.age`) |
| Code | `scripts/backup/backup.sh` (dump, verify, encrypt), `scripts/backup/restore-drill.sh` (6.4, Linux / WSL), `scripts/backup/restore-drill.ps1` (6.4a, Windows), `scripts/backup/test-local.sh` (the whole cycle against a local database) |

Inside the encrypted file: `db.dump` (`pg_dump` custom format), `auth-users.csv`, and
`manifest.txt` (the time, the server and `pg_dump` versions, each table's row count and each
file's SHA-256).

**Public repository.** The repository is public on purpose (operator decision, 1 Oct); it may become private
later. Any signed-in GitHub user can download its Actions artifacts, so a backup is only ever stored
**encrypted** with age, and that exposure is accepted: without the operator's private key the file is
unreadable. Never commit a secret, production data or personal data; the run summary prints counts only.

**Why an artifact, not a backups repository.** The file is encrypted before upload. Artifacts need no extra credential, while a second repository would
need a write token in Actions and would keep every backup in its history forever. Thirty
files fit easily in the Free plan's Actions storage: a local test file was under 0.5 MB, and the
first production run shows the real size. The operator keeps one download a month offline
(6.3), which covers longer than 30 days.

### 6.2 One-time setup (operator)

Nothing below is ever pasted into a chat or a Claude session.

1. **Make the key pair** on your own machine: install age (`sudo apt install age`, or
   `brew install age`), then run `age-keygen -o nexra-backup.key`. The file holds the private
   key, and the command prints `Public key: age1…`.
   - Keep `nexra-backup.key` in two places: your password manager and an offline copy.
   - **Without it no backup can be opened.** If it is ever exposed, make a new pair and replace
     the public key.
2. **Create the environment.** GitHub → repository **Settings → Environments → New
   environment**, named `backup`. Under *Deployment branches and tags*, choose **Selected
   branches** and add `master`, so only `master`'s workflow can read the secret.
3. **Add the secret.** In the `backup` environment: **Add environment secret**
   `BACKUP_DATABASE_URL`, with the Supabase **session pooler** connection string (Dashboard →
   **Connect** → *Session pooler*, port 5432, `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`),
   the database password filled in.
   - GitHub's runners have no IPv6, so the direct connection does not work from them.
   - It is the `postgres` database password: keep it in this environment only.
   - Replace the whole `[YOUR-PASSWORD]` placeholder, brackets included. A password of letters
     and digits needs no encoding; otherwise write `@` as `%40`, `#` as `%23`, `/` as `%2F`,
     `:` as `%3A` and `%` as `%25` (an unencoded `@`, `#`, `/` or `:` is also accepted).
   - The job refuses, before connecting, any string whose host is not `*.pooler.supabase.com`,
     whose port is not 5432 or whose user is not `postgres.<ref>`. Its message names the rule,
     never the value.
4. **Add the variable.** In the `backup` environment: **Add environment variable**
   `BACKUP_AGE_RECIPIENT`, set to the `age1…` public key, on one line. It is not a secret.
   Surrounding spaces, carriage returns and newlines in either value are trimmed.
5. **Set up failure mail.** A failed run fails loudly in two ways:
   - **An issue.** The workflow opens an issue titled "Nightly backup failed …" with a link to
     the run, and GitHub emails the repository owner about new issues. Keep **Watching** the
     repository, and keep email on under **Settings → Notifications**.
   - **GitHub's own mail.** Under **Settings → Notifications → Actions**, turn on notifications
     for failed workflows, by email. GitHub sends scheduled-run failures to the account that
     last changed the schedule, and a manual run's failure to whoever started it.
6. **Merge, then run once by hand.** Actions → **Nightly backup** → **Run workflow** on
   `master`. That is the first read of production, so it needs its own approval. Check it turns
   green, with one artifact (the local test's was under 0.5 MB). Then do the drill in 6.4.

If the database password is reset in Supabase, update `BACKUP_DATABASE_URL` the same day, or
every run fails.

**How the job handles the string** (`scripts/backup/conn.sh`): it splits it itself (the
password runs from the first `:` after the user to the **last** `@`, and `%XX` escapes are
decoded) and gives libpq separate settings, with the password in a 0600 file, never a URL. The
workflow first masks the password, as written and decoded, and every prefix and suffix of four
characters or more; every database error line is also redacted the same way before it is logged.

**Run history:**

| Date (UTC) | Run | Result |
|---|---|---|
| 30 Sep 2026 11:14 | [36707286151](https://github.com/abdulrehmanvigo2-hash/nexra-seo-command-center/actions/runs/36707286151), manual, `bffaaed` | **Failed** in about 28 s at the first connection, before reading anything: the secret held the *direct* connection host with an unencoded `@` in the password, so libpq read part of the password as the host and printed it. No dump or artifact; issue #75 opened. The run's logs were deleted the same day (approved); the password is to be reset, and the parsing, checks, masking and redaction above were added. |
| 30 Sep 2026 11:46 | [36710567750](https://github.com/abdulrehmanvigo2-hash/nexra-seo-command-center/actions/runs/36710567750), manual, `212caa9` | **Failed** in about 30 s at the connection-string check, before any connection: the host was not `*.pooler.supabase.com` (the direct string again). Nothing of the value was printed; issue #77 opened. The password had been reset after the first run's leak. |
| 30 Sep 2026 13:15 | [36720332709](https://github.com/abdulrehmanvigo2-hash/nexra-seo-command-center/actions/runs/36720332709), manual, `212caa9` | **Green**, 1 min 12 s (dump, verify and encrypt 44 s), after the secret was re-entered from the Session pooler (`aws-0-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.<ref>`). Summary: `nexra-backup-20260930T131550Z.tar.age` (676,200 bytes); 32 tables, 1,225 rows, 10 projects; server 170006 (PostgreSQL 17.6). The dump listed the projects, runs and migration-history tables. Artifact `nexra-backup-36720332709`, 676,388 bytes, kept until 30 Oct. Issues #75 and #77 closed. **Not yet done:** the restore drill (6.4) on the operator's machine. |
| 30 Sep 2026 15:57 | [36740624220](https://github.com/abdulrehmanvigo2-hash/nexra-seo-command-center/actions/runs/36740624220), manual, `33b27a5` | **Green**, 1 min 30 s (dump, verify and encrypt 59 s). The backup before F6 (the legacy crawl subsystem retired). Summary: `nexra-backup-20260930T155743Z.tar.age` (676,200 bytes); 32 tables, 1,226 rows, 10 projects; server 170006 — against production at the time, 27 non-legacy tables (1,091 rows) plus the five legacy tables (135 rows: `crawls` 9, `crawl_pages` 43, `crawl_urls` 43, `crawl_page_signals` 40, `crawl_links` 0), so the manifest's counts and the `public` dump hold all five. Artifact `nexra-backup-36740624220`, 676,388 bytes, kept until 30 Oct 2026: the only copy of those 135 rows after migration `20261013120000`. |
| 1 Oct 2026 05:01 | [36817821484](https://github.com/abdulrehmanvigo2-hash/nexra-seo-command-center/actions/runs/36817821484), manual, `fd3c5c5` | **Green**, 1 min 21 s; run by hand because no scheduled run had happened at 03:17 UTC (Phase 0 audit §I). Artifact `nexra-backup-36817821484`, 666,148 bytes, kept until 31 Oct. |
| 1 Oct 2026 | **Restore drill** (6.4a), Windows | **Passed** on the operator's Windows PC: non-administrator PowerShell, PostgreSQL 17, `restore-drill.ps1` at `master` `596aeb9`, on artifact `nexra-backup-36740624220`: `RESTORE DRILL: OK - 32 tables, 1226 rows, every row count equals the manifest; 1 auth users listed; backup 20260930T155743Z, server 170006, restored on PostgreSQL 17`. Two earlier attempts the same day found two drill bugs, both fixed before this pass: a hang after `decrypted` (PR #93) and `role "supabase_admin" does not exist` (PR #94). Closes audit A2-05 and A6-01. |

### 6.3 Routine

- **Daily:** nothing, unless a "Nightly backup failed" issue or mail arrives. Then open the run,
  read the failing step (the script says what failed and never prints the URL), fix the cause,
  run it by hand, and close the issue.
- **Monthly:** download the newest artifact and keep it offline next to the key. Run the drill
  (6.4, or 6.4a on Windows) on it, and note the date and result in CLAUDE.md §0.

### 6.4 Restore drill (local, throwaway)

Proves a backup opens and restores, without touching any hosted database.

1. **Download.** Actions → **Nightly backup** → a green run → **Artifacts** → download and
   unzip. You get `nexra-backup-<UTC>.tar.age`.
2. **Install PostgreSQL 17 server binaries** (the drill refuses an older major than the
   backup's server). On Ubuntu or WSL:
   `sudo apt install postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh && sudo apt install postgresql-17`.
3. **Run the drill:**
   `bash scripts/backup/restore-drill.sh nexra-backup-<UTC>.tar.age /path/to/nexra-backup.key`
   (`PG_BIN=/usr/lib/postgresql/17/bin` if several versions are installed). It:
   1. decrypts into a temporary directory and checks every file against the manifest's SHA-256;
   2. starts a throwaway cluster on a Unix socket with TCP off;
   3. creates, without login, every role the dump names (owners, grantees and the owners of
      default privileges, such as Supabase's `supabase_admin`) and Supabase's platform roles;
   4. restores in one transaction, creating the triggers after the data, so no guard fires;
   5. compares every table's row count with the manifest;
   6. deletes everything.

   `restore-drill: OK — N tables restored, every row count equals the manifest` is a pass. Set
   `NEXRA_DRILL_KEEP=1` to keep the cluster for inspection.

`bash scripts/backup/test-local.sh` runs the whole cycle without production: it builds a
database from the migrations, backs it up, runs the drill, and tries the refusals (wrong key,
tampered file, missing settings, too few projects, an unreachable database with a password in
its URL).

### 6.4a Restore drill on Windows (PowerShell, no WSL)

The same drill for a Windows 10 or 11 PC. It takes about ten minutes the first time and two
minutes after that. It never connects to production: it starts its own small, temporary
database on your PC, checks the backup in it, and deletes it.

**Once: install two programs.** Open **PowerShell** (Start menu → type `PowerShell` → open
it; *not* "Run as administrator").

1. **PostgreSQL 17:**

   ```powershell
   winget install --exact --id PostgreSQL.PostgreSQL.17 --interactive
   ```

   The installer window opens. Click **Next** and keep the defaults, except:
   - **Select Components:** keep ✅ **PostgreSQL Server** and ✅ **Command Line Tools**.
     **Untick** ☐ **pgAdmin 4** and ☐ **Stack Builder** (not needed).
   - **Password:** type any new password and keep it somewhere. It is only for the copy of
     PostgreSQL on your PC. It is **not** the Supabase password, and the drill does not use
     it.
   - **Port** 5432, **Locale** default: leave them as they are.
   - On the last page, **untick** "Launch Stack Builder at exit", then **Finish**.

   The installer also starts a PostgreSQL service that runs when Windows starts. The drill
   does not use it. To stop it starting by itself, run this in an administrator PowerShell
   (optional): `Set-Service postgresql-x64-17 -StartupType Manual`.
2. **age** (opens the backup):

   ```powershell
   winget install --exact --id FiloSottile.age
   ```

3. **Close PowerShell and open a new window**, so it finds the new programs.

`tar` is already part of Windows 10 and 11. If anything is missing, the script says so and
prints the `winget` line to run.

**Each drill (monthly, 6.3):**

1. **Download the backup.** On GitHub, signed in: the repository → **Actions** → **Nightly
   backup** (left) → the newest run with a green tick → scroll down to **Artifacts** → click
   **nexra-backup-…**. A file `nexra-backup-<number>.zip` lands in your **Downloads**
   folder. Leave it zipped; the script opens it.
2. **Have the key file ready.** This is `nexra-backup.key` from 6.2, step 1. If you keep it only
   in your password manager, save it as a plain text file for the drill, for example
   `C:\Users\<you>\Documents\nexra-backup.key`, and delete that file afterwards.
3. **Get the script.**
   - If you have the repository on your PC, it is `scripts\backup\restore-drill.ps1`.
   - Otherwise, on GitHub open `scripts/backup/restore-drill.ps1` on `master`, click
     **Download raw file**, and save it in **Downloads**.
4. **Run it** in PowerShell, with your own file names (the run number and your key's path):

   ```powershell
   cd $HOME\Downloads
   powershell -ExecutionPolicy Bypass -File .\restore-drill.ps1 -Backup .\nexra-backup-36720332709.zip -KeyFile C:\Users\<you>\Documents\nexra-backup.key
   ```

   `-ExecutionPolicy Bypass` lets this one script run without changing any Windows setting.
5. **Read the last lines.**
   - `RESTORE DRILL: OK - N tables, … every row count equals the manifest` (green) is a
     pass. Note the date and the result in CLAUDE.md §0, or tell Claude to.
   - `RESTORE DRILL: FAIL - …` (red) says what failed. Common ones:
     - *decryption (wrong key, or a damaged file)*: the wrong key file, or a broken download.
       Download again.
     - *prerequisites missing*: run the `winget` line it prints, then open a new PowerShell.
     - *tables differ from the manifest*: the backup did not restore completely. Keep the zip,
       and report it.
   - The last line, `cleaned up: throwaway database and decrypted files deleted`, means
     nothing was left behind. Delete the zip yourself if you do not keep it as the monthly
     offline copy (6.3).

What it does, step by step:
1. It checks the programs.
2. It unzips the artifact and decrypts the `.tar.age` with age into a new folder in
   `%TEMP%`, readable by your Windows user only.
3. It checks every file against the manifest's SHA-256.
4. It creates a throwaway PostgreSQL there, listening on `127.0.0.1` only, on a free port
   (never 5432, the installed service's), with trust authentication, so nothing prompts for a
   password.
5. It creates, without login, the roles the dump names (including `supabase_admin`, which owns
   Supabase's default privileges on `public`) and Supabase's platform roles, then restores in
   one transaction. The first Windows run on the real backup `36740624220` stopped here with
   `role "supabase_admin" does not exist`; `test-local.sh` now builds its dump with those
   default privileges, so this cannot come back unnoticed.
6. It compares every table's row count with the manifest.
7. It stops the database and deletes the folder.

It never prints the key. Add `-Keep` to keep the stopped folder for inspection: it then holds
the **decrypted** backup, so delete it when done.

**Progress and timeouts.** Every program the script runs is one named step. It prints
`start : <step>` before it and `done  : <step> (N s)` after it, and runs under a timeout. A step
that runs too long is stopped, and the script ends with `RESTORE DRILL: FAIL - <step> timed out
…` and the last 20 lines of the throwaway server's log. It still stops the server and deletes the
folder.

**The 1 Oct hang.** The first Windows run stopped after `decrypted` and printed nothing for over
10 minutes. Cause: `pg_ctl start` ran through a PowerShell pipe. On Windows the server it starts
inherits that pipe and keeps it open, so PowerShell waited for the end of output forever. Now
`pg_ctl` runs on the console with nothing redirected (`-l <log> -w -t 60 -s`). Every other program
writes to files, never a pipe.

**What was tested, and what was not.**
- `scripts/backup/test-local.sh` runs the script under PowerShell 7 on Linux, on a real
  backup. It checks:
  - a pass on both the `.tar.age` and the downloaded `.zip`;
  - the wrong key, a tampered file, a missing key file and a missing PostgreSQL each end in
    one FAIL line;
  - the key is never printed, and no temporary folder is left;
  - a `start`/`done` pair for every step, a port other than 5432, and a forced timeout (FAIL
    naming the step, the log tail, the server stopped, the folder deleted).
- A doctored manifest was also checked by hand: it gives the row-count FAIL.
- The hang's mechanism was reproduced on Linux with a stand-in program that leaves a child
  holding its output. The old pipe call waited until the child let go; the new console call
  returned in 0.1 s. Linux's real `pg_ctl` detaches from its output, so the hang itself never
  happens there.
- Not run on Windows before 1 Oct (now covered by the operator's passing run, below):
  - Windows PowerShell 5.1 (the script is written for it);
  - the EDB installer's `C:\Program Files\PostgreSQL\17\bin` lookup and `winget`'s `age`
    link;
  - the `icacls` lock on the folder;
  - `initdb` and `pg_ctl` on Windows paths, and `pg_ctl` started from a non-administrator
    shell;
  - `Start-Process` output files in Windows PowerShell 5.1, and `taskkill` on a timeout.

  **Tested on Windows (1 Oct 2026):** the drill passed on the operator's Windows PC — Windows PowerShell
  started from PowerShell 7, a non-administrator shell, the EDB PostgreSQL 17 install with its own service on
  5432, `winget`'s age — on the real backup `36740624220` (32 tables, 1,226 rows; *Run history*, 6.2). That run
  covered the items above except the timeout path (`taskkill`), which stays tested on Linux only.

  If a later Windows run fails, send the FAIL line (it never holds the key).

### 6.5 Restoring production after a loss

**Every step is a production change needing the operator's approval (CLAUDE.md §6).** The rule:
restore into a **new** Supabase project, never over the damaged one.

1. **Create the project.** A new Supabase project, Postgres 17, same region. Note its database
   password and session pooler string, and keep the damaged project untouched.
2. **Open the backup:** `age -d -i nexra-backup.key nexra-backup-<UTC>.tar.age | tar -xf -`,
   then `sed -n '/^--- sha256$/,$p' manifest.txt | tail -n +2 | sha256sum -c` (both files OK).
3. **Build the restore list.** Leave out what a new project already has: the `public` schema
   entry, and the platform's `rls_auto_enable` function.
   - `pg_restore --list db.dump | grep -vE ' (SCHEMA|COMMENT) - (SCHEMA )?public ' | grep -v rls_auto_enable > restore.list`
   - If the new project already has a `supabase_migrations` schema, also remove the line
     `SCHEMA - supabase_migrations`.
4. **Restore, with every grant kept and ownership given to `postgres`:**
   `pg_restore --dbname "$NEW_SESSION_POOLER_URL" --no-owner --single-transaction --exit-on-error --use-list restore.list db.dump`.
   Any error rolls the whole restore back. Fix the list and repeat.
5. **Reload PostgREST:** `psql "$NEW_SESSION_POOLER_URL" -c "notify pgrst, 'reload schema'"`.
6. **Verify.** Compare the new database's row counts with `manifest.txt`. Check the §1.3 facts:
   `security definer` functions with an empty `search_path`, the grants, RLS on, triggers
   enabled.
7. **Recreate the operator.**
   - Authentication → invite each email in `auth-users.csv`. Set sign-up off and email
     confirmation on, as on the old project (A1-08).
   - The new user ids differ from the old ones. Stored `created_by` values keep the old ids,
     which reference no table.
8. **Point the app at the new project.** In Vercel, change `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, then redeploy. Check
   `/api/health`, and update `BACKUP_DATABASE_URL` (6.2).
9. **Record it in CLAUDE.md §0.** Write down which backup was restored, when, and what was
   lost: everything after the backup's time.

**Recovering a few rows** (a mistaken write, not a lost database): restore the newest backup
with the drill and `NEXRA_DRILL_KEEP=1`, read the rows there, and apply the correction to
production as its own approved change.

## 7. Before the next article (publishing article 2 and later)

The renderer can render a second article only after these steps (audit A5-01; fix F9 did step 1). Each is its own
checkpoint under its own approval (`CLAUDE.md` §6).

**Checking a version in one press.** On the article's fact-check panel, *Check all units…* opens one confirmation (units to
carry, units to check, estimated runs and cost range, today's usage against the 40-a-day cap; refused when the cap would
be exceeded), then carries every unit it can and checks the rest one at a time — queue, run now, record — in this browser
tab. It continues past a unit that needs review and lists those units at the end; it stops on a failed run, a malformed
answer, any refused request, or *Stop after this unit*. Closing the tab stops it after the unit in flight; pressing again
resumes from the unchecked rows. Each unit still has its own run and record, as when checked by hand.

1. **Live slugs and keywords come from the records (done, F9).** The product keeps no list of live slugs in code. It
   reads `nexra_article_publication_live_articles(destination)` (migration `20261015120000`). That function returns
   each live slug with the article it was published from and that version's keywords. The proposal eligibility, the
   preview, the editor's live notice and the renderer all follow it. Until that migration is applied, every proposal
   is blocked `live-articles-unread`.
2. **Re-pin the website template at the then-current `nexra-ai` `main`** (a `/3` template beside `/2`; never edit a
   pinned template):
   - read `lib/blog.ts`, the live article files the renderer edits and `components/site/article.tsx` read-only at the
     new commit;
   - record each file's SHA-256 in the new template;
   - check every component name the renderer imports;
   - list the template's own live slugs.
   The renderer refuses any file whose hash differs (`registry-changed`, `live-article-changed`).
   Done for article 2: `nexra-ai-blog-tsx/3` at `356f38f8` (`template.ts`), pinned at `main` as it stood on 2 Oct — two
   merges after the first article's `9a69c8c` (PR #10, the organisation schema; PR #11, edits to the follow-up article),
   so a pin at `9a69c8c` would have been refused against `main`. Check `main` has not moved again before rendering.
   Done for article 3: `nexra-ai-blog-tsx/4` at `ab5f10d6` (`main` after article 2's merge, PR #12), the cross-link on
   the first line of the follow-up article's missed-call paragraph (the "journey" section). Each re-pin is one PR by
   hand today; automating it per publication is on the backlog (part of P-L2).
3. **Choose the cross-link** for the new article. Today it is mandatory and targets the one pinned live article. A
   rendered article writes its paragraphs as string literals, so it cannot be a cross-link source until the renderer
   can target it (A5-01 item 3).
4. **Render and build** the three files from the stored, approved version and its approval, in a temporary copy of
   `nexra-ai`. `npm ci`, `npm run build`, `npm run typecheck` and `npm run lint` must all pass; then delete the copy.
   The renderer refuses a slug the records list as live, any keyword that repeats a live article's recorded keywords,
   and a live article whose keywords are not recorded.
5. **After the merge, record the new live slug in the database** with a migration in the 6.12a shape. Replace
   `nexra_article_publication_live_slugs` and `nexra_article_publication_live_slug_article` with the new slug and its
   owning article; the propose function is unchanged. Apply it by §1. No code list changes: the product reads the
   records.
   Done for article 2: `20261017120000_live_slug_ai_sdr_tool.sql`, **applied to production and recorded on 3 Oct 2026**
   by §1.2 after manual backup run `37091449651` (local tampered-hash test first; one hash-checked transaction, SHA-256
   `29f315b84c3dfba0ef6d038b82d12289f8bcdfddaf85c7e19c217faaf52c4f48`; no `NOTIFY pgrst`, no signature changed).
   Verified read-only: 40 history rows; three live slugs; the live-articles read lists `ai-sdr-tool` → article
   `6f50f8cb…`, version 2, its four keywords; the propose and read functions' bodies unchanged; every row count and
   the article tables' fingerprint unchanged (step 6 done). Harness suites `live-slug-2` (21) and
   `live-slug-2-upgrade` (12); the `live-slugs` and `live-articles` suites now run on the schema before it, which
   they pin.
   Done for article 3: `20261018120000_live_slug_missed_call_text_back.sql` (PR #110), **applied to production and
   recorded on 3 Oct 2026** by §1.2 after manual backup run `37099766394` (local tampered-hash test first; one
   hash-checked transaction, SHA-256 `586f2739edb0cea4f2aec8c382974def5cc82a42d234301c0b24b1aa10d006cf`; no `NOTIFY
   pgrst`, no signature changed). Verified read-only: 41 history rows; four live slugs; the live-articles read lists
   `missed-call-text-back` → article `339c9b60…`, version 2, its three keywords; the propose and read functions'
   bodies unchanged (`91aaca49…`, `c4ac3b46…`); every row count and the article tables' fingerprint unchanged (step 6
   done). Harness suites `live-slug-3` (22) and `live-slug-3-upgrade` (12); the `live-slug-2` suite now runs on the
   schema before it, which it pins.
6. **Confirm read-only** that `nexra_article_publication_live_articles('nexra-agency-website')` lists the new slug,
   its article, the proposed version and that version's keywords.

**Article 2 — `ai-sdr-tool` (published 3 Oct 2026).** Steps 1–4 as recorded: template `/3` at nexra-ai `356f38f8`
(PR #104); article `6f50f8cb-bb85-4389-a5b4-21402c739f8b` version 2 (content SHA-256 `cdcfbc87…b524`; 13 of 13
check units passed, 4 run on v2 and 9 carried from v1), approved 3 Oct 02:02 UTC (approval `60268daa…`, 5 attested
"Our view" paragraphs, attestation ticked), proposal `870a1af6…` to `nexra-agency-website` (preview `1439bd4d…`);
rendered from that stored version and approval, built in a temporary copy, opened as nexra-ai PR #12 and merged by the
operator as `ab5f10d`; live at `https://www.nexraagency.com/blog/ai-sdr-tool` (operator browser check, FAQ working,
Search Console indexing requested). Rendered files: `app/blog/ai-sdr-tool/page.tsx` `dbe38009…`, `lib/blog.ts`
`072bb1d1…`, the follow-up article with one link in its "what it does" section `51669948…`. Step 5 is migration
`20261017120000`; step 6 follows its apply.
Proposal `870a1af6…` was found `withdrawn` on 3 Oct (an accidental click); the operator re-records a proposal for
version 2 — new proposal `2b8b07d1…`, recorded 3 Oct 2026 11:16 UTC (read in production).

**Article 3 — `missed-call-text-back` (published 3 Oct 2026).** Steps 1–4 as recorded: template `/4` at nexra-ai
`ab5f10d` (PR #109); article `339c9b60-7f4c-4c6b-8692-1bb7b9cdfc52` version 2 (content SHA-256 `0a076a01…8bae0`;
13 of 13 check units passed — v1 by one press of "Check all units…" (13 runs, 10 passed, 3 needs review), v2 with
three wording fixes by one press (10 carried, 3 fresh runs)), approved 3 Oct 05:02 UTC (approval `ee51c6a2…`, 5
attested "Our view" paragraphs, attestation ticked), proposal `c060a913…` to `nexra-agency-website` (preview
`4fc018ef…`); rendered from that stored version and approval, built in a temporary copy, opened as nexra-ai PR #13 and
merged by the operator; live at `https://www.nexraagency.com/blog/missed-call-text-back` (operator browser check,
Search Console indexing requested). Rendered files: `app/blog/missed-call-text-back/page.tsx` `e4058981…`, `lib/blog.ts`
`97d36872…`, the follow-up article with one link in its missed-call paragraph `8a241b4c…`. Step 5 is migration
`20261018120000`, applied 3 Oct; step 6 done (above).

---

## 8. DataForSEO keyword snapshot (F0)

The design is `docs/roadmap/F0-dataforseo-keyword-snapshot.md`; the schema is migration `20261016120000`
(`nexra_provider_runs`, `nexra_provider_requests`, `nexra_keyword_metrics`; five functions, among them
`nexra_provider_metrics_record`); the code is `src/lib/providers/dataforseo` (config, client, parsers, estimate),
`src/lib/keyword-snapshots` (service, store, routes) and the *Provider estimates* section on Keyword Intelligence.
Every figure it stores is a provider's estimate, labelled so on screen, never observed data; no agent reads it.

### 8.1 The variables (Vercel: Sensitive, Production only)

| Variable | What | Rule |
|---|---|---|
| `DATAFORSEO_LOGIN` | The account's API login | Secret. Vercel **Sensitive**, **Production** only, so a preview build holds no credential. Never a `NEXT_PUBLIC_` prefix (the config refuses one). |
| `DATAFORSEO_PASSWORD` | The account's API password | As above. The two are set together: one without the other is a configuration error that names the variable. |
| `DATAFORSEO_MODE` | Which API the server calls | **Unset, empty or anything but exactly `live` = the sandbox** (free, dummy data, recorded and labelled as such). Only `live` calls `api.dataforseo.com`. |
| `DATAFORSEO_DAILY_CAP_USD` | The daily cap for live calls, in US dollars | Unset = `1.00` (decision Q3). Above `5.00`, negative or unparsable refuses every run (the database refuses any cap above 5.00 too). |

The values are never pasted into chat, a log, a doc or the repository (which is public). With both credentials
empty the product reads "Not set up yet" and nothing else changes.

### 8.2 Changing the mode: variable, redeploy, check

A Vercel variable changes nothing until the next deployment. The sequence for every mode change:

1. Set `DATAFORSEO_MODE` (unset for the sandbox; exactly `live` for the paid API) in the Production environment.
2. Redeploy production (the current `master`), then confirm the deployment by §2.1.
3. Open Keyword Intelligence → Keywords; the *Provider estimates* footer names the mode the deployment is in and the
   cap. The Fetch confirmation names it again ("LIVE — charges the DataForSEO balance" or "Sandbox — free, dummy
   data").
4. After the first run in the new mode, confirm read-only that the newest `nexra_provider_runs` row has the expected
   `mode` and `api_host`.

### 8.3 The $1.00 cap, and what to do when it is hit

The cap is global per UTC day and counts live runs only: the sum over today's live runs of
`coalesce(cost_usd, estimate_usd) + unknown_cost_usd` — a finished run at its recorded cost, an open run at its
estimate, and timed-out calls at their estimate because the provider may have charged them. The reserve function
takes an advisory lock on the day, so two reservations at once cannot both pass. A sandbox run costs 0 and is never
counted.

When it is hit the request answers **429 `cap-reached`** with a Retry-After until midnight UTC; nothing is sent to
the provider and no run row is created. The screen says "Daily provider cap reached ($X of $Y used today); resets at
midnight UTC". What to do: nothing — wait for midnight UTC. Never edit a run row (the guards refuse it anyway), and
raise the cap only by a deliberate change to `DATAFORSEO_DAILY_CAP_USD` under §6 of CLAUDE.md, never above the
$5.00 ceiling. A cap above the ceiling refuses every run rather than being clamped.

### 8.4 Verifying a run (read-only)

After a fetch, in the SQL editor as read-only `SELECT`s only:

- `nexra_provider_runs`: the newest row for the project — `mode`, `api_host`, `status` (`completed`; `partial` with
  an `error_code` of `incomplete` or `deadline` names missing calls; `failed` with `provider-refused` means the
  credentials were refused and nothing was charged), `estimate_usd`, `cost_usd`, `unknown_cost_usd`, `finished_at`.
- `nexra_provider_requests` for that run: eleven rows for a full run (seq 0 the overview, seq 1–10 one per seed; a
  resume adds seqs 11–20 with `params->>'retry_of'`), each with its `outcome`, the provider's `cost_usd` and
  `provider_task_id`, and `response_sha256`. `params` never holds a credential (the function refuses one).
- `nexra_keyword_metrics` for that run: up to 10 seed rows and 20 related rows per seed, every row with `provider`,
  `mode`, `location_code` 2840, `language_code` `en` and `fetched_at`. A null figure is "not given", never 0.
- For a live run, set `cost_usd` against the DataForSEO dashboard's figure for the day and record any difference in
  CLAUDE.md §0 before anything is built on the data.

On screen: the run's mode badge, its status, the label "Provider estimate — DataForSEO, <date>, United States /
English — not observed" and the table. A sandbox run shows "Sandbox — dummy data, not real".

### 8.4a Run history

| Date (UTC) | Run | What happened |
|---|---|---|
| 2 Oct 2026 11:12, 11:25, 13:21, 13:23 | `df73ba33`, `710778ef`, `fe58d6fd`, `572e1fc5` (sandbox) | **Failed**, each at its first call with HTTP 401 → `provider-refused`; nothing charged, no metric row. **Cause: a wrong credential value in Vercel** (the website password where the API password belongs, or a stray character) — the owner's side; the code, the host and the header were right. Fixed by re-entering both values in Vercel and redeploying. |
| 2 Oct 2026 13:41 | `9598361a` (sandbox) | **Passed**: completed in 13 s, 11 calls, cost 0, 10 dummy metric rows (the sandbox answers a fixed sample, so no seed row), nothing counted against the cap. |
| 2 Oct 2026 14:06 | `b50f8fa7` (**live**) | **Passed**: completed in 13.6 s, 11 calls, cost **$0.1371** (estimate $0.1572), 41 metric rows (7 seed + 34 related); three seeds without provider data. Expected balance $50.8629; the DataForSEO dashboard showed $50.86284 — a match within the four-decimal rounding. |

**Lesson:** when a run reads "refused the credentials", test the values in a browser first — a `GET
https://api.dataforseo.com/v3/appendix/user_data` with the API login and API password as Basic auth answers 200 with
the account's figures, or 401 if the values are wrong — before suspecting the code. The API password is not the
website password; it is shown in the dashboard's API Access page (or sent by e-mail from there).

### 8.5 The live steps, in order, each under its own approval

1. **Apply migration `20261016120000`** to production by §1 and record it; verify read-only (the three tables with
   RLS on and no policies, `service_role` SELECT only, the five functions `security definer` with EXECUTE for
   `service_role` only, every guard trigger enabled).
2. The DataForSEO account exists (created and email-verified). **Not topped up** at this step.
3. The operator sets `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (Sensitive, Production only), leaves
   `DATAFORSEO_MODE` unset, and redeploys (§8.2). The sandbox needs the ordinary credentials and charges nothing.
4. **One sandbox run in production** from the screen, through the confirmation. Verify by §8.4: `sandbox` /
   `sandbox.dataforseo.com`, cost 0, eleven request rows, metric rows present, the badge on screen, nothing counted
   against the cap, no credential in any log line.
5. **The $50 top-up** — only after step 4 passes, with the operator's approval. Confirm the current Labs prices on
   DataForSEO's pricing page at the same time; the estimate in the design note (≈ $0.16 a run) is re-checked before
   step 7.
6. The operator sets `DATAFORSEO_MODE=live` and redeploys (§8.2). The Fetch confirmation now shows the LIVE warning.
7. **One live run** with the ten seeds, through the confirmation. Verify by §8.4 and set the recorded cost against the
   DataForSEO dashboard.
8. Record the outcome (run id, cost, the dashboard's figure) in CLAUDE.md §0.

A partial run is resumed only from the screen's *Resume…* through the same confirmation (decision Q4); nothing
resumes on its own, and no live call is ever retried by the system.
