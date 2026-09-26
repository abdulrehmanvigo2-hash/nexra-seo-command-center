# Checkpoint 1.2 progress (docs reconciliation)

Branch `claude/phase1-docs-reconciliation` from `2e8116ce`. Delete this file in the final commit.

## Findings
- #51: no test covers provider responses 401, 404 or 529. `retry-cost.test.ts:176-196` covers 500, 429 and 400.
  The only `401` hit (`process-job.test.ts:131`) is the worker credential, not the provider. Narrowed replacement applied.
- #73: harness files are `supabase/tests/tasks/setup.sql`, `supabase/tests/tasks/tests.sql`,
  `supabase/tests/task-workflow/tests.sql`; both suites load `c4/setup.sql` and `gsc/setup.sql` first (`run.sh:453,459`).

## Rows applied
- supabase/tests/README.md: row 73 (actual file names from run.sh:453,459).
- docs/BACKEND.md: rows 43-72 (row 72 needs no edit once row 29 landed; row 59 applied as an appended sentence) + 7 mirrored facts.
- supabase/README.md: rows 29-42, plus additional row 87 (see deviations).
- CLAUDE.md: rows 1-8, 10-28 (row 9 unchanged by design; rows 12 and 13 applied as one merged paragraph) + 7 verification facts under §0.

## Rows remaining
74-86

## Deviations
- Row 2: the closing `**` was kept, because it closes the bold opened at line 6 ("**Current stage:"); it is not stray.
- Additional row 87: supabase/README.md:261-262, the `20260922140000` (draft publication proposals) note "applied only to a throwaway local PostgreSQL 16" was also stale and is corrected to applied and recorded.
