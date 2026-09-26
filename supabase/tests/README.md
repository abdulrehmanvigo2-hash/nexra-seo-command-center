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
| `gsc-pairs` | `c4/setup.sql`, `gsc/setup.sql`, `gsc-pairs/setup.sql`, `gsc-pairs/tests.sql` | 94 assertions (M1 P4c query × page rows): schema, security, the pair validator, every shape refusal through the record function writing nothing, recording a set, `exists` with the count and no extension, the 250-pair limit, immutability, restrict on the project, isolation, the snapshot table untouched |
| `gsc-pairs-races` | as `gsc-pairs`, scenarios in `run.sh` | two sessions on one window (P1: second waits on the advisory lock, answers `exists`, one set), the first rolling back (P2: second creates), different windows without waiting (P3) |
| `findings` | `c4/setup.sql`, `findings/setup.sql`, `findings/tests.sql` | 109 assertions (T3 crawl findings): schema, security, every shape and binding refusal through the record function, recording, `exists`, a second rule version beside the first, immutability, cascade-only deletion, project isolation |
| `findings-races` | as `findings`, scenarios in `run.sh` | two sessions recording one crawl (F1: second waits, answers `exists`, one report), the first rolling back (F2: second creates), different rule versions without waiting (F3) |
| `signals` | `c4/setup.sql`, `findings/setup.sql`, `signals/setup.sql`, `signals/tests.sql` | 36 assertions (T5 crawl signals): the seven page columns and the link column with their types and nullability, the prefixed constraints, no new policy or trigger, the findings category set widened by `images`, every refusal (negative counts, more images without alt than images, over-long header or anchor text, a signal on a URL never reached) writing nothing, empty versus null anchor text, privileges |
| `signals-upgrade` | as `signals` up to T3, `signals/upgrade-before.sql`, the T5 migration, `signals/upgrade-after.sql` | 7 assertions: the T5 migration applied over pages, links and a T3 report written before it keeps every row, leaves every new column null, and then records the new signals and a rule-version-2 report |
| `content` | `c4/setup.sql`, `findings/setup.sql`, `content/setup.sql`, `content/tests.sql` | 38 assertions (M2 crawl content signals): the nine page columns with their types, nullability and no default, the prefixed constraints, no new policy or trigger, no link column, the findings category set widened by `content`, every refusal (negative counts or milliseconds, more malformed alternates than alternates, over-long lang, og:title, og:image or twitter card, a signal on a URL never reached) writing nothing, empty lang and zero counts apart from null, privileges, and the T5 columns and constraints untouched |
| `content-upgrade` | as `content` up to M1 P4c, `content/upgrade-before.sql`, the M2 migration, `content/upgrade-after.sql` | 7 assertions: the M2 migration applied over pages, a T5 edge and a rule-version-2 report written before it keeps every row and reading, leaves every new column null, and then records the new signals and a rule-version-3 content finding |
| `triage` | `c4/setup.sql`, `findings/setup.sql`, `triage/setup.sql`, `triage/tests.sql` | 84 assertions (M3 crawl finding triage): schema, keys and guards; security (RLS, no policies, `service_role` SELECT and EXECUTE on the set function only, no direct write); every outcome of the set function (`set` with the previous status, one row per project and key across crawls, `not-found`, `not-recorded`, refused status, note and arguments writing nothing); the immutable identity, no re-dating, no re-binding to another project's or another key's finding, no direct delete or truncate; project isolation; the findings and reports byte-for-byte unchanged; the cascade with a crawl |
| `triage-races` | as `triage`, scenarios in `run.sh` | two operators on one key (R1: the second waits and answers the first's status as previous, one row, the later decision wins), the first rolling back (R2: the second's decision stands), different keys without waiting (R3) |
| `tasks` | `c4/setup.sql`, `gsc/setup.sql`, `tasks/setup.sql`, `tasks/tests.sql` | 80 assertions (Project Manager task core): schema, security, the create function's outcomes and refusals, source binding to a Director run or a stored query, no update path, project isolation |
| `task-workflow` | as `tasks`, `task-workflow/tests.sql` | 150 assertions (Project Manager task workflow): the events table and its guards, the transition map, the four functions' outcomes, the `handoff-active` refusal, link checks, project isolation |

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
