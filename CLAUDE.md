# Nexra SEO Command Center

Professional, agency-grade AI SEO platform. This file defines the operating rules for the
project. Read it before writing any code.

**Current stage: PRODUCTION READY; Phase 6 (→ the full 12-agent V1) has started.** Its design note
(6.1) and the attestation design (6.1b) are approved; the per-agent run history (6.2) and its
follow-up (the agent header's figures labelled Modelled, the fake sync button removed) are merged,
deployed and browser checked; the Command Center over stored data (6.3), Reports on read (6.4), the second
grounded tasks, batch 1 (6.5), and the scoped V1 (6.6) are merged and deployed (browser confirmed); the queue
controls on agent pages (6.6b) are merged, and the nine second tasks were run live once each through them
(eight completed; the Writer's correctly refused to queue). Phase 5 (Content Studio, the article positive path and hardening → production ready) is
complete (checkpoints 5.1–5.7, PR #45–#49; see the *PRODUCTION READY* block in §14): the observed
Content Studio (5.2) is merged and deployed; the article positive path (5.3) is recorded live — one
verification article checked, approved and record-proposed, nothing published; the delete and
truncate guards (5.4) are merged, deployed and their migration applied and recorded in production;
health, daily caps, the abort fix and dynamic screens (5.5), the runbook and claim race test (5.6) and
the closing checkpoint (5.7: orphan cleanup, Modelled labels on the fixture screens, docs) are merged
and deployed. Phase 4 (Analytics, Competitors, AI Visibility and Outbound Links over stored
data; the Director's learnings loop) is complete (checkpoints 4.1–4.8, PR #39–#43 and the closing
checkpoint 4.8): the Director and performance-review output bounds (4.2) are verified live; the
Analytics (4.3), Competitors (4.4), AI Visibility and Outbound Links (4.5) screens over stored data
are merged, deployed and browser verified; the Director's five-slot bundle and the bounded-answer fix
(4.6) are deployed and verified live (run `288639f4…`). Phase 3,
Technical & Keywords realification — the MVP target — is complete
(checkpoints 3.1–3.6, PR #34–#38): the Technical SEO and Keyword Intelligence screens read observed
data only, with live page detail, derived finding history and the operator's curated keywords
(migration `20261006120000`, applied and recorded); each browser verified in production. Phase 2,
Project Manager loop closure, is complete — step (a), the handoff outcome
read-back (checkpoint 2.2); step (b), handoffs for five more agents (checkpoint 2.3), with the
crawl-review bound (2.3c, then structurally 2.3d) and task priority change (2.3b, the one Phase 2
migration, applied and recorded); and step (c), tasks as grounding and the Project Manager task
plan review (checkpoint 2.4) — each merged, deployed and production verified (PR #27–#32).
Phase 1 (baseline truth and gates) is complete (see §14).
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

GitHub `master`: `6764326210b3dbf9946f79ac6f62bc5c635a4431` (merge of PR #56,
`claude/phase6-queue-controls`, the queue controls on agent pages; preceded by PR #55 `04be98ae…` (the
scoped-down V1), PR #54 `1b2c2cbd…` (second grounded tasks,
batch 1), PR #53 `a2e3cdc1…` (Reports on read), PR #52 `c8ac155c…` (the Command Center over stored
data), PR #51 `17ee0a64…`
(the 6.2 follow-up), PR #50 `b2b7da00…` (the per-agent
run history), PR #49 `bf71dd73…` (Phase 5
closing — PRODUCTION READY), PR #48 `fb048e81…` (the
runbook and the claim race test), PR #47 `6b776b3a…` (health,
daily caps, the abort fix and dynamic screens), PR #46
`7bd748f7…` (the delete and truncate guards), PR #45 `f9a32773…` (the
observed Content Studio), PR #44 `aef49419…` (Phase 4
closing), PR #43 `ddc6cbb4…` (the Director's five-slot
bundle and the bounded-answer fix), PR #42 `41519ffd…` (the AI Visibility and Outbound Links screens), PR #41
`69379e3d…` (the Competitors screen over stored crawls), PR #40
`a73cfd21…` (the Analytics screen over stored data), PR #39 `0c64d77d…`
(the Director and performance-review bounds), PR #38
`ce1fb312…` (Phase 3 closing and MVP complete), PR #37 `98b0fbd9…` (the
curated keyword entity), PR #36 `201d47a2…` (the observed Keywords surfaces), PR #35 `c244efd4…`
(live Technical page detail and derived finding history), PR #34 `5b79ba8d…` (live Technical SEO
tabs), PR #33 `e7feedaf…`
(Phase 2 closing docs), PR #32 `2305b605…` (tasks as
grounding and the task plan review), PR #31
`0921c1f8…` (task priority change), PR #30 `a48cb35a…` (structural
crawl-review bound), PR #29
`bad5469b…` (crawl-review character bound), PR #28 `8dcff921…`
(five agent handoffs), PR #27 `0143a0cf…` (handoff outcome read-back), PR #26 `e01bf12f…`
(Phase 1 closing docs), PR #25 `6363db53…` (CI gates),
PR #24 `3a316124…` (security and worker tests), PR #23 `97aa0018…` (docs reconciliation), PR #22 `2e8116ce…` (intake bound), PR #21
`073bf85e…` (handoff-run restore) and PR #20 `47fae75d…` (task workflow, `bdd541c`); the C6 merge,
PR #3, is `f28cd35e…`; the C5 merge, PR #2, is `304ac146…`).

