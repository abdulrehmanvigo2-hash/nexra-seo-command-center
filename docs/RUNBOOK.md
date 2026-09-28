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
- **Known mismatch, left as is (decision Q10):** the articles migration is the repository file
  `20260923120000_create_articles.sql` but is recorded in production as `20260923043554`
  (`create_articles`). The schema is correct; only the version differs. Do not repair or rename
  it. A CLI `migration list` shows the two versions unmatched; that is expected. Anyone running
  `db push` against production would try to apply `20260923120000` again — never run `db push`
  or `db reset` against production.

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
