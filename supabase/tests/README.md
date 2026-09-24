# Database test harness

PostgreSQL tests for the content-workflow migrations: C2 (articles), C4 (article check units),
C5 (article approvals) and C6 (article publication proposals). They exercise the real migration
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
| `c6` | `c4/setup.sql`, `c5/setup.sql`, `c6/setup.sql`, `c6/tests.sql` | 146 assertions: schema, security, binding refusals, immutability and withdrawal |
| `c6-races` | as `c6`, scenarios in `run.sh` | nine two-session races (E1–E9); the second session must wait for the first and answer as expected |
| `c6-d3-gap` | as `c6`, plus `c6/d3-gap-setup.sql` | the known D3 gap (below) |
| `c6-rollback` | the C6 migration | a failed apply leaves no partial objects; a clean apply succeeds |

`c4/setup.sql` is also the shared base for C5 and C6 (projects, the `t.ok()` assertion helper).

### C5 and the C6 schema

C6 adds a foreign key to `nexra_article_approvals`. A plain `TRUNCATE` of the approvals is
therefore refused by PostgreSQL itself (`0A000`) before the C5 guard runs, and
`TRUNCATE … CASCADE` is refused by the guard (`23514`); `c5/tests.sql` asserts both and that the
history is intact afterwards. Its `security definer` inventory names the authorized C2, C4, C5
and C6 functions, and every such function in the database, with signatures.

### D3: the known gap

`c6-d3-gap` passes while the documented gap between draft and article proposals is present
(see the header of `20260925120000_create_article_publication_proposals.sql`): the draft
proposal function does not check article proposals, and the two tables share no lock or index.
G1 (article, then draft) and G2 (both at once) each end with two active reservations of one
destination and slug; G3 confirms a committed draft proposal does block an article proposal.
When D3 is fixed, change G1 and G2 to expect `slug-taken`.