Production deployment for `67643262` (PR #56, 28 Sep): **not read** — the Vercel API refuses this session
(403); `master` CI run `36407164456` passed at `67643262`. The operator's live runs from the agent pages'
*Queue a review* and Run Now (28 Sep 10:39–11:02 UTC, 6.6b below) show the build serving it.

Production deployment for `04be98ae` (PR #55, 28 Sep ~09:42 UTC): **confirmed by the operator in the
browser** — Reports on read, the Command Center tiles and no "Run agent sync" on `/agents` are live on
`nexra-seo-command-center.vercel.app`. Its deployment id is **not recorded**: the Vercel API refused this
session's access (403 for the `abdulrehmanvigo2-hash` scope), so the id, READY state and alias were not read
and no redeploy was attempted. `master` CI run `36405118649` passed at `04be98ae`. The stacked merges, each
after CI green on its final base (`master`, reached by merging `master` into the PR branch — no force-push):
PR #53 (checkpoint 6.4) merged as `a2e3cdc1…` (`master` CI `36404604165`); PR #54 (checkpoint 6.5) as
`1b2c2cbd…` (its `master` run `36404872526` was cancelled by the next push — superseded, by design); PR #55
(checkpoint 6.6) as `04be98ae…`. Previous deployment: `dpl_5fzpNZrBzgWzYi1TYj1mHVCaDgEy`, READY (28 Sep
07:59 UTC) at `c8ac155c`. PR #52 (checkpoint 6.3) merged as
`c8ac155c…` (`master` CI `36394607712`); PR #51 (the 6.2 follow-up) as `17ee0a64…` (`master` CI `36393369165`); PR #50 (checkpoint 6.2) as `b2b7da00…` (`master` CI `36391754452`); PR #49 (checkpoint 5.7) as `bf71dd73…` (`master` CI `36386424748`); PR #48 (checkpoint 5.6) as `fb048e81…` (`master` CI `36384855012`); PR #47 (checkpoint 5.5) as `6b776b3a…` (`master` CI `36382919799`); PR #46 (checkpoint 5.4) as `7bd748f7…` (`master` CI `36375497802`); PR #45 (checkpoint 5.2) as `f9a32773…` (`master` CI `36333709886`); PR #44 (checkpoint 4.8) as `aef49419…` (`master` CI `36332161488`); PR #43
(checkpoint 4.6) as `ddc6cbb4…` (`master` CI `36330205806`, the manual redeploy `dpl_2bUN9N9R…`).

**Auto-deploy skip (27 Sep):** the push of `ddc6cbb4` to `master` left no Vercel deployment record
at all — not even the CANCELED record an ignored build leaves (as every branch preview shows) — so
production stayed on `41519ffd` and served the three-slot Director panel; the likeliest cause is a
GitHub push event Vercel never received or processed (no project setting explains it; unconfirmed).
One manual redeploy of the same commit (`dpl_2bUN9N9R…`) fixed it. **Practice from now on:** after
every merge, confirm the production deployment id, its commit and the production alias before any
live run.

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
schema change; priority change stays OPEN (cp 2.3b). PR #28 merged as `8dcff921…`; deployment
`dpl_7wpPFS…` READY. **Production verification (operator, 27 Sep):** the operator saw the record
chooser and the handoff outcome; handoff run `bcefb1e4…` (Technical SEO `crawl-review` over crawl
`3398ff1a…`, task `30e79092…` event 11) completed, 1 attempt, `claude-opus-5`, 1,946-character
summary. A separate, unlinked panel run over the same crawl, `f7b68573…`, failed
`rejected-output` (the crawl review had no output bound; not retried). Totals after: 43 runs,
43 attempts.

**Phase 2 checkpoint 2.3c (crawl-review output bound):** `CRAWL_REVIEW_INSTRUCTIONS` gain the
On-Page review's bound (PR #13): at most 4 findings, the whole answer under 1,500 characters,
lowest-severity findings dropped first, the coverage statement never dropped; the earlier answers
over crawl `3398ff1a…` ran 1,596–1,946 characters against the worker's unchanged 2,000 ceiling. The
handoff confirmation now says a queued run is executed by the scheduled worker or by Run Now on the
project's review panel (the Agents run history has none). No schema, worker or screen change.
PR #29 merged as `bad5469b…`; deployment `dpl_5uYk2Ron…` READY. **Live result (27 Sep): the
findings cap held, the character cap did not.** Two unlinked panel runs over crawl `3398ff1a…`
executed on the bounded build: `2e8b7ab3…` completed with 3 findings but 1,926 characters, and
`98e56366…` failed `rejected-output`. Neither was retried. Totals after: 45 runs, 45 attempts.

**Phase 2 checkpoint 2.3d (structural crawl-review bound):** `CRAWL_REVIEW_INSTRUCTIONS` rewritten
in the shape that held for the Project Director (`PROJECT_PRIORITY_REVIEW_INSTRUCTIONS`) and intake
(`INTAKE_REVIEW_INSTRUCTIONS`) reviews: a fixed order — one COVERAGE line (under 25 words, never
dropped), at most three findings, each three lines (OBSERVED under 20 words, INFERENCE under 12,
RECOMMENDATION under 15), one NEXT line (under 15 words) — and, as the last rule, the whole answer
under 1,200 characters, dropping the lowest-severity finding first and never the COVERAGE line or a
cited URL. The 2.3c sentence is replaced; the evidence, safety and findings-block sentences are
3b74d99's, verbatim. No schema, worker or screen change. PR #30 merged as `a48cb35a…`; deployment
`dpl_g8nT5phX…` READY. **Live verification (27 Sep):** run `941cc617…` (unlinked panel run over crawl
`3398ff1a…`, on the bounded build) completed, 1 attempt, `claude-opus-5`, **1,138 characters**, 3
findings, the COVERAGE line first and the NEXT line last. Totals after: 46 runs, 46 attempts.

**Phase 2 checkpoint 2.3b (task priority change, the one Phase 2 migration):** migration
`20261005120000_agent_task_priority.sql` adds `nexra_agent_task_set_priority` (`security definer`,
empty `search_path`, shaped like `set_owner`: `priority-changed`, `task-not-found`, `same-priority`,
`terminal`; 22023 outside the four priorities) and a `priority-changed` event (`from_priority` /
`to_priority`, type list and shape check replaced; the append-only guards untouched); the update
guard lets priority change only under the task functions' flag; `service_role` gains EXECUTE on the
one function. `POST /api/agent-tasks/[taskId] { action: "priority" }` under the existing action
limit, and *Change priority* in *Live tasks*; the history renders the event. Harness suite
`task-priority` (69 assertions); `task-workflow` pinned to the pre-priority schema. PR #31 merged as
`0921c1f8…`; deployment `dpl_L1Vyf5SU…` READY; `master` CI run `36294914125` green. **Migration
applied to production and recorded (27 Sep, separately approved):** read-only preflight
(PostgreSQL 17.6, READ COMMITTED, version absent, no priority columns or function, 1 task, 11
events); the file applied unmodified as one transaction that also inserted its history row
(`20261005120000 agent_task_priority`, the file's text as its statement, SHA-256 `942ecfa4…d92e9`
identical to the repository file; no Supabase CLI was available for `migration repair`), then
`NOTIFY pgrst`. Verified read-only: function `security definer`, empty `search_path`, owner
`postgres`, EXECUTE for `service_role` only, no UPDATE grant on the task table, every guard
trigger enabled; a direct priority UPDATE refused (23514); a `priority-changed` event accepted by
the shape check and malformed ones refused (23514), in one always-rolled-back block (its
identity values, event seq 12–14, are not reused). **Browser verification PASS (operator, 27
Sep):** task `30e79092…` priority high and back to medium, events seq 15 (medium → high) and 16
(high → medium); the task is at medium.

**Phase 2 checkpoint 2.4 (tasks as grounding + Project Manager task plan review, step (c)):**
Part C of the 2.1 design note with decisions Q6 (no new task source kind: the operator applies a
proposal through the existing status, owner and priority actions) and Q7 (at most 25 open tasks,
a 6,000-byte task block inside the 12,000-byte evidence ceiling, output under 1,300 characters).
A thirteenth evidence kind, `task` (`src/lib/agent-tasks/grounding.ts`): the run's own project's
tasks through the one bounded read, open ones only, ordered priority → created_at → id, each a
short id, the JSON-quoted title (screened with `looksLikeSecret`; a match is withheld with a fixed
disclosure), status, priority, owner, source kind (never source text), age in days and the linked
run's state by the cp 2.2 rules; one line for what was left out; an unreadable task store refuses
(`tasks-not-readable`). Task type `task-plan-review` (Project Manager, read-only, no input) with
structural-bound instructions (RECORDED, at most five PROPOSED steps, BLOCKERS, NEXT, the whole
under 1,300 characters), queued from the *Task plan review* panel beside the intake review. No
schema change, no worker or executor behaviour change (the mock executor gains its simulated
case). PR #32 merged as `2305b605…` (the PR's diff scan admitted the test's synthetic `sk-`
title fixture in `.github/secret-scan-allowlist`); deployment `dpl_4EZwABN3…` READY; `master` CI
run `36302739300` green. **Phase 2 finale (production, 27 Sep):** the first `task-plan-review`,
run `567a3f11…`, queued and run once by the operator from the *Task plan review* panel: completed,
1 attempt, `claude-opus-5`, **435 characters**; RECORDED (1 open task read, 1 shown, 0 left out),
one PROPOSED step, BLOCKERS (none recorded) and NEXT held, in that order; it cited `30e79092` only,
every recorded field matching (ready, medium, `technical-seo`, `director-run`, linked run
completed); grounded, evidence kind `task` (1,406 bytes, 1 task read, 0 titles withheld); the
instruction-shaped title was reported as data, not followed, quoted only as a shortened fragment.
One cosmetic finding, not fixed: an extra "Observation:" line outside the fixed order. Totals
after: 47 runs, 48 attempts (the extra attempt is `33ac8a25…`, below).

**Phase 3 checkpoint 3.1 (design, 27 Sep):** an audit-only design note for Phase 3, approved with
decisions Q1 (fixture-only surfaces are hidden, not labelled), Q3 (the latest own-site crawl only,
no crawl picker) and Q8 (crawl `75d1bfbe…`, the operator's own panel test on 27 Sep, is the expected
default). Production then held 8 crawls (7 own-site, 1 competitor), 99 page rows and 586 link edges;
findings reports exist for 4 own-site crawls (one at rule version 2, three at 3), all naming the
same 5 finding keys. Cross-crawl finding history is derivable without a table (checkpoint 3.3); the
curated keyword entity is Phase 3's one schema (checkpoint 3.5).

**Phase 3 checkpoint 3.2 (Technical SEO live tabs):** the Technical SEO screen reads only this
product's own crawl records. `GET /api/crawls/latest-overview?project=` (operator, project checked
before the service, the crawl read limit) answers the project's latest own-site crawl, its pages
(at most 500), a count summary of its recorded edges and its findings at the current rule version
(`src/lib/crawl/overview/`). Live tiles (pages fetched of discovered, not reached, findings by
severity from the report's counts, rule version; no health score); a filter toolbar (severity,
category, URL) over the live findings and pages; tabs Overview, Issues (the existing *Observed
findings* section, now following the screen's project; the fake session triage is gone),
Crawlability, Pages (rows link to `/technical/pages/<crawl-page id>`, realified in 3.3), Schema
(detected types only) and Internal links ("no inbound link from the fetched pages"). Hidden, per Q1:
Core Web Vitals, Opportunities, answer-engine access, index coverage and the health score. Every
section carries the coverage banner ("Crawl 75d1bfbe · Partial — stopped on the page budget · 5 of
7 discovered pages fetched, 2 not reached · 46 link edges read"), and the findings coverage line
now leads with the crawl's stop reason. No schema change. PR #34 merged as `5b79ba8d…`; deployment
`dpl_AmhtdzpiZ…` READY; `master` CI run `36305201262` green.

**Phase 3 checkpoint 3.3 (page detail + finding history, decisions Q2 and Q4):**
`/technical/pages/[pageId]` is live and replaced in place (Q2): the id is the `nexra_crawl_pages` uuid,
checked by shape, then the operator, then the crawl read limit, then the service's page → crawl →
project chain (the crawl must be confined to the project's own host); fixture `tech-*` ids, unknown
ids and competitor crawl pages are not found, and nothing is prerendered. It shows the page's
response (server response labelled crawler-measured), its declared indexing ("declared by the page —
not whether Google indexed it"), metadata and markup, linking counts, the recorded edges into and out
of it with anchor text, and the findings naming it with their decisions; a page not fetched shows
only that. Cross-crawl finding history is derived on read (Q4, no table): the project's own crawls'
reports at the current rule version compared (consecutive, by finding key), "resolved" only when the
later crawl fetched every page the finding named ("not re-checked" otherwise), a finding whose pages
changed shown as changed, reports under earlier rules not compared, crawls without a report "not
recorded" and never recomputed (`src/lib/crawl/findings/history.ts`, `GET
/api/crawls/finding-history`, the *Finding history* panel on the Issues tab). No schema change.
PR #35 merged as `c244efd4…`; deployment `dpl_38hYkQX8…` READY; `master` CI run `36307963203`
green. **Browser verification PASS (operator, 27 Sep).**

**Phase 3 checkpoint 3.4 (Keywords observed surfaces, Parts B1 + B2, decisions Q1, Q2, Q7):** the
Keyword Intelligence screen reads observed data only, for one stored project chosen on the screen:
one read, `GET /api/search-console/keywords`, answers the Keywords, Groups and Opportunities tabs
(the M4 inventory; the presenter is `src/lib/search-console/keywords/screen.ts`). Keywords: observed
position buckets from each query's latest average position ("Search Console average position, not
rank") and intent hints labelled "hint", then the inventory as the primary table with *Record as
task* per row, then the Search Console summary panel; the toolbar filters (query text, intent hint,
opportunity label) and its footer ("Observed in stored Search Console rows · derived labels", the
stored windows read). Groups (tab id `clusters`): the lexical groups inline, "a shared word, not a
topic". Opportunities: the four M4 rule labels, no upside or target CTR. Movement: the P4a/P4d
stored-window comparison, "change between two stored windows, not a trend". Cannibalisation: the P4c
overlap section, "candidate for review". Hidden (Q1): Content gap, Competitors, SERP, AI search and
Lists; the Discover and Import dialogs and the session-only bulk actions are gone from the screen;
`/keywords/clusters/[clusterId]` is removed (Q2); `/keywords/[keywordId]` is unchanged (3.5 replaces
it). Q7: the inventory view keeps the exact stored query as `query`, the *Record as task* source;
`queryLabel` is the 200-character display cut. No schema change. PR #36 merged as `201d47a2…`;
deployment `dpl_JBsp1YeB…` READY; `master` CI run `36309293871` green.

**Phase 3 checkpoint 3.5 (curated keyword entity, Part B3, decisions Q2, Q5, Q6):** migration
`20261006120000_curated_keywords.sql` adds `nexra_keywords` — one row per project and exact query text
(unique, never trimmed or case-folded; an unobserved query may be curated, Q5), a status (`tracked`,
`paused`, `archived`), an optional group label (1–80), note (1–500) and target page (an absolute
http(s) URL on the project's host, with or without `www.`, Q5), creator and timestamps, and no figure
of any kind — and the append-only `nexra_keyword_events` (`created`, `status-changed`,
`group-changed`, `target-changed`, `note-changed`; identity `seq`; shape check; guards). Five
`security definer` functions (empty `search_path`, the project beside the keyword):
`nexra_keyword_add` (`added`, `exists`, `project-not-found`, `target-off-host`) and
`nexra_keyword_set_status` / `_group` / `_target` / `_note`; the update guard allows only those
fields under the setters' flag; no delete path (archive instead); RLS on, no policies,
`service_role` SELECT on both tables and EXECUTE on the five only. Harness suites `keywords` (126)
and `keywords-races` (K1–K4); the C5 inventory names the five functions. `src/lib/keywords`
(contract, Supabase store, service, the observed join by exact query text — "not observed in stored
rows", never zero), `GET`/`POST /api/keywords` and `POST /api/keywords/[keywordId]` (operator, same
origin, 60 writes per ten minutes). UI: the Lists tab returns (curated list with status filter and
each keyword's stored-row figures; Import, one query per line); *Track* on each observed row adds the
exact query after a confirmation; `/keywords/[keywordId]` replaced in place (Q2) — a curated
keyword's curation controls, per-window figures and pages from the stored rows, tasks recorded from
the exact query and its history; fixture ids are not found; nothing prerendered. No grounding change
(Q6). PR #37 merged as `98b0fbd9…`; deployment `dpl_3uX3tKdE…` READY; `master` CI run
`36310916032` green. **Migration applied to production and recorded (27 Sep, separately
approved):** read-only preflight (PostgreSQL 17.6, READ COMMITTED, the version absent, no keyword
tables or functions, 10 projects); one transaction that inserted the history row (`20261006120000
curated_keywords`, the file's text as its one statement) and executed that recorded text only after
checking its SHA-256 equals the repository file's (`072578a5…a949fe`; a mismatch raises and writes
nothing — the method tested first on a disposable local cluster), then `NOTIFY pgrst`. Verified
read-only: RLS on, no policies; exactly the five write functions `security definer`, every keyword
function with an empty `search_path` and owned by `postgres`; `service_role` SELECT on both tables
and EXECUTE on the five only, nothing for `anon` or `authenticated`; all seven triggers enabled.
Probes in one always-rolled-back block: add `added` with its created event, the same text `exists`,
another case a separate keyword, an off-host target `target-off-host`, a `www.` target accepted, a
direct duplicate 23505, a setter through another project `keyword-not-found`, direct update,
identity change, delete and event update/delete refused (23514), each event type accepted by the
shape check and cross-type or no-change events refused (23514), `service_role` direct writes refused
(42501). Production row counts unchanged (0 keywords, 0 keyword events; every other table as
before); the probes consumed identity values of the keyword events `seq`, which are not reused.

**Phase 3 checkpoint 3.6 (Phase 3 closing, 27 Sep):**

- **Browser verifications (operator, 27 Sep):**
  - cp 3.2/3.3 Technical — the coverage banner, tiles 5 of 7 with no health score, tabs Overview,
    Issues, Crawlability, Pages, Schema, Internal links (Vitals and Opportunities absent), Issues
    triage Open 4 / Acknowledged 1, the Crawlability depth, Pages 7 rows (two "/" rows are the apex
    and `www.` host variants — the title-duplicate finding), Schema ProfessionalService 5 / FAQPage
    2, Internal links 31 internal / 15 external: **PASS**.
  - cp 3.4 Keywords — 6 tabs (content gap, competitors, SERP and AI search absent), the portfolio
    labelled "average position, not rank" (all 9 queries over 50), the inventory as the primary
    table, no volume or CPC, Groups "ai · 6 queries": **PASS**.
  - cp 3.5 entity — *Track* recorded "ai lead follow up" as a curated keyword (18 impressions, 0
    clicks, average position 85.6); Import of "ai automation lahore" with group `test-group` →
    "Not observed in stored rows"; re-import → "0 added; 1 already tracked"; Lists shows Tracked
    (2); the keyword detail page opened: **PASS**. The first attempt failed only because a
    `/keywords` page opened before the migration was applied held its failed read of the curated
    list until reloaded (expected; the read is not retried). The two curated rows are
    verification records and stay.
- **Fixture removal:** the 36 fixture components no route, layout, API handler or live component
  imports any more were deleted — 21 under `src/components/keywords` (the modelled keyword table,
  toolbar, bulk actions, portfolio, dialogs, gap, SERP, AI, lists, clusters, movement,
  opportunities and cannibalisation views, the cluster and keyword workspaces, rank chart and their
  helpers) and 15 under `src/components/technical` (the modelled views, page workspace, pages
  table, toolbar, chrome and helpers). Found by an import-graph scan from every `src/app` entry and
  the proxy, to a fixed point; no test imported them. The `src/lib/mock` modules stay: other
  fixture screens use them.
- **Sidebar build-status note** (`src/config/build-status.ts`): "Partly modelled" — Technical SEO
  and Keywords are observed data; other live panels are labelled.
- **Decision recorded (operator, 27 Sep):** the 18 links in 15 fixture files (Competitors, Content,
  AI Visibility) to the removed `/keywords/clusters/<id>` route stay 404 intentionally until those
  screens' own phases; no redirect.
- No schema change, no behaviour change on a live surface.
- **Next step:** Phase 4 design checkpoint (4.1), under its own explicit approval.

**Phase 4 checkpoint 4.1 (design, 27 Sep):** an audit-only design note for Phase 4 (roadmap
checkpoints 9–11: Analytics, Competitors, AI Visibility and Backlinks over stored data; the Director
consuming the performance and answer-readiness reviews; learnings; the carried Director bound), no
external provider. Approved with decisions: **Q1** the performance review gets the structural bound
beside the Director fix (4.2); **Q2** learnings are read from completed `performance-review` runs, no
table — the planned learnings migration (4.7) is dropped; **Q3** the competitor detail route is
replaced in place, keyed by the competitor's host; **Q4** the navigation label for the Backlinks
screen becomes "Outbound Links" (outbound edges only, never backlinks); **Q5** AI-bot robots access
stays hidden (the crawler records only its own user agent); **Q6** Analytics tiles show the latest
stored window only; **Q7** the Director ranks recorded finding > measurement > inference; **Q8** each
live verification run is approved separately. Planned split: 4.2 bounds; 4.3 Analytics; 4.4
Competitors; 4.5 AI Visibility and Outbound Links; 4.6 the Director bundle with five slots; 4.8
closing docs. P4d first verifies with a window ending 28 Sep or later (the 7-day `MIN_GAP_DAYS`;
windows 21–23 Sep stored), captured around 2 Oct; full confidence (14 days) around 9 Oct.

**Phase 4 checkpoint 4.2 (Director and performance-review bounds, parts A and Q1):**
`PRIORITY_REVIEW_INSTRUCTIONS` (`src/lib/agent-runs/run-grounding.ts`) rewritten in the 2.3d
structural shape: a fixed order (the items, then one NEXT line); at most three items, each six lines —
PRIORITY, BASIS, ACTION (under 20 words), SOURCE in short form (a rule id and URL path, or the
agent's name and a quote under 8 words; never a full URL or a whole finding), WHY THIS RANK (under
15), VERIFY (under 8); one NEXT line under 25 words; and as the last rule the whole under 1,200
characters, dropping the lowest-ranked item first and never a SOURCE or the NEXT line. The
single-run Director review's history: four of its first five production runs were refused as
`rejected-output` at the worker's 2,000-character ceiling (`a6a5bfcf…`, `55a0d422…`, `559fdffa…`,
`33ac8a25…`), and the one that completed, `393cf8ae…`, ran to 1,965 characters.
`PERFORMANCE_REVIEW_INSTRUCTIONS` (`src/lib/search-console/grounding.ts`), which had no bound (its one
production answer ran to 1,587 characters), gets the same treatment: one WINDOWS line (under 25
words, never dropped), at most three findings (OBSERVED under 20 words, INFERENCE under 12,
RECOMMENDATION under 15), its two closing lines kept (each under 20 words), and the whole under
1,200 characters as the last rule. Every sentence not about length is kept word for word; both texts
are hash-pinned. The `link-grounding.ts` header now says anchor text is recorded (since
`20260929120000`) and that the reader does not read it. No schema, worker, screen or bundle change.
PR #39 merged as `0c64d77d…`; deployment `dpl_DQ88j5hz…` READY; `master` CI run `36315046313`
green. **Live verification (27 Sep, each run approved separately, run once, no retry):**

- Director `priority-review` `aecfca87…` over search-query-review `73f38c16…` (the source of the
  earlier refused `559fdffa…` and `33ac8a25…`): completed, 1 attempt, `claude-opus-5`, **1,217
  characters** — 3 items, each with its six lines in order (all BASIS PROPOSED, no findings were
  supplied), short-form SOURCE lines, the NEXT line last.
- `performance-review` `17623686…` (Nexra Agency, 30d): completed, 1 attempt, `claude-opus-5`,
  **1,311 characters** — the WINDOWS line first (insufficient stored history, 3 snapshots), 3
  findings (OBSERVED / INFERENCE / RECOMMENDATION) and the two closing lines last.
- Both under the worker's 2,000-character ceiling on the first attempt; both slightly over their
  own 1,200 rule, each by one paragraph outside the fixed order (below). Totals after: 49 runs,
  50 attempts.

**Phase 4 checkpoint 4.3 (Analytics over stored data, Part B, decisions Q2 and Q6):** the Analytics
screen reads stored data only, for one stored project chosen on the screen. Tiles: the latest stored
Search Console window (Q6: that window only, no delta) — clicks, impressions, click-through rate and
average position ("Search Console average position, not rank"), with a window line (dates, capture
date, stored window count) — read by `GET /api/search-console/latest-window?project=` (operator,
project checked, one bounded snapshot read, the property from the server's own mapping, never
returned; `src/lib/search-console/latest/`). Overview: the Search Console panel with its stored-history
comparison (P4a/P4d) and a readiness line — "insufficient" until two stored windows are 7 days apart,
naming the first qualifying window end (oldest stored end + 7 days; 28 Sep for the windows stored
now). Pages: the Search Console pages view and the stored query × page pairs (P4c). Learnings (Q2):
the project's completed, model-executed Analytics & Learning `performance-review` runs, newest first,
each with its summary, the window its evidence recorded and the run date, labelled "A model's reading
of Google's report, not a measurement"; an empty state when none (`src/lib/analytics/learnings.ts`,
read through the existing run list). Hidden, not labelled: Trends, Segments, Attribution and
Movements (with the modelled anomaly links); a deep link to one opens the Overview. The screen imports
no fixture and carries the Observed badge; the sidebar note names Analytics as observed. The seven
modelled analytics components the screen no longer imports stay in the tree, unimported, for the
closing checkpoint. No schema, instruction, worker or other screen change. PR #40 merged as
`a73cfd21…`; deployment `dpl_8wchF2C9…` READY; `master` CI run `36321725374` green. **Tile figures
note:** the tiles show the newest *stored* snapshot — for Nexra Agency the window ending 23 Sep
(140 impressions, 1 click, 0.71%, average position 30.2) — while the 4.2 performance review
`17623686…` read the *live* report's window ending 24 Sep (144, 1, 0.69%, 30.5); the two differ by
one day of data and are both correct for their windows. **Browser verification PASS (operator, 27
Sep):** tiles 1 / 140 / 0.71% / 30.2 ("not rank"), window 25 Aug–23 Sep, "latest window only"; the
history note names 28 Sep; tabs Overview, Pages and Learnings only; Learnings shows run `17623686…`
as "Model reading"; the sidebar lists Analytics as observed. **Note for 4.8:** the tiles (the stored
23 Sep window, 140 impressions) and the Search Console panel below them (the live 24 Sep window, 144)
show different windows on one screen — add a one-line clarifier.

**Phase 4 checkpoint 4.4 (Competitors over stored crawls, Part C, decision Q3):** the Competitor
Intelligence screen reads this product's own crawls only, for one stored project chosen on the
screen. One read, `GET /api/crawls/competitor-overview?project=[&competitor=]` (operator, request
shape, crawl read limit, project checked; a competitor must be one of the domains the project's
stored record lists, resolved by the comparison reader's rule — `competitor-not-recorded`,
`competitor-is-project-site`, `competitor-invalid` refused 422 before any crawl is read;
`src/lib/crawl/competitor-overview.ts`, over the comparison reader's readers): without a competitor,
the recorded competitors, each with its newest crawl and coverage banner ("Crawl f4f5fda7 · Partial —
stopped on the page budget · 5 of 50 discovered pages fetched, 45 not reached") or "Not crawled yet";
with one, the project's newest own-site crawl beside that competitor's newest crawl, each reduced to
its fetched pages' declarations (title, first h1, meta description, canonical, schema types), labelled
"What each site's pages declared, as crawled", or `not-crawled`; a row read back under another project
or host shows no pages; a failed or running newest crawl shows its state and no declarations, never an
older crawl. The comparison review (`competitor-comparison-review`) runs through the existing
review control beneath the declarations. `/competitors/[host]` is replaced in place (Q3): keyed by the
competitor's host (the route folder is renamed from `[competitorId]`), the host's shape checked, then
the operator, then a stored project that recorded it (the `?project=` one first); unknown hosts and
the fixture ids (`<project>--<rival>`, not hostnames) are not found; nothing is prerendered. It shows
that competitor's declarations beside the project's and its comparison reviews, newest first. Hidden,
not labelled (no SERP data): every tile, visibility share, keyword overlap, rankings, content gaps, top
pages, clusters, intent, SERP threats, opportunities and compare; the detail's position bands,
authority, momentum and "costing us"; the 9 stale cluster links go with those views. The screen
imports no fixture and carries the Observed badge; the sidebar note names Competitors. The 18
modelled competitor components stay in the tree, unimported, for 4.8; the two fixture-screen links to
`/competitors/<fixture id>` (Projects' competitor table, the Command Center snapshot) now 404, as
the cluster links did in 3.6. No schema, instruction, worker or other screen change. PR #41 merged
as `69379e3d…`; deployment `dpl_ANfmhgGs…` READY; `master` CI run `36323532887` green. **Browser
verification PASS (operator, 27 Sep):** 2vautomation.ai with the "Partial — 5 of 50" banner and "not
verified as a competitor"; declarations side by side; the comparison run restored; the SERP views
absent.

**Phase 4 checkpoint 4.5 (AI Visibility and Outbound Links, Part D, decisions Q4 and Q5):** both
screens read the project's latest own-site crawl only, for one stored project chosen on the screen.
**AI Visibility** reads the Technical screen's own route (`GET /api/crawls/latest-overview`, no new
route) and shows one row per fetched page of the fields the answer-readiness review reads — h1 count
and first h1, title and description, canonical self or elsewhere, noindex declared, schema types and
parse failures, word count "as served" — labelled "What each page declared, as crawled — not whether
any AI engine cites it", with the coverage banner and the `answer-readiness-review` through the
existing control (`src/lib/crawl/declared-readiness.ts`); a null reads "not established", never a no.
Hidden (Q5 and no data): visibility score, citations, mention share, entities, fan-out, topics, gaps,
opportunities, evidence and AI-bot access; the one stale cluster link goes with topics. **Outbound
Links** (Q4: the navigation label "Backlinks & Authority" becomes "Outbound Links"; the route stays
`/backlinks`; the agent's name is unchanged) reads a new route, `GET /api/crawls/latest-outbound`
(operator, request, crawl read limit, project; then the latest own-site crawl by the overview's rule
and its edges through the one bounded link read) — new because the overview carries edge counts only
and never an edge list, while this screen shows each host's rel values, source paths and anchor text
(`src/lib/authority/outbound-view.ts`). Header "Outbound only — links from our pages, not
backlinks", the banner, and the `outbound-link-review` through the existing control. Hidden:
authority score, backlinks, referring domains, inbound anchors, link gaps, risk and toxicity,
outreach. Both screens import no fixture and carry the Observed badge; the sidebar note names them.
The modelled components stay in the tree, unimported, for 4.8 (10 under `ai-visibility` —
`ai-chrome` is still used by a Content fixture panel — and 10 under `backlinks`). No schema,
instruction, crawler or other screen change. PR #42 merged as `41519ffd…`; deployment `dpl_CjXD2ik8…`
READY; `master` CI run `36329038130` green. **Browser verification PASS (operator, 27 Sep):** AI
Visibility 5 rows, /contact 0 h1, "not whether any AI engine cites it", words as served, the agent
control present, the hidden views absent; the sidebar lists AI Visibility and Outbound Links as
observed.

**Phase 4 checkpoint 4.6 (the Director bundle with five slots, and the bounded-answer fix, Part E and
Q7):** instructions, bundle and tests only. **Bundle** (`src/lib/agent-runs/director-bundle.ts`):
`DIRECTOR_SOURCE_SLOTS` gains Analytics & Learning `performance-review` and AI Visibility
`answer-readiness-review` after the three M5 slots, each under the same 6,000-byte review ceiling, so
`MAX_BUNDLE_BYTES` grows by 12,000 (5 × 6,000 + 2 findings blocks + 4,000); both are carried as
reviews — quoted inside the T6 header, never as figures the Director saw — and the limits note gains
one line saying a performance review's figures are that agent's reading of Google's report and an
answer-readiness review is an inference over one crawl's declarations. The stored summary stays
within the run store's check with five sources. **Ranking (Q7):**
`PROJECT_PRIORITY_REVIEW_INSTRUCTIONS` rank recorded finding > measurement (only a performance
review's figures, described as that agent's reading of Google's report) > inference; three items
and 1,200 characters unchanged; BASIS stays OBSERVED / PROPOSED. **Extra-paragraph fix:** the
sentence "State anything the evidence lacks inside the fixed lines; add no other paragraph." is added
just before the last (length) rule of `PRIORITY_REVIEW_INSTRUCTIONS`,
`PROJECT_PRIORITY_REVIEW_INSTRUCTIONS`, `PERFORMANCE_REVIEW_INSTRUCTIONS` and
`TASK_PLAN_REVIEW_INSTRUCTIONS`; every earlier sentence is kept word for word (tested against
`master`). **Answer-readiness:** its only character rule was an inline "under 1,500 characters" that a
live run exceeded (1,699), so that clause gives way to a 2.3d-style last rule — under 1,200, dropping
the lowest-priority finding first, never a cited URL or the two closing lines — needed, as asked; the
instruction-length guard moves from 2,400 to 2,500 deliberately (2,454). New hashes: priority
`b0ef607c…`, project priority `3bed3937…`, performance `9524ebe2…`, task plan `fd84a38a…`,
answer-readiness `c0dc8223…`. **Not changed (screens):** the *Project Director review* panel's
description still names the three M5 reviews, though its source list follows the five slots —
for 4.8. No schema, worker or screen change. PR #43 merged as `ddc6cbb4…`; deployment
`dpl_2bUN9N9R…` READY (a manual redeploy, see *Auto-deploy skip* above); `master` CI run
`36330205806` green. **Live verification (27 Sep, operator-run once, no retry):** project
`project-priority-review` run `288639f4…` completed, 1 attempt, `claude-opus-5`, grounded — **5 of
5 sources selected**, 0 missing, 24,818 bytes (crawl-review `941cc617…`, on-page-review
`66df0fb1…`, search-query-review `73f38c16…`, performance-review `17623686…`,
answer-readiness-review `5b6cef01…`) plus the recorded findings of crawls `75d1bfbe…` and
`3398ff1a…`. Answer in the fixed order: 3 items, all BASIS OBSERVED (the /contact h1, the apex →
www host variant, the long homepage description), the BLOCKERS line, then the closing "First:" line;
**no stray paragraph — the extra-paragraph fix held**. It cited Technical SEO, On-Page SEO and AI
Visibility beside the recorded findings; the performance and search-query reviews were read but not
cited, as the Q7 rule ranks recorded findings first and three filled the plan. **1,417 characters**
(see the length note below). Totals after: 50 runs, 51 attempts.

**Phase 4 checkpoint 4.8 (Phase 4 closing, 27 Sep):**

- **Orphan cleanup:** the 45 modelled components no route, layout, API handler, proxy or live
  component imports any more were deleted — found by the 3.6 method (an import-graph scan from every
  `src/app` entry and the proxy, to a fixed point; no test imported them): 7 under
  `src/components/analytics` (`analytics-chrome`, `analytics-toolbar`, `filters`, `insight-views`,
  `overview-view`, `sorting`, `tables`); 18 under `src/components/competitors` (`battles-view`,
  `clusters-view`, `compare-view`, `competitor-chrome`, `competitor-intelligence`,
  `competitor-summary`, `competitor-toolbar`, `competitor-workspace`, `competitors-table`, `filters`,
  `gaps-view`, `intent-view`, `opportunities-view`, `overlap-table`, `overview-view`, `pages-view`,
  `sorting`, `threats-view`); 10 under `src/components/ai-visibility` (`ai-toolbar`, `ai-visibility`,
  `fan-out-view`, `filters`, `gaps-view`, `opportunities-view`, `overview-view`,
  `relationships-panel`, `sorting`, `tables`); 10 under `src/components/backlinks`
  (`anchors-view`, `backlinks-workspace`, `filters`, `link-chrome`, `link-toolbar`, `outreach-view`,
  `overview-view`, `risk-view`, `sorting`, `tables`). Kept: `ai-visibility/ai-chrome` (a Content
  fixture panel imports it). The `src/lib/mock` modules stay.
- **Wording (screen text only):** the Analytics tiles carry one line saying they show the latest
  stored window while the Search Console panel below reads Google's live report
  (`STORED_VS_LIVE_NOTE`); the *Project Director review* panel's description, the review's
  control summary and its "nothing to plan from" line name the five reviews.
- **Length note:** 1,200 characters is a soft target the model often overshoots (`aecfca87…` 1,217,
  `17623686…` 1,311, `288639f4…` 1,417); the worker's 2,000-character ceiling holds on every bounded
  review. Not pursued further.
- **Remaining 404s, left intentionally until Phase 5:** 8 links in 6 Content fixture files to the
  removed `/keywords/clusters/<id>` route, and 2 fixture links to `/competitors/<fixture id>`
  (Projects' competitor table, the Command Center snapshot).
- No schema, instruction, worker or migration change.
- **Next step:** the Phase 5 design checkpoint (5.1), under its own explicit approval.

**Phase 5 checkpoint 5.1 (design, 27 Sep):** an audit-only design note for Phase 5 (roadmap
checkpoints 12–13 and hardening → production ready): the Content Studio over stored content, the
article positive path, the Writer handoff and six hardening items. Approved with decisions:

- **Q1** Content Studio tabs Articles, Drafts and Pipeline, observed; the modelled tabs hidden.
- **Q2** `/content/[contentId]` replaced in place, keyed by article id; the old fixture ids are not
  found.
- **Q3** the positive path is a Version 3 of article `c89182f9…`, its text drafted read-only by
  Claude and approved by the operator before any write.
- **Q4** the standing constraint "never approve, propose or publish articles" is lifted for **one
  version only** (that Version 3), each step separately approved; publishing stays out of scope.
- **Q5** articles only; the older draft path (Stage 4/5A) is not exercised.
- **Q6** the Writer handoff stays deferred.
- **Q7** delete and truncate guards on `projects`, `agent_runs` and `agent_run_attempts`; crawls
  refuse TRUNCATE only (DELETE stays for housekeeping); drafts unchanged (the store's compensating
  delete needs it).
- **Q8** a public health endpoint that returns no data.
- **Q9** spend caps: 40 runs per project per day and 100 in all, refused (never crashed).
- **Q10** the C2 migration-history mismatch is documented, not repaired.
- **Q11** the provider's abort classification is fixed (`APIUserAbortError` → transient).
- **Q12** production ready = D1–D6 plus 5.2 and 5.3 verified.

Planned split: 5.2 observed Content Studio; 5.3 the article positive path (operator writes only);
5.4 the guards migration; 5.5 health, caps and the abort fix; 5.6 runbook and the C2 note; 5.7
closing.

**Phase 5 checkpoint 5.2 (observed Content Studio, Part A, decisions Q1 and Q2):** the Content
Studio reads this product's stored content only, for one stored project chosen on the screen, through
the content workflow's existing GET routes — no new route, no schema (`src/lib/content/studio.ts`,
`src/components/content/observed-content.tsx`). **Articles:** each stored article's title and slug,
status, current version of all versions, the current version's check-unit progress ("0 passed · 2
need review · 2 unchecked of 4"), approval ("Not approved", "Version N approved", or an older
version's approval named as not the current one) and proposal state (a proposal is "not published").
**Drafts:** each stored draft (at most 20 read), its current version of all versions, the current
version's recorded fact-check, placeholders, approval and proposal state. **Pipeline:** the same
records grouped by status, every stage shown, empty ones included. A read that failed says so, never
zero or none; honest empty states ("No article recorded", "No draft recorded"). **`/content/[articleId]`**
replaced in place (Q2; the route folder is renamed from `[contentId]`): the id must be a uuid, then
the operator, then a stored project holding the article (the `?project=` one first) through the
article service's own project-scoped read; the fixture ids and unknown ids are not found; nothing is
prerendered. It shows the header (slug, current version, plan run, dates), the current version's
check units with their verdicts, counts and runs, the approval and proposal state with every blocking
reason, and every version newest first with its hash, topic decision and source draft versions. No
write control anywhere on the screen or the page: each links to the project screen, where the live
controls are. **Hidden, not labelled:** the ten modelled tabs (overview, inventory, briefs, keyword
mapping, coverage, intent, on-page, AI readiness, internal links, gaps; a deep link to one opens
Articles) and the modelled detail workspace — so the 8 links to the removed `/keywords/clusters/<id>`
route are gone from the product. The screen imports no fixture and carries the Observed badge; the
sidebar note names Content. The 26 modelled files no route imports any more (24 under
`src/components/content`, `ai-visibility/ai-chrome` and `keywords/keyword-chrome`) stay in the
tree, unimported, for 5.7. **New 404s:** the Command Center's content snapshot (a fixture panel)
links each fixture page to `/content/<fixture id>`, now not found — like the 2 competitor fixture
links, left for the dashboard's own phase. No schema, instruction, worker or write-path change. PR #45
merged as `f9a32773…`; deployment `dpl_7B6vDCeT…` READY; `master` CI run `36333709886` green.
**Browser note (operator, 28 Sep):** the operator used the observed Studio screens throughout 5.3
(the Articles tab and the article detail as the positive path moved through checked, approved and
proposed).

**Phase 5 checkpoint 5.3 (the article positive path, decisions Q3–Q5; LIVE RECORD, 28 Sep):** operator
writes only, each step approved separately; no code. The Version 3 text was drafted read-only by
Claude (checkpoint 5.3a: every checkable statement quotes a declaration recorded by crawl
`75d1bfbe…`; labels, headings and the call to action are editorial), validated locally against the
C1 validator and the unit packer (4 units), and approved by the operator with two tweaks.

- **Version 3 abandoned, unchecked:** Version 3 (`a1cbc273…`, 02:10 UTC) was saved with the old
  Version 2 excerpt left in by mistake (the outcome claim that had failed before). No check ran on it.
- **Version 4** (`4df96c9a…`, 02:17 UTC, content SHA-256 `e9db287f…`) is the approved text word for
  word: slug `nexra-ai-website-lead-follow-up` (not live at the destination), topic decision
  `different-angle`, no placeholder, one section, no FAQ.
- **All 4 units passed,** each on the first attempt, `claude-opus-5`, coverage complete:
  `metadata:1` run `747330f3…` (2 supported, 6 editorial); `lead-introduction:1` run `91e441f0…`
  (1 supported); `section:what-the-pages-declare:1` run `e5c4efb2…` (5 supported, 1 editorial);
  `cta:1` run `d26af181…` (1 supported, 1 editorial) — **9 supported, 0 partial, 0 unsupported, 0
  unverifiable**. The article moved to `checked` at 03:05 UTC; the stored unit hashes match those
  regenerated from the approved text.
- **Approved** (C5): approval `5f02d149…` of Version 4 at **03:35 UTC** (4 units, content SHA-256
  `e9db287f…`); the article is `approved`, `approved_version` 4.
- **Proposal recorded** (C6): `5f229630…` at **03:38 UTC** to `nexra-agency-website`, slug
  `nexra-ai-website-lead-follow-up`, Version 4, status `proposed`, preview SHA-256 `bbf3fae3…`.
  **Nothing was published**: a proposal is a record; no `nexra-ai` write, pull request or deployment
  exists or was made.
- **It is a verification article** (a description of the site's own declarations, written so every
  statement could be checked): the proposal is to be **withdrawn before Phase 6's real
  publication**, and the article is not content to publish.
- Decision Q4's lifted constraint covered this one version only; "never approve, propose or
  publish" applies again to every other version and article. Totals after: 54 runs, 55 attempts
  (the 4 check runs).

**Phase 5 checkpoint 5.4 (delete and truncate guards, Part D1, decision Q7):** one migration,
`20261007120000_delete_truncate_guards.sql`, triggers only (no grant, row, function, column or
existing trigger changes): `projects`, `agent_runs` and `agent_run_attempts` refuse every DELETE and
TRUNCATE (23514), for every caller, service_role included — the application never deletes any of
them; `nexra_crawls`, `nexra_crawl_pages` and `nexra_crawl_links` refuse TRUNCATE only, and a crawl
DELETE stays for housekeeping (it still cascades through pages, links, findings reports, findings
and triage — the header says so); `nexra_content_drafts` is unchanged (the store's compensating
delete needs it). Four guard functions (empty `search_path`, not `security definer`, executable by
no API role). Harness suite `guards` (38 assertions: the triggers, each refusal as owner and as
service_role, crawl and page DELETE still working with the cascade, the compensating draft delete
still working, nothing removed by a refused statement). Existing suites adjusted deliberately: six
project-delete assertions accept 23514 beside 23503 (the guard now answers first), and `signals`
and `content` exempt the two new truncate triggers from "no trigger on pages or links";
`task-workflow` runs on its pinned pre-priority schema and is unchanged. PR #46 merged as
`7bd748f7…`; deployment `dpl_AjWaHbgu…` READY; `master` CI run `36375497802` green. **Migration
applied to production and recorded (28 Sep, separately approved; this corrects the earlier "not
applied" note):** read-only preflight (PostgreSQL 17.6, READ COMMITTED, the version absent, latest
`20261006120000`, 29 history rows, the six tables present, none of the guard objects; projects 10,
runs 54, attempts 55, crawls 8, pages 99, links 586); the 3.5 method — tested first on a disposable
local cluster (9 triggers, 1 history row; a tampered hash fails closed and writes nothing) — one
transaction that inserted the history row (`20261007120000 delete_truncate_guards`, the file's text)
and executed that recorded text only after checking its SHA-256 equals the repository file's
(`17d1ef9d…e84253`); no `NOTIFY pgrst` (triggers only). Verified read-only: the recorded hash matches,
30 history rows, all **9 guard triggers enabled**, the 4 guard functions not `security definer`, empty
`search_path`, owned by `postgres`, EXECUTE for no API role. **Rolled-back probe** (one `do` block
ending in a raise): as `service_role`, DELETE on projects, runs and attempts → 23514 (the guard);
TRUNCATE of pages and links → 23514; TRUNCATE of projects, runs and crawls → 0A000 plain (the
foreign-key check precedes the triggers) or 42501 with CASCADE (no TRUNCATE on a cascaded table), and
of attempts → 42501 (no TRUNCATE grant) — each refused before the guard; as the owner every one of
those TRUNCATEs → 23514 (the guard); a crawl DELETE as `service_role` (crawl `13211e31…`) succeeded
and took its 7 pages with it, rolled back. Row counts unchanged afterwards. `supabase/README.md`
lists it as applied.

**Phase 5 checkpoint 5.5 (health, daily caps, abort fix, dynamic screens; Parts D2, D3, D6 and the
5.2 note; decisions Q8, Q9, Q11):** no schema.

- **Health (Q8):** `GET /api/health` (`src/lib/health/health.ts`, `src/app/api/health/route.ts`) —
  public for GET and HEAD at exactly that path (`HEALTH_PATH` in `src/lib/auth/access.ts`; a write or
  any other path is still refused); 200 `{ status: "ok", time, database: "reachable" }`, or 503
  `{ status: "degraded", time, database: "unreachable" }` when the database errs or takes over 2 s
  (the probe reads at most one project id and discards it); `not-configured` (200) on a deployment
  that keeps no database. The body is exactly those three fields — no data, id, count, error text or
  configuration name. Never cached; a light per-instance cap of 120 a minute (429 with Retry-After).
- **Daily caps (Q9):** `src/lib/agent-runs/daily-caps.ts` — 40 a project and 100 in all per UTC day,
  counted twice: runs created and attempts started, through the existing `rate_limit_consume` (keys
  `<project>|all:<YYYY-MM-DD>`, a one-day window; no schema). At creation the service answers
  `daily-cap` → HTTP 429 with Retry-After (until midnight UTC) and nothing is queued; a duplicate
  costs nothing. Before an attempt the worker counts it; a capped run is **never claimed**, stays
  queued with nothing changed, and runs after midnight UTC: the queue reads the due runs
  (`listDue`, the claim's own rule and order, read-only) and passes over a capped project's runs; a
  global cap stops the batch (`stoppedBy: "daily-cap"`, `heldByCap` in the job answer); Run Now on a
  capped run answers 429 `daily-cap` and claims nothing. Counts can only overstate use (a project hit
  when the global count then refuses, or an attempt another worker took first, is not returned). The
  review controls say so in words (`DAILY_CAP_MESSAGE`, `DAILY_CAP_HELD_MESSAGE`).
- **Abort fix (Q11):** `classify` (`providers/anthropic.ts`) answers the SDK's `APIUserAbortError`
  `unavailable` (transient) before the status rule; the 1.3 test that pinned `rejected` is updated
  deliberately.
- **Dynamic screens (the 5.2 note):** the 11 list pages that read the stored project list — `/`,
  `/projects`, `/agents`, `/settings`, `/keywords`, `/technical`, `/competitors`, `/ai-visibility`,
  `/backlinks`, `/analytics`, `/content` — are `force-dynamic`, so the build marks each `ƒ` and a
  project added after a deploy appears without a rebuild. The detail pages keep their existing
  rendering (the project page is revalidated on its own writes).

PR #47 merged as `6b776b3a…`; deployment `dpl_ANhS71fqzxQBasqpBJF6QDd9qVFH` READY on the production
alias; `master` CI run `36382919799` green. **Browser check PASS (operator, 28 Sep):** `/api/health`
answered `{"status":"ok","database":"reachable"}`.

**Phase 5 checkpoint 5.6 (runbook and claim race test, Parts D4 and D5, decision Q10):** docs and one
harness suite; no schema, no app code. `docs/RUNBOOK.md`: applying a migration (read-only preflight;
apply and record — the CLI's `migration repair`, or without the CLI one transaction that writes the
history row and executes its text only when its SHA-256 equals the file's; verify with read-only
checks and always-rolled-back probes, as `service_role` and as the owner); forward-fix only, never
down-migrate; history repair notes; the C2 mismatch (`20260923043554` recorded, file
`20260923120000`) documented and left as is (Q10), never `db push` or `db reset`; confirming the
deployment id, READY, the alias and `master` CI after every merge before a live run, with the
`ddc6cbb4` skip and the one-redeploy rule; Vercel rollback by promoting the previous production
deployment (its id in §0 or the dashboard's Production list), then fixing forward; `/api/health` and
an uptime monitor's use; the daily caps (40 a project, 100 in all) and what to do when one is hit
(wait for midnight UTC; the counter rows to read; never edit them); how a run is claimed. Harness
suite `claim-races` (`supabase/tests/run.sh`): R1 two workers claim one queued run by id — the first
`claimed`, the second waits on the row lock (~1.5 s) and answers `not-queued`, the run `running` with
attempt count 1 and one attempt row; R2 the first claim rolls back — the second claims; R3 two queue
claims take different runs without waiting (`skip locked`). PR #48 merged as `fb048e81…`; deployment
`dpl_6cfpcgN5…` READY on the production alias; `master` CI run `36384855012` green.

**Phase 5 checkpoint 5.7 (Phase 5 closing, PRODUCTION READY):** cleanup, labels and docs; no schema,
no behaviour change on a live surface.

- **Orphan cleanup:** the 26 modelled files no route, layout, API handler, proxy or live component
  imports any more were deleted — found by the 3.6 / 4.8 method (an import-graph scan from every
  `src/app` entry and the proxy, to a fixed point; a re-scan finds none; no test imported them, and
  every remaining reference to them came from another file in the same set): 24 under
  `src/components/content` (`aeo-view`, `ai-visibility-panel`, `authority-strip`, `brief-document`,
  `brief-requirements`, `briefs-view`, `bulk-actions`, `content-chrome`, `content-studio`,
  `content-summary`, `content-table`, `content-toolbar`, `content-workspace`, `coverage-view`,
  `filters`, `gaps-view`, `intent-view`, `links-view`, `mapping-view`, `overview-view`,
  `recommendations-view`, `sorting`, `technical-strip`, `workflow-board`),
  `src/components/ai-visibility/ai-chrome` and `src/components/keywords/keyword-chrome`. The
  `src/lib/mock` modules stay: the fixture screens use them.
- **Modelled labels (audit §J: no fixture figures without an explicit modelled label, and no live
  panel read as modelled):** one shared badge, `src/components/ui/modelled-badge.tsx` ("Modelled",
  with a hover explanation), used two ways. **Fully fixture screens** carry it in their header:
  Command Center (`dashboard-header`), Reports (`reports-workspace`) and a report
  (`report-preview`). **Mixed screens** carry no header badge; each fixture section is wrapped in
  `ModelledSection` (the badge and the section's name above it), and each live section stays
  unwrapped with its own observed label:
  - Projects (`projects-workspace`): Modelled — *Portfolio figures*, *Project roster figures*; no
    live section (the roster's names are stored projects, its figures fixtures, as its footer says).
  - A project with fixture data (`project-workspace`): Modelled — *Project health*, *Metrics*, *AI
    visibility*, *Authority*, *Analytics*, *Reporting*, *Issues*, *Agent team*, *Tasks* (overview);
    *Metrics*, *Performance trend*; *Issues*; *Tasks*; *Keywords*; *Content*; *Technical snapshot*;
    *Competitors*; *Agent team*; *Notes*; *Project settings* (the other tabs); live — *Site crawl*
    (`CrawlPanel`, "Observed data"). A stored project with no fixture data shows the unmeasured
    page, which holds live panels only (intake and task-plan reviews, Search Console, crawls, the
    evidence pack, content plan, articles, the Director) and no fixture figure; it is unchanged.
  - AI Agents (`agents-workspace`): Modelled — *Team health*, *Agent roster figures*,
    *Orchestration pipeline*, *Agent tasks*, *Blockers*, *Handoffs*, *Collaboration*, *Recent
    activity*; live — *Run History* (`AgentRunHistory`), which gains an "Observed" badge beside its
    "Agent runtime" eyebrow.
  Already labelled, unchanged: an agent's page ("Modelled operating data" in its header). Not
  labelled, because it shows no fixture figure: Settings (browser preferences only, which it says).
  No other change to those screens. Test `src/lib/projects/modelled-screens.test.ts` (fully fixture
  screens: header badge once; mixed screens: no header badge, every fixture section wrapped, every
  Modelled section a listed one, live sections unwrapped and observed-labelled; observed screens:
  none).
- **Remaining 404s, left for Phase 6:** the Command Center's content snapshot links to
  `/content/<fixture id>` and the 2 fixture links to `/competitors/<fixture id>` (Projects'
  competitor table, the Command Center snapshot) — all inside the fixture screens.
- PR #49 merged as `bf71dd73…` (an amendment moved the Modelled badge from the mixed screens'
  headers to their fixture sections before the merge); deployment `dpl_6EFMc9Ng…` READY on the
  production alias; `master` CI run `36386424748` green. **Phase 5 is complete: PRODUCTION READY.**

**Phase 6 checkpoint 6.1 (design, 28 Sep):** an audit-only design note for Phase 6 (roadmap
checkpoints 14–16 → the full 12-agent V1): the approval workflow, C7 publishing, Command Center and
Reports over stored data, per-agent run history, the full-V1 agent criteria, the learning loop and
the PR split. Found: no task type is `approval-required` today (the refusal path is latent); the
destination is a pull request's worth of TSX in `nexra-ai` (no CMS; the website template pinned at
`a4a5722`), with a live `ai-lead-follow-up-automation` article; nine agents hold fewer than two
grounded task types. Approved with decisions:

- **Q1** approval: C7-only, in a reusable approvals table; the run-claim gate is unchanged.
- **Q2** publishing: a pull request to `nexra-ai`, merged by the operator; a fine-grained token scoped
  to `nexra-ai`, with an expiry (a §6 credential).
- **Q3** the real article's topic "AI dead-lead reactivation", slug `ai-dead-lead-reactivation` (a
  new article, not a version of the verification article `c89182f9…`).
- **Q4** external data: option B, a scoped-down V1 — Market compares crawled declarations, AI
  Visibility reads answer-readiness of declared content (no citations), Authority reads outbound and
  internal link structure (no backlinks); no paid provider.
- **Q5** the curated keywords may ground the Keyword agent's second task (lifts 3.5's Q6).
- **Q6** reports are generated on read (no stored report table).
- **Q7** the learning loop: one recorded re-prioritisation — a `priority-changed` event carrying the
  Director run it cites (a migration).
- **Q8** the low-risk screens first (6.2–6.4).

**Phase 6 checkpoint 6.1b (operator-attested statements, design, 28 Sep):** the article check could
only pass statements the project's own records hold, so a first-hand or opinion passage was
UNVERIFIABLE and never approvable. Approved with decisions: attestation is **paragraph-level** (a
top-level list of locators in a new canonical format `nexra-article-content/2`, used only when there
are attestations, so every `/1` text, unit and preview — V4's included — keeps its bytes and hashes);
a new ATTESTED class the checker may use only for marked statements, and never for a checkable fact
about the site; limits **at most 40% of body sentences, at most half of any section's, and at least 3
SUPPORTED statements**; attested paragraphs **ban digits, symbols and count words except "one" and
"first"**; labels **"From our client work — first-hand, not independently verified"** and **"Our
view"**; a **per-approval attestation tick, stored** on the approval with the attested count; option
(b), external sources, **after V1**; built as checkpoint **6.8b, before C7**.

**Phase 6 order:** 6.2 per-agent run history; 6.3 Command Center over stored data; 6.4 Reports on
read; 6.5 second grounded tasks (Keyword, Content, Writer, On-Page, Technical, Analytics); 6.6 option B
(docs and the Market, AI Visibility and Authority second tasks); 6.7 the learning loop (migration);
6.8 the C7 approval (migration); 6.8b attested statements (migration, instructions); 6.9 C7a (a
read-only re-audit of `nexra-ai`, the article renderer as a dry run); 6.10 C7b (the published-state
table; the operator withdraws `5f229630…` and takes the real article through C4 → C5 → C6); 6.11 C7c —
**the one external write**, last (the pull request, the operator's merge, the live check); 6.12
closing. Each under its own explicit approval.

**Phase 6 checkpoint 6.2 (per-agent run history, Part C, decision Q8):** every agent page
(`/agents/[agentId]`) shows the agent's stored runs first on its Overview: the existing Run History
section (`AgentRunHistory`) with a new optional `presetAgentId`, which fixes the list to that agent
(the page passes its own record's id) and replaces the agent picker with the agent's name; the
project selector, the per-run attempts toggle, "Load older runs" and the Observed badge are unchanged.
It reads the existing route (`GET /api/agent-runs?project=&agent=`, built by
`src/lib/agent-runs/run-history-view.ts`); an empty list says "No runs recorded for this agent" and
names the agent and project, never a zero. AI Agents keeps the unpreset list with its picker. Labels
(5.7 rule): every fixture section of the agent page — *Operating state*, *Performance*, *Projects*,
*Assigned tasks*, *Blockers*, *Handoffs* (and *Incoming* / *Outgoing handoffs*), *Outputs*, *Recent
activity*, *Pipeline neighbours*, *Collaboration*, *Brief*, *Agent settings* — is wrapped in
`ModelledSection`; the live sections (Run History, and the Project Manager's *Live tasks* on its
Tasks tab, unchanged) are not; the header's "Modelled operating data" line gives way to "Nothing on
this page starts an agent run. Run History lists this agent's stored runs; every section labelled
Modelled is fixture data." Tests: `run-history-view.test.ts` (the preset route for each of the 12
agents, the empty states, the mount), `modelled-screens.test.ts` (the agent page as a mixed screen),
and the task-surface test's two pinned lines updated deliberately. No schema, no route, no
instruction, no other screen. PR #50 merged as `b2b7da00…`; deployment `dpl_GoSs6ztV…` READY on the
production alias; `master` CI run `36391754452` green. **Browser check PASS (operator, 28 Sep):** the
new header line is live on the Technical SEO agent's page.

**Phase 6 checkpoint 6.2 follow-up (the agent header, the 5.7 rule):** on `/agents/[agentId]` the
header card's figures — the status and load badges, the last action, and the eight facts (stage,
category, projects, active tasks, queue, workload, quality, outputs) — are fixture data and had no
label, and its "Run agent sync" button did nothing but show a simulated notice. The figures now sit
together in one `ModelledSection` ("Operating figures") inside the header, beneath the agent's name,
title and responsibility; the button, its queued notice and the workspace's sync state are removed,
so the header has no control (§12: no control that does nothing). The page note is unchanged. Tests:
`modelled-screens.test.ts` (one Modelled block holding every figure, none outside it, no button or
sync state) and the task-surface test's header line (whitespace-normalised). No schema, route,
instruction or other screen; the AI Agents list kept its own simulated "Run agent sync" button, not
in this scope (removed in 6.4). PR #51 merged as `17ee0a64…`; deployment `dpl_D8L7aLiU…` READY on the production
alias; `master` CI run `36393369165` green.

**Phase 6 checkpoint 6.3 (Command Center over stored data, Part C, decision Q8):** the Command
Center (`/`) reads stored data only, for one stored project chosen on the screen (the `?project=`
one first), with the Observed badge and no header Modelled badge. Five tiles, each read through an
existing route and linking to its screen on the same project (`src/lib/dashboard/command-center.ts`,
the screen `src/components/dashboard/observed-command-center.tsx`; no new route, no schema):

- **Search Console** (`GET /api/search-console/latest-window`): the latest stored window's
  impressions and clicks, click-through rate and average position ("Search Console average
  position, not rank"), with the window line; → Analytics.
- **Crawl findings** (`GET /api/crawls/latest-findings`, lighter than the overview route and enough
  here): the newest own-site crawl with recorded findings — the total and the count by severity from
  the report's recorded counts, and the crawl's id, stop reason and coverage line; → Technical SEO.
- **Open tasks** (`GET /api/agent-tasks`): the open tasks (not completed or cancelled) by status;
  → the Project Manager.
- **Recent agent runs** (`GET /api/agent-runs`, the newest 5): each run's task and outcome (a failure
  named by its code); → Run History.
- **Content pipeline** (`GET /api/content-articles`, then the proposal route for at most the 10
  newest articles): articles by status and active proposals, "a proposal is a record of intent —
  nothing is published"; a proposal state not read is counted as not read; → Content Studio.

A read that failed says so ("Nothing is shown in its place"); 503 says the deployment keeps no such
records; an empty store says what is not recorded, never a zero figure. Removed from the screen: the
fixture snapshot (scores, KPIs, the performance chart, priorities, alerts, the agent, keyword,
content, technical, competitor, AI-visibility, authority, analytics and reporting snapshots), the
fake "Run SEO Analysis" and "Refresh" controls and the header's Modelled badge — so the fixture
links to `/content/<fixture id>` and `/competitors/<fixture id>` in those panels are gone from the
product. The sidebar note names the Command Center as observed. The fixture components the screen no
longer imports (`command-center`, `dashboard-header` and the snapshot panels) stay in the tree,
unimported, for the Phase 6 closing (6.12). Tests: `src/lib/dashboard/command-center.test.ts` (10:
each tile over production-shaped answers — 140 impressions and 1 click, 5 findings as 2 medium and 3
low with the crawl's coverage, 1 open task, the approved article with its proposal; the empty,
failed and not-kept states; the five links; the routes; no fixture import, the Observed badge, no
control) and `modelled-screens.test.ts` (the Command Center moved from the fully modelled list to
the observed one). No schema, route, instruction or other screen. PR #52 merged as `c8ac155c…`;
deployment `dpl_5fzpNZrB…` READY on the production alias; `master` CI run `36394607712` green.
**Browser confirmation (operator, 28 Sep, on the #55 build):** the Command Center tiles are live.

**Phase 6 checkpoint 6.4 (Reports on read, decision Q6):** `/reports` generates one stored project's
report on read (the `?project=` one first, chosen on the screen), in the browser, from the project's
stored records each time it opens — no report table, no stored copy, no schedule, no send
(`src/lib/reports/project-report.ts`, the screen `src/components/reports/observed-report.tsx`; no new
route, no schema). Five sections, each read through an existing route and each labelled **Observed**
(figures read from stored records), **Not recorded** (the store holds nothing of this kind), **Not
read** (the read failed) or **Not kept** (the deployment keeps no such records) — never a zero for
"nothing read":

- **Search Console** (`latest-window` and `history?range=30d`): the latest stored window's dates,
  capture date, clicks, impressions, click-through rate and average position ("not rank"), and the
  P4d history state in one line — the comparison's window ends, gap, confidence and click and
  impression change ("not a trend"), or why there is none (for Nexra Agency today: not enough
  history).
- **Crawl findings** (`latest-findings` and `finding-history`): the newest own-site crawl with
  recorded findings — crawl, pages fetched of discovered, total at its rule version and by severity,
  the stop reason — and the derived finding-history summary.
- **Tasks by status** (`agent-tasks`): every recorded task, counted under each of the seven statuses.
- **SEO Director's latest plan** (`agent-runs?agent=seo-director`, the 25 newest): the newest
  completed, model-executed `project-priority-review`, its stored text quoted as stored, with run,
  date and model — labelled "A model's reading of the stored specialist reviews, not a measurement".
- **Content pipeline and proposals** (`content-articles`, then the proposal route for the 10 newest):
  articles by status, each active proposal (slug, version, destination, date), and always "Nothing
  is published: a proposal is a record of intent, and this product has no publishing path."

The report states when it was generated (date and UTC time) and lists the stored windows, crawls and
runs it read (*Windows and records used*). Print-friendly: a Print button (`window.print()`); in
print the sidebar, header, drawer, project selector and section links are hidden
(`print:hidden` in `app-shell.tsx` and on the controls) and sections do not split across pages.
**`/reports/[reportId]` is removed** (the smaller honest option: its only links came from the
fixture report library, and a stored report does not exist to key it by). The fixture report
components the screen no longer imports stay in the tree, unimported, for 6.12. **Also:** the AI
Agents list (`agents-workspace.tsx`) loses its simulated "Run agent sync" button, its "Sync queued"
notice and timer, and the header's fixture "N needing attention" count (a fixture figure outside any
Modelled section, the 5.7 rule). The sidebar note names Reports as observed. Tests:
`src/lib/reports/project-report.test.ts` (11) and `modelled-screens.test.ts` (Reports moved to the
observed list — no screen is wholly fixture now — plus the agents-list and route checks). No
schema, no instruction, no write. PR #53 merged as `a2e3cdc1…`; `master` CI `36404604165` green.
**Browser confirmation (operator, 28 Sep, on the #55 build):** Reports on read is live, and `/agents` has
no "Run agent sync".

**Phase 6 checkpoint 6.5 (second grounded tasks, batch 1, decision Q5):** six agents gain a second
grounded task, each over an evidence kind that already exists, with one block appended for its
question (no new evidence kind, no schema); instructions in `src/lib/agent-runs/second-tasks.ts`, each
in the 2.3d structural shape — a fixed order, at most three findings (or revisions) of three capped
lines, the first line never dropped, a closing line — with the 4.6 sentence "State anything the
evidence lacks inside the fixed lines; add no other paragraph." just before an under-1,200-character
last rule naming what to drop first; hash-pinned; a full-caps answer in eight-letter words stays
under the worker's 2,000 ceiling (tested):

- **Keyword & Search Intent — `keyword-opportunity-review`** (range; `search-console` with the M4
  inventory): the operator's curated keywords (**Q5 lifts 3.5's Q6** for this one task) through the
  keyword service — status, group, target page and the stored rows' reading of each exact query
  ("not observed in stored rows", never zero); archived left out, credential-like text withheld
  (`src/lib/keywords/grounding.ts`). Hash `771b1ef7…`.
- **Content Strategist — `content-refresh-review`** (crawl id; `crawl`): the latest stored query ×
  page window listed by page, each page marked fetched or not by the crawl
  (`src/lib/search-console/query-pages/page-pairs.ts`, `readLatestPagePairs`). Hash `c9ffd8c2…`.
- **Writer — `article-revision-draft`** (the check's four unit inputs; policy `draft`;
  `article-unit`): the unit, its recorded **needs-review** check (partial, unsupported and
  unverifiable items with the check's notes) and the evidence pack; refused `unit-not-checked` or
  `unit-not-needs-review` before any provider call (`src/lib/content/articles/revision-grounding.ts`);
  it writes nothing to the article — a revision becomes a version only when the operator saves one.
  Hash `921e3f22…`.
- **On-Page SEO — `page-query-alignment-review`** (crawl id; `crawl`): the same page pairs block;
  alignment is shared words only, an overlap "for review", never confirmed cannibalisation. Hash
  `3ad335d5…`.
- **Technical SEO — `finding-history-review`** (crawl id; `crawl` with the computed findings): the
  derived finding history (3.3) through the crawl service
  (`src/lib/crawl/findings/history-grounding.ts`); "not re-checked" is never "fixed". Hash
  `8483f822…`.
- **Analytics & Learning — `learning-review`** (range; `search-console`, analytics audience, with
  the P4d history): the agent's own earlier `performance-review` readings by the Learnings tab's
  rule, at most three, quoted as a model's reading (`src/lib/analytics/learnings-grounding.ts`).
  Hash `36f61680…`.

A missing reader, an empty store or a failed read is stated in its block and never fails the run;
the first tasks' grounding is unchanged. Wiring (`src/lib/agent-runs/index.ts`): `pagePairs`,
`findingHistory` and `curatedKeywords` (the keyword service imported on use, to avoid a module
cycle); the learnings through the existing per-agent run listing. Each of the six agents now holds
two or more grounded tasks. **No screen control:** the six are queued through the existing `POST
/api/agent-runs` (operator, the agent and input checked), not from a panel — a deliberate
deviation, left for a later checkpoint. Tests: `src/lib/agent-runs/second-tasks.test.ts` (20);
deliberate pin updates — the task count (18 → 24) and the non-read-only list (now `section-draft`,
`article-revision-draft`) in seven suites, the curated-keyword grounding rule (Q6 → Q5: only the
runtime's one reader) and the M4 wiring regex. `docs/BACKEND.md` gains *Second grounded tasks*. No
schema, no run. PR #54 merged as `1b2c2cbd…` (after the allowlist fix below and a merge of `master`).

**Phase 6 checkpoint 6.6 (the scoped-down V1, decision Q4 option B):** §13 gains *Scoped V1* — for
Market & Competitor Intelligence, AI Visibility and Authority & Backlink, what V1 reads, its two
tasks and what it never claims. Their second tasks, in the 6.5 shape (hash-pinned, full caps under
2,000), each over an evidence kind that already exists:

- **Market — `competitor-page-gap-review`** (competitor domain, parsed as the comparison;
  `competitor-comparison`): which kinds of page, topic or schema type the competitor's fetched pages
  declare that the project's do not — declarations only, a partial sample on each side, never copied,
  never a measurement. Instructions only. Hash `9a7b1449…`.
- **AI Visibility — `schema-entity-review`** (crawl id; `crawl`, no findings block): the JSON-LD types
  each page declares, parse failures, and whether title and h1 name the same entity — type names
  only, never a property, rich-result eligibility or a citation. Instructions only. Hash `10ef1d3a…`.
- **Authority — `internal-link-review`** (crawl id; `crawl-links`): the outbound record, then an
  *Internal link structure* block from the same edges, read once (`readLinkGrounding` gains an
  `internal` option that also reads the crawl's pages, bounded at 500): each fetched page's inbound
  internal edges from the other fetched pages, source paths and anchors as recorded, fewest first —
  "no inbound link from the fetched pages", never "orphaned"
  (`src/lib/authority/internal-link-grounding.ts`). Hash `d65b6abc…`.

Every one of the twelve agents now holds two or more grounded tasks (tested). The outbound review's
grounding is unchanged. Tests: `src/lib/agent-runs/scoped-v1.test.ts` (9); pins updated deliberately —
the task count (24 → 27) and the Authority agent's task set (outbound and internal). No schema, no
run, no screen control (queued through `POST /api/agent-runs`, as 6.5). PR #55 merged as `04be98ae…`;
`master` CI `36405118649` green. (The 6.5 test's synthetic `sk-ant-` keyword fixture is admitted in
`.github/secret-scan-allowlist`, as PR #32's was.)

**Phase 6 checkpoint 6.6b (queue controls on agent pages):** every agent page (`/agents/[agentId]`) gains
*Queue a review* above its Run History, the two in one live section (`AgentRunsSection`) on one shared
project, so a queued run is listed at once (`AgentRunHistory` gains optional `projectId`,
`onProjectChange` and `refreshToken`; the AI Agents list is unchanged). The control
(`src/components/agents/queue-review-control.tsx`, presenter `src/lib/agent-runs/queue-control.ts`)
lists exactly the agent's grounded task types from the registry (evidence other than `none`, not open to
any agent), each with its description, and offers the record chooser its evidence needs: none (project,
evidence pack, tasks, the Director bundle); a finished own-site crawl (`crawl`, `crawl-links`, from `GET
/api/crawls`); a Search Console window (`search-console`); a recorded competitor (`GET
/api/crawls/competitor-overview`); for `article-revision-draft`, an article and one unit of its current
version whose recorded check **needs review** (`GET /api/content-articles`, then `/api/content-article-checks`).
Tasks whose record is chosen by its own panel (`priority-review`, `section-draft`, `draft-fact-check`,
`article-check-unit`) say where on the project screen and are not queued here. The task and the record
start empty ("Choose a task…"); Queue stays disabled until the request is valid. Queue sends one `POST
/api/agent-runs` (project, agent, task, the chosen record) and executes nothing: "Queued, not run … It
appears in Run History below. Run now here, or the scheduled worker picks it up."; a duplicate is named as
one. **Amendment (before merge):** the agent page's Run History offers **Run Now** on each queued run of that
agent only (`runNowOffered`; never a running, completed, failed or cancelled run, and none on the AI Agents
list), through the review panels' own control, extracted into `src/components/agent-runs/run-now.tsx`
(`useRunNow`, `RunNowButton`, `RunNowNote`) and now shared by `queued-review.tsx` and Run History: one
`POST /api/agent-runs/<id> {action:"execute"}`, the route's operator gate and daily caps (a capped run is
held, `DAILY_CAP_HELD_MESSAGE`), the run read back and the list refreshed. Draft-policy tasks carry "Writes a draft for your review, publishes
nothing." Refusals, the daily cap (429, `DAILY_CAP_MESSAGE`) included, use the review controls' wording
(`queueRefusal`). Tests: `src/lib/agent-runs/queue-control.test.ts` (8) and two Run Now tests in
`run-history-view.test.ts`; pins updated deliberately —
the agent page's Run History mount (`run-history-view.test.ts`) and its live section
(`modelled-screens.test.ts`). No schema, route, instruction or run. PR #56 merged as `67643262…`; `master` CI
`36407164456` green; deployment id not read (Vercel 403).

**Phase 6 checkpoint 6.6b live verification (28 Sep, operator-run once each from the agent pages' *Queue a
review* and Run Now, no retry; verified read-only):** eight runs, all on project `nexra-agency`, all
**completed, 1 attempt (1 attempt row), `claude-opus-5`, executor `ai`, grounded**; crawl tasks over crawl
`75d1bfbe…`, Search Console tasks over `30d`.

| Run | Task (agent) | Characters | Structure | Evidence recorded |
|---|---|---|---|---|
| `855262b5…` | `finding-history-review` (Technical SEO) | 1,008 | held: COVERAGE, 3 findings, NEXT | `crawl` + `findings` (rule v3, 5) + `findingHistory` (3 compared, 1 under other rules, 3 not recorded) |
| `b91d9a29…` | `page-query-alignment-review` (On-Page SEO) | 1,074 | held | `crawl` + `pagePairs` (10 pairs, 3 pages, window ending 24 Sep) |
| `522e8074…` | `internal-link-review` (Authority & Backlink) | 1,089 | one stray "Note:" paragraph (partial crawl, no backlinks) | `crawl-links` (46 edges) + `internalLinks` (5 pages, 31 internal edges, 1 with no inbound) |
| `cabd78b0…` | `schema-entity-review` (AI Visibility) | 1,192 | one stray "Note:" paragraph (types only; the apex homepage) | `crawl` (5 pages) |
| `a7471250…` | `keyword-opportunity-review` (Keyword & Search Intent) | 969 | held | `search-console` + history (insufficient) + query pages + keywords (9) + `curatedKeywords` (2 read, 1 observed, 0 withheld) |
| `c1c624ec…` | `learning-review` (Analytics & Learning) | 951 | one stray unlabelled paragraph ("Previous-window … not established") between the one finding and LEARNING | `search-console` (analytics) + history (insufficient) + query pages + `learnings` (2: `17623686…`, `7711726c…`) |
| `951edae8…` | `content-refresh-review` (Content Strategist) | 1,085 | held | `crawl` + `pagePairs` (10 pairs, 3 pages) |
| `8ca9c9f8…` | `competitor-page-gap-review` (Market & Competitor Intelligence) | **1,247** | one stray "Note:" paragraph (competitor readings not established) | `competitor-comparison` (5 + 5 pages; competitor crawl `f4f5fda7…`, 2vautomation.ai) |

- **Length:** seven of eight under the 1,200 soft target; `8ca9c9f8…` 47 over; all far under the worker's
  2,000 ceiling (range 951–1,247).
- **Structure:** four held their fixed order exactly; four added one paragraph outside it, each stating
  what the evidence lacks — the 4.6 extra-paragraph pattern returning despite the `NO_OTHER_PARAGRAPH`
  sentence. Addressed by checkpoint 6.6c (below).
- **Content:** the claims stay inside the scoped V1 — "no inbound link from the fetched pages", never
  orphaned; type names only; "not observed in stored rows … unknown, not zero"; "overlap to review, not
  cannibalisation"; no ranking, traffic or backlink claim.
- **Writer `article-revision-draft`:** correctly refused at queue time — the article's current Version 4
  has no unit whose recorded check needs review (all 4 passed), so the chooser offers none and Queue stays
  disabled; no run was created.
- **Totals after:** 62 runs, 63 attempts (from 54 and 55; these eight are the only runs on 28 Sep after
  the 5.3 check runs). All eight 6.5/6.6 second tasks that
  can be queued today have one completed live run; the Writer's waits for a needs-review unit.

**Phase 6 checkpoint 6.6c (the LIMITS line):** the four stray paragraphs above each said what the evidence
did not cover, so the fixed order of all nine second tasks (6.5 and 6.6, `src/lib/agent-runs/second-tasks.ts`)
now holds a line for it: `LIMITS_LINE` — "LIMITS: one line, under 20 words, naming what the supplied evidence
does not cover." — placed just before each closing line (NEXT, or LEARNING for `learning-review`), and each
fixed-order sentence names it ("…, then the findings, then one LIMITS line, then one NEXT line."). The 4.6
"add no other paragraph" sentence and every other sentence are kept word for word: the tests take the LIMITS
line and its place in the order out and match the 6.5 and 6.6 hashes. New hashes: keyword-opportunity
`653f59b8…`, content-refresh `b027d90d…`, article-revision-draft `0dd3eeea…`, page-query-alignment
`7cf11088…`, finding-history `24911c5a…`, learning `ac7cc936…`, competitor-page-gap `b87fc8e1…`,
schema-entity `bbecdbc5…`, internal-link `e8536140…`. Full-caps answers (eight-letter words at every cap,
LIMITS included) stay under the worker's 2,000 ceiling: 1,978 (COVERAGE reviews and the revision draft),
1,972 (scoped), 1,879 (learning — its OBSERVED cites both window dates, not a URL; modelled with a URL, as the
6.5 test did, it would be 2,031). The margins are thin (22–28 characters). **Accepted (operator, 28 Sep):**
worst cases 1,978 / 1,972 / 1,879 against the 2,000 ceiling, because live answers average about 1,000
characters (the eight 6.6b runs: 951–1,247); if any live run of these tasks is refused `rejected-output`,
tighten the word caps. The instruction-length guard in
`second-tasks.test.ts` moves from 2,600 to 2,700 deliberately (the keyword text is 2,606). No other
instruction, no schema, no screen, no run.

**Findings recorded for later phases:**

- **Carried forward to Phase 4 (resolved by checkpoint 4.2, verified live on run `aecfca87…`):** the single-project Director `priority-review` run `33ac8a25…`
  (SEO Director, queued by an operator on 26 Sep 08:45) was executed by the scheduled worker on
  27 Sep 06:19 UTC and failed `rejected-output`; not retried. `PRIORITY_REVIEW_INSTRUCTIONS` still
  lack the structural bound the project Director, intake, crawl and plan reviews carry; it is
  Phase 4's Director work.
- Task events seq 12–14 do not exist: the identity values were taken by the rolled-back 2.3b
  verification probe (see 2.3b above) and are not reused. History is ordered by `seq`, never
  assumed contiguous.
- **The extra-paragraph pattern (3 instances; resolved by checkpoint 4.6, verified live on run `288639f4…`):** a structurally bound
  answer adds one paragraph of prose outside its fixed order, usually explaining missing evidence —
  the task plan review's "Observation:" line (run `567a3f11…`), the Director's opening "No recorded
  crawl findings…" line (`aecfca87…`, which is what puts it 17 characters over 1,200) and the
  performance review's unlabelled "Previous-window … unknown, not zero" paragraph between its
  findings and its closing lines (`17623686…`, 111 over). None reached the 2,000 ceiling. No
  instruction is changed before 4.6.

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

**Current work:** Phase 6 checkpoint 6.6c on `claude/kind-cannon-7b7swp` (above, not merged); next 6.7; each further
step starts only with explicit approval. Earlier: the Project Manager task workflow (branch
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
- The draft path's production drafts remain unapproved; no draft proposal exists.
- `nexra_article_publication_proposals` holds one row: the verification proposal `5f229630…`
  (checkpoint 5.3), to be withdrawn before Phase 6's real publication. It published nothing.
- The content workflow has no Create PR, Merge, Deploy or Publish control; C6 records proposal
  state only.
- Article `c89182f9-4954-4834-8446-a831fc3c42d0` is `approved` at Version 4 (checkpoint 5.3: all 4
  units passed, approval `5f02d149…`, proposal `5f229630…`) and **not published**. Versions 2 and 3
  can never be approved. The approve/propose permission was for Version 4 only.
- Vercel deploys every push to `master` to production automatically.
- Any external write requires explicit user approval (§6).
- Migration `20261006120000_curated_keywords.sql` (checkpoint 3.5) is applied to production and
  recorded; curated keywords are operator records, and since 6.5 ground one agent task only —
  the Keyword agent's `keyword-opportunity-review` (decision Q5 of the 6.1 note, lifting 3.5's Q6).
- Migration `20261007120000_delete_truncate_guards.sql` (checkpoint 5.4) is applied to production
  and recorded: projects, runs and attempts can no longer be deleted or truncated, crawl records not
  truncated. Agent runs are capped at 40 a project and 100 in all per UTC day (checkpoint 5.5).

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
lists the migrations in order; `docs/RUNBOOK.md` is how production is changed, checked and rolled back.

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

The Technical SEO and Keyword Intelligence screens read observed data only (Phase 3): this
product's own crawl records, the stored Search Console rows and the operator's curated keywords.
The Analytics screen reads stored Search Console snapshots and the Analytics & Learning agent's
completed runs only (Phase 4, checkpoint 4.3), and the Competitor Intelligence screen this product's
own crawls of the project's site and its recorded competitors (checkpoint 4.4); the AI Visibility and
Outbound Links screens the project's latest own-site crawl (checkpoint 4.5); the Content Studio the
project's stored articles and drafts (Phase 5, checkpoint 5.2); the Command Center one stored
project's own records (Phase 6, checkpoint 6.3); Reports a project's report generated on read from
them (checkpoint 6.4).
Everything else on screen (fixture figures on the Projects, project, agent and AI Agents screens)
is still modelled fixture data from `src/lib/mock`. It must stay labelled as
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
9. Outbound Links (route `/backlinks`; renamed from "Backlinks & Authority" by decision Q4)
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

### Scoped V1 (decision Q4, option B)

Three agents' full responsibilities (the table above) need data this product does not hold and will not
buy for V1 (no SERP, citation, backlink or paid provider). Their V1 is scoped to stored records; the
table states the direction, this states what V1 does:

| Agent | V1 reads | V1 tasks | V1 never claims |
|---|---|---|---|
| Market & Competitor Intelligence | This product's crawls of the project's site and of competitors the project recorded — page declarations (title, h1, description, canonical, schema types) | `competitor-comparison-review`, `competitor-page-gap-review` | rankings, traffic, share of voice, SERP positions, backlinks or any measurement of a competitor |
| AI Visibility / AEO / GEO | The project's own crawls — each page's declared answer-readiness fields and JSON-LD types | `answer-readiness-review`, `schema-entity-review` | citations, mention share, a visibility score, AI-bot access, rich-result eligibility or a schema property the crawl did not record |
| Authority & Backlink | The project's own crawls' recorded link edges — outbound hosts and rel values, internal edges and anchor text | `outbound-link-review`, `internal-link-review` | backlinks, referring domains, an authority score, PageRank or toxicity |

Anything beyond this is after V1 and needs a §4 / §6 decision (a new external integration).

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
| Phase 2 (b) | Handoffs for five more agents with an operator-chosen record (own-site crawl or recorded competitor domain); Writer deferred | Complete: PR #28 (`8dcff921`), deployed, production verified (run `bcefb1e4…`); no migration. Crawl-review bound: 2.3c PR #29 (`bad5469b`), then the structural 2.3d PR #30 (`a48cb35a`), verified live (run `941cc617…`, 1,138 characters) |
| Phase 2 (b2) | Task priority change: set-priority function, priority-changed event, Change priority control (checkpoint 2.3b) | Complete: PR #31 (`0921c1f8`), deployed; migration `20261005120000` applied and recorded; browser verified (events seq 15–16) |
| Phase 2 (c) | Tasks as grounding (evidence kind `task`) and the Project Manager task plan review (checkpoint 2.4) | Complete: PR #32 (`2305b605`), deployed; no migration; production verified (run `567a3f11…`, 435 characters) |
| Phase 2 | Project Manager loop closure: steps (a), (b) with 2.3b/c/d, and (c) | **Complete** (PR #27–#32); closing docs checkpoint 2.5 |
| Phase 4 | Analytics, Competitors, AI Visibility and Outbound Links over stored data; the Director reads the performance and answer-readiness reviews; learnings from runs | **Complete:** design note 4.1 approved (Q1–Q8); 4.2 (Director and performance-review bounds) merged (PR #39, `0c64d77d`), deployed, verified live (runs `aecfca87…` 1,217 characters and `17623686…` 1,311); 4.3 (Analytics over stored data) merged (PR #40, `a73cfd21`), deployed; 4.4 (Competitors over stored crawls) merged (PR #41, `69379e3d`), deployed; 4.3 and 4.4 browser verified; 4.5 (AI Visibility and Outbound Links) merged (PR #42, `41519ffd`), deployed, browser verified; 4.6 (the Director's five-slot bundle, the Q7 ranking and the extra-paragraph fix) merged (PR #43, `ddc6cbb4`), deployed (manual redeploy `dpl_2bUN9N9R…`), verified live (run `288639f4…`, 5 of 5 sources); 4.8 closing (orphan cleanup, wording, docs) |
| Phase 5 | Content Studio over stored content, the article positive path (C4 → C5 → C6 on one version), hardening (guards, health, spend caps, abort fix, runbook) → production ready | **Started:** design note 5.1 approved (Q1–Q12); 5.2 (observed Content Studio) merged (PR #45, `f9a32773`), deployed; 5.3 positive path recorded live (article `c89182f9…` Version 4: 4 of 4 units passed, approved 03:35 UTC, proposal `5f229630…` 03:38 UTC, nothing published); 5.4 (delete and truncate guards, migration `20261007120000`) merged (PR #46, `7bd748f7`), deployed, migration applied and recorded (28 Sep, probes verified); 5.5 (health, daily caps, abort fix, dynamic screens) merged (PR #47, `6b776b3a`), deployed, `/api/health` browser verified; 5.6 (runbook, claim race test) merged (PR #48, `fb048e81`), deployed; 5.7 closing (orphan cleanup, Modelled labels, docs) merged (PR #49, `bf71dd73`), deployed — **Complete: PRODUCTION READY** |
| Phase 6 | The full 12-agent V1: approval for C7, publishing through a pull request to `nexra-ai`, Command Center and Reports over stored data, per-agent run history, two grounded tasks per agent (option B), the recorded learning loop, operator-attested statements | **Started:** design notes 6.1 (Q1–Q8) and 6.1b (attestation) approved; 6.2 (per-agent run history) merged (PR #50, `b2b7da00`), deployed, browser checked; its follow-up (agent header figures labelled, fake sync button removed) merged (PR #51, `17ee0a64`), deployed; 6.3 (Command Center over stored data) merged (PR #52, `c8ac155c`), deployed; 6.4 (Reports on read, PR #53, `a2e3cdc1`), 6.5 (second grounded tasks, batch 1, PR #54, `1b2c2cbd`) and 6.6 (the scoped V1, PR #55, `04be98ae`) merged, deployed, browser confirmed; 6.6b (queue controls on agent pages) merged (PR #56, `67643262`), verified live (eight second-task runs, 28 Sep); 6.6c (the LIMITS line in the nine second tasks) on `claude/kind-cannon-7b7swp`, not merged; then 6.7–6.12 in order, the one external write (6.11) last |
| Phase 3 | Technical & Keywords realification (the MVP target) | Design note 3.1 approved; 3.2 (Technical SEO live tabs) merged (PR #34, `5b79ba8d`) and deployed; 3.3 (page detail and derived finding history) merged (PR #35, `c244efd4`), deployed, browser verified; 3.4 (Keywords observed surfaces) merged (PR #36, `201d47a2`) and deployed; 3.5 (the curated keyword entity) merged (PR #37, `98b0fbd9`), deployed, migration `20261006120000` applied and recorded; 3.2–3.5 browser verified; 3.6 closing (fixture removal, sidebar note, docs) — **Complete: the MVP target** |

**MVP COMPLETE (27 Sep).** Each MVP criterion from the audit, with its evidence:

| MVP criterion | Evidence |
|---|---|
| Docs match production, with CI gates | Phase 1: docs reconciliation (PR #23), security and worker tests (PR #24), CI gates on every pull request and push to `master` (PR #25), closing docs (PR #26); every later PR merged on green CI |
| Project Manager outcome loop | Checkpoint 2.2: a task's handoff outcome is read back from its linked run (PR #27), browser verified |
| Specialist handoff | Checkpoint 2.3: handoff for 11 of the 12 agents (six from the task workflow, five with an operator-chosen record, PR #28), production verified on run `bcefb1e4…`; the Writer is deferred by decision |
| Project Manager plan proposal | Checkpoint 2.4: the task-plan review, recorded in production as run `567a3f11…` (435 characters, grounded in the project's tasks) |
| Technical and Keywords observed-first | Phase 3: the Technical SEO screen, page detail and derived finding history over this product's own crawls (PR #34, #35); the Keyword Intelligence screen over the stored Search Console rows (PR #36); the operator's curated keywords (PR #37, migration `20261006120000` applied); closing and fixture removal (PR #38); each browser verified in production |

Carried forward: the single-project Director `priority-review` has no structural bound (run
`33ac8a25…` failed `rejected-output`) → Phase 4. Next step: the Phase 4 design checkpoint (4.1).

**PRODUCTION READY (28 Sep, Phase 5 closing, decision Q12: D1–D6 plus 5.2 and 5.3 verified).** Each
production-ready criterion from the audit (§J), with its evidence:

| Criterion | Evidence |
|---|---|
| Screens read observed data, or say they are modelled | Phase 3: Technical SEO with page detail and finding history, Keyword Intelligence with curated keywords (PR #34–#38); Phase 4: Analytics, Competitor Intelligence, AI Visibility, Outbound Links (PR #40–#42, #44); Phase 5: Content Studio (PR #45). The fully fixture screens — Command Center, Reports, a report — carry the Modelled badge in their header; the mixed screens — Projects, a project, AI Agents — on each fixture section, their live panels (crawls, Run History) labelled observed; an agent's page its "Modelled operating data" line (5.7) |
| Content Studio live | 5.2: Articles, Drafts and Pipeline and the article detail over stored records (PR #45), used by the operator through 5.3 |
| Article positive path | 5.3: article `c89182f9…` Version 4 (content SHA-256 `e9db287f…`): 4 of 4 check units passed (9 supported statements), approved (`5f02d149…`), proposal `5f229630…` recorded — **nothing published** |
| Browser verifications recorded | 1.5 (M3 findings, M4 query inventory, M5 Director panel), 2.2 (handoff outcome), 2.3b (priority change), 3.3 and 3.6 (Technical, Keywords, curated keywords), 4.3 (Analytics), 4.4 (Competitors), 4.5 (AI Visibility, Outbound Links), 5.3 (Content Studio in use), 5.5 (`/api/health`) — each in §0 |
| Security and worker test coverage | 1.3: 113 security and worker cases (PR #24); CI gates on every pull request and push to `master` (1.4, PR #25); the SQL harness (30 suites, 72 checks) including the claim race (5.6) |
| Records cannot be deleted | 5.4: `20261007120000` applied and recorded — projects, runs and attempts refuse DELETE and TRUNCATE, crawl records TRUNCATE; verified with rolled-back probes |
| Health endpoint | 5.5: public `GET /api/health`, no data; browser verified `{"status":"ok","database":"reachable"}` |
| Spend caps | 5.5: 40 runs a project and 100 in all per UTC day, refused or held, never crashed |
| Abort classification | 5.5: the SDK's caller abort is transient (Q11) |
| Runbook | 5.6: `docs/RUNBOOK.md` — migrations, deployment confirmation, rollback, health, caps, claims |
| C2 decision documented | Q10: `20260923043554` recorded vs file `20260923120000`, documented in the runbook and left as is |

**Carried to Phase 6:**

- Withdraw the verification proposal `5f229630…` before any real publication (the article is a
  verification article, not content to publish).
- Command Center and Reports realification (and the fixture links that 404 inside them).
- An approval workflow for real publication; publishing itself stays out of scope until approved.
- The external-provider decision (any new integration is §4 / §6).
- The 1,200-character soft target, which the model often overshoots under the 2,000 ceiling (4.8).

Next step: the Phase 6 design checkpoint (6.1), under its own explicit approval.

Stages are executed in order. Each stage is broken into bounded features, and each bounded
feature gets its own workflow cycle (§1) and Git checkpoint (§10). Current: Phase 6, next checkpoint 6.7
(6.2 through 6.6b merged, PR #50–#56). Phase 5 is complete — PRODUCTION READY (PR #45–#49). Phase 4 is
complete (PR #39–#44).
Phase 3 — the MVP target — is complete.
Phase 1, Phase 2, Phase 3, Phase 4 and Phase 5 are complete. Phase 2, Project Manager loop closure: the handoff
outcome read-back, handoffs for five of the six deferred agents (the Writer stays deferred) with the
structural crawl-review bound, priority change, and tasks as grounding with the Project Manager
task-plan review. Phase 3, Technical & Keywords realification — the MVP target: the Technical SEO
screen, page detail and derived finding history over this product's own crawls; the Keyword
Intelligence screen over the stored Search Console rows; and the operator's curated keywords
(the one Phase 3 migration, applied). Phase 4: the Analytics, Competitors, AI Visibility and
Outbound Links screens over stored data, the Director and performance-review bounds, and the
Director's five-slot bundle. Phase 5: the Content Studio, the article positive path and the hardening
(guards, health, caps, the abort fix, the runbook). Not started, each under its own explicit
approval: Phase 6 checkpoints 6.7–6.12.

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
