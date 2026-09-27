# Nexra SEO Command Center

Professional, agency-grade AI SEO platform. This file defines the operating rules for the
project. Read it before writing any code.

**Current stage: Phase 2, Project Manager loop closure — step (a), the handoff outcome read-back
(checkpoint 2.2), is merged, deployed and browser verified; step (b), handoffs for five more
agents (checkpoint 2.3), is on its branch; Phase 1 (baseline truth and gates) is complete (see §14).
The Project Manager task workflow (status transitions, owner changes, specialist handoff, event
history) is merged and production verified end-to-end.
C1–C6 (with D3), T3–T6, all of M1 (CP1a–CP1c, P4a–P4d), M2, M3, M4 and M5 are complete, merged and
deployed (M5: PR #17, `62ae593`, deployment `dpl_Ck286bMi6dkewMgPV2JRH3HBggv8`; one production
project Director run completed on 26 Sep after an earlier refusal; panel browser verified); M2 is production verified on crawl `3398ff1a…` and its On-Page bound on two
completed reviews; M3 (PR #14, `db7afdb`, migration `20261002120000` applied and recorded) is
deployed, one triage decision recorded in production, browser verified; M4 (PR #15,
`3510493`, and the selector fix PR #16, `220c732`) is deployed, production verified on
search-query-review run `73f38c16…` and browser verified. The scheduled snapshot capture is production verified (two
connected snapshots, 25 and 26 Sep) and P4c captured its first 10 query × page pairs. The task
core and task workflow are merged and production verified (see §0).**

---

## 0. Current Checkpoint

GitHub `master`: `0143a0cfda71dd252611276f14cdefac2f50d69f` (merge of PR #27,
`claude/phase2-outcome-readback`, the handoff outcome read-back; preceded by PR #26 `e01bf12f…`
(Phase 1 closing docs), PR #25 `6363db53…` (CI gates),
PR #24 `3a316124…` (security and worker tests), PR #23 `97aa0018…` (docs reconciliation), PR #22 `2e8116ce…` (intake bound), PR #21
`073bf85e…` (handoff-run restore) and PR #20 `47fae75d…` (task workflow, `bdd541c`); the C6 merge,
PR #3, is `f28cd35e…`; the C5 merge, PR #2, is `304ac146…`).

Production deployment: `dpl_3DnEtpn3y4MWQcGgZQr7kZr4Zsqp`, READY, built from `master` at
`0143a0cf`, serving `nexra-seo-command-center.vercel.app` (previous:
`dpl_EWD3RTL6SxybjHtM3Hew1zUCFCLz` at `e01bf12f`); `master` CI run `36287780891` passed all five
jobs.

**Phase 1 checkpoint 1.2 (docs reconciliation, 26 Sep):** PR #23 merged as `97aa0018…`; docs and
source comments only, no behaviour change, no migration; deployment `dpl_88CT3m…` READY.

**Phase 1 checkpoint 1.3 (security and worker tests, 26 Sep):** PR #24 merged as `3a316124…`;
tests only (113 new cases, `npm test` 2,189 passed), no behaviour change, no migration;
deployment `dpl_3asSXd6p…` READY. One documented question: the Anthropic provider classifies a
caller abort as `rejected` (the SDK's status-less `APIUserAbortError`), which the worker's own
timeout and lease race decide ahead of.

**Phase 1 checkpoint 1.4 (CI gates):** `.github/workflows/ci.yml` runs typecheck, lint, build,
the full test suite and a secret scan (`scripts/secret-scan.mjs`, fixtures admitted one by one in
`.github/secret-scan-allowlist`) on every pull request and every push to `master`, with no
credential of any kind; superseded runs on a pull request are cancelled. CI verifies; it never
deploys. PR #25 merged as `6363db53…`; deployment `dpl_81Hyhh…` READY; the first `master` CI run,
`36260453844`, passed all five jobs, including the full-tree secret scan. Branch protection on master is configured but not enforced on the current GitHub plan; merge discipline is the operator's explicit approval plus green CI on every pull request.

**Phase 1 checkpoint 1.5 (browser verifications, 26–27 Sep, operator):**

- M3: the *Observed findings* section shows the recorded findings and the triage decision's state.
- M4: the *Observed query inventory* on `/keywords` (Keywords tab) shows real Nexra Agency Search
  Console queries.
- M5: the *Project Director review* panel restores the completed 26 Sep run with its bundle
  summary.

**Phase 1 checkpoint 1.6 (C4 new-parser live check, 26 Sep):** one operator-queued
`article-check-unit` run, `6e2e9659…`, on unit 1 (`lead-introduction:1`) of article
`c89182f9…` Version 2, executed by Run Now: completed, 1 attempt, `claude-opus-5`, 587-character
summary. Recorded as unit `0022ff3f…`, **needs-review** — both statements unverifiable, an evidence
result, not a parser fault. Statement accounting exact: 2 of 2 classified, no unnumbered lines,
no missing or duplicate statements, coverage complete (against unit 0's 9 of 8 with 1 unnumbered
line). The parser's malformed-answer path (`failed` / `coverage-incomplete`) stays covered by
automated tests only. After it: 41 runs, 41 attempts; units 0 and 1 recorded (both needs-review),
units 2 and 3 unchecked.

**Phase 1 complete:** PR #23 (docs reconciliation), PR #24 (security and worker tests), PR #25
(CI gates), the browser verifications (1.5) and the C4 live check (1.6); PR #26 (`e01bf12f…`)
recorded them.

**Phase 2 checkpoint 2.1 (design, 26 Sep):** an audit-only design note for the three Phase 2 steps,
approved with decision Q1: a handoff's outcome is computed at read time from the linked run — no
outcome event, no migration. Priority change and recording a Project Manager plan are OPEN
(each would need a migration) and not part of 2.2.

**Phase 2 checkpoint 2.2 (handoff outcome read-back):** `GET /api/agent-tasks/[taskId]` also
answers `outcome`, computed now from the run named by the newest `handoff-run-linked` event and
shown only when that run exists, is the same project's and names the task as `sourceTaskId`
(otherwise `unavailable`, never guessed); states queued, running, retrying, completed (screened
summary, model, attempts), failed (fixed code and message; `rejected-output` stores no answer),
cancelled. The *Live tasks* history view shows it, with no control. Read only: no event, no
migration, no task or run write, and the task's status never changes because its run finished.
PR #27 merged as `0143a0cf…`; deployment `dpl_3DnEtpn3…` READY. **Browser verification PASS
(operator, 27 Sep):** the *Handoff outcome* section shows on task `30e79092…`.

**Phase 2 checkpoint 2.3 (five agent handoffs):** decisions Q2–Q4 — the operator chooses the
record, the server validates it and never picks one; Market Intelligence takes a competitor
domain the project recorded; the Writer stays deferred (draft policy, fails the read-only drift
test). Technical SEO (`crawl-review`), On-Page SEO (`on-page-review`), AI Visibility
(`answer-readiness-review`) and Authority & Backlink (`outbound-link-review`) take one of the
project's own-site crawls; Market Intelligence (`competitor-comparison-review`) one recorded
competitor domain. The handoff request carries at most one record, checked before any write
(`record-required`, `record-not-accepted`, `record-invalid`: another project's, a competitor's
or an unknown crawl, an unrecorded domain); the confirmation lists the choosable records
(`?view=handoff-choices`) and cannot confirm without one. Execution-time grounding unchanged. No
schema change; priority change stays OPEN (cp 2.3b).

**Phase 1 verification facts (26 Sep, read-only production reads):**

- Scheduled snapshot capture verified: two connected `nexra-agency` snapshots, windows ending
  21 and 22 Sep, captured 25 and 26 Sep (`source: scheduled`).
- P4c first capture verified: 10 query × page pairs for `nexra-agency`, captured 25 Sep.
- M5: one `project-priority-review` run completed on 26 Sep 04:53 UTC, after the refused
  `d2cbdcc7…`.
- M2 On-Page bound: two `on-page-review` runs completed under the bound (latest 25 Sep 13:06 UTC).
- M3: one finding triage decision recorded in production through the triage route.
- Project Manager workflow end-to-end: task `30e79092…`, events seq 7–8 (`handoff-requested`,
  `handoff-run-linked`), run `be1b692e…` queued with `sourceTaskId`, restored into the panel,
  executed by operator Run Now, one completed attempt (`claude-opus-5`, 1,552-character screened
  summary), no duplicate run, no provenance leak, task unchanged.
- PR #20 merged as `47fae75d…`; PR #21 as `073bf85e…` (deployment `dpl_3NGboYJ6…`); PR #22 as
  `2e8116ce…` (deployment `dpl_5fzqnd…`).

**Completed content-workflow stages:**

- Stage 1: durable Writer draft persistence
- Stage 2: immutable operator version history
- Stage 3: exact-version fact-check
- Stage 4: exact-version approval gate
- Stage 5A: publication proposal + exact-version preview
- Stage 5B: website artifact dry-run
- Stage 5 / Complete Article Assembly — Milestone C1: Pure Article Contract (live verified)
- Stage 5 / Complete Article Assembly — Milestone C2: Article Persistence (live verified)
- Stage 5 / Complete Article Assembly — Milestone C3: Writer Section Choice (live verified)
- Stage 5 / Complete Article Assembly — Milestone C4: Article Check Units, Option A
  (implementation complete; deployment, existing-result browser verification and new-parser
  live verification complete)
- Stage 5 / Complete Article Assembly — Milestone C5: Article Approval Gate (complete, merged,
  deployed, production verified)
- Stage 5 / Complete Article Assembly — Milestone C6: Article Publication Proposal
  (record-only), with D3 (complete, merged, migrations applied, deployed, production verified)

**C2 notes:** production migration applied (Supabase `20260923043554_create_articles`);
production deployment verified; live Version 1 creation and Version 2 immutable save verified
(article `c89182f9-4954-4834-8446-a831fc3c42d0`, drafting, version 2); stored hashes verified;
source provenance verified. No approval, fact-check, proposal or publication is part of C2.

**C3 notes:** the Writer's `section-draft` task requires an operator-chosen, zero-based
`sectionIndex`; there is no fallback to the first section, and a run queued without one is
refused at execution. No migration. Live verification: the explicit section chooser was
verified in production; the non-first section index 2 ("Where a person still belongs") was
selected; the Writer drafted exactly that section, with no fallback to section 0; grounding rules
stayed active and unsupported details were marked NEEDS EVIDENCE; the selected section saved
successfully as draft Version 1. No fact-check, approval or publication side effect occurred.

**C4 notes:** an article version is fact-checked in bounded units, never as one prompt: blocks
(metadata, lead-introduction, each H2 section, FAQs, CTA) cut into parts of at most 10 numbered
statements and 6,000 bytes, at most 150 units per version, keys `<block>:<part>`; heading context
is never checked twice; a unit passes only when every statement S1 … Sn is placed exactly once and
nothing is partial, unsupported or unverifiable. Results bind to one exact article version; the
article moves from `drafting` to `checked` only when its current version's unit set is complete
and all passed — never to `approved`. Verified locally: full test suite 1,354 passed; focused C4
tests 74 passed; typecheck, lint and production build passed; migration
`20260923180000_create_article_check_units.sql` validated with 60 assertions on an isolated
PostgreSQL 16.

**C4 release:** the production migration `20260923180000` was applied previously (history
recorded and verified). The counting fix (`892ffa0`, merged as `c23ed0b`) counts only numbered
statements S1 … Sn, each exactly once; keeps `Observation:` lines under EDITORIAL apart as
non-statement notes that never count toward coverage or evidence; and records an answer with a
missing, repeated, malformed or unexplained line as `failed` / `coverage-incomplete`, which a new
run may re-check. `passed` and `needs-review` stay final for their article version; stored
results are never rewritten. No migration. Production deployment
`dpl_FA7qMS5BbhWP4ByKzS7R6HAV8H2Z` is READY at `c23ed0b`.

**C4 production browser verification (operator):** article
`c89182f9-4954-4834-8446-a831fc3c42d0`, Version 2, displayed its four check units. Metadata
Unit 0 (`metadata:1`) was checked by a real Research & Evidence run
(`e322fc1d-01b4-478e-9b4e-7726dc5b8644`) and recorded as **needs-review**; that saved result
remained unchanged after the deployment, and the updated UI shows its original coverage
discrepancy honestly: 9 of 8 numbered statements classified, coverage incomplete, 1 unnumbered
line. The remaining three units were then unchecked. The article remains `drafting` — not
checked, not approved, not published. The corrected counting behaviour is covered by automated
tests (focused C4 87 passed; full suite 1,367 passed) and was live-verified on 26 Sep with a new
result on unit 1 (run `6e2e9659…`, unit `0022ff3f…`, needs-review, 2 of 2 statements classified,
coverage complete; see Phase 1 checkpoint 1.6); units 2 and 3 are unchecked.

**C5 notes:** an operator approves one exact, immutable article version, and only when every C4
check unit of that exact version passed, the article is `checked`, the topic decision is
`update-existing` or `different-angle`, and no `[NEEDS EVIDENCE` placeholder remains; there is no
override. `nexra_article_approvals` (append-only history) binds the article, version number,
version row id, content SHA-256, unit count and ordered unit-set digest, operator and time; the
parent's `approved_version` / `approved_by` / `approved_at` stay the current-approval pointer, and
`nexra_articles_approved_is_current` requires `approved` to name the current version. The one
write is `nexra_article_approve_version` (`security definer`, under the parent's row lock). A later
version inherits nothing. Approval is not publication. Feature commit `57284d6`, merged as
`304ac14` (PR #2); production migration `20260924120000` applied and recorded in migration history;
production deployment `dpl_6HUTVPgTSZN2VWkoDGYW39RDnYEo` READY; production verified by the
operator: article `c89182f9-4954-4834-8446-a831fc3c42d0`, Version 2, shows **Not eligible** with no
Approve button (1 unit needs review, 3 unchecked, not Checked) and approval history 0. No article
has been approved.

**Current work:** checkpoint 2.3 on `claude/phase2-agent-handoffs` (above). Earlier: the Project Manager task workflow (branch
`claude/project-manager-task-workflow` from `master` `3121ff3`, the PR #19 merge) was merged as
PR #20 (`47fae75d…`); migration `20261004120000_agent_task_workflow.sql` is applied and recorded in
production; PR #21 (`073bf85e…`) made a handoff-queued run restore into its review panel; PR #22
(`2e8116ce…`) bounded the intake review to 1,300 characters. The task core (PR #18, `6e345c5`;
migration `20261003120000` applied to production; one real backlog task on `nexra-agency`,
production verified) is its baseline. Production verified end-to-end on task `30e79092…`:
handoff-requested and handoff-run-linked events (seq 7–8), queued run `be1b692e…` with
`sourceTaskId`, panel restore, operator Run Now, one completed grounded attempt (1,552-character
screened summary), no duplicate run, no provenance leak, task unchanged. The earlier handoff run
`1d27b114…` failed `rejected-output` under the 1,500-character ask and was not retried. Each
further step starts only with explicit user approval.

**Task workflow (merged, deployed, production verified):** migration `20261004120000` adds `nexra_agent_task_events`
(append-only: `created` by trigger and backfilled, `status-changed`, `owner-changed`,
`handoff-requested`, `handoff-run-linked`; identity `seq` order; guards refuse update, delete,
truncate) and four `security definer` functions, each taking the project beside the task and
locking the row: `nexra_agent_task_set_status` along the fixed map (backlog → ready | blocked |
cancelled; ready → in-progress | blocked | cancelled; in-progress → review | blocked | cancelled;
blocked → ready | in-progress | cancelled; review → in-progress | completed | blocked; completed
and cancelled terminal), `nexra_agent_task_set_owner` (the twelve registry agents, never inferred),
`nexra_agent_task_handoff_request` (refused `handoff-active` while a linked run is queued or
running) and `nexra_agent_task_handoff_link` (same project, the owning agent, `sourceTaskId` in the
run's input). The update guard now allows only status, owning_agent and updated_at, only under the
functions' transaction flag; no UPDATE grant exists; `service_role` holds SELECT and EXECUTE only.
`GET`/`POST /api/agent-tasks/[taskId]` (operator, same origin, 60 actions per ten minutes) and
the *Actions* column of *Live tasks* (change status, change owner, hand off after a confirmation,
view history). A handoff creates at most one queued run for the owning agent through the existing
run path with the task id as provenance and executes nothing; supported owners are SEO Director
(`project-priority-review`), Project Manager (`intake-review`), Research & Evidence
(`evidence-pack-review`), Content Strategist (`content-plan-review`), Keyword & Search Intent
(`search-query-review`, `30d`) and Analytics & Learning (`performance-review`, `30d`); since
checkpoint 2.3 also the five record-reading agents with an operator-chosen record (see 2.3); the
Writer alone is deferred and shows *Handoff not supported yet*. Harness suite `task-workflow` (150).

**Task core (merged, deployed, production verified):** an audit found every Project Manager tab modelled and no task table.
Migration `20261003120000` adds `nexra_agent_tasks`: one row per operator-approved task — project,
title (1–200), owning registry agent (twelve ids restated in a CHECK, drift-tested), status (seven
values; new rows `backlog`), priority (four; default `medium`), creator, timestamps, and always a
source: `director-run` (a completed SEO Director run of the same project, by run id) or `keyword`
(the exact query text stored in the project's snapshot or query × page rows; no keyword id is
invented). No uniqueness on the source. The one write is `nexra_agent_task_create` (`security
definer`); no update, delete or truncate path exists; RLS on, no policies, `service_role` SELECT and
EXECUTE only. `src/lib/agent-tasks` (contract, store, service, wiring), `GET`/`POST /api/agent-tasks`
(operator, same origin, project-scoped, bounded), *Record as task* beneath a completed Director
result and on each observed query row (a form first, one confirmed POST), and one *Live tasks*
section on the Project Manager's Tasks tab, labelled live, above the board now labelled modelled.
No automatic creation, no assignment, no agent execution. Harness suite `tasks` (80 assertions).

**M5 (merged, deployed):** PR #17 merged as `62ae593`; deployment `dpl_Ck286bMi6dkewMgPV2JRH3HBggv8`
READY; no migration. One production `project-priority-review` run completed on 26 Sep (after the
refused `d2cbdcc7…`, see below); the *Project Director review* panel is browser verified
(checkpoint 1.5): it restores that run with its bundle summary.

**M5 (as delivered):** a gap audit found the T6 single-run hand-off complete (one upstream run by id,
project-checked, labelled, OBSERVED/PROPOSED separation, output screening, provenance on screen, run
history, no automation) and one core gap: no project-level Director review over more than one
specialist run. M5 adds one read-only task, `project-priority-review` (SEO Director, no input): the
server selects, by fixed rules in `src/lib/agent-runs/director-bundle.ts`, the newest completed,
model-executed, grounded run of each of three supported tasks — Technical SEO `crawl-review`,
On-Page SEO `on-page-review`, Keyword & Search Intent `search-query-review` — among that agent's 25
newest runs on the run's own project, ordered by creation time then id; a slot with none is written
as MISSING with why; a bundle with no eligible source is refused before any provider call. Each
source keeps the T6 header and JSON-quoted review under 6,000 bytes; the recorded crawl findings
(T3) follow once per distinct crawl, at most two; one limits note; the whole under 54,000 bytes; the
stored summary (`source: "agent-runs"`) is scalar-only inside its arrays and passes the run store's
check. Instructions: at most three items under 35 words each, the whole under 1,200 characters (tightened
after the first production run, `d2cbdcc7…`, was refused as `rejected-output`; the worker's 2,000-character
ceiling is unchanged), BASIS OBSERVED/PROPOSED, short-form SOURCES per
item, a worded ranking rule (recorded findings first, then severity, then agreement, then
confidence; no score), one item where sources agree, a BLOCKERS line for missing reviews and
unestablished readings, no traffic/ranking/indexation/vitals claims. UI: the *Project Director
review* panel on the project screen previews the same rule over the run list and offers "Run
project Director review" through the shared control; the result's provenance line names the source
runs and the missing reviews. The single-run hand-off, its block, instructions and control are
unchanged; neither Director task is a hand-off source; no agent write, page edit or publishing.

**M4 (merged, deployed, production verified):** PR #15 merged as `3510493`, the Keywords-tab
selector fix PR #16 merged as `220c732`; deployments READY; run `73f38c16…` stored the fourth
grounding block (`keywords: "available"`, 9 queries) beside the report, history and query-page
blocks, with the output keeping OBSERVED / INFERENCE / RECOMMENDATION apart. The *Observed query
inventory* panel is browser verified (checkpoint 1.5) with real Nexra Agency queries.

**M4 (as delivered):** a gap audit found overlap and cannibalization-candidate detection (P4c), Search
Console grounding (M1, P4b, P4c), stored history and movement (P4a, P4d) and the live panel complete;
missing were a project-level observed query inventory, structured intent labels, grouping, a
query-to-page mapping beyond overlaps, fixed opportunity rules and a live keyword surface. All are
delivered as derived intelligence recomputed on read from `nexra_search_console_snapshots` and
`nexra_search_console_query_pages`; no new table, no paid API, no SERP scraping, no search volume,
difficulty, cost per click or rank tracking. `src/lib/search-console/keywords/`: the inventory
(union of every stored snapshot's top queries and the latest pair window, per the P4a property rule
and the P4c window selection), lexical intent hints (fixed word lists, the deciding word returned,
brand from the host label and the project name minus generic business words; "unclassified" when
nothing matches), lexical groups (most frequent non-function word; "a shared word, not a topic"),
page mapping (`no-pairs`, `single-page`, P4c `overlap` with leading page and share), opportunity
labels (*low CTR* = the P4a rule; *position band* 4–20 with ≥ 20 impressions; *no strong landing
page* = leading share under 50%; *cannibalization candidate* = P4c), page hubs (≥ 5 observed
queries). `GET /api/search-console/keywords`; the *Observed query inventory* panel beneath the
Search Console panel on the Keywords tab, labelled *Observed · derived labels*; a fourth grounding
block (≤ 8,000 bytes) for `search-query-review` only, with instructions that an intent hint is a
lexical suggestion never to be cited as OBSERVED and an opportunity label is a candidate, never a
predicted gain. A persisted operator-curated keyword entity and AI-assisted intent or topic
classification are deferred.

**M3 (merged, deployed):** PR #14 merged as `db7afdb`; migration `20261002120000` applied and
recorded; deployment `dpl_4bSxM9oBQHTA4auwToyRVRd1cR1v` READY; the triage table holds one operator
decision recorded through the triage route; the *Observed findings* section is browser verified
(checkpoint 1.5), showing the recorded findings and the decision's state.

**M2 (merged, deployed, production verified):** PR #12 merged as `3b74d99`; migration
`20261001120000` applied and recorded; deployment `dpl_HWMCwJTSWtJdwYAgVLtuMez6D8T7`; the fresh
crawl `3398ff1a-59d7-479f-b5e9-44bee4a6ae99` recorded every M2 signal on its five fetched pages
and a rule-version-3 report. The first On-Page review over it was refused as `rejected-output`;
PR #13 (`6760cfc`, deployment `dpl_3RHPiV2PKZ9hRhLgUPKbAbDTQdw5`) bounds the On-Page answer to four
findings and 1,500 characters; two On-Page reviews completed under the bound (latest 25 Sep),
which is the verification.

**M1 P4c (merged, deployed, production verified: the first 10 query × page pairs for
`nexra-agency` were captured by the scheduled worker beside the 25 Sep snapshot):** one additive
migration, `nexra_search_console_query_pages` — one immutable
row per project, property, 30-day window end, query and page with only clicks, impressions, CTR and
position; at most 250 pairs per capture, written as one set by
`nexra_search_console_query_pages_record` (`security definer`, advisory lock per window, `exists`
never extends a set); RLS on, no policies, `service_role` SELECT and EXECUTE only. The capture makes
one extra real Search Console request (`dimensions: ["query", "page"]`, `rowLimit` 250) strictly
after each connected snapshot write, inside the project's remaining budget; its outcome sits beside
the snapshot's and never changes it; worker budgets, cron and credentials are unchanged. Pure
intelligence with documented thresholds (overlap: a query on ≥ 2 pages; candidate: ≥ 2 pages with
≥ 20 impressions within 5 places; change: ≥ 7-day gap, ≥ 20 impressions); a third grounding block
for `search-query-review` and `performance-review` only when pair evidence exists;
`GET /api/search-console/query-pages`; the *Query-to-page overlap* panel section. Wording is
"potential query overlap" and "cannibalization candidate for review"; nothing claims a confirmed
cannibalisation, a ranking, a search volume, a difficulty, a SERP feature, an indexation state, a
cause or an owned query. Harness suites `gsc-pairs` (94 assertions) and `gsc-pairs-races` (P1–P3).

**M1 CP1a (merged, deployed, migration applied):** migration `20260927120000_create_search_console_snapshots.sql` —
`nexra_search_console_snapshots`, one immutable row per project, property and 30-day window end
(unique key; a repeated or concurrent capture answers `exists`); `connected` totals or a `no-data`
row with nulls; top 25 queries and pages as JSONB checked by the immutable validator
`nexra_search_console_rows_valid`; guard triggers refuse update, delete and truncate; the one
write is `nexra_search_console_snapshot_record` (`security definer`, empty `search_path`,
window must end before today, unknown project answers `not-found`); `service_role` gets SELECT
and EXECUTE on that function only; RLS on with no policies. The project-to-property mapping is
the server's private configuration and is not checked by the database. The capture (CP1b/CP1c),
history (P4a/P4d) and keyword inventory (M4) read and write it. Harness suites `gsc` (100
assertions) and `gsc-races` (G1–G3) added; the C5 `security definer` inventory names the new
function. The migration is applied and recorded in production.

**M1 CP1b (merged, deployed):** `src/lib/search-console/snapshots/` — the server-side capture module
(`capture.ts`), its store contract, the Supabase store over the CP1a record function and the
process wiring (`index.ts`), which nothing calls yet. It reads the 30-day window through the
existing cached provider for each stored project the private `SEARCH_CONSOLE_PROPERTIES` mapping
names, sequentially, within `maxProjects` and `budgetMs`, and records one immutable snapshot per
project, property and window end. A row is written only for a stored project's own mapped
property, from a fresh answer that names that exact property; a failed read is never a no-data
row; rows stay within the table's limits; logs carry ids, outcomes and durations only. The worker,
cron, UI, environment and migrations are unchanged. See `docs/BACKEND.md` (*Search Console*).

**M1 CP1c (merged, deployed, production verified):** the scheduled `process` job (`src/lib/agent-runs/process-job.ts`,
`/api/worker/process`) runs the agent-run queue first, unchanged (5 runs, 240 s), then the
snapshot capture in the time left: at most 45 s, never into a 15 s response margin, skipped as
`time-budget` when under the capture's 3 s minimum, and cut off at a hard deadline of budget plus
5 s grace (`timed-out`); a throwing capture answers `failed`. The queue's answer is returned
whatever the capture does; the response gains one additive `snapshots` field with ids, outcome
names and counts only. Worker credential, rate limit, cron schedule and `vercel.json` unchanged.
Production verified: the scheduled worker recorded connected snapshots for `nexra-agency` on
25 and 26 Sep (`source: scheduled`).

C6 records an operator's intention to publish one exact approved article version. It records
proposal state only.

C6 adds:

- one record-only proposal for one exact approved current article version;
- exact binding to article id, version, version row id, content hash and the C5 approval;
- a registered destination;
- a slug;
- preview/document hash metadata only;
- an explicit operator-triggered "Record proposal";
- withdraw support.

C6 reuses:

- the C5 approval gate and approval history;
- the C1 canonical article content and content hash;
- the existing destination registry;
- the existing preview/completeness logic where appropriate.

C6 does NOT include: TSX publishing; GitHub writes; Vercel writes; `nexra-ai` writes; pull
request creation; merge; deployment; live publishing; C7. It never approves or publishes anything
automatically. Real rendering and publishing remain a later, separately approved milestone.

**C6 checkpoints** (branch `claude/c6-article-proposal-db`, on `master` `7fb652a`; merged as `f28cd35`):

- `caae5d6` — **C6 Checkpoint 1: database gate, implemented and verified locally.** Migration
  `20260925120000_create_article_publication_proposals.sql`: `nexra_article_publication_proposals`
  bound to one exact approved version (version number and row id, content SHA-256, the exact C5
  approval row with its approver and time), a registered destination, the content's own slug (D1)
  and a preview hash; `proposed` or `withdrawn` only; insert, update, delete and truncate guards;
  one active proposal per article and per destination slug; `nexra_article_publication_propose`
  and `nexra_article_publication_withdraw` (`security definer`, under the article's row lock);
  service_role gets SELECT and EXECUTE on the two functions only. The pinned destination registry
  and live slugs (D2) are restated in SQL, with a repository drift test against `destinations.ts`
  and the pinned website template. It adds a foreign key to `nexra_article_approvals`, so a plain
  TRUNCATE of approvals is now refused by PostgreSQL (0A000) before the C5 guard.
- `16e7717` — **PostgreSQL test harness, repository-tracked** under `supabase/tests/`, with one
  runner, `bash supabase/tests/run.sh`, that builds and deletes a disposable local cluster (Unix
  socket only, TCP disabled, libpq environment cleared) and never connects to a hosted database.
  Needs bash and PostgreSQL 16 server binaries (Linux or WSL). Covers C2, C4, C5 (updated for the
  C6 foreign key and `security definer` inventory) and C6, with two-session races.
- `ac95fc2` — **D3 Option A, implemented and verified locally.** Migration
  `20260926120000_publication_proposals_cross_table_slug_lock.sql`: one BEFORE INSERT trigger on
  the draft proposal table and one on the article proposal table, sharing one function. For a row
  inserted as `proposed` it refuses a transaction that is not READ COMMITTED (0A000), takes a
  transaction advisory lock on the destination and slug, and raises unique_violation when the
  other table holds an active proposal; both propose functions answer `slug-taken`. At most one
  active proposal per (destination, slug) across both tables. New draft-side behaviour: a draft
  proposal is refused `slug-taken` while an active article proposal holds its destination and
  slug. No function body, grant, RLS setting or application code changed. The migration refuses
  to apply over an existing cross-table duplicate. Adds a draft-proposal regression suite.
- **Local verification at `ac95fc2`:** every harness suite passed (40 of 40 checks: C2 54, C4 60,
  C5 69, drafts 40, C6 146, C6-D3 35 assertions; C2, draft, C6 and D3 races; a 12-session stress
  run with no deadlock; D3 preflight; C6 rollback); `npm test` 1,420 passed; typecheck, lint and
  production build passed.
- `ee26378` — documentation checkpoint for the above (CLAUDE.md).
- `2daabdc` — **C6 Checkpoint 2: eligibility and deterministic preview.** Pure, fail-closed
  eligibility reporting every blocking reason in a fixed order, with the D2 live-slug warning;
  the `article-proposal-text/1` preview (LF, no trailing newline, canonical text verbatim) and
  its server-only SHA-256.
- `0ea99d8` — **C6 Checkpoint 3: service, Supabase store, GET API and confirmed Record/Withdraw
  Server Actions.** The service composes the C4 check store, the C5 approval store and the
  proposal store; operator → argument types → confirmation token → one write in flight and
  30 per ten minutes → service.
- `71e9b28` — **C6 Checkpoint 4: UI**, the corrected draft `slug-taken` wording ("Another active
  publication proposal — a draft's or an article's — already uses this destination and slug.
  Choose another slug."), and browser verification against a disposable local database only.
- **Earlier browser evidence (Checkpoint 4, not rerun by the final audit):** 27 of 27 matrix
  items plus 4 responsive/accessibility checks passed, against a disposable local database.
- **Fresh final local audit at `71e9b28`:** focused C6 checks 142 of 142 passed; `npm test`
  1,554 of 1,554 passed; PostgreSQL harness 40 of 40 checks passed; typecheck, lint, local
  production build and secret scan passed. It found no code or security defect; it was blocked
  only on documentation, which this checkpoint resolves.

**C6 release (2026-09-24, each step separately approved by the operator):**

- Review-only draft PR #3 opened from `claude/c6-article-proposal-db` at `d6025ce` after fresh
  gates at that commit (focused C6 142 passed; `npm test` 1,554 passed; PostgreSQL harness 40 of
  40; typecheck, lint, production build, secret scan and `git diff --check` clean) and a
  read-only check that every Vercel project variable targets Production only, so a preview
  deployment holds no Supabase credentials.
- Read-only production preflight in Supabase project `nmseedcgtxelufewvbvr` (operator-run in
  the SQL Editor as `postgres`): PostgreSQL 17.6; `default_transaction_isolation` `read
  committed` with no role or database override; C5 `20260924120000` recorded; C6 and D3 absent
  from history and schema; every dependency table, key, column and `set_updated_at()` present;
  `nexra-agency` project row present; 1 article, 0 approvals, 0 active draft reservations.
- Migration `20260925120000_create_article_publication_proposals.sql` (SHA-256
  `855da3dd2380e6aa42b72bd67e6d1f8ef3f42ed777bdf8162b7b6bbfe6646871`) applied unmodified as one
  `BEGIN`/`COMMIT` transaction, then `NOTIFY pgrst, 'reload schema';`. Verified read-only: table
  with RLS on and no policies, 0 rows, 4 indexes, 5 foreign keys, 5 enabled triggers, 7
  functions owned by `postgres` (only propose and withdraw `security definer`), `service_role`
  SELECT on the table and EXECUTE on propose/withdraw only, existing data unchanged. Recorded
  with `supabase migration repair --status applied 20260925120000 --linked`.
- Migration `20260926120000_publication_proposals_cross_table_slug_lock.sql` (SHA-256
  `5a370fb3678384239cdba08f63abfde8fce52881b13ff41d369a1e0afe60f799`) applied the same way after
  a read-only D3 preflight (0 cross-table duplicates). Verified read-only: the reservation
  function present, not `security definer`, empty `search_path`, READ COMMITTED guard present,
  executable by no API role; both reservation triggers present and enabled; 0 cross-table
  duplicates; existing data unchanged. Recorded with
  `supabase migration repair --status applied 20260926120000 --linked`; `supabase migration
  list --linked` shows both versions on Local and Remote.
- The pre-existing C2 history mismatch (remote `20260923043554`, repository file
  `20260923120000`) was left untouched, as before.
- PR #3 marked ready and merged into `master` as `f28cd35e554033aed59b841a200fba8254a905d0`
  (merge commit, head `d6025ce`, 50 files). Vercel built `master` automatically:
  `dpl_HusNWgcGQx8xu5vc2Co8d5QNskxh`, READY, holding all three production domains.
- **Production browser verification (operator, signed in):** article
  `c89182f9-4954-4834-8446-a831fc3c42d0`, Version 2, status `drafting`, shows the new *Article
  publication proposal* section headed **Not eligible**, the banner **PROPOSAL ONLY — NOT
  PUBLISHED**, no Record button and proposal history 0; the C5 approval section renders as
  before; the fact-check still shows 0 of 4 units passed (metadata needs review, three
  unchecked). No article was approved, proposed or published.

**C6 notes and known items:**

- C6 records proposals only: it never publishes, never generates a deployable artifact, never
  creates a publishing pull request and never writes to `nexra-ai`. Real rendering and
  publishing remain a later, separately approved milestone.
- The draft `slug-taken` wording was corrected in `71e9b28`.
- Known LOW items, left as they are: the GET route logs `name: message` rather than the C5
  route's `logFailure` shape; a Record whose re-read fails after the row was written reports
  `failed` (the C5 convention).
- The C6 migration header's "known gap" text is superseded by D3; existing migrations are never
  edited.

**D3 assumptions:** READ COMMITTED is required, and any other isolation level fails closed
(0A000). Both reservation triggers must stay enabled; a superuser disabling triggers can bypass
the protection.

**D2 limitation:** the destination registry and live slugs are pinned to the website template at
nexra-ai commit `a4a5722`; newer live slugs are not discovered. A proposal is never permission to
overwrite live content.

**Current safety boundaries:**

- No automatic publishing.
- No automatic approval.
- No write path to the `abdulrehmanvigo2-hash/nexra-ai` GitHub repository exists.
- The current production draft, Version 2, remains **Needs review**.
- There is no active publication proposal for Version 2, and `nexra_article_publication_proposals`
  holds no rows.
- The content workflow has no Create PR, Merge, Deploy or Publish control; C6 records proposal
  state only.
- Article `c89182f9-4954-4834-8446-a831fc3c42d0` is `drafting`: two check units need review
  (units 0 and 1), two are unchecked, and it is neither checked, approved nor published. Its Version 2 can never
  be approved (a needs-review result is final for its version), so it cannot receive a C6 proposal.
- Vercel deploys every push to `master` to production automatically.
- Any external write requires explicit user approval (§6).

Update this section at every Git checkpoint that changes the stage, the next planned
milestone, or a safety boundary.

---

## 1. Development Workflow

Every unit of work follows this loop, without skipping steps:

```
Plan → Build One Bounded Feature → Test → Fix → Git Commit → Next Feature
```

- **Plan** — state what will be built, which files are touched, and what is explicitly out of scope.
- **Build one bounded feature** — one feature per cycle. No opportunistic side-work.
- **Test** — run the app locally, exercise the feature, check the console for errors.
- **Fix** — resolve everything found in testing before moving on.
- **Git commit** — one checkpoint per completed feature (see §10).
- **Next feature** — only after the previous cycle is closed.

## 2. Current Architecture

A Next.js 16 application (read `AGENTS.md` before writing Next.js code) with a Supabase
Postgres production backend. `docs/BACKEND.md` is the detailed reference; `supabase/README.md`
lists the migrations in order.

- **Operator authentication** — Supabase Auth. One level: operator or nobody; operators are
  confirmed users listed in `NEXRA_OPERATOR_EMAILS`. `src/proxy.ts` gates every page, and every
  write and data endpoint re-checks the operator server-side.
- **Database** — Row level security with no policies on every table; the server alone uses
  `service_role`. Lifecycle and immutability rules are enforced in Postgres (triggers,
  `security definer` functions).
- **Live agent execution** — the agent runtime (`src/lib/agent-runs`, `/api/agent-runs/*`,
  `/api/worker/*`) queues and runs tasks for the twelve registry agents, with attempts, leases,
  retries and a scheduled worker. The executor is `mock` by default or `ai` (Anthropic).
- **Crawl grounding** — the crawl foundation (`src/lib/crawl`, `/api/crawls/*`) records own-site
  and competitor crawls; crawl-grounded agent tasks read those records.
- **Google Search Console grounding** — a read-only service account (`src/lib/search-console`);
  the Search Console panel and two agent tasks read the project's own report.
- **Content workflow** (`src/lib/content`, `/api/content-drafts`, `/api/content-publications`):
  - immutable content drafts and operator versions;
  - version-bound fact-check of one exact version;
  - exact-version approval;
  - publication proposals for one exact approved version, which publish nothing;
  - website artifact dry-run, rendered offline, which writes nothing anywhere;
  - articles (C1–C6): article persistence, check units, approval and record-only article
    publication proposals — `GET /api/content-article-proposals` (operators only, read-only)
    and the Server Actions `recordArticleProposal` and `withdrawArticleProposal`
    (`src/app/(app)/projects/article-proposal-actions.ts`, explicit confirmation required).
    A proposal publishes nothing and writes nowhere outside the database.

Everything else on screen (rankings, technical, competitor, backlink, AI-visibility and
reporting figures) is still modelled fixture data from `src/lib/mock`. It must stay labelled as
such (`src/config/build-status.ts`). Never present fixture data as live, or live data as a
fixture.

## 3. Build Principles

- Extend the existing modules and patterns; do not introduce a parallel implementation.
- Server-side first: validation, authorisation and state rules live on the server and, where
  they protect data, in the database.
- Grounded, not invented: agents and renderers use only records the product holds. A missing
  value is reported as missing, never filled in.
- Every screen keeps real states (loading, empty, error, not connected) and honest labels.
- Every change is additive and reversible unless the user approves otherwise. Existing
  migrations are never edited; a schema change is a new migration.

## 4. Out of Scope Until Explicitly Requested

Do **NOT** build any of the following until the user explicitly asks:

- Publishing content to any website, or any write to the `nexra-ai` repository (branch,
  commit, pull request, merge, deployment)
- Create PR / Merge / Deploy / Publish controls in the product
- Billing / payments / subscriptions
- New external integrations (GA4, Ahrefs, Semrush, CMS, webhooks, and similar)
- Replacing a fixture-backed screen with live data, beyond the feature requested

## 5. Dependency Rules

Before adding **any** dependency, package, MCP server, CLI, SDK, or tool:

1. **Inspect the current project first** — read `package.json` and the existing code.
2. **Identify what is actually required** for the current bounded feature.
3. **Avoid unnecessary installations** — no "nice to have" packages.
4. **Prefer existing dependencies** — solve it with what is already installed.
5. **Install only safe, project-level dependencies** needed for the current task.

No global installs. Nothing added "for later".

## 6. Approval Required

Ask the user and wait for explicit approval before any of these:

- Authentication
- API keys
- Paid services
- Paid APIs
- OAuth
- Database setup
- Production credentials
- External webhooks
- System-level changes
- Global CLI installs
- DNS / domain changes
- Deployment configuration
- Applying a migration to the production database, or changing production data
- Switching the agent executor, AI provider or model (`NEXRA_AGENT_EXECUTOR`,
  `NEXRA_AI_PROVIDER`, `NEXRA_AI_MODEL`)
- Any write to an external repository or service, including `nexra-ai` (branch, commit,
  pull request, merge, deployment, publication)

## 7. Security Rules

- **Never expose secrets in frontend code.**
- **Never hardcode** API keys, tokens, passwords, webhook secrets, or private credentials.
- **Use environment variables** for all configuration and secrets.
- **Never commit `.env` secrets to Git.** `.env*` files stay in `.gitignore`; only
  `.env.example`, with empty placeholder values, is committed.
- Any value carrying a client-exposure prefix (for example `NEXT_PUBLIC_*`) is public by
  definition — never put a secret behind one.
- Verify no secrets are staged before every commit.

## 8. File Safety Rules

- **Do not modify unrelated files.** Touch only what the current feature requires.
- **Do not delete working files or make destructive changes without approval.**
- **Preserve working UI and existing functionality.** No refactors bundled into feature work.
- No mass reformatting, no renaming sweeps, no restructuring outside the requested scope.

## 9. Testing Discipline

- **Test every completed feature before continuing.**
- Run the app locally and exercise the feature by hand.
- Check every route the change touches.
- Check the browser console and the terminal for errors and warnings.
- Verify responsive behaviour at mobile, tablet, and desktop widths.
- Verify no regressions in previously working screens.
- Run the available checks before committing: `npm test`, `npm run typecheck`,
  `npm run lint`, `npm run build`, `npm run secret-scan`, and `npm run db:seed:check` when the
  seed or projects change. The same gates run in GitHub Actions on every pull request and push
  to `master` (`.github/workflows/ci.yml`); a red check is fixed before a merge.
  Branch protection on master is configured but not enforced on the current GitHub plan; merge discipline is the operator's explicit approval plus green CI on every pull request.
- Add unit tests beside the code for every new server module, contract or renderer.

## 10. Git as a Checkpoint System

After each completed bounded feature:

1. **Review changed files** — `git status`, `git diff`.
2. **Run available checks** — type check, lint, build.
3. **Verify no secrets are included** in the staged diff.
4. **Make a clear commit** describing the completed feature.

One feature per commit. Commit messages state what was built, in plain language.

## 11. Development Order

```
Local Project → Localhost Testing → Git Checkpoint → GitHub → Vercel
```

**Production hardening must happen before public deployment.** No deployment step is taken
until the user asks for it and the hardening pass is complete. Since the production Vercel project
auto-deploys every push to `master`, a merge into `master` is the deployment step and is approved
as one (§0, §6).

## 12. Product Standards

Primary UI language: **English**.

The product should feel:

- Premium
- Modern
- Clean
- Professional
- Technical
- Agency-grade
- SaaS-ready
- Data-focused

**Avoid:**

- Cheap template appearance
- Excessive gradients
- Random animations
- Clutter
- Oversized cards
- Cartoon visuals
- Dead buttons
- Broken links
- Inconsistent spacing

Design discipline: a consistent spacing scale, a restrained palette, dense but legible data
display, real states (loading, empty, error), and no control that does nothing.

## 13. Architecture

### Main Navigation

The sidebar supports these destinations, in this order:

1. Command Center
2. Projects
3. AI Agents
4. Keyword Intelligence
5. Content Studio
6. Technical SEO
7. Competitor Intelligence
8. AI Visibility
9. Backlinks & Authority
10. Analytics
11. Reports
12. Settings

Every navigation item resolves to a real route. No dead links.

### The 12 AI Agents

| # | Agent | Responsibility |
|---|---|---|
| 1 | SEO Director / Orchestrator | Owns strategy, sequences the other agents, arbitrates priorities |
| 2 | Project Manager | Intake, scope, scheduling, task state, delivery tracking |
| 3 | Market & Competitor Intelligence | Market landscape, SERP competitors, positioning, share of voice |
| 4 | Keyword & Search Intent | Keyword discovery, clustering, intent classification, prioritisation |
| 5 | Content Strategist | Content plans, briefs, topical maps, internal-linking strategy |
| 6 | Research & Evidence | Sources, facts, citations, evidence behind every claim in content |
| 7 | Writer | Drafts content against briefs, tone, and structure |
| 8 | On-Page SEO | Titles, meta, headings, entities, internal links, on-page optimisation |
| 9 | Technical SEO | Crawlability, indexation, Core Web Vitals, schema, site health |
| 10 | AI Visibility / AEO / GEO | Visibility in AI answers and generative engines, answer-readiness |
| 11 | Authority & Backlink | Link opportunities, digital PR, authority signals |
| 12 | Analytics & Learning | Performance measurement, attribution, learnings fed back into strategy |

Agent profiles, statuses and activity feeds come from the fixture registry
(`src/lib/mock/agents`). Agent **runs** are real: the runtime executes read-only review tasks,
grounded in stored projects, crawls, Search Console or earlier runs, plus the Writer's
`section-draft` task. The full task-type list is in `docs/BACKEND.md` (*Agent runtime*).

### Long-Term Agent Workflow

```
Project Added
  → Project Manager
  → SEO Director
  → Competitor Intelligence
  → Keyword Intelligence
  → Content Strategy
  → Research
  → Writing
  → On-Page SEO
  → Technical SEO
  → AI Visibility
  → Authority Building
  → Analytics & Learning
  → Feedback to SEO Director
```

The loop closes: Analytics & Learning feeds back into the SEO Director, which re-prioritises
the next cycle. The UI should represent this as a continuous cycle, not a one-way pipeline.

## 14. Build Sequence

The frontend foundation (app shell, navigation, the twelve screens, UI primitives, fixture
data layer) and the backend foundation (Supabase, operator sign-in, agent runtime, crawl
foundation, Search Console) are complete. Current work follows the content workflow:

| Stage | Scope | Status |
|---|---|---|
| Stage 1 | Durable Writer draft persistence | Complete |
| Stage 2 | Immutable operator version history | Complete |
| Stage 3 | Exact-version fact-check | Complete |
| Stage 4 | Exact-version approval gate | Complete |
| Stage 5A | Publication proposal + exact-version preview | Complete |
| Stage 5B | Website artifact dry-run | Complete |
| Stage 5 / C1 | Complete Article Assembly: Pure Article Contract | Complete, live verified |
| Stage 5 / C2 | Complete Article Assembly: Article Persistence | Complete, live verified |
| Stage 5 / C3 | Complete Article Assembly: Writer Section Choice | Complete, live verified |
| Stage 5 / C4 | Complete Article Assembly: Article Check Units | Complete; deployment, existing-result browser verification and new-parser live verification (run `6e2e9659…`) complete |
| Stage 5 / C5 | Complete Article Assembly: Article Approval Gate | Complete, merged, deployed, production verified |
| Stage 5 / C6 | Complete Article Assembly: Article Publication Proposal (record-only) | Complete, merged (`f28cd35`), migrations applied, deployed, production verified |
| M1 / CP1a | Search Console snapshot persistence: database | Complete, merged, migration applied and recorded, deployed |
| M1 / CP1b | Search Console snapshot persistence: capture module | Complete, merged, deployed |
| M1 / CP1c | Search Console snapshot persistence: worker step | Complete, merged, deployed, production verified (scheduled snapshots 25 and 26 Sep) |
| M1 / P4a–P4b, P4d | Stored history comparison, agent grounding, history API and panel section | Complete, merged (`fc2066d`), deployed |
| M1 / P4c | Query × page Search Console intelligence | Complete, merged (`315323b`), migration applied and recorded, deployed; first live capture verified (10 pairs, 25 Sep) |
| M2 | Remaining crawl enrichment: word count, html lang, hreflang, Open Graph, Twitter card, response time; rule version 3 | Complete, merged (`3b74d99`), migration applied and recorded, deployed, production verified; On-Page output bound merged (`6760cfc`), deployed and verified on two completed reviews |
| M3 | Finding triage (operator decisions kept apart from findings) and the observed findings section on the Technical SEO screen | Complete, merged (`db7afdb`), migration applied and recorded, deployed; one triage decision recorded in production; browser verified |
| M4 | Observed keyword intelligence: query inventory, lexical intent hints and groups, page mapping, fixed opportunity rules, Keywords panel, agent grounding | Complete, merged (`3510493`, selector fix `220c732`), deployed, production verified on run `73f38c16…`; browser verified; no migration |
| M5 | SEO Director project-level orchestration: deterministic multi-source selection, bounded bundle, deduplicated plan instructions, project Director panel | Complete, merged (`62ae593`), deployed; no migration; one production run completed (26 Sep); panel browser verified |
| PM task core | Persisted agent tasks: `nexra_agent_tasks`, create function, project-scoped API, Record as task from Director results and observed queries, Live tasks section | Complete, merged (`6e345c5`), migration `20261003120000` applied, deployed, production verified (one real backlog task) |
| PM task workflow | Status transitions along a fixed map, owner changes, specialist handoff (one queued run, never executed here), append-only event history, task route, Live tasks controls | Complete, merged (`47fae75d`), migration `20261004120000` applied and recorded, deployed; restore fix (`073bf85e`) and intake bound (`2e8116ce`) merged; production verified end-to-end on run `be1b692e…` |
| Phase 1 | Baseline truth and gates: docs reconciliation, security and worker tests, CI gates, browser verifications (M3, M4, M5), C4 new-parser live check | Complete: PR #23 (`97aa0018`), PR #24 (`3a316124`), PR #25 (`6363db53`); checkpoints 1.5 and 1.6 verified in production |
| Phase 2 (a) | Handoff outcome read-back: the task read answers what became of its newest handoff, computed from the linked run; shown in the task history | Complete: PR #27 (`0143a0cf`), deployed, browser verified (27 Sep); no migration |
| Phase 2 (b) | Handoffs for five more agents with an operator-chosen record (own-site crawl or recorded competitor domain); Writer deferred | Implemented on `claude/phase2-agent-handoffs` (checkpoint 2.3); no migration; not merged |

Stages are executed in order. Each stage is broken into bounded features, and each bounded
feature gets its own workflow cycle (§1) and Git checkpoint (§10). Current: branch
`claude/phase2-agent-handoffs` (checkpoint 2.3).
Phase 1 is complete. Current: Phase 2, Project Manager loop closure — step (a), the handoff outcome
read-back, is complete; step (b), handoffs for five of the six deferred agents (the Writer stays
deferred), is implemented on its branch; then priority change (cp 2.3b, a separate migration), then
tasks as grounding and a Project Manager task-plan review — each step under its own explicit approval. Work beyond that (cross-crawl
finding history, a curated keyword entity, further Director sources) is planned in the roadmap but
not started.

## 15. Definition of Done

A feature is done only when **all** of the following are true:

- [ ] Requested scope complete
- [ ] UI polished
- [ ] Interactions working
- [ ] No unrelated regressions
- [ ] Local tests passed
- [ ] Changed files reviewed
- [ ] Ready for Git checkpoint

Anything short of this is not done, and the next feature does not start.

## 16. Claude Code Behavior

1. **Read `CLAUDE.md` first.**
2. **Inspect the project** before writing code — existing files, dependencies, patterns.
3. **Identify the relevant files** for the task.
4. **Build only the requested bounded feature.**
5. **Avoid unrelated changes.**
6. **Test the result.**
7. **Report exactly what changed** — file by file.
8. **Report the tests performed** and their outcome.
9. **Report remaining issues** honestly, including anything left incomplete.
10. **Stop before starting the next major feature** unless explicitly asked to continue.

When a request is ambiguous, ask before building. When a rule in this file conflicts with a
request, say so and wait for the user's decision.
