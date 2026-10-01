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
| Stored | as a GitHub Actions artifact of this private repository, one per run, kept **30 days** (`nexra-backup-<run id>`, containing `nexra-backup-<UTC>.tar.age`) |
| Code | `scripts/backup/backup.sh` (dump, verify, encrypt), `scripts/backup/restore-drill.sh` (6.4), `scripts/backup/test-local.sh` (the whole cycle against a local database) |

Inside the encrypted file: `db.dump` (`pg_dump` custom format), `auth-users.csv`, and
`manifest.txt` (the time, the server and `pg_dump` versions, each table's row count and each
file's SHA-256).

**Why an artifact, not a backups repository.** The repository is private, and the file is
encrypted before upload. Artifacts need no extra credential, while a second repository would
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

### 6.3 Routine

- **Daily:** nothing, unless a "Nightly backup failed" issue or mail arrives. Then open the run,
  read the failing step (the script says what failed and never prints the URL), fix the cause,
  run it by hand, and close the issue.
- **Monthly:** download the newest artifact and keep it offline next to the key. Run the drill
  (6.4) on it, and note the date and result in CLAUDE.md §0.

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
   3. creates every role the dump names, without login;
   4. restores in one transaction, creating the triggers after the data, so no guard fires;
   5. compares every table's row count with the manifest;
   6. deletes everything.

   `restore-drill: OK — N tables restored, every row count equals the manifest` is a pass. Set
   `NEXRA_DRILL_KEEP=1` to keep the cluster for inspection.

`bash scripts/backup/test-local.sh` runs the whole cycle without production: it builds a
database from the migrations, backs it up, runs the drill, and tries the refusals (wrong key,
tampered file, missing settings, too few projects, an unreachable database with a password in
its URL).

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
6. **Confirm read-only** that `nexra_article_publication_live_articles('nexra-agency-website')` lists the new slug,
   its article, the proposed version and that version's keywords.
