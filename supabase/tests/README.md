# Database test harness

PostgreSQL tests for the content-workflow migrations: C2 (articles), C4 (article check units),
C5 (article approvals), draft publication proposals (Stage 5A), C6 (article publication
proposals) and D3 (one active proposal per destination and slug across both proposal tables). They exercise the real migration
SQL — guards, grants, row level security, `security definer` functions and row locks — which the
TypeScript tests in `src/lib` only read as text.

```sh
bash supabase/tests/run.sh              # every suite
bash supabase/tests/run.sh c5 c6        # selected suites
```

## Safety

`run.sh` never connects to a hosted database. It:

- creates a new PostgreSQL cluster with `initdb` in a fresh temporary directory;
- starts it with TCP disabled (`listen_addresses = ''`), on a Unix socket inside that directory;
- removes every `PG*` connection variable and `DATABASE_URL`-style variable from its
  environment, and disables `.pgpass` and service files;
- checks that the server it reached is the cluster it just created, before running anything;
- stops and deletes the cluster when it exits.

No host, port, password or connection string is read from the environment or from any file.
Do not run the SQL files here by hand against any other database: they create roles and
fixtures, and some fabricate state with triggers disabled.

## Requirements

- bash 4+, GNU `date` (Linux or WSL);
- PostgreSQL 16 server binaries (`initdb`, `pg_ctl`, `postgres`, `psql`, `createdb`, `dropdb`),
  found through `pg_config --bindir`, `/usr/lib/postgresql/16/bin`, or `PG_BIN`;
- when run as root, an unprivileged OS user for the server (`NEXRA_DB_TEST_OS_USER`,
  default `postgres`), used through `runuser`.

`NEXRA_DB_TEST_KEEP=1` keeps the temporary cluster and logs for inspection.

## Suites

Each suite starts from a new database with every migration in `supabase/migrations` applied in
order. A suite passes only if it runs to the end and reports exactly its expected number of
assertions (`EXPECTED` in `run.sh`); change that number when you add or remove assertions.

| Suite | Files | Checks |
|---|---|---|
| `c2` | `c2/setup.sql`, `c2/tests.sql` (on `supabase/seed.sql`), `c2/race-*.sql` | 54 assertions; two-session create/create (`exists`) and save/save (`stale`) races |
| `c4` | `c4/setup.sql`, `c4/tests.sql` | 60 assertions |
| `c5` | `c4/setup.sql`, `c5/setup.sql`, `c5/tests.sql` | 69 assertions |
| `drafts` | `c4/setup.sql`, `drafts/setup.sql`, `drafts/tests.sql` | 40 assertions: draft proposal security, every propose outcome, the application's withdrawal UPDATE, guards |
| `drafts-races` | as `drafts`, scenarios in `run.sh` | two drafts on one slug, identical proposes, propose vs save, withdrawal vs propose |
| `c6` | `c4/setup.sql`, `c5/setup.sql`, `c6/setup.sql`, `c6/tests.sql` | 146 assertions: schema, security, binding refusals, immutability and withdrawal |
| `c6-races` | as `c6`, scenarios in `run.sh` | nine two-session races (E1–E9); the second session must wait for the first and answer as expected |
| `c6-d3` | as `c6`, plus `c6/d3-setup.sql`, `c6/d3-tests.sql` | 35 assertions: the D3 trigger's schema and security, both orders, retries, withdrawal, rollback, direct privileged inserts, the isolation guard |
| `c6-d3-races` | as `c6-d3`, scenarios in `run.sh` | draft/article races in both orders (D1–D2), two drafts (D3), different slugs without waiting (D4), rollback (D5), withdrawal vs propose in both orders (D6–D8), and a 12-session stress run with no deadlock |
| `c6-d3-preflight` | the D3 migration | refuses to apply over an existing draft/article duplicate, leaving nothing; applies once one is withdrawn |
| `c6-rollback` | the C6 migration | a failed apply leaves no partial objects; a clean apply succeeds |
| `gsc` | `c4/setup.sql`, `gsc/setup.sql`, `gsc/tests.sql` | 100 assertions (M1 CP1a Search Console snapshots): schema, security, the JSONB row validator, every shape refusal, recording, `exists`, no-data and partial rows, immutability, project isolation |
| `gsc-races` | as `gsc`, scenarios in `run.sh` | two sessions on one window (G1: second waits, answers `exists`, one row), the first rolling back (G2: second creates), different windows without waiting (G3) |
| `findings` | `c4/setup.sql`, `findings/setup.sql`, `findings/tests.sql` | 108 assertions (T3 crawl findings): schema, security, every shape and binding refusal through the record function, recording, `exists`, a second rule version beside the first, immutability, cascade-only deletion, project isolation |
| `findings-races` | as `findings`, scenarios in `run.sh` | two sessions recording one crawl (F1: second waits, answers `exists`, one report), the first rolling back (F2: second creates), different rule versions without waiting (F3) |
| `signals` | `c4/setup.sql`, `findings/setup.sql`, `signals/setup.sql`, `signals/tests.sql` | 36 assertions (T5 crawl signals): the seven page columns and the link column with their types and nullability, the prefixed constraints, no new policy or trigger, the findings category set widened by `images`, every refusal (negative counts, more images without alt than images, over-long header or anchor text, a signal on a URL never reached) writing nothing, empty versus null anchor text, privileges |
| `signals-upgrade` | as `signals` up to T3, `signals/upgrade-before.sql`, the T5 migration, `signals/upgrade-after.sql` | 7 assertions: the T5 migration applied over pages, links and a T3 report written before it keeps every row, leaves every new column null, and then records the new signals and a rule-version-2 report |

`c4/setup.sql` is also the shared base for the draft, C5 and C6 suites (projects, the `t.ok()`
assertion helper). Draft fixtures are fact-checked and approved the way the application does
it: `service_role` UPDATEs through the draft guards.

### C5 and the C6 schema

C6 adds a foreign key to `nexra_article_approvals`. A plain `TRUNCATE` of the approvals is
therefore refused by PostgreSQL itself (`0A000`) before the C5 guard runs, and
`TRUNCATE … CASCADE` is refused by the guard (`23514`); `c5/tests.sql` asserts both and that the
history is intact afterwards. Its `security definer` inventory names the authorized C2, C4, C5
and C6 functions, and every such function in the database, with signatures.

### C6 and D3

`c6/tests.sql` lists the article proposal table's triggers exactly; since D3 that list includes
`nexra_article_publication_proposals_reserve_slug`.

### D3: one active proposal per destination and slug

`20260926120000_publication_proposals_cross_table_slug_lock.sql` adds one BEFORE INSERT trigger
to each proposal table, sharing one function. For a row inserted as `proposed` it refuses a
transaction that is not READ COMMITTED (`0A000`), takes a transaction advisory lock on the
destination and slug, and raises `unique_violation` if the other table holds an active
proposal for them; both propose functions answer that as `slug-taken`. Before D3 the draft and
article tables each enforced the rule only for themselves; `c6-d3` and `c6-d3-races` now assert
that one active reservation survives where the earlier G1 (article, then draft) and G2 (both at
once) reproductions ended with two.
