# Nexra Backend

What the backend is, how it is secured, and what a deployment needs. Written at
the end of Backend Phase 6 (Part 3). It describes only what is built and was
verified; limitations are listed at the end.

## Architecture

A Next.js 16 application. The pages are the product surface; the backend is its
server-side modules and route handlers, with Postgres (Supabase) as the only
store.

```
Browser ── proxy (src/proxy.ts) ── pages (Server Components) ── repositories / services ── Supabase Postgres
                                 └─ /api/* route handlers ──┘                           └─ Google Search Console API
Vercel Cron ── /api/worker/* ── agent runtime worker ── executor (mock | AI provider)
```

| Area | Module | Store |
|---|---|---|
| Projects | `src/lib/projects` | `public.projects` |
| Sign-in | `src/lib/auth`, `src/proxy.ts` | Supabase Auth |
| Search Console | `src/lib/search-console`, `/api/search-console/report` | Google API (read-only) |
| Agent runtime | `src/lib/agent-runs`, `/api/agent-runs/*`, `/api/worker/*` | `public.agent_runs`, `public.agent_run_attempts` |
| Crawl foundation | `src/lib/crawl`, `/api/crawls/*` | `public.nexra_crawls`, `public.nexra_crawl_pages`, `public.nexra_crawl_links` |
| Search Console history | `src/lib/search-console/{snapshots,history,query-pages,keywords}`, `/api/search-console/{history,query-pages,keywords}` | `public.nexra_search_console_snapshots`, `public.nexra_search_console_query_pages` |
| Crawl findings and triage | `src/lib/crawl/findings`, `/api/crawls/*/findings*`, `/api/crawls/latest-findings` | `public.nexra_crawl_findings_reports`, `public.nexra_crawl_findings`, `public.nexra_crawl_finding_triage` |
| Content drafts | `src/lib/content/drafts`, `src/lib/content/publications`, `/api/content-drafts`, `/api/content-publications` | `public.nexra_content_drafts`, `public.nexra_content_draft_versions`, `public.nexra_content_publication_proposals` |
| Articles | `src/lib/content/articles`, `/api/content-article*` | `public.nexra_articles`, `public.nexra_article_versions`, `public.nexra_article_version_sources`, `public.nexra_article_check_units`, `public.nexra_article_approvals`, `public.nexra_article_publication_proposals` |
| Agent tasks | `src/lib/agent-tasks`, `/api/agent-tasks/*` | `public.nexra_agent_tasks`, `public.nexra_agent_task_events` |
| Shared rate limits | `src/lib/security/shared-rate-limit.ts` | `public.rate_limit_windows` |
| Logs | `src/lib/observability/log.ts` | stdout (JSON lines) |

Everything else on screen — rankings, content, technical, competitor, backlink,
AI-visibility, and reporting figures — is still modelled fixture data, labelled
as such. Nothing measures it yet. **The crawl foundation does not change that:**
it stores what it observes, and the only readers of it are the crawl panel on
the project workspace and the two crawl-grounded agent tasks below. Since M3
the Technical SEO screen carries one observed section — a stored project's
latest recorded findings and the decisions made about them — above its
modelled views, which stay fixture data and still say so.

## Supabase

Postgres holds projects, agent runs and attempts, rate-limit windows, crawls
with their pages, links, findings and triage, Search Console snapshots and
query × page rows, content drafts, versions and proposals, articles with their
versions, check units, approvals and proposals, and agent tasks with their
event history. Every
table has row level security with no policies: no browser-side client can read
or write it. The server uses the secret (`service_role`) key, which never leaves
the server. The rules that matter are enforced in the database, for every
writer, the server included:

- the run lifecycle and its immutable request fields (trigger);
- one active identical request (partial unique index);
- attempts start, renew, finish, and are recovered only through
  `security definer` functions executable by `service_role` alone — the
  service role cannot write attempt rows directly;
- automatic retries are counted only by the retry function.

Migrations, in order, are listed in [`supabase/README.md`](../supabase/README.md#applying-migrations).
They are applied by pasting each file into the SQL Editor, followed by
`NOTIFY pgrst, 'reload schema';`.

## Auth model

One level: operator or nobody. An operator is a Supabase Auth user with a
confirmed email that is listed in `NEXRA_OPERATOR_EMAILS`. The proxy gates every
page with the verified session token; every write and every data endpoint
re-checks the user with the Auth server (`getOperator`). Session cookies are
`httpOnly`, `SameSite=Lax`; writes also require a same-origin request. Private
responses are `Cache-Control: private, no-store`.

The worker routes are the one exception to session auth — see below.

## Search Console

A service account reads Search Console for projects mapped in
`SEARCH_CONSOLE_PROPERTIES`. Read-only: no property, user, sitemap, or removal
calls exist. Reports are fetched server-side, cached briefly, and shown beside —
never mixed into — modelled figures, with explicit not-connected, no-data,
partial, and stale states. Verified for `nexra-agency`
(`sc-domain:nexraagency.com`).

Two agent tasks read it: `search-query-review`, for the Keyword & Search
Intent agent, and `performance-review`, for the Analytics & Learning agent.
Both take one input, a range id, and are given the same evidence block with a
different question — what the queries mean, and what the figures did. The
runtime fetches the report for the run's own project and the
range in the task input through the same cached provider the panel uses
(`src/lib/search-console/grounding.ts`), serialises the window, the
previous-window comparison where Google still holds it, and the top queries by
clicks — each query quoted as third-party text, at most 25 rows, every absent
reading written as "not established" — and refuses every non-connected state
before anything is formatted. No caller can name a property or a query: the
input carries a range and nothing else.

**Snapshot capture (milestone M1, checkpoints 1b and 1c; deployed, production verified).**
`src/lib/search-console/snapshots/capture.ts` reads the 30-day window for each
stored project that `SEARCH_CONSOLE_PROPERTIES` maps to a property and records
what Google reported through the one CP1a database function,
`nexra_search_console_snapshot_record` (migration `20260927120000`,
`nexra_search_console_snapshots`). Sequential across projects, bounded by
`maxProjects` (1–50) and `budgetMs`; a project is not started with under three
seconds left, and a Google read that outlives the budget answers
`unavailable`/`timeout` without writing. Before a row is written the project is
read again (`project-not-found` if gone), the property comes from the server's
mapping and nowhere else (`not-connected` otherwise), the provider's answer must
name that exact property (`property-mismatch` otherwise) and must be fresh
(`stale-skipped`); a stale or mismatched queries or pages read is recorded as
`queries-unavailable`/`pages-unavailable`, never as today's rows. Google's
totals and top 25 queries and pages are stored as returned, within the table's
limits (25 rows, keys of at most 2,048 characters; a row outside them is left
out, not altered). Outcomes: `created`, `no-data-created` (Google answered with
no impressions), `exists` (the window was already recorded; nothing written),
`not-connected`, `access-denied`, `unavailable`, `stale-skipped`,
`property-mismatch`, `project-not-found`, `store-unavailable` (fixture roster)
and `store-failed`. A failed read is never a no-data row. Logs carry project
ids, outcomes, reasons and durations only. The provider does not echo the
window's dates, so the window is bound by the call the capture makes (the
provider caches by property and exact dates), not by the response; the
database does not check the project-to-property mapping.

The scheduled `process` job runs the capture after the agent-run queue
(`src/lib/agent-runs/process-job.ts`, checkpoint 1c). The queue is unchanged
(5 runs, 240 s). The capture then gets the smaller of 45 s and what is left of
the route's 300 s minus a 15 s response margin; under the capture's 3 s minimum
it is skipped (`snapshots.status: "skipped"`, reason `time-budget`) with nothing
started. The whole capture is raced against a hard deadline of its budget plus
5 s of grace for a write already in flight: past it the job answers `timed-out`
and returns without waiting (a cut write is one transaction the database
commits or rolls back whole, and the next capture of that window answers
`exists` or records it). A capture that throws answers `failed`, logged by
error name. Whatever the capture does, the queue's answer is returned as
before; the response gains one additive field, `snapshots`, holding project
ids, outcome names, counts and durations only. Nominal worst case: 240 + 45 +
5 = 290 s. The cron schedule, `vercel.json`, the worker credential and its
rate limit are unchanged. Production verified: the scheduled job recorded two
connected `nexra-agency` snapshots (windows ending 21 and 22 Sep, captured
25 and 26 Sep, `source: scheduled`).

### Query × page rows and overlap (M1 P4c; deployed, production verified)

`20260930120000_create_search_console_query_pages.sql` adds
`nexra_search_console_query_pages`: one immutable row per project, property,
30-day window end, query and page, holding only clicks, impressions, CTR and
average position for that pair. The capture (`src/lib/search-console/snapshots/capture.ts`)
makes one more real Search Console request per connected project — the same
property, credentials, window and failure semantics as the three snapshot
reads, with `dimensions: ["query", "page"]` and `rowLimit` 250
(`QUERY_PAGE_ROW_LIMIT`) — strictly after the snapshot is written or found
already written, inside what is left of that project's budget (never started
under 2 s left; a hanging read ends at the project's deadline), and records
the rows as one set through `nexra_search_console_query_pages_record`
(`security definer`, empty `search_path`, at most 250 well-formed pairs,
transaction advisory lock per window, `created` with the count, `exists` when
the window already holds rows, `not-found` for a missing project). The pair
step's outcome (`recorded`, `exists`, `no-pairs`, `skipped` with
`snapshot-not-connected`/`time-budget`/`store-unavailable`, `unavailable`
with its reason, `store-failed`) sits beside the snapshot's in every batch
entry and never changes it; the worker's response gains one additive `pairs`
outcome name per entry. Worker budgets, cron, `vercel.json`, the credential
and its rate limit are unchanged: the pair read costs at most one cached
Google request per project per hour, inside the same 45 s capture budget.

`src/lib/search-console/query-pages/` holds the pure intelligence over stored
pairs, with the thresholds written once in `thresholds.ts`: (A) a *potential
query overlap* is one query on at least 2 of the site's pages in the set; (B)
a *cannibalization candidate for review* is an overlap in which at least 2
pages each had at least 20 impressions for the query with average positions
within 5 places of each other; (C) the *leading page* is the page with the
most impressions for the query (ties: clicks, then URL), and *page
concentration* counts the overlaps each page leads; (D) across the newest
window and the newest eligible earlier one (at least 7 days apart, as P4a;
under 14 days is low confidence) an overlap appeared or disappeared, the
leading page changed, or the query's summed impressions moved by at least
20. The reader (`readSearchConsoleQueryPages`, server-only) lists the
project's rows through one bounded read (750 rows: three captures' worth, so
two complete windows are always seen and a cut third is dropped), keeps only
the property the private mapping names now, and never takes a property from
a caller. Every reader states what the evidence is not: Search Console
leaves anonymised queries out and the set is a capped cut by clicks, so it is
never complete; nothing here is a confirmed cannibalisation, a ranking, a
search volume, a difficulty, a SERP feature, an indexation state, a ranking
cause, or a page that owns a query.

`search-query-review` (Keyword & Search Intent) and `performance-review`
(Analytics & Learning) get a third grounding block after the live report and
the P4b history — at most 10 overlaps of 5 pages, under 12,000 bytes — and
only when observed pair evidence exists; no pairs, another property, a
deployment that keeps none or a failed read adds no block and never fails the
run. `GET /api/search-console/query-pages?project=<id>&range=30d`
(`src/app/api/search-console/query-pages/route.ts`) mirrors the history
route's gates and answers `presentQueryPages` (`query-pages/view.ts`): no
property, no row id, at most 10 overlaps × 5 pages with true counts. The
*Query-to-page overlap* section
(`src/components/search-console/search-console-query-pages.tsx`) sits in the
Search Console panel beneath the stored history on the summary and queries
views, with its own load and the states loading, no stored rows, rows for a
previous property, no overlap observed, overlaps, and read failed. Nothing
here writes; the migration is applied and recorded in production, and the
first capture recorded 10 query × page pairs for `nexra-agency` on 25 Sep.

### Stored history on the panel (M1 P4d)

`GET /api/search-console/history?project=<id>&range=30d`
(`src/app/api/search-console/history/route.ts`) is the browser's only way to
the stored snapshot history: operators only, the project must be stored, the
range must be the one window snapshots are kept for, and the property is the
server's own mapping resolved inside `readSearchConsoleHistory` — no request
names one. It answers the P4a comparison projected by
`src/lib/search-console/history/view.ts`: dates, gap, confidence, both
windows' state and partial flags, totals as the comparison computed them (a
percentage stays null over a zero baseline; a position stays not established
when the previous window had no impressions), and for queries and pages at
most five improving, five declining and five opportunity rows with the true
counts beside them. No property name, snapshot id or full top-25 list reaches
the browser. A deployment that keeps no snapshots answers `not-kept`; no
snapshots, one snapshot and history under a previous property are each named;
a failed read is a 503, never an empty comparison. The *Change since last
stored snapshot* section (`src/components/search-console/search-console-history.tsx`)
sits inside the Search Console panel beneath the live report with its own
load, so a failed or empty history never changes the live panel, shows the
query lists on the summary and queries views and the page lists on the pages
view, and always carries the caveats: two windows, not a trend; Search
Console's average position, not a rank tracker; incomplete top rows; no
query-to-page mapping and no cannibalisation conclusion. Nothing here writes.

### Observed query inventory (M4; deployed, production verified on run `73f38c16…`; browser verified)

M4 began with a gap audit of the Keyword Intelligence roadmap against
`master` after M1. Overlap and cannibalization-candidate detection (P4c),
Search Console evidence grounding for the two review agents (M1, P4b, P4c),
stored history and movement over two windows (P4a, P4d) and the live Search
Console panel were complete. What was missing was a project-level inventory
of the queries Google reported, any structured intent label, any grouping,
a query-to-page mapping beyond the overlaps, fixed opportunity rules and a
live keyword surface. M4 delivers those as derived intelligence over the two
M1 tables and adds no table: every input already sits in
`nexra_search_console_snapshots` (each window's top 25 queries) and
`nexra_search_console_query_pages` (each window's top 250 pairs), and an
inventory recomputed on read from immutable rows is always the rows' truth.
A persisted, operator-curated keyword entity and AI-assisted intent or topic
classification were considered and deferred: neither is needed to show what
Google reported, and both would present a model's or an operator's opinion
beside observed figures.

`src/lib/search-console/keywords/` holds the pure module. `inventory.ts`
unions the top queries of every stored snapshot for the property the private
mapping names now (the P4a property rule; rows under another property are
set aside and counted) with the latest stored pair window (selected as P4c
selects it, a possibly cut oldest window dropped): per query, the windows it
was listed in with first and last window end, whether it is in the latest
top rows, the latest window's figures — the snapshot row when the query is
in the latest top rows, else the impression-weighted sum of its pairs, and
the source is named — its page mapping from the pairs (`no-pairs`,
`single-page` or P4c's `overlap` with the leading page, its share and the
candidate flag), an intent hint, a lexical group and opportunity labels.
Sorted by the latest window's impressions, then clicks, then query; counts
are true counts. `intent.ts` gives a lexical hint from fixed word lists over
the query's own words — informational, commercial, transactional,
navigational (the brand: the host's registrable label and the name's words of
four letters or more, minus generic business words such as "agency"), local,
or `unclassified` when nothing matches — with the word that decided it,
under the precedence brand, transactional, local, commercial, informational.
It is derived, never observed, and every surface says so. `groups.ts` files
each query under its most frequent non-function word within the inventory
(ties to the alphabetically earlier word) and keeps groups of two or more: a
lexical group shares a word, not necessarily a topic, and is labelled that
way. `thresholds.ts` writes the opportunity rules once: *low CTR* reuses the
P4a opportunity rule (at least 100 impressions, CTR at most 1%, position
within 20); *position band* is an average position from 4 to 20 with at
least 20 impressions; *no strong landing page* is an overlap whose leading
page holds under 50% of the query's impressions; *cannibalization candidate
for review* is P4c's label unchanged; a *page hub* is a page under at least
five observed queries in the pairs. Every label names a candidate for a
person's review, never a predicted win; there is no search volume,
difficulty, cost per click, SERP feature, indexation or rank-tracker
reading, and nothing is estimated in their place.

`readKeywordIntelligence(projectId)` (`keywords/index.ts`, server-only)
reads the project's snapshots and pairs through the two existing bounded
store reads, resolves the property from the private mapping and the brand
words from the stored project record, and answers null when the deployment
keeps no snapshots. `GET /api/search-console/keywords?project=<id>&range=30d`
mirrors the query-pages route's gates and answers
`presentKeywordIntelligence` (`keywords/view.ts`): at most 50 rows, 10
groups of 8 queries and 5 hubs with the true counts, no property or row id,
and the fixed caveats; the states not kept, no snapshots, snapshots under a
previous property and no queries are each named, never an empty inventory
read as no demand. The *Observed query inventory* panel
(`src/components/search-console/search-console-keywords.tsx`) is, since
checkpoint 3.4, the primary table of the Keyword Intelligence screen (below),
labelled *Observed · derived labels*, with *Record as task* on each row.

`search-query-review` alone gets a fourth grounding block after the pairs
(`keywords/grounding.ts`): at most 25 rows, 10 groups, 5 hubs, under 8,000
bytes with a truncation note, ending with its own limits; no inventory, a
deployment that keeps no snapshots or a failed read adds no block and never
fails the run, and `performance-review` never reads it. The instructions
tell the agent that an intent hint is a lexical suggestion it may confirm or
overturn in its INFERENCE and must never cite as OBSERVED, that a group
shares a word, that an opportunity label is a candidate, that no page owns
a query, and to infer nothing when no block follows. The run's evidence
summary gains `keywords` (status, window ends, counts, cuts, bytes). No
migration, no worker, cron, credential or environment change.

## Agent runtime

An operator asks one of the twelve registry agents to run a task on a stored
project. Twenty-seven task types exist, twenty-five read-only and two `draft` (the nine added in checkpoints 6.5 and 6.6 are listed under *Second grounded tasks* below): `project-review` (any agent),
`keyword-research` (Keyword & Search Intent, from operator seed keywords),
`crawl-review` (Technical SEO), `on-page-review` (On-Page SEO),
`answer-readiness-review` (AI Visibility),
`search-query-review` (Keyword & Search Intent, from Search Console),
`performance-review` (Analytics & Learning, from Search Console),
`priority-review` (SEO Director, from one other agent's completed review),
`project-priority-review` (SEO Director, from the latest completed Technical
SEO, On-Page SEO, Keyword & Search Intent, Analytics & Learning performance and
AI Visibility answer-readiness reviews of the project, selected on the server;
see *The Director's project bundle (M5)* below),
`intake-review` (Project Manager, from the project's own stored record),
`task-plan-review` (Project Manager, from the project's open tasks; see
*Tasks as grounding* below) and
`competitor-comparison-review` (Market & Competitor Intelligence, from the
project's own recorded crawl and one recorded competitor's crawl) and
`evidence-pack-review` (Research & Evidence, from the records this product
holds for the project), `content-plan-review` (Content Strategist, from
the same records), `section-draft` (Writer, from one completed content
plan and the records it was written over) and `outbound-link-review`
(Authority & Backlink, from the link edges one own-site crawl recorded),
`draft-fact-check` (Research & Evidence, one saved draft version) and
`article-check-unit` (Research & Evidence, one check unit of one saved
article version; see *Article check units* below). The
three crawl reviews take one input, a crawl id, and are grounded in the same
recorded crawl; the two Search Console reviews take one input, a range id, and
are grounded in the project's own Search Console report; the priority review
takes one input, a run id, and is grounded in that run's stored output (see
*Agent hand-off* below); the intake review takes no input at all and is
grounded in the run's own project record (see *Project intake review* below);
the competitor comparison takes one input, a competitor's bare hostname, and
is grounded in two crawls the server finds (see *Competitor comparison
review* below); the evidence pack takes no input and is grounded in the
project's newest own-site crawl, its default Search Console window and the
competitor crawls on record (see *Evidence pack* below); the content plan
takes no input and reads the same records through the same reader (see
*Content plan* below); the section draft takes two inputs, a plan run id
and an operator-chosen section index, and is grounded in that plan quoted as a proposal beside the records re-read
(see *Section draft* below); the outbound link review takes one input, a
crawl id, and is grounded in that crawl's stored link edges (see *Outbound
link review* below).
Input is parsed strictly per task type, bounded, and screened for credentials;
unknown fields are refused. Adding a task type needs no migration: the run
table checks the id's format, not a list.

Lifecycle, enforced in Postgres:

```
queued → running → completed
             ├──→ failed → queued   (manual or automatic retry, while attempts remain; 3 by default)
             └──→ cancelled
queued → cancelled
```

### Second grounded tasks (checkpoint 6.5)

Six agents gain a second grounded task, each over an evidence kind that
already exists, with one block appended for its question
(`src/lib/agent-runs/task-grounding.ts`); instructions in
`src/lib/agent-runs/second-tasks.ts`, in the 2.3d structural shape with the
4.6 extra-paragraph sentence and an under-1,200-character last rule (since
checkpoint 6.6c the fixed order of all nine also holds one `LIMITS` line —
under 20 words, naming what the supplied evidence does not cover — just
before the closing line),
hash-pinned. Operator-triggered through `POST /api/agent-runs`; none is a
hand-off source; no schema.

| Task | Agent | Evidence | Appended block |
|---|---|---|---|
| `keyword-opportunity-review` (range) | Keyword & Search Intent | `search-console` + the M4 inventory | the curated keywords (decision Q5), through the keyword service: status, group, target page, and the stored rows' reading of each exact query ("not observed in stored rows", never zero); archived left out, credential-like text withheld (`src/lib/keywords/grounding.ts`) |
| `content-refresh-review` (crawl id) | Content Strategist | `crawl` | the latest stored query × page window listed by page, each page marked fetched or not by the crawl (`src/lib/search-console/query-pages/page-pairs.ts`, read by `readLatestPagePairs`) |
| `article-revision-draft` (the check's four unit inputs; policy `draft`) | Writer | `article-unit` | replaces the check block: the unit, its recorded needs-review check (partial, unsupported, unverifiable items with the check's notes) and the evidence pack; refused `unit-not-checked` / `unit-not-needs-review` before any provider call (`src/lib/content/articles/revision-grounding.ts`); writes nothing to the article |
| `page-query-alignment-review` (crawl id) | On-Page SEO | `crawl` | the same page pairs block |
| `finding-history-review` (crawl id) | Technical SEO | `crawl` + the computed findings | the derived finding history (3.3) through the crawl service (`src/lib/crawl/findings/history-grounding.ts`) |
| `learning-review` (range) | Analytics & Learning | `search-console` (analytics audience, with the P4d history) | the agent's own earlier `performance-review` readings (the Learnings tab's rule), at most three, quoted as a model's reading (`src/lib/analytics/learnings-grounding.ts`) |

A missing reader, an empty store or a failed read is stated in its block
and never fails the run; the first tasks' grounding is unchanged.

Since checkpoint 6.6b each agent page's *Queue a review* control queues any
of the agent's grounded tasks through the same `POST /api/agent-runs`, with
the record its evidence needs chosen on the page
(`src/lib/agent-runs/queue-control.ts`); it never executes a run.

Checkpoint 6.6 (the scoped-down V1, decision Q4 option B) adds three more,
in the same shape:

| Task | Agent | Evidence | Appended block |
|---|---|---|---|
| `competitor-page-gap-review` (competitor domain) | Market & Competitor Intelligence | `competitor-comparison` | none: instructions only (declarations the competitor's fetched pages make that the project's do not) |
| `schema-entity-review` (crawl id) | AI Visibility | `crawl` | none: the crawl evidence alone (declared JSON-LD types, parse failures, title and h1) |
| `internal-link-review` (crawl id) | Authority & Backlink | `crawl-links` | *Internal link structure*, from the same edges read once: each fetched page's inbound internal edges from the other fetched pages, source paths and anchors, fewest first (`src/lib/authority/internal-link-grounding.ts`; `readLinkGrounding({ internal: true })` also reads the crawl's pages, bounded at 500) |

### Attempt history

`agent_run_attempts` keeps one row per attempt: number, executor, worker label,
start, last heartbeat, finish, outcome, fixed error code/message, screened
result metadata. `agent_runs` is the current state. The API returns attempts
without the lease token or worker label.

### Leases, heartbeats, recovery

A claim starts an attempt and returns a lease token (60 s, database clock). The
worker renews it every 15 s. A result is accepted only from the current
attempt's live lease; a cancelled, recovered, or lapsed lease is refused and the
worker stops without writing. An attempt whose lease expired — crash, timeout,
killed request — is failed with `lease-expired` by recovery. Recovery is
idempotent and never completes a run.

### Worker and scheduler

`src/lib/agent-runs/worker.ts` is the execution boundary: claim, heartbeat,
execute with timeout, record, recover, schedule retries, and run a bounded batch.
It has no HTTP or auth of its own. Three callers use it:

| Caller | Route | Auth |
|---|---|---|
| Operator executes a run | `POST /api/agent-runs/<id>` `{action:"execute"}` | operator session, same-origin |
| Operator manual trigger | `POST /api/agent-runs/worker` `{action:"recover-stale"\|"run-next"}` | operator session, same-origin |
| Scheduler | `GET\|POST /api/worker/recover`, `GET\|POST /api/worker/process` | `Authorization: Bearer $CRON_SECRET` only |
| Diagnostics | `GET /api/worker/status` | worker credential or operator session |

Execution happens inside the invoking request; nothing runs detached after a
response.

#### Schedule

`vercel.json` ships a schedule that deploys on **every** Vercel plan:

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `/api/worker/recover` | `0 4 * * *` — daily, 04:00 | fails up to 25 expired attempts |
| `/api/worker/process` | `30 5 * * *` — daily, 05:30 | re-queues retryable failures, then runs up to 5 due runs within a 240 s budget, then the Search Console snapshot capture in the time left (at most 45 s; see *Search Console*) |

Vercel's limits, from its documentation (checked 2026-09-17): Hobby cron jobs
run at most **once per day**, and a more frequent expression **fails the
deployment**; Hobby timing is only accurate to the hour (04:00 may fire at any
time until 04:59, hence the 90-minute gap). Pro and Enterprise allow once per
minute. The deployment plan was not verifiable from this environment, so the
daily schedule is the default.

On a **daily** schedule, an automatic retry and the recovery of an abandoned
attempt wait until the next run. Operators are not blocked: executing a run is
immediate, and `POST /api/agent-runs/worker {"action":"recover-stale"}` recovers
on demand.

**On Pro or Enterprise**, replace the two schedules with:

```json
{ "path": "/api/worker/recover", "schedule": "*/15 * * * *" },
{ "path": "/api/worker/process", "schedule": "*/10 * * * *" }
```

Both jobs are safe to call repeatedly and concurrently: claims use row locks
(`for update skip locked` for the queue), so overlapping invocations never run
the same attempt. With no work, both answer 200 with empty lists. The
scheduled-job limit (60 per hour per job) leaves room for either schedule.

#### Function duration

The worker routes and `POST /api/agent-runs/<id>` set `maxDuration = 300`. With
Fluid compute — on by default for new projects — 300 s is the **maximum on
Hobby** and the default on Pro and Enterprise (maximum 800 s), so it deploys on
every plan. Keep Fluid compute enabled: without it Hobby functions are limited
to 60 s.

The queue job stops **claiming** once another attempt could overrun its 240 s
budget: it claims only while elapsed time plus one attempt's timeout (30 s mock,
120 s AI) fits, so the last attempt starts by 120 s and ends by 240 s, leaving
60 s under the limit to record the result and respond. If a function is
terminated anyway, its attempt keeps its lease only until the lease expires,
and recovery fails it with `lease-expired`.

### Retry policy

Retried automatically, while attempts remain, with backoff of 2, 4, 8 … minutes
(max 30), by the queue job:

| Retryable | Terminal (never retried automatically) |
|---|---|
| `timeout` | `rejected-output` — output too large or credential-like |
| `execution-failed` | `project-missing` |
| `lease-expired` | `provider-rejected` — provider refused, truncated, or invalid request |
| `provider-unavailable` — network, 429, 5xx, overload | `provider-not-configured` |
| | `policy-blocked` |

Invalid requests (unknown project, agent, or task; malformed or credential-like
input) are refused before a run exists. Cancelled runs are never retried. The
list lives in both `agent_run_schedule_retries` (SQL) and
`src/lib/agent-runs/retry-policy.ts`; change them together.

### What one run can cost

Read this before setting `NEXRA_AGENT_EXECUTOR=ai`. Everything below is the
behaviour of the code as it stands, not a plan.

**Application retries.** A run gets `max_attempts` attempts including the
first — `DEFAULT_MAX_ATTEMPTS = 3` (`lifecycle.ts`). `willRetryAutomatically`
additionally requires `autoRetryCount < max_attempts - 1`, so the queue job
re-queues a failing run at most twice. **Three attempts is the ceiling for one
run**, with backoff of 2, 4, 8 … minutes, capped at 30.

**Provider retries: none.** `createAnthropicProvider` constructs the SDK client
with `maxRetries: 0` (`providers/anthropic.ts`). The SDK's own default is 2,
which would silently triple the calls an attempt makes; it is overridden so
that retrying is the runtime's job, where each attempt is recorded and backed
off. A single attempt therefore makes **at most one** request to the provider.

**Failures that can lead to another paid call.** Each of these fails an attempt
with a retryable code, so the run may be re-queued and call the provider again:

| Code | Happens |
|---|---|
| `provider-unavailable` | network failure, 408, 409, 429, 5xx — classified in `providers/anthropic.ts` |
| `timeout` | the attempt exceeded the executor timeout (120 s for `ai`) |
| `lease-expired` | the worker died mid-attempt; recovery closes it, and the attempt was already counted |
| `execution-failed` | anything the executor could not carry out, **including a refused grounding** |

The worst case for one run is therefore **three provider requests**, each
billed if it reached the model.

**Failures that cannot cost anything.** These all occur before
`provider.generate` is reached, or are terminal:

- Everything in the terminal column above. `rejected-output` is the notable
  one: the call was already made and billed, but the run will not be retried.
- A refused grounding. `ai-executor.ts` awaits `readGrounding(task)` and throws
  on `!evidence.ok` **before** `provider.generate`, so an unreviewable,
  cross-project, missing or still-running crawl costs nothing. Proven by
  `src/lib/crawl/grounding.test.ts` — *"a refused grounding stops the attempt
  instead of asking the model anyway"* and *"a failed crawl reaches no
  provider, through the real grounding reader"*, both asserting the provider
  was never called.
- `provider-not-configured`, `policy-blocked`, `project-missing`, and a task
  type or agent record that cannot be resolved.

**Grounding refusal is retryable, and that is a known imprecision.** A refusal
surfaces as `execution-failed` because the executor's error codes are fixed by
the run table's constraint and none of them means "this evidence will never be
readable". A cross-project crawl id will therefore be retried twice before
going terminal. Those retries cost nothing — the refusal precedes the model
call — but the imprecision is real, and narrowing it needs a migration.

**A hand-off is one more billed run.** The Director's `priority-review` costs
what any AI-executed run costs, on top of the upstream run it reads; its
grounding refusals (see *Agent hand-off*) happen before the provider call and
cost nothing. Nothing queues a hand-off automatically, so the number of paid
Director runs is exactly the number of times an operator clicks.

**Concurrency cannot double-spend.** `store.claim` is atomic and takes a lease:
of Run Now, the 05:30 cron, and a second tab, exactly one claims the attempt
and the rest are told the run is already running (409). `createRun` matches an
identical request to the run already queued rather than making a second one.
The per-operator in-flight sets and the Postgres-backed limiters sit on top.

**Therefore: enable the AI executor only with spend monitoring in place.** One
click is normally one billed request, but a run that keeps failing retryably
can reach three, and nothing in this codebase caps spend per day, per project,
or per operator. That control has to come from the provider account.

### Executor and provider boundary

`NEXRA_AGENT_EXECUTOR` selects the executor.

- `mock` (default): simulated output, labelled `simulated: true`.
- `ai`: `src/lib/agent-runs/ai-executor.ts` over a `ModelProvider`
  (`providers/contract.ts`). One provider exists: Anthropic
  (`providers/anthropic.ts`, official SDK, default model `claude-opus-5`, SDK
  retries off, server-side refusal fallback on). The prompt is built only from
  the agent registry, the task type's fixed instructions, the project's name and
  domain, and the validated input passed as labelled data. The model has no
  tools or live data and is told so. The answer is screened like any executor
  output; stored metadata is provider, model, token counts, and `grounded`.
  `grounded` is `true` whenever a record this product holds was actually
  loaded and put in the prompt, which is every evidence kind: `crawl`,
  `crawl-links`, `search-console`, `agent-run`, `agent-runs`, `project`,
  `competitor-comparison`, `evidence-pack`, `content-draft`, `draft-version`
  and `article-unit`; only the ungrounded `project-review` and
  `keyword-research` store `false`. Their metadata also carries an
  `evidence` object saying which record: the crawl and its page counts; the
  property, window and query count; or, for a hand-off, the upstream run, its
  agent and task, and that run's own evidence summary under
  `upstreamEvidence`. The runtime picks the reader from that declaration
  (`src/lib/agent-runs/task-grounding.ts`): the crawl tasks read one
  serialisation of the crawl (`src/lib/crawl/grounding.ts`) through one
  ownership check and one byte ceiling, the search task reads the project's
  report (`src/lib/search-console/grounding.ts`), and the hand-off reads one
  run from the run store (`src/lib/agent-runs/run-grounding.ts`). Each reader
  names its evidence to the model in its own terms, so the system prompt
  never calls a Search Console report "crawl readings", and never calls
  another agent's review a reading at all. Every other task records
  `grounded: false`. Raw provider responses are not stored. Provider failures
  map to `provider-unavailable` or `provider-rejected`; provider text is
  dropped.

The provider was verified in this repository against simulated HTTP responses
(400, 429 and 500 in `retry-cost.test.ts`, each attempted exactly once, and a
refusal as terminal; the refusal and truncation stop reasons are handled in
`providers/anthropic.ts`). The
deployment has since executed a run through the AI executor by the operator's
Run Now control, which is the live verification; this development environment
holds no provider key, so every check here still runs against fakes.

### Agent hand-off

`priority-review` is the first task whose evidence is another agent's output.
The SEO Director is given one completed run's stored summary and asked for a
ranked action queue, each item traced to a quoted upstream finding and paired
with what a person must verify before acting. It is operator-triggered, from
the hand-off control under a completed review on the crawl and Search Console
panels; nothing queues it automatically, no run records a parent, and the
`source` column still permits `operator` only.

The AI Visibility agent's `answer-readiness-review` reads the crawl with a
third question — whether each page's recorded declarations (structured data
and its types, h1, title, description, canonical, robots directive) are shaped
for an answer engine to retrieve and cite. Its instructions name what no crawl
can observe and forbid claiming it: AI crawler access rules (the robots.txt
reading is this product's own crawler's), citations, mention share,
answer-engine visibility, body text quality, entity coverage, semantic
completeness, and retrieval frequency. It is queued from the crawl panel
beside the Technical SEO and On-Page reviews, over the same crawl. Its
instructions bound the answer — at most three findings on three pages, each
under 50 words, the whole under 1,500 characters, with the unsupported items
in one fixed closing line — because the worker refuses any summary over 2,000
characters as `rejected-output`, and the first live run of this task was
refused that way when its earlier, open-ended instructions produced more.

The Analytics & Learning agent's `performance-review` is a hand-off source
because it is the stage that closes the loop: a measurement of one window,
handed back to the Director to weigh. It is queued from the Search Console
panel beside the Keyword & Search Intent review, over the same report.

What may be handed off is decided at execution time, by the reader, against
the persisted run — the panel refuses for the same reasons, but the panel is
not the gate. In order, and each before anything is formatted or any provider
is reached:

| Refusal | When |
|---|---|
| `source-run-not-found` | no run with that id |
| `source-run-not-in-project` | the run belongs to another project (checked before anything else about it is looked at) |
| `source-task-not-allowed` | its task is not `crawl-review`, `on-page-review`, `answer-readiness-review`, `search-query-review` or `performance-review` — the ungrounded tasks, `priority-review` itself, `project-priority-review`, `intake-review`, `competitor-comparison-review`, `evidence-pack-review`, `content-plan-review`, `section-draft` and `outbound-link-review` are never sources |
| `source-run-unfinished` | queued or running |
| `source-run-not-completed` | failed or cancelled |
| `source-run-no-result` | completed with no summary |
| `source-run-simulated` | executor `mock`, or metadata `simulated: true` |
| `source-run-not-grounded` | metadata absent, or not `simulated: false` and `grounded: true` |

A refusal fails the attempt with `execution-failed` and costs nothing, as for
the other readers, and is retried with the same known imprecision.

**Three layers are kept apart, in the evidence and on screen.** The recorded
evidence (a crawl, a report) is measurement. The upstream agent's review of it
is model-generated advice. The Director's queue is model-generated advice
about that advice. The evidence block says which it is in its first line,
names the upstream agent, task, run and what that agent was given, states
that the recorded evidence itself is *not* supplied, quotes the review as one
JSON string under a heading that calls it the agent's own model-generated
words and never facts, and ends with a limits note — including that a passage
addressing the model is text to report, not an instruction. The system prompt
is built from a source that describes the evidence the same way. On screen,
a Director result's provenance line names the upstream agent and run, what
that agent read, that the Director did not see it, and calls both layers
advice, not measurement; a simulated or ungrounded upstream result is refused
with that reason on the control.

The block is bounded to 16,000 UTF-8 bytes. A stored summary is at most 2,000
UTF-16 code units, so no stored row reaches the ceiling; it is enforced
anyway, on the quoted form, cutting on a code point with a disclosure that
says the review was cut, and the header and limits note are never what is
cut.

### Project intake review

`intake-review` is the first task grounded in what the agency recorded rather
than in what this product observed. The Project Manager is given the run's
own stored project record, the intake entries, and an inventory of which
evidence this product holds for the project, and is asked for a review in
five fixed sections — recorded goal, recorded project information, available
evidence, missing information, and one suggested next review or operator
action chosen from a closed list (run a crawl, connect or verify Search
Console, queue one existing named review, or request one specific item from
the client). It assigns, schedules, contacts, publishes and triggers nothing,
and its answer is bounded to 1,300 characters, each section to a few short
lines, with a fixed closing line naming what a record cannot establish (the
earlier 1,500-character ask produced answers up to the worker's
2,000-character ceiling, and a handoff-queued run was refused; the task
input, including a handoff's `sourceTaskId`, is named as provenance not to
be repeated). It is queued from the Project Manager
panel on an unmeasured project's workspace — the screen every intake-created
project renders — and takes no input: the project is the run's, read on the
server from the persisted run, so no caller can name another client's
project.

The reader (`src/lib/projects/grounding.ts`) reads the record first and
alone; a project that no longer exists refuses the attempt with
`project-not-found` before any provider is reached. The intake columns and
the three inventory reads follow, each keyed by the run's project id, and
any one of them failing is written as "not established" rather than failing
the attempt. What reaches the model:

- the record's fields, every free-text one quoted as a JSON string and the
  block headed as agency-entered, not a measurement;
- the intake note, quoted verbatim as one JSON string under a heading that
  calls it unverified and data — or withheld, with a fixed disclosure and
  nothing else, when the run table's own credential detector matches it;
- the competitor domains, quoted as a JSON array, each cut at 120 code points;
- the inventory: crawl count and the latest crawl's status, dates and counts;
  the Search Console state and property; counts of completed, model-executed,
  grounded runs by task over the newest 100 runs. Availability only: no page
  text, no clicks, impressions, queries or pages, and no review text.

The intake columns (`competitor_domains`, `intake_notes`) are read through a
repository method of their own, apart from the record read every screen
makes, so nothing else receives them. The block is bounded to 12,000 UTF-8
bytes; the note is the one variable cost and is cut on a code point with a
disclosure, and the record, inventory and limits note are never what is cut.
The stored evidence summary carries counts, states and flags only. A
completed intake review is never a hand-off source: the record is the
agency's own entries, not a finding about the site for the Director to rank,
and both the reader and the panel refuse it as `source-task-not-allowed`.

### Competitor comparison review

`competitor-comparison-review` is the first task that reads a competitor
crawl. The Market & Competitor Intelligence agent is given two crawls this
product recorded — the newest of the project's own site and the newest of one
competitor the project's stored record lists — and is asked for a comparison
in five fixed sections: PROJECT SITE OBSERVATIONS, COMPETITOR SITE
OBSERVATIONS, DIFFERENCES OBSERVED, INFERENCES (at most three, each opening
with the word `INFERENCE:`), and RECOMMENDED NEXT OPERATOR ACTION (one change
to the project's own site for a person to consider, or one thing to check).
The instructions name what neither crawl can establish and must not be
claimed for either site — traffic, rankings, keyword positions, backlinks,
authority, revenue, conversions, share of voice, market share, citation
share, AI visibility, brand strength, page body quality, content depth — open
DIFFERENCES OBSERVED with a fixed line saying both sides are partial samples
and a difference is between the samples, and end on a fixed closing sentence.
It fetches, publishes, assigns and changes nothing.

Every section is bounded, because the worker refuses any summary over 2,000
characters as `rejected-output` and the first live run of this task was
refused that way: at most three pages per side, one line each under 8 words,
cited by URL path only (the section heading names the host); at most three
findings under 14 words; at most three inferences under 10 words; one action
under 15 words; the whole under 1,500 characters, with observation lines
dropped first if it runs long and the headings, the partial-samples line and
the closing sentence never dropped. An answer at every bound stays under
1,500 characters with ordinary words and under the ceiling with long ones.
The screen, the ceiling and the credential patterns are unchanged; only this
task's instructions were bounded, as the answer-readiness review's were.

The input is one field, `competitorDomain`, parsed at queue time as a bare
hostname by the crawler's own rule (a URL, path, port, address, bare word or
over-long name is refused before anything is stored; unknown fields are
refused). Which crawls are compared is decided on the server at execution
time by the reader (`src/lib/crawl/comparison-grounding.ts`), in order: the
run's own project record (`project-not-found`); the domain against that
record's stored competitor list, by the same rule that authorises a
competitor crawl (`competitor-invalid`, `competitor-not-recorded`,
`competitor-is-project-site`, `no-domain`); the project's newest own-site
crawl, listed by the project's exact host (`project-crawl-missing`,
`project-crawl-unfinished` for a running crawl, `project-crawl-not-reviewable`
for a failed or cancelled one); then the competitor's newest crawl, listed by
the competitor's exact host, with the same three refusals for its side.
`partial` is a real result on either side. The newest crawl of each side is
the one the panels show, and if it is not reviewable the task is refused
rather than falling back to an older one. Each crawl is then read back with
its pages and checked again — same project, expected host, still reviewable —
before it is formatted (`crawl-not-readable` otherwise). No caller names a
crawl id, and no refusal carries a line of either site's text.

Each side is the block the three crawl reviews read, produced by the same
formatter under a per-side limit of 25 described pages and 60,000 UTF-8
bytes, with its own omission notice and limits note; the pair is wrapped in
a header naming which host is the project's and which the competitor's,
delimited `PROJECT SITE EVIDENCE` / `COMPETITOR SITE EVIDENCE` blocks, and a
comparison limits note saying that a difference between two small samples is
not a difference between the sites and that the competitor side is what a
rival's public pages declared to this crawler, not the competitor's
performance. The stored evidence summary carries `source:
"competitor-comparison"`, the project host, crawl id, status, pages fetched
and pages included for each side, truncation flags and the byte size — never
page text. The evidence is named to the model as "competitor comparison
evidence", distinct from the single-crawl wording.

The control is on the unmeasured project workspace, under each recorded
competitor in the competitor crawl panel: the shared queue-then-Run Now
control, keyed by the competitor's host, disabled with a reason while either
side's newest crawl is unknown, missing, running, failed or cancelled, and
restored after a page load from the Market & Competitor Intelligence agent's
newest run whose input names that host. Nothing queues it automatically. A
completed comparison is not a hand-off source: the Director's reader and the
panel refuse it as `source-task-not-allowed`, and offering it would need one
`UPSTREAM_TASK_TYPES` entry plus a matching upstream-evidence description.

### Evidence pack

`evidence-pack-review` is the Research & Evidence agent's first task, and
the first grounded in more than one kind of record at once. It takes no
input at all: the project is the run's, and the reader
(`src/lib/research/evidence-pack.ts`) finds every record on the server from
it. The agent is given the records this product holds for the project and
is asked to say what they establish and cannot establish, in six fixed
sections — RECORDED PAGE EVIDENCE, RECORDED SEARCH EVIDENCE, COMPETITOR
EVIDENCE ON RECORD, CLAIMS THIS EVIDENCE SUPPORTS, CLAIMS THIS EVIDENCE
CANNOT SUPPORT, and RECOMMENDED NEXT EVIDENCE TO COLLECT — with every
supporting claim ending in a tag naming the record it rests on (`[crawl
/path]` or `[search console <window>]`), the next evidence chosen from a
closed list, and a fixed closing sentence saying no external source was
consulted. It consults nothing outside the product, because nothing outside
the product exists in the task, and the block says so beside the data as
well as in the instructions: this agent's registry brief speaks of primary
sources and dated citations, and a model checking its work against that
brief must not be able to satisfy it by naming a study that does not exist.

The reader, in order: the project record (`project-not-found`; `no-domain`
where the stored domain is not a hostname); the newest own-site crawl by the
project's exact host (`project-crawl-missing`, `project-crawl-unfinished`,
`project-crawl-not-reviewable`; partial accepted and labelled a sample),
read back with its pages and checked again for project, host role and state
(`crawl-not-readable`), and formatted by the crawl reader's own formatter
under the comparison's per-side bound of 25 pages and 60,000 bytes. Those
refusals are decided before anything is formatted. The Search Console
report for the default 30-day window follows: a connected report with
queries is formatted exactly as the Search Console reviews see it; every
other state — not connected, no data, access denied, unavailable, no top
queries, or a provider that threw — is written as `SEARCH CONSOLE: not
established — <state>` and never fails the task or becomes a figure. Then,
for each competitor the stored record lists (reduced to hosts by the crawl
panels' rule), one availability line: host, newest crawl status and pages
fetched, or "no crawl recorded", or not established where the listing could
not be read. No competitor page, title or declaration is included. The
intake note is not read for the block, and no earlier agent run is read.

The block is headed as records held by this product, with the crawl under
`=== RECORDED PAGE EVIDENCE: <host> (crawl <id>) ===`, the report under
`=== RECORDED SEARCH EVIDENCE ===`, the competitor lines under `COMPETITOR
CRAWLS ON RECORD (availability only)`, and an EVIDENCE PACK LIMITS note
stating that no external source was consulted, that the crawl is a bounded
sample, that Search Console top rows are not the whole demand, that the
competitor lines are availability only, that earlier reviews and intake
notes are not evidence, and what the pack cannot establish. The stored
evidence summary carries `source: "evidence-pack"`, the project host, the
crawl id, status, pages fetched and included and a truncation flag, the
Search Console disposition with property and window where Google gave
them, the competitor domain and crawl counts, and the byte size — never page
text, a query, or a note. The evidence is named to the model as "evidence
pack records".

Every section is bounded (at most four page lines under 8 words cited by
path, two search lines under 12 words, one competitor line under 10 words,
three tagged claims under 12 words, two unsupportable claims under 14 words
naming what would establish them, one next-evidence line under 12 words;
the whole under 1,500 characters with a cut order), because the worker
refuses any summary over 2,000 characters. An answer at every bound stays
under 1,500 characters with ordinary words and under the ceiling with long
ones. The control is on the unmeasured project workspace, beneath the crawl
panel: the shared queue-then-Run Now control, keyed by the project, offered
only while the newest own-site crawl is reviewable, and restored after a
page load from the Research & Evidence agent's newest run. Search Console
and competitor crawls never block it. Nothing queues it automatically. A
completed pack is not a hand-off source: it holds records and
supportability, not actions to rank, and both the Director's reader and the
panel refuse it as `source-task-not-allowed`. Its provenance line calls it
advice organising recorded evidence, not a new measurement.

### Content plan

`content-plan-review` is the Content Strategist's first task and the second
task to read the evidence pack block. It declares the same evidence kind the
pack declares, so the runtime hands it the same records through the same
reader, unchanged — the newest own-site crawl, the default Search Console
window where connected, which competitor crawls exist — exactly as three
agents read one crawl. It takes no input. It does not consume the
completed pack: the plan and the pack are two readings of one set of
records, and the pack's supported-claims list stays the authority a draft
will cite, which the plan says in a fixed line. Nothing else reaches it: no
intake note, no earlier agent's output, no competitor page, no fixture
brief, cluster, source, volume, difficulty, coverage or citation score.

The agent plans exactly one page in seven fixed sections — PAGE AND GOAL
(one crawled path or "new page"), INTENT AND QUERY (an `INFERENCE:` tied to
a recorded query with its `[search console <window>]` tag, or "not
established"), TITLE AND H1 DIRECTION (recorded facts tagged, anything else
marked `INFERENCE:`), OUTLINE (at most four sections, each ending `[crawl
/path]`, `[search console <window>]` or `[needs evidence]`), INTERNAL LINKS
AND SCHEMA (crawled paths and recorded JSON-LD types only, tagged), CLAIMS
NOT PERMITTED (with the fixed line "Factual claims in the draft come only
from the Research & Evidence pack's supported list."), and NEXT OPERATOR
ACTION from a closed list — ending on a fixed sentence that the plan is a
proposal naming no volume, difficulty, ranking, traffic, backlink,
authority, conversion or market figure. The instructions forbid every
invented figure, page, audience fact, source and cause, and ask for none of
the clusters, topical maps or link graphs this agent's registry brief
speaks of. Every section is bounded, with a cut order, so an answer at
every bound stays under 1,500 characters with ordinary words and under the
worker's ceiling with long ones.

Provenance is the pack reader's, unchanged; the run's own task type tells
Run History which reading was made, so a plan is described as "a proposed
content plan over that evidence, not a measurement" and a pack keeps its
own wording. The control is on the unmeasured project workspace beneath the
Evidence pack panel: the shared queue-then-Run Now control, keyed by the
project, gated on the newest own-site crawl exactly as the pack is, and
restored from the Content Strategist's newest run; the pack, the intake
review and the plan never pick up each other's runs. Nothing queues it
automatically and nothing chains from the pack. A completed plan is not a
hand-off source: it is strategy, not a finding to verify, and both the
Director's reader and the panel refuse it as `source-task-not-allowed`.

### Section draft

`section-draft` is the Writer's first task, the first to declare the
`draft` policy, and the second path by which one agent's output reaches
another agent's prompt. The input names one completed content plan by run
id and, as a required zero-based `sectionIndex` (0–49), the one outline
section the operator chose (Stage 5, milestone C3); nothing else. The
Writer-specific reader
(`src/lib/content/draft-grounding.ts`) reads the plan by id and checks its
project against the Writer's run before its task, state, provenance or text
is looked at (`plan-run-not-found`, `plan-run-not-in-project`); then that it
is a `content-plan-review` (`plan-task-not-allowed`, an allow-list of one
kept apart from the Director's), completed (`plan-run-unfinished`,
`plan-run-not-completed`), with a result (`plan-run-no-result`), executed by
a model and not simulated (`plan-run-simulated`), grounded
(`plan-run-not-grounded`), and carrying the evidence-pack crawl it was
written over (`plan-provenance-missing`). Then the chosen section is
resolved in the plan's own outline by `resolveSection`, with no default, no
clamping and no fallback to the first line: a missing index
(`section-index-missing` — which is also how a run queued before sections
were chosen is answered), an invalid one (`section-index-invalid`), a plan
with no outline (`plan-outline-missing`), an index past its end
(`section-out-of-range`), a line with no record tag, including one marked
as needing evidence (`section-not-draftable`), and a line with no heading
(`section-malformed`) are all refused. Only then are the records read,
through the evidence pack reader unchanged, with its refusals propagated;
and if the newest own-site crawl is no longer the crawl the plan recorded,
the task is refused as `plan-records-changed` rather than drafted over pages
the plan never saw. Every refusal is decided before anything is formatted
and before any provider is reached.

The block is headed as content draft inputs and names the project host, the
plan run and its crawl, and the section to draft: the operator's chosen
outline line, by zero-based index, 1-based outline position and heading,
each quoted as data, with the instruction to draft that section only — no
earlier or later line and never the full article. Only a line whose tag
names a record (`[crawl /path]` or `[search console <window>]`) can be
chosen. The run's metadata keeps `section` and the 1-based `sectionIndex` a
saved draft reads, and adds `selectedSectionIndex` (zero-based),
`sectionHeading` and `sectionSelection: "operator"`. The Writer control
lists the plan's outline lines by index and heading and starts with none
chosen. The reader finds the outline by its heading's words, not its
presentation: a markdown hash or list marker before `OUTLINE`, emphasis
around it, a colon or dash after it, its letter case, and a first item
sharing its line are all tolerated, as are blank lines between items,
list markers on them, and a closing emphasis or one punctuation mark after
a tag. Nothing else is: a line qualifies only when a record tag ends it,
any other text after the tag disqualifies it, and the outline ends at the
next plan heading however that heading is decorated. The plan follows under `=== CONTENT PLAN (MODEL-GENERATED PROPOSAL
— NOT FACTUAL EVIDENCE …) ===`, quoted verbatim as one JSON string and cut
with a disclosure if it must be; then the records block verbatim under `===
RECORDED PROJECT EVIDENCE ===`; then a DRAFT LIMITS note stating that the
plan is a proposal and not a source, that a tag in the plan is a claim to
verify, that only the records establish facts, that unsupported items stay
placeholders, and that the output is an unapproved draft that publishes and
sends nothing. Intake notes, earlier Research & Evidence prose, competitor
pages and fixtures never reach it.

The Writer drafts exactly one section in five fixed sections — SECTION (the
chosen outline line), DRAFT (prose, at most 90 words, no inline tags, no
result, outcome, guarantee, audience, style or figure), CLAIMS USED (at most
five lines, each ending with the record it rests on), PLACEHOLDERS (at most
three `[NEEDS EVIDENCE: …]` lines), and STATUS ("Draft for operator review.
Not published, not approved, not final.") — and ends on a fixed sentence
that every claim is listed with its record and nothing was published or
sent. Every section is bounded, with a cut order, so an answer at every
bound stays under 1,500 characters with ordinary words and under the
worker's 2,000-character ceiling, which is unchanged, with long ones. The
stored evidence summary carries the plan run id and completion time, the
plan's crawl id and the current one, the chosen section line and its
position, the outline's tagged and needing-evidence counts, whether the
plan was cut, the records' own summary, and the byte size — never plan text
beyond that one line, and never a page.

The control is nested beneath a completed content plan wherever the shared
review control renders one: "Draft one section with Writer Agent", offered
under any completed plan and refusing, with the reader's own reason, for a
plan the Writer may not draft from; queue and Run Now stay two operator
actions; the draft is restored by project, the Writer and the plan's id, so
another plan's draft, the plan itself and the pack are never picked up.
Nothing queues it when a plan completes. A completed draft is not a
hand-off source and offers no further control; the Director's list and
refusal rules are unchanged. The `draft` policy runs without an approval
workflow because a draft changes nothing: publishing stays on the
prohibited-actions list; a draft is saved from the run into
`nexra_content_drafts` (Stage 1), edited into immutable versions (Stage 2),
fact-checked and approved per exact version (Stages 3–4) and proposed for
publication record-only (Stage 5A); publishing does not exist.

### Outbound link review

`outbound-link-review` is the Authority & Backlink agent's first task and
the first reader over `nexra_crawl_links`. The crawler records every anchor
it resolves as an edge — source URL, target URL, the `rel` attribute as
written, and whether the target is within the crawl's host — and external
edges are recorded and never fetched. That is the whole of what this
product knows about links, and it points one way: what the client's pages
link *to*, never who links to the client. No inbound backlink, referring
domain, authority figure, anchor text or link placement is recorded by
anything here, and the block says so in its own text.

The input is a crawl id and nothing else, parsed by the crawl reviews'
rule. The Authority-specific reader (`src/lib/authority/link-grounding.ts`)
reads the crawl record through the crawl reader and checks it before an
edge is read: it must exist (`crawl-not-found`), belong to the run's
project (`crawl-not-in-project`), be the project's own site rather than a
competitor's (`crawl-not-project-site`), and have finished in a reviewable
state (`crawl-unfinished`, `crawl-not-reviewable`) — the crawl reader's own
five refusals, decided before any provider is reached. Then the edges are
read through one bounded store method (`listLinks`, external edges first,
then by target and source URL, at most 5,000 rows), grouped by target host
— most edges first, then host name — with the distinct `rel` values as
written ("(none)" for an anchor with no rel), and up to three source paths
per host, each a `[crawl /path]` tag. At most 40 hosts and 60,000 bytes are
described; hosts beyond that are counted and disclosed as omitted, and an
edge read that hit its row limit is reported as a lower bound. A crawl with
no external edge is not a refusal: the block states "none recorded".

The block is headed as an outbound link record, states the crawl, its host,
the internal, external and total edge counts, a direction line ("every edge
below is FROM a crawled page of the site TO the named host"), the host list
under `=== OUTBOUND HOSTS ===`, and a LINK RECORD LIMITS note: an edge is
an outbound link and never a backlink, nothing inbound is recorded and each
such figure is not established rather than zero, a rel value is the page's
own declaration and says nothing about worth or payment, no target was
fetched, and the crawl is a bounded sample. The agent answers in six fixed
sections — LINK RECORD, OUTBOUND HOSTS (at most six tagged lines, or "none
recorded"), DECLARATIONS TO CHECK (at most three lines beginning OBSERVED or
INFERENCE), NOT ESTABLISHED (exactly: "No inbound backlink, referring
domain, authority, anchor-text or placement record exists for this project;
nothing above is a backlink."), EVIDENCE NEEDED and NEXT OPERATOR ACTION
(each from a fixed list) — and ends on a fixed sentence naming the recorded
own-site crawl as the only evidence. Every section is bounded so an answer
at every bound stays under 1,500 characters with ordinary words and under
the worker's unchanged 2,000-character ceiling with long ones. The
instructions forbid backlink counts, referring domains, authority, link
quality or toxicity, traffic, rankings, conversions, competitor backlinks,
anchor text, placement, any claim that a host links back, any prospect,
contact or outreach message. The stored evidence summary is counts and
identifiers only — source, crawl id, host scope, pages fetched, edges
recorded, internal and external edges, external hosts, hosts included,
truncated, bytes — never a host name, URL or path.

The control is the fourth beneath the project's own-site crawl: "Review
outbound links with Authority Agent", offered for the same crawls as the
three crawl reviews and refused for the same; queue and Run Now stay two
operator actions; the run is restored by project, the Authority agent and
the crawl's id. The competitor crawl panel never offers it. Nothing queues
it when a crawl finishes. A completed review is not a hand-off source and
offers no further control; the Director's list and refusal rules are
unchanged. The Backlinks & Authority screen stays fixture-only: nothing
there is read by this task, and nothing this task records reaches it.

### Action policy

Every task type declares `read-only`, `draft`, `approval-required`, or
`executable` (`src/lib/agent-runs/action-policy.ts`). Only `read-only` and
`draft` run. No approval workflow exists, so an `approval-required` task is
refused at creation with `422 {"error":"approval-required"}` and a message
saying so, and, if its policy is tightened after runs were queued, those runs
fail with `policy-blocked` before execution. Every
existing task is `read-only`. Never automated: publishing, deleting pages,
creating backlinks, outreach, destructive Search Console actions, DNS or domain
changes.

### Run history UI

Agents → Run History: project and agent filters, status, task, created /
started / finished, attempts (with automatic retries), screened summary labelled
simulated or model-generated, fixed error message, next retry time, and
expandable attempts. 25 runs per page with "Load older runs"
(`GET /api/agent-runs?…&offset=n`, offset ≤ 1,000).

### Daily caps, the health check and the abort classification (Phase 5, checkpoint 5.5)

- **Daily caps** (`src/lib/agent-runs/daily-caps.ts`): 40 a project and 100 in all per UTC day,
  counted for runs created and, separately, for attempts started, through `rate_limit_consume`
  (keys `agent-runs.daily-<kind>-<scope>:<project|all>:<YYYY-MM-DD>`, a one-day window; no schema).
  A refused creation is HTTP 429 `daily-cap` with Retry-After and queues nothing. A capped run is
  never claimed: the queue reads the due runs (`listDue`) and passes it over, a global cap stops the
  batch (`stoppedBy: "daily-cap"`, `heldByCap`), and Run Now answers 429 `daily-cap`; the run stays
  queued and runs after midnight UTC.
- **Health** (`GET /api/health`, public for GET/HEAD): 200 `{ status: "ok", time, database }` or 503
  `{ status: "degraded", time, database: "unreachable" }`; the database probe reads at most one
  project id with a 2 s timeout and discards it. No data, ids or configuration names; not cached;
  120 a minute per instance.
- **Abort classification:** a caller's abort (`APIUserAbortError`) is `unavailable`, not
  `rejected`.

## Content drafts

The first durable content-production record: one Writer section draft,
saved by an operator as draft version 1. Two tables, `nexra_content_drafts`
and `nexra_content_draft_versions` (the `nexra_` prefix for the same reason
as the crawl tables), RLS enabled with no policies, `service_role` only
(`20260922120000_create_content_drafts.sql`,
`20260922120100_grant_content_drafts_to_service_role.sql`).

The parent row records provenance and state: project, the Writer run whose
output became version 1 (unique — one run seeds at most one draft, which is
what makes "Save as draft" idempotent), the content plan run and outline
section that run drafted, `status` (`drafting` until a later milestone
stores a fact-check), `current_version`, and null pointers reserved for
later milestones: approved version, approver and time; published version
and time; remote content id and target. A guard trigger refuses any change
to a draft's provenance after creation.

The version row is the text, written once. Version 1 is `origin = writer`:
the Writer's SECTION line as the title, its DRAFT prose as the body exactly
as generated apart from surrounding whitespace, and its CLAIMS USED and
PLACEHOLDERS lines as JSON arrays ("none" becomes `[]`). The status sentence
and the closing sentence are never part of the body. A guard trigger refuses
any update to a version's identity or text; `fact_check` is the one column a
later milestone may fill, once, for the exact version it checked, and it
stays null (never "passed") until then.

Saving is one Server Action (`app/(app)/projects/draft-actions.ts`,
`saveWriterRunAsDraft`): operator confirmed with the Auth server, both
arguments treated as `unknown`, 30 saves per ten minutes per operator
counted in Postgres. The service (`src/lib/content/drafts`) re-reads the
Writer run from the runtime's own store and accepts it only when it is this
project's, the Writer's `section-draft`, completed with a result, executed
by a model and not simulated, grounded, carrying the plan and crawl it was
written over in its metadata, and parseable as the Writer's five fixed
sections; the Writer's evidence-needed answer ("SECTION none") is refused
because there is no draft in it. Nothing from the browser about the text is
used. The same run saved again returns the same draft; a concurrent save
that loses the unique key re-reads the winner; a version insert that fails
after its parent was written removes the parent again. The action calls no
provider, queues no run, crawls nothing and publishes nothing.

The control is "Save as draft", beneath a completed grounded Writer result
wherever the shared review control renders one; it is offered for nothing
else. On a page load the control reads `GET /api/content-drafts?project=…&
writerRun=…` (operators only, a read) and shows the saved draft instead of
the button, so nothing is saved twice and nothing saves on its own. The
draft panel shows the current version, the section, body and creation
time, offers the exact-version fact-check and approval controls (Stages 3–4),
and says that publishing does not exist. There is no publish or delete
control. The Content
Studio remains fixture-only: no real draft row reaches it and no fixture
reaches a draft.

### Operator editing and version history

An operator may edit a saved draft. Every save is a new version row (2, 3,
…); no existing version is ever updated, and version 1 stays the Writer's
output exactly as generated, so the model-generated original can always be
read beside whatever a person later wrote.

The write is one Postgres function,
`public.nexra_content_draft_save_version` (migration
`20260922130000_content_draft_save_version.sql`, `security definer`,
`search_path` pinned empty, executable by `service_role` only). It locks the
parent row (`select … for update`), refuses when the draft is not this
project's (`not-found`), is archived (`archived`), or its `current_version`
is not the version the operator started from (`stale`, naming the current
one), and otherwise inserts `current_version + 1` with `origin = operator`,
empty `claims` and `placeholders`, null `fact_check`, and advances the
parent's pointer in the same transaction. Two operators saving from the
same version therefore never combine: the first wins, the second is told
which version is current now and re-reads it. A parent that was
`fact-checked` or `approved` returns to `drafting`, because the checked or
approved text is no longer the current text; `approved_version`,
`approved_by`, `approved_at` and the published columns are left exactly as
they were, so the record of what was approved survives and nothing is ever
approved or published by an edit. The function was written because
PostgREST cannot make the version insert and the pointer update one
transaction from the client; the store calls it through `rpc`.

Versions are permanent. Beside the Stage 1 update guard, a delete guard
(`20260922130100_content_draft_versions_guard_delete.sql`) refuses every
DELETE and TRUNCATE on the versions table, including the cascade from a
parent delete: a draft with versions cannot be deleted by anything, only
archived. The store's Stage 1 compensation, which removes a parent whose
version 1 insert failed, deletes a parent with no versions and is
unaffected. `fact_check` remains the one writable column of a version.

### Fact-check of one version

An operator can have one exact version checked against the records this
product holds, and record the result on that version. The check is an
agent run: the Research & Evidence agent's second task, `draft-fact-check`
(`src/lib/agent-runs/task-types.ts`), read-only, evidence kind
`draft-version`, input `{ draftId, version }`. It is queued and started
through the same review control and the same agent-run routes as every
other review, nested beneath the version on the Draft panel, and offered
only for the current version of a live draft that carries no result yet.
Nothing queues it on its own, and nothing runs on page load.

The reader (`src/lib/content/drafts/fact-check-grounding.ts`) reads the
draft by project and id together, so another project's draft is not found;
then the exact version by number, never "the current one"; refuses an
archived draft and a version that already carries a result; and re-reads
the evidence pack through the same reader the Writer drafted over. The
block quotes the version's title and body as one JSON string under a
heading that names it the thing under check and never a source, beside the
records, and names the fetched paths and the Search Console window a tag
may cite. The run's metadata records the draft id, the version number, the
crawl id, the window and the fetched paths. The agent answers under six
fixed headings — SUPPORTED, PARTIAL, UNSUPPORTED, UNVERIFIABLE, EDITORIAL,
SUMMARY — one quoted sentence per line, every supported line ending with
the record it rests on, at most twelve statements checked, and is told in
fixed words that absence from the records is not falsehood and that the
check approves nothing.

Recording the result is a separate, explicit click and a Server Action
(`recordDraftFactCheck`, in the draft actions file): operator confirmed,
every argument `unknown`, 30 recordings per ten minutes per operator. The
service reads the draft by project and id, the version by number, and the
run by id; refuses a run whose own metadata names any other draft or
version (`version-mismatch`), a simulated, ungrounded, unfinished or
malformed run, and a version that already carries another run's result;
then builds the stored record deterministically
(`src/lib/content/drafts/parse-fact-check-output.ts`): every tag is
checked against the paths and window the run's evidence carried, a
supported or partial line whose tag names nothing there is moved to
unverifiable, and the overall status is derived from the groups — `failed`
when anything is unsupported, `passed` only when at least one statement is
supported and nothing is partial, unsupported or unverifiable, `needs-review`
otherwise — never read from the model's own words. The record is written
onto the version's `fact_check` in one statement conditional on the column
still being null, so a version is checked once, its text and every other
column untouched, and the update guard has nothing to refuse. The parent
moves from `drafting` to `fact-checked` in one further conditional
statement, only when the check passed and the checked version is still the
draft's current version at that moment; a version 3 saved meanwhile leaves
the parent as it is and version 2 keeps its historical result. Neither
statement approves or publishes anything, and both use grants the Stage 1
migration already gave; no migration was needed.

The panel shows every version's fact-check state: "Not fact-checked" with
the control for an unchecked current version, "Not fact-checked" and only a
note for an unchecked historical one, and for a recorded result the status,
the version checked, the run, the crawl and window, the timestamps, the
summary, the five groups with their evidence references, and a fixed
sentence that unsupported means no record holds the statement and that
nothing was approved or published.

### Approval of one exact version

An operator can approve the draft's current version, and only under an
explicit policy (`src/lib/content/drafts/approval-rules.ts`): the version
must be the current one, the draft live and in the `fact-checked` state a
passed check of that version leaves it in, and the version's recorded
fact-check must be `passed`. `needs-review` is not a pass and is refused
with its own reason; `failed` and an unchecked version are refused; there
is no override. Approval is not publication: nothing is sent anywhere, and
the published columns stay null.

The write is one Server Action (`approveDraftVersion`, in the draft actions
file): operator confirmed, every argument `unknown`, 20 approvals per ten
minutes per operator, one in flight per operator. The service reads the
draft by project and id together and the version by number, applies the
policy, and then the store issues one conditional statement — `update …
set status = 'approved', approved_version, approved_by, approved_at where
id and project_id match and current_version = <version> and status =
'fact-checked'` — so a version that stopped being current between the read
and the write matches no row and is answered `stale` from a re-read, never
approved as "the current one". The approver is the server-confirmed
operator id and the time is the server's; neither comes from the browser.
No version row is touched, no version is created, and the version's
`fact_check` stays attached, so the record answers which version was
approved, by whom, when, and what check that exact text had. A second
approval of the same version writes nothing and is answered as already
approved.

History: the Stage 2 save function leaves `approved_version`, `approved_by`
and `approved_at` untouched when a new version is saved, so an approved
version 2 stays identifiable as the approved one after version 3 exists;
the parent returns to `drafting`, and version 3 is unapproved and, being
unchecked, ineligible. No migration was needed: the columns and the
`approval_complete` check constraint exist since Stage 1, and the update
uses grants already given.

The panel shows, for the current version: "Ready for approval" with an
"Approve version N" button and a confirmation step when the policy
passes; "Not eligible for approval" with the policy's reason otherwise. An
approved version shows "Approved", the version number, the approver's
operator id and the time, in history too, with a note that a newer current
version is not approved. There is no publish control.

### Publication proposal for one exact approved version

Stage 5 begins with a proposal, not a publication. An operator can record
the intention to publish the approved current version to one registered
destination; nothing is written anywhere else, no GitHub call is made, and
no file, branch, commit, pull request or deployment is created.

Eligibility (`src/lib/content/publications/proposal-rules.ts`, shared by
the panel and the server, no override): the version is the draft's
current one; the draft is not archived or published; the version's
recorded fact-check is `passed` and was recorded for that draft and
version (`needs-review`, `failed` and unchecked are refused with their own
reasons); the version carries no `[NEEDS EVIDENCE: …]` placeholder, listed
or left in its text; the draft is `approved` and its approved version is
this version; and no proposal for the draft is active. The live Nexra
Agency version 2, checked `needs-review`, is refused.

Binding and concurrency. The service reads the draft by project and id and
the version by number, computes the content hash (SHA-256 of
`nexra-content-draft-version/1`, NUL, title, NUL, body) from the stored
row, compares it with the hash the operator was shown, and builds the
preview. The one database function (`nexra_content_publication_propose`,
migration `20260922140000`) then locks the parent draft, re-checks every
condition against the locked rows, recomputes the hash itself, copies the
approval snapshot from the locked parent, and inserts only if no proposal
is active. A draft edited or re-approved between the read and the write
is answered `stale`; two concurrent requests serialise on the lock and the
second is answered `exists` (checked with two real sessions against a
local PostgreSQL 16). The browser's approval, text, hash and identity are
never stored.

Destination (`src/lib/content/publications/destinations.ts`): a registry
of one, the Nexra Agency website (`nexraagency.com`), offered only to the
`nexra-agency` project. The site's source repository is named for a
person to read and is never contacted; no credential exists. The site's
content format has not been inspected, so the content path and format are
null and shown as unresolved: the slug (lowercase letters, digits and
single hyphens, 3–80 characters, never corrected) is the only target
identifier, validated without creating anything.

Preview (`src/lib/content/publications/preview.ts`, format
`draft-section-text/1`): one deterministic plain-text document carrying
the version's exact title and body, labelled "DRAFT SECTION — NOT A
COMPLETE PUBLISHABLE ARTICLE" and "This proposal does not publish content
or create a GitHub pull request.", with the destination, the unresolved
path, the slug, the version and row id, the content hash and the approval.
Its hash is stored; on every read the preview is rebuilt from the bound
row and checked against both stored hashes.

Writes are two Server Actions (`app/(app)/projects/publication-actions.ts`):
`preparePublicationProposal` (10 per ten minutes per operator) and
`withdrawPublicationProposal` (20 per ten minutes), operator confirmed
first, every argument `unknown`, one write in flight per operator. Reads
are `GET /api/content-publications?project=…&draft=…`, operators only.
Withdrawal is one conditional update of the proposal's status and
withdrawer; the database stamps the time. No draft, version, fact-check or
approval column changes, and a withdrawn proposal is final.

The draft panel's "Publication proposal" section always shows the
no-publication statement. For an eligible current version it offers
"Prepare publication proposal", then the destination, the slug, the exact
version and row id, the content hash, the approval and the exact text,
and a confirmation button. An active proposal shows its binding, whether it
still matches the approved current version (after an edit it is marked
stale and should be withdrawn), whether its preview verified, the exact
text, and "Withdraw proposal" with a confirmation. An ineligible version
shows the reason and no button. There is no publish, merge, deploy or
pull-request control.

### Website artifact dry-run (Stage 5, milestone B)

For an active publication proposal the panel renders, offline, exactly what
the Nexra Agency website's repository would need. Nothing is written
anywhere: no GitHub read or write happens at runtime, no credential exists,
and no branch, commit, pull request, deployment or publication is created.
The panel says so in every state.

Template contract (`src/lib/content/publications/website/template.ts`,
`nexra-ai-blog-tsx/1`): pinned to the audited commit
`a4a572296eca5944dc29a436048a6fff68c33d5d` of
`abdulrehmanvigo2-hash/nexra-ai`, default branch `main`. An article is a new
TSX route file `app/blog/<slug>/page.tsx` and one `Article` record appended
to `lib/blog.ts`; the route is `/blog/<slug>`; the blog index and sitemap
derive from the registry. The contract is kept apart from the destination
registry on purpose: Milestone A's preview document prints the content path
as "unresolved", and every stored proposal's preview hash depends on it.

Completeness (`article-contract.ts`): 15 required fields — the nine registry
fields, the lead paragraph, at least one H2 section with a body, the
canonical route, `ArticleJsonLd`, and the CTA title and body — and six
optional ones. A proposal supplies only its slug and the bound version's
title and body (one section); the canonical route is derived from the slug,
`ArticleJsonLd` is the template's component, and the table of contents is
derived from the section headings. Everything else is reported missing and
is never invented, so the current draft renders as "INCOMPLETE — NOT
PUBLISHABLE" with 11 missing required fields.

Renderer (`render.ts`, `tsx-literal.ts`): pure and deterministic. Both
artifacts are assembled line by line from fixed code following the pinned
article; content enters only as string literals (`JSON.stringify`, with `<`,
`>`, `&`, U+2028 and U+2029 escaped), never as JSX text, identifiers,
comments or code, and ids, hashes and the slug are validated before they
reach a comment or path. A missing field is rendered as an undeclared
`MISSING_REQUIRED_FIELD_<name>` identifier, so an incomplete artifact cannot
typecheck or build. Each artifact carries a SHA-256 of its bytes.

Topic overlap (`topic-overlap.ts`): a fixed phrase check against the live
articles the contract lists, with no search and no model. The current draft
matches `/blog/ai-lead-follow-up-automation`; the warning says a different
slug does not make a new page safe, and that updating the existing article,
taking a materially different angle or creating a new article is an
operator decision for a later milestone. It does not block the dry-run; the
live article's own slug is a collision and keeps it incomplete.

Eligibility (`website/service.ts`,
`GET /api/content-publications/dry-run?project=…&draft=…&proposal=…`,
operators only): only the draft's active proposal, and only while the
proposal service reports it current (same approved current version, same
approval moment) and verified (bound row, content hash and preview hash
match). Withdrawn, stale, unverified, foreign and unknown proposals are
refused. Nothing is written to the proposal or the draft.

The Server Action (`saveDraftVersion`, same file as the save action) takes
every argument as `unknown`, confirms the operator with the Auth server,
counts 60 saves per ten minutes per operator, and hands the request to the
service, which validates the ids, normalises the text (line endings folded
to LF, surrounding whitespace removed) and refuses an empty title or body
or one over the columns' bounds (400 and 20,000 characters) before reading
anything; reads the draft by project and id together, so another project's
draft is not found; refuses a stale expected version; and treats the saved
text sent again as no change, creating no version. Only then does the
store's function run, and it applies the ownership and version checks a
second time under the lock. No provider is called, no run queued, nothing
crawled, nothing published, and nothing is saved on the operator's behalf:
there is no autosave.

The panel shows the current version's number, origin ("AI-generated
original" for version 1, "Operator edit" for the rest), creation time, and
a version selector. Choosing an earlier version shows it read-only, marked
"Historical, read-only", with a way back to the current one; only the
current version of a non-archived draft has an Edit control. Editing uses
the existing title input and text area, shows "Unsaved changes" once the
text differs from the saved version, and offers Save (as the next version)
and Discard. An operator-edited version shows no claims of its own: the
panel says it is not verified, that the Writer's recorded claims apply to
version 1 only, and that its factual claims need re-verification before
any approval. `GET /api/content-drafts?project=…&draft=…` reads one draft
with its versions (newest 100), so a page refresh shows the latest version
without creating one.

### Article persistence (Stage 5, Complete Article Assembly, milestone C2)

An article is one complete page assembled from a completed content plan
run and from exact, immutable section-draft versions. Its content is the C1
contract (`src/lib/content/articles/validate.ts`) serialised canonically
(`nexra-article-content/1`) and stored once, as text, with its SHA-256.
Nothing here fact-checks, approves, proposes or publishes. (The panel's
notice now reads "Article persistence, article fact-check and approval only —
no publication occurs here.", since C4 adds the article's own check and C5
the approval.)

Tables (`20260923120000_create_articles.sql`): `nexra_articles` — project,
source plan run (unique: one article per plan, so a repeated create answers
`exists`), status (`drafting`, `checked`, `approved`, `archived`; no
published state), current version, and approval columns that a later
milestone may fill and that are never carried to a newer version;
`nexra_article_versions` — canonical text and hash, bound by a CHECK
constraint that recomputes the hash; `nexra_article_version_sources` — per
version, 1–20 exact draft versions by id, number, row id and
`nexra-content-draft-version/1` hash. An insert trigger re-checks every
source row against the stored draft text and the article's project for any
writer. Versions and sources are never updated or deleted; an article's
project, plan run, creator and creation time never change, and it is
archived, not deleted.

Writes: `nexra_article_create` (parent, version 1 and its sources) and
`nexra_article_save_version` (version N+1 and its sources, `current_version`
advanced and status set to `drafting`, under the parent's row lock; a
stale expected version is answered `stale` and an archived article
`archived`). Both re-check the project, the plan run (this project's,
completed, `content-plan-review` by the Content Strategist), the canonical
text's format and hash, and every source, and write nothing when anything
differs. service_role holds SELECT on the tables and EXECUTE on these two
functions only.

Service (`src/lib/content/articles/service.ts`): content and sources arrive
as `unknown` and are validated with the C1 contract; the canonical text and
hash are computed on the server; the plan run is read from the runtime;
every source is read back by project, draft and number and its row id and
hash compared. An edit identical to the current version, content and
sources alike, is answered `unchanged`. A stored version is shown only
after its text parses as canonical content and hashes to the stored value.
Server Actions `createArticle` and `saveArticleVersion`
(`app/(app)/projects/article-actions.ts`): operator confirmed first, every
argument `unknown`, 10 creates and 60 saves per ten minutes per operator,
one write in flight. Reads: `GET /api/content-articles?project=…`,
operators only.

Panel (`src/components/content/article-panel.tsx`), on the project
workspace below the content plan: status, current version, version
history, each version's content and source provenance, "New article"
(version 1) and "Edit as version N+1". Milestone C4 adds the article's own
fact-check beneath each version (below); the C5 approval and C6 record-only
proposal sections sit beneath it. There is no publish or delete control.

### Article check units (Stage 5, Complete Article Assembly, milestone C4)

An article version is fact-checked in bounded units, never as one prompt.
`src/lib/content/articles/checks/units.ts` reads one validated version as
blocks in a fixed order — `metadata` (topic, search intent, title, meta
title, meta description, excerpt, category, keywords), `lead-introduction`,
one `section:<id>` per H2 (its heading, paragraphs, and each H3 with its
paragraphs), `faq` when the article has FAQs, and `cta` — each block one
ordered sequence of statements: a field value, a heading, a FAQ question,
or one sentence (split at `.`, `!`, `?` or `…` followed by whitespace). The
slug, topic decision and internal links are not checked by a model; C1
validates their syntax.

Each block is cut, in order and without overlap, into parts of at most 10
statements and 6,000 bytes of unit text (context included). Paragraphs,
H3 blocks (heading with first paragraph) and FAQ question-answer pairs stay
whole when they fit; otherwise they split only between sentences, and a
heading or question that must be split from its text opens a fresh part. A
unit is one part: key `<block>:<part>` (for example `section:<id>:2`), index
its position across the article, with its part count and the version's
unit count. Its text is canonical `nexra-article-check-unit/1` JSON —
format, kind, block, key, part, part count, `context` and `statements`
numbered S1 … Sn — and its hash is SHA-256 over that text (server-only). A
heading is a statement exactly once; a later part of its block carries it
as `context`, for orientation only, never checked. A version with one
statement too large for a unit (`statement-too-large`) or more than 150
units (`too-many-units`) is refused whole; nothing is ever cut.

Task `article-check-unit` (Research & Evidence, read-only, evidence
`article-unit`): input `{articleId, articleVersion, articleVersionId,
unitIndex}`, all required, `unitIndex` 0–149, no text, hash or count. The
reader (`checks/grounding.ts`) re-reads the article by project and id
(archived refused), the version by number (its row id must match),
verifies the stored text against its hash, regenerates the plan, refuses a
refused version or an index with no unit (no fallback), refuses a unit
already carrying a final result or a stored row with other counts or hash,
then re-reads the evidence pack — all before any provider call. The run's
evidence records the unit's key, hash, index, part, part count and the
unit count. The prompt (`src/lib/content/article-check-prompt.ts`) quotes
the unit as the thing under check, never evidence, tells the model to
check only the numbered statements and to open every line's quotation with
its number (`"S3: …"`), and uses the draft fact-check's six headings and
closing sentence, so the draft check's parser reads it unchanged.

Result (`checks/result.ts`): every answer line is sorted by its own
opening words into a numbered classification (`"S1: …"` … `"Sn: …"`,
under any heading), an observation (an unnumbered EDITORIAL line opening
`Observation:`, at most 3), or an invalid line (anything else). Numbered
statements are counted apart from observations: `classifiedCount` counts
classifications only and never exceeds the statement count, and
observations are kept in a separate `observations` list, never counted,
never evidence, and never contributing to coverage. Coverage is exact:
each of S1 … Sn must be classified exactly once, with no invalid line. An
answer that misses, repeats or contradicts a statement, uses an
out-of-range or malformed number, or carries unexplained unnumbered text is
no verdict: the unit is recorded `failed` with reason `coverage-incomplete`
(its missing and repeated numbers and the first invalid lines are kept),
and a new run may check it again. Nothing is dropped to make coverage
pass. Tags are verified against the run's own evidence (a supported or
partial line naming nothing there is moved to unverifiable). A covered
unit is `passed` only with nothing partial, unsupported or unverifiable;
editorial statements never count against it. Otherwise `needs-review`.
`passed` and `needs-review` remain final for their article version; only
`failed` (an execution failure or `coverage-incomplete`) is re-checked.
Results stored before observations were kept apart have no `observations`
field and are read and shown exactly as recorded — none is rewritten or
reclassified. A simulated or ungrounded run records nothing. The version's
state is derived from its unit rows, never stored.

Table (`20260923180000_create_article_check_units.sql`):
`nexra_article_check_units` — per article version and unit: index, kind,
key, part, part count, unit count, unit hash, status (`pending`, `passed`,
`needs-review`, `failed`), the structured result, the run, and the
recording operator. No article text. An insert trigger requires the
version to be the article's version with that number, the key's block to
be one the stored content has (`nexra_article_check_blocks`) with its kind,
and the counts to agree with the version's other rows (one unit count) and
the block's other rows (one part count). Rows move only forward (pending →
final with the same run; failed → a new run); passed and needs-review are
final; identity and counts never change; nothing is deleted or carried to
a newer version. The one write is `nexra_article_check_unit_record`
(`security definer`, empty `search_path`, under the parent's row lock): it
re-checks the article, version, unit identity and counts, the run (this
project's Research & Evidence `article-check-unit` run whose input names
exactly this unit; its state must agree with the status) and, for a
completed run, that its own evidence names the same key, hash, index, part,
part count and unit count. Only for a pass of the current version does it
test completeness (`nexra_article_check_version_complete`: exactly
`unit_count` rows, all passed and naming that count; every block present
with exactly its part count of rows; every index its position in block,
then part, order) and move the article from `drafting` to `checked`. Never
to `approved`. service_role holds SELECT on the table and EXECUTE on that
function only.

Service (`checks/service.ts`), Server Action `recordArticleCheckUnit`
(`app/(app)/projects/article-check-actions.ts`: operator first, every
argument `unknown`, 120 records per ten minutes per operator, one in
flight) and `GET /api/content-article-checks?project=…&article=…&version=…`
(operators only, read-only). The panel section
(`src/components/content/article-check-section.tsx`) shows the version's
units with part numbers, status, counts and run provenance, or the reason
the version is refused; for one chosen unit it offers the shared queue/run
control and one explicit record click. It is labelled "Article fact-check
only — this does not approve or publish the article."

Live verification: after the counting fix, one operator-queued run
(`6e2e9659…`, unit 1 `lead-introduction:1` of the production article's
Version 2, `claude-opus-5`, one attempt) was recorded as `needs-review` with
both statements unverifiable; its accounting was exact (2 of 2 classified, no
unnumbered lines, coverage complete), where the earlier unit 0 result
classified 9 of 8 with one unnumbered line. The malformed-answer path
(`failed` / `coverage-incomplete`) is covered by the automated tests only.

### Article approval (Stage 5, Complete Article Assembly, milestone C5)

An operator approves the article's current, exact version — and only when
every check unit of that version passed. Approval is not publication:
nothing here proposes, renders, publishes or reaches a repository or site.

Eligibility (`approvals/eligibility.ts`, pure, shared by the panel and the
server) fails closed and reports every reason that applies, in a fixed
order: archived; not the current version; stored text that does not read
as C1 content or verify against its hash; a version the C4 plan refuses; a
stored check row matching no regenerated unit; any unit unchecked,
checking, failed or needs-review; an article not `checked`; a topic
decision other than `update-existing` or `different-angle`; and a
`[NEEDS EVIDENCE` placeholder anywhere in the stored text
(case-insensitive). There is no override. A version already approved is
reported as approved, not eligible again.

Service (`approvals/service.ts`): the browser names the project, the
article and the version number it saw — nothing else. The server reads the
article and its current version, re-verifies the text and hash,
regenerates the units and matches them to the stored rows through the C4
check service, applies the rule, and only then calls the database with its
own version row id, content hash, unit identities and unit-set digest
(`approvals/units-digest.ts`: SHA-256 over
`nexra-article-approval-units/1\n` then `<index> <key> <unit sha256>\n` per
unit in index order). A version that is no longer current is refused
`stale` before anything is sent; a repeated request returns the existing
approval without a write.

Table and gate (`20260924120000_create_article_approvals.sql`):
`nexra_article_approvals` — append-only history, one row per approved
version: article, version number, version row id, content hash, unit count,
unit-set digest, operator, time; unique per article version; an insert
trigger binds the row to the stored version and its hash; update, delete
and truncate are refused. The parent's existing `approved_version`,
`approved_by` and `approved_at` stay the current-approval pointer, and a
new constraint requires `approved` to name the current version. The one
write is `nexra_article_approve_version` (`security definer`, empty
`search_path`), one transaction under the parent's row lock — the lock the
save and check-record functions take, so approval, edit and check
recording are serialised. It refuses, in order: not in the project;
archived; stale; another version row; another content hash; then answers
`exists` for a version already approved; then refuses a parent not
`checked`; a unit list that is not exactly the stored rows (index, key,
hash, count) or whose digest differs; any unit not `passed`; a unit set
the C4 completeness rule rejects; an unapprovable topic decision; a
placeholder. Then it writes the history row and sets the parent to
`approved` with the pointer, together. Saving a new version returns the
article to `drafting` and leaves the pointer and history naming the older
version; the new version inherits nothing. service_role holds SELECT on
the table and EXECUTE on the gate only; `anon` and `authenticated` hold
nothing; RLS is enabled with no policies.

Server Action `approveArticleVersion`
(`app/(app)/projects/article-approval-actions.ts`: operator first, every
argument `unknown`, 30 approvals per ten minutes per operator, one in
flight) and `GET /api/content-article-approvals?project=…&article=…`
(operators only, read-only). The panel section
(`src/components/content/article-approval-section.tsx`) shows the current
version, its check state and unit counts, the topic decision, the
approved-version pointer, every blocking reason and the approval history;
the Approve control appears only when eligible and asks for an explicit
confirmation. It is labelled "Approval only — nothing is published."

### Article publication proposal (Stage 5, Complete Article Assembly, milestone C6)

An operator records an intention to publish the article's current, exact,
approved version to one registered destination. A proposal is record-only:
nothing here publishes, renders a deployable website artifact, writes to a
website or to any repository (including `nexra-ai`), creates a branch,
commit or pull request, deploys, or approves anything. The only states are
`proposed` and `withdrawn`; there is no published state.

Eligibility (`proposals/eligibility.ts`, pure, shared by the panel and the
server) fails closed and reports every reason that applies, in a fixed
order (`ARTICLE_PROPOSAL_BLOCKS`): an invalid request; not found; archived;
not approved; not the current version; an approval that does not name the
current version; a missing or different version row; stored text that
does not read as C1 content or verify against its hash; a missing or
different C5 approval row or pointer; an invalid slug or one that is not
the content's own; a `[NEEDS EVIDENCE` placeholder; an unregistered
destination; unreadable proposal state; an existing active proposal of
the article; the destination and slug held by another article's or a
draft's active proposal; and a live-slug collision. A live-slug collision
under the `update-existing` topic decision is not a block but a warning.

Decisions. **D1** — the slug is the approved canonical content's own
`slug`; there is no slug input. **D2** — the destination registry
(`nexra-agency-website` for `nexra-agency`) and the existing live slugs
(`ai-lead-follow-up-automation`) are pinned to the website template
`nexra-ai-blog-tsx/1` at nexra-ai commit `a4a5722`, restated in SQL
(`nexra_article_publication_destination_allowed`,
`nexra_article_publication_live_slugs`) and kept equal to
`destinations.ts` and the template by a drift test
(`article-proposal-migration.test.ts`). Newer live slugs are not
discovered; a proposal is never permission to overwrite live content. Since
checkpoint 6.12a (D10) a slug published after the pin is listed explicitly,
bound to the article it came from (`proposals/live-slugs.ts`, migration
`20261011120000`, below).
**D3** — one active proposal per destination and slug across the draft
and article proposal tables (below).

Preview (`proposals/preview.ts`, `proposals/preview-hash.ts`): a
deterministic text document, format `article-proposal-text/1` — LF line
endings, no trailing newline, the canonical text verbatim, labelled
"PROPOSAL ONLY — NOT PUBLISHED". Its SHA-256 is computed on the server
only; the browser never supplies a hash.

Service (`proposals/service.ts`) composes the C4 check store, the C5
approval store and the proposal store (`proposals/supabase/store.ts`). The
browser names only the project, the article, the version number it saw and
the destination. The server re-reads the article, version, text, hash and
approval, applies the rule, builds and hashes the preview, and only then
calls the database with its own identities. A version that is no longer
current is refused `stale`, and an ineligible one `ineligible`, before
anything is sent; while the article has an active proposal it is
ineligible (`proposal-exists`), and if an identical binding still reaches
the database it answers `exists` without a write. If the re-read after a
write fails, the action reports `failed` even though the row was written
(the C5 convention). An active proposal that no longer
names the current approved version, row, hash or approval is reported
stale; a new proposal needs it withdrawn first. Without a database
configuration every call answers `unavailable`.

Table and functions (`20260925120000_create_article_publication_proposals.sql`):
`nexra_article_publication_proposals` binds project, article, version
number and row id, content SHA-256, the C5 `approval_id` with its
`approved_by` and `approved_at`, destination, slug, preview format and
SHA-256, and `requested_by`. An insert trigger checks the binding; guard
triggers keep it fixed and refuse delete and truncate; withdrawal
(`proposed` → `withdrawn`) is final and timed by the database. Partial
unique indexes allow one active proposal per article and per destination
and slug within the table. `nexra_article_publication_propose` (`security
definer`, empty `search_path`, under the parent article's row lock) answers
`created`, `exists` or `active-exists` with the proposal, or refuses:
`not-found`, `archived`, `destination-unavailable`, `not-approved`,
`stale`, `version-not-found`, `version-mismatch`, `content-mismatch`,
`approval-mismatch`, `slug-mismatch`, `unresolved-placeholder`,
`invalid-preview`, `slug-live-collision`, `slug-taken`.
`nexra_article_publication_withdraw` answers `withdrawn`,
`already-withdrawn` or `not-found`. service_role holds SELECT on the table
and EXECUTE on those two functions only; `anon` and `authenticated` hold
nothing; RLS is enabled with no policies. The foreign key to
`nexra_article_approvals` makes a plain TRUNCATE of approvals fail (0A000).

Cross-table slug lock (`20260926120000_publication_proposals_cross_table_slug_lock.sql`,
D3 Option A): the function `nexra_publication_proposals_reserve_slug()`
(not `security definer`, empty `search_path`) runs from a BEFORE INSERT
trigger on each proposal table for rows inserted as `proposed`. It refuses
any transaction that is not READ COMMITTED (0A000, fail closed), takes
`pg_advisory_xact_lock(20260926, hashtext(destination || '/' || slug))`,
and raises unique_violation when the other table holds an active proposal
for the same destination and slug; both propose functions answer it as
`slug-taken`. A draft proposal is therefore refused while an article
proposal holds its slug. The protection requires both triggers to stay
enabled; a superuser disabling triggers bypasses it. A preflight block
refuses to apply the migration over an existing cross-table duplicate.
This migration supersedes the "known gap" text in the C6 migration's
header, which is left unedited because existing migrations are never
changed.

`GET /api/content-article-proposals?project=…&article=…[&destination=…]`
(operators only, read-only, uncached) answers `{ proposal: state }` —
eligibility with every reason and warning, the preview and its hash when
eligible, the active proposal and whether it is current, and the history —
or 401 unauthorized, 400 invalid, 404 not-found, 503 unavailable, 500
failed. Server Actions `recordArticleProposal(projectId, articleId,
articleVersion, destination, confirmation)` and
`withdrawArticleProposal(projectId, articleId, proposalId, confirmation)`
(`app/(app)/projects/article-proposal-actions.ts`) check, in order
(`proposals/requests.ts`): operator; argument types (every argument
`unknown`); the confirmation token (`record-proposal-only` /
`withdraw-proposal-only`); one write in flight and 30 per ten minutes per
operator (`articles.propose`); then the service. The panel section
(`src/components/content/article-proposal-section.tsx`, after the approval
section) shows the headline state, every blocking reason, the preview,
the active proposal and the history; Record and Withdraw appear only when
allowed and ask for explicit confirmation. It is labelled "PROPOSAL ONLY —
NOT PUBLISHED". The draft proposal section's `slug-taken` message now
names both a draft's and an article's active proposal.

### The verification proposal withdrawn (Phase 6, checkpoint 6.10a)

On 29 Sep the article publication proposal `5f229630…` was withdrawn. It was the checkpoint 5.3 verification
record for article `c89182f9…` Version 4. The withdrawal went through `nexra_article_publication_withdraw`, the
function the `withdrawArticleProposal` Server Action reaches, and the function answered `withdrawn` at
01:46:07 UTC.

- The row stays, with its status `withdrawn` and its time.
- The article, its versions, its approval `5f02d149…` and its check units are unchanged; Version 4 still hashes
  to `e9db287f…`.
- No active proposal remains.
- Nothing was ever published.

### Live slugs published after the pin (Phase 6, checkpoint 6.12a; migration `20261011120000`, applied and recorded 30 Sep)

Decision D10: once the 6.11 pull request merged, `ai-dead-lead-reactivation` is a live slug at
`nexra-agency-website`. The pinned templates (`/1` at `a4a5722`, `/2` at `1a688bd`) and their hashes are unchanged.

- **The list:** `LIVE_SLUGS_AFTER_PIN` in `src/lib/content/articles/proposals/live-slugs.ts` — one entry,
  `ai-dead-lead-reactivation`, from article `1003104c-6b25-456f-9304-eefa2ba88e7d`, source nexra-ai pull request #9,
  merge `9a69c8c09aff7df7ce3d676700114d6efe91d4f9`, published 2026-09-30. `liveSlugsFor` answers the pinned
  template's slugs, then these; `liveSlugArticle` names the owning article.
- **The rule (`liveSlugOutcome`):** a pinned slug keeps D2 (different-angle refused `slug-live-collision`,
  update-existing allowed with the warning); a slug published after the pin never refuses its owning article and
  refuses every other article, whatever its topic decision. Eligibility, the preview and the test memory database
  all use it. The owner's preview still reads "WARNINGS None.", so the stored preview of `ea85edb0…` (`47178c61…`)
  keeps its bytes.
- **SQL:** migration `20261011120000_live_slugs_after_pin.sql` restates the list
  (`nexra_article_publication_live_slugs`, the new `nexra_article_publication_live_slug_article`) and replaces
  `nexra_article_publication_propose` with the same rule (its body otherwise 20261010120000's word for word, tested).
  No table, row, trigger or grant changes.
- **Proposal `ea85edb0…`** stays active as the record of the published intent; the owning article gains no block (its
  eligibility still reads only `proposal-exists`, as before).
- **Not changed:** the 6.9b renderer's `slug-live` check reads the `/2` template's pinned `liveSlugs`; the draft
  path has no live-slug check (a draft naming the slug is refused `slug-taken` while `ea85edb0…` is active).
- **Tests:** `proposals/live-slugs.test.ts` (13, including the SQL drift checks) and the SQL suites `live-slugs` and
  `live-slugs-upgrade`.
- **Applied to production and recorded (30 Sep):** one hash-checked transaction (`9087f84c…`), the runbook's method,
  tested first on a disposable cluster. Verified read-only: both slugs live, the owner function names `1003104c…`,
  propose unchanged in security and its body the file's, `ea85edb0…` still active and not blocked, and every row
  count and article-table fingerprint unchanged.

### The article published (Phase 6, checkpoint 6.11, 30 Sep)

The one external write of V1, under the lean V1 decision: nexra-ai pull request #9, rendered from the stored,
approved version 6 of article `1003104c…` (approval `98195295…`, proposal `ea85edb0…`), opened from a Claude Code
session and merged by the operator.

- **Commits:** `5309f9b` (the three rendered files) and `57becf2` (`lib/blog.ts` re-rendered with published
  2026-09-30, the merge date; the page and the live article byte-identical); merge commit
  `9a69c8c09aff7df7ce3d676700114d6efe91d4f9`, whose tree equals the PR head's.
- **Files on nexra-ai `main`:** `app/blog/ai-dead-lead-reactivation/page.tsx` `7e1e1e3c…`, `lib/blog.ts`
  `d6f1c74c…`, `app/blog/ai-lead-follow-up-automation/page.tsx` `e5f173dd…`.
- **Live 30 Sep:** the operator confirmed `https://www.nexraagency.com/blog/ai-dead-lead-reactivation` in the browser
  (30 September 2026, 4 min read) and requested indexing in Search Console. The session's proxy refuses the site,
  so no live read was made from Claude Code.

### The real article checked, approved and proposed (Phase 6, checkpoint 6.10b)

On 29–30 Sep the operator took article `1003104c…` (`ai-dead-lead-reactivation`) through C2 → C4 → C5 → C6 in the
browser, with no code or schema change. Its explanatory paragraphs are attested with basis `opinion` (6.8b).

- Version 6 (`5ae7594d…`) passed all 7 check units. Versions 1–5 were superseded; their results stay bound to them.
- Approval `98195295…` (attestation ticked) and proposal `ea85edb0…`
  (`nexra-agency-website`, preview `article-proposal-text/2` `47178c61…`) are recorded. Nothing is published.
- The checker samples at the API's defaults, so identical unit text can be judged differently on two runs.
  Carrying a passed result forward by unit hash, and a v3 instruction making self-describing metadata EDITORIAL,
  are planned after V1.
- V1 publishing takes the lean route: the 6.11 pull request is opened from a Claude Code session with the
  operator's approval. The published-state table and the product's C7 publisher are deferred.

### The full article renderer (Phase 6, checkpoint 6.9b)

`src/lib/content/articles/website/` renders an approved article version (format 1 or 2) and its C5 approval into
the three files one nexra-ai pull request carries (`docs/website-renderer-6.9.md`, decisions D1–D7):
- the new `app/blog/<slug>/page.tsx`;
- `lib/blog.ts` with one record appended;
- the live article with one link in its revive section.

Its template is `nexra-ai-blog-tsx/2`, pinned at `1a688bd`, with the modified files pinned by SHA-256. Output is
deterministic and hashed. Content enters only as escaped string literals. Anything incomplete or invalid is
refused with a typed code and no partial output. A new article's keywords may not repeat the live article's.
Nothing is written anywhere; 6.11 is the write.

### Operator-attested paragraphs (Phase 6, checkpoint 6.8b; migration `20261010120000`, applied and recorded 28 Sep)

The article check can pass only what the project's records hold, so a
first-hand or opinion passage was always UNVERIFIABLE and never approvable.
An operator may now attest whole H2 or H3 body paragraphs — nothing in the
metadata, lead, introduction, FAQs or call to action — each as `experience`
("From our client work — first-hand, not independently verified") or
`opinion` ("Our view"). The design is the approved 6.1b note.

- **Contract** (`validate.ts`, `canonical.ts`): a top-level `attestations`
  list of `{locator, basis}`, the locator `<section or subsection id>/<zero-based
  paragraph>`, each naming an existing body paragraph once (`attestation-target`,
  `duplicate`, `format`). Attested paragraphs hold at most 40% of the body's
  sentences and at most half of any H2 section's, its H3s included
  (`attestation-limit`), and state no number: no digit in any script, `%`,
  currency symbol or count word except "one" and "first" (`attestation-number`).
  Canonical `nexra-article-content/2` is format 1 with the list as a final
  member, written only when the list is non-empty; an article without
  attestations serialises exactly as before, so every stored version keeps its
  bytes and hash (pinned against production Version 4 of `c89182f9…`:
  content `e9db287f…`, its four unit hashes, their digest `e4bfde00…` and the
  proposal preview `bbf3fae3…`, `src/lib/content/articles/test-support/v4-pin.json`).
- **Units** (`checks/units.ts`): an attested statement carries
  `"attested":"<basis>"`; a unit holding one is `nexra-article-check-unit/2`,
  every other unit stays format 1, byte for byte.
- **Checker** (`article-check-prompt.ts`): instructions version 2 answer in
  seven sections, ATTESTED before SUMMARY, with one added rule (`ATTESTED_RULE`):
  only a marked statement may go under ATTESTED, with its basis; a marked
  statement that says something checkable about the site is still classified
  like any other, and one stating a figure, result, name, person or
  organisation goes under UNVERIFIABLE. Every other sentence is version 1's
  word for word (tested; version 1 is kept as `…_V1`); the length rule is
  unchanged; hash-pinned. The parser takes the headings as a parameter (the
  draft path's five are unchanged) and an earlier six-heading answer still
  parses. An ATTESTED line on an unmarked statement, or with another or no
  basis, makes the answer `failed` / `coverage-incomplete`; attested lines
  never block a pass, and the verdict counts them apart (`counts.attested`,
  only on units that attest).
- **Approval** (C5, migration): the approve function counts the version's
  attestations in SQL, refuses `attestation-unconfirmed` without the
  operator's tick and `too-few-supported` when the passed units record fewer
  than three supported statements — both only when something is attested — and
  stores `attested_count` and `attested_confirmed`. The approval section shows
  the count and a tick box that Confirm waits for.
- **Proposal** (C6): an attesting version's preview is `article-proposal-text/2`
  — an *ATTESTED PARAGRAPHS* block listing each one, in article order, with its
  label prefixed — before the exact canonical text; the propose function
  requires the preview format the content implies.
- **Screens:** the article editor's *Attested paragraphs* (paragraph and
  basis), the labelled paragraph in the read view, and an Attested column and
  count on the check units, the Studio's article detail and the approval.
- **Not here:** the articles have no website renderer until C7a (6.9), which
  will render the same labelled blocks (`src/lib/content/articles/attestations.ts`);
  the older draft-path dry-run is unchanged. External sources (6.1b option (b))
  are after V1.
- **Compatibility:** format 1 works unchanged (approval reads select every
  column; the tick is sent only for an attesting version). Before the
  migration was applied, saving a version with attestations was refused by the
  database's content check.

## Crawl foundation

An operator asks for a crawl of a stored project; the engine walks that
project's own host inside fixed budgets and records what each URL returned.
Read-only with respect to the client's site: `GET` requests only, no forms
submitted, no state changed anywhere but our own tables.

**Three agent tasks read this data** — `crawl-review`, `on-page-review` and
`answer-readiness-review`, all through one serialisation with one ownership
check — and the crawl panel on
the project workspace lists the recorded pages. The Technical SEO screen shows
the latest recorded findings and their triage in its *Observed findings*
section (M3); its other tabs still render fixtures.

### Competitor site crawls

An operator may also crawl one competitor domain the agency recorded for the
project at intake (`projects.competitor_domains`). The request names the
domain (`POST /api/crawls { projectId, competitorDomain }`); the service
reads the project's stored intake list by the project id, reduces each entry
to its host, and accepts the request only when the requested bare hostname
matches one of them exactly. Refused before the allow-list and before any
outbound request, each with a fixed reason: a URL, path, port, address or
bare word (`competitor-invalid`); a domain the project never recorded, or
another project's (`competitor-not-recorded`); the project's own host, a
subdomain of it, or a parent of it (`competitor-is-project-site`). The host
must then pass `CRAWL_ALLOWED_HOSTS`, `CRAWL_ENABLED`, and every guard, budget,
robots rule, user agent and rate limit the project's own crawl runs under.
Nothing about the crawler's fetching changed; only which recorded host it may
be pointed at. Adding a competitor host to the allow-list is an operator
decision made in the deployment's environment, never in code.

The recorded list can be edited after intake. The Server Action
`updateProjectCompetitorsAction` (`src/app/(app)/projects/actions.ts`) is the
second and only other browser-to-project write beside creation: it confirms
the operator with the Auth server, treats its argument as `unknown` and
refuses any field but a project id and a list, loads the project on the
server, validates the list against the project's own stored domain
(`src/lib/projects/competitor-domains.ts` — bare hostnames only, no URL, path,
port or address, not the project's own site or a subdomain or parent of it,
no duplicates after canonicalisation, at most five), and writes
`projects.competitor_domains` and nothing else on the row through a gateway
patch that names that one column. It is rate-limited like creation (10 per
ten minutes per operator, one at a time) and answers with the list as
stored. The competitor domains panel on the unmeasured project workspace
edits a draft, labels unsaved entries as such, and hands only the saved list
to the competitor crawl panel beneath it; saving crawls nothing, queues
nothing, and never touches `CRAWL_ALLOWED_HOSTS`.

Whose site a crawl fetched is derived, not stored: a crawl's `host_scope`
either sits inside the project's own host scope or it does not
(`src/lib/crawl/competitor-target.ts`). Own-site listings ask the store for the
project's exact host and competitor listings for the competitor's exact
host (`GET /api/crawls?project=<id>&competitor=<host>`), so a competitor crawl
is never the latest own-site crawl and the crawl panel and the three crawl
reviews keep seeing the project's own crawls only. The crawl grounding reader
now also refuses `crawl-not-project-site` — a crawl the project made of
another host — for `crawl-review`, `on-page-review` and
`answer-readiness-review`, comparing the crawl's host scope with the run's own
project domain after the ownership check and before any page is described.
One agent task reads a competitor crawl: the Market & Competitor
Intelligence agent's `competitor-comparison-review` (see *Competitor
comparison review* above), which reads it beside the project's own newest
crawl and never alone. The competitor crawl panel on the unmeasured project
workspace offers the recorded domains only, one explicit crawl control per
domain, one explicit comparison control per domain beneath it, and describes
a recorded crawl as the pages a rival's site returned, never as a measurement
of the rival.

### What it observes, derives, and refuses to guess

| Observed | Derived | Never stored |
|---|---|---|
| final URL, HTTP status, redirect chain, robots meta, X-Robots-Tag header, canonical href, title, meta description, H1, H2 and H3 counts, image count and images without alt, anchor text per link, JSON-LD types, sitemap membership | crawl depth, internal link counts (within the crawl), canonical-is-self, length fields, robots.txt verdict, robots noindex/nofollow (meta and header together) | Google indexation, Core Web Vitals |

There is no column for indexation or vitals in any of the three tables. A
crawler cannot observe either — a 200 means the page answered us, not that
anyone indexed it — and Search Console remains the authority for what it
measures. A `null` anywhere in these tables means *unknown*, never false or
zero: `in_sitemap` stays null when no sitemap could be read, and a URL that a
budget left unvisited is recorded as `budget-skipped` rather than omitted, so
"we did not look" is never mistaken for "there is nothing there".

Internal link counts are within one crawl only. A bounded crawl cannot
establish that a page has no inbound links anywhere, so **orphan status is not
derived and must not be** from this data.

Both counts are derived from the recorded edges, after the walk: a page's
`internal_links_in` is the number of distinct recorded internal edges whose
target is that page, and its `internal_links_out` is the number of distinct
recorded internal edges whose source is that page — the same URL
normalisation, host classification and source-target deduplication that
`nexra_crawl_links` holds, so the sum of either count over a crawl's pages
equals the crawl's internal edge count. A raw anchor is not a link: repeated
hrefs, fragments, `mailto:` and `tel:` and `javascript:` anchors, hrefs that
do not normalise, and links to other hosts never reach either count. A page
whose robots meta, or whose `X-Robots-Tag` response header (since T5), says
`nofollow` or `none` records no edges and counts zero on the outbound side. **Crawls completed before this definition took effect
stored the raw extracted anchor count in `internal_links_out`** — duplicates,
non-URLs and external anchors included — so their page-level outbound figures
read high, while their edge table and inbound counts were always as described
here. No backfill was performed: completed crawl rows are written once and
are never rewritten, and the agent runs grounded on them are unchanged. A
fresh crawl records the corrected count.

### Lifecycle

```
operator POST /api/crawls → running → completed        (frontier drained)
                                    → partial          (page or time budget)
                                    → failed           (start URL unusable)
```

`partial` is a real result, not a failure. Execution happens inside the
operator's request; nothing runs detached and there is no schedule.

### Table naming, and the subsystem we do not touch

This database already contains a separate, live crawl subsystem that owns the
unprefixed names `crawls`, `crawl_pages`, `crawl_page_signals` and
`crawl_urls`. It holds real data, has its own triggers, and is not described
anywhere in this repository — no commit here has ever defined those tables.

Everything this product's crawl foundation creates therefore carries a
`nexra_` prefix: the three tables, and every constraint and index on them. The
prefix on constraints is not cosmetic — a UNIQUE or PRIMARY KEY constraint
creates an index, index names are unique per schema, and reusing one would
collide even where the table name did not.

No migration, query or grant in this repository names the unprefixed tables.
The Supabase client is typed by the `nexra_` keys, so reaching the other
subsystem is a compile error rather than a convention.

### The two objects both subsystems reach

Isolation runs one way only. Nothing here reaches into that subsystem, but two
objects in `public` are reachable from both, and this repository defines both:

- **`public.projects`** — the crawl tables reference it and change nothing
  about it.
- **`public.set_updated_at()`**, defined in
  `20260913120000_create_projects.sql` for `projects_set_updated_at` — the
  foreign subsystem binds that same function to two triggers of its own,
  `crawls_set_updated_at` and `crawl_pages_set_updated_at`.

The second is a dependency nobody declared, and it points the opposite way
from every other rule here: their tables depend on our function. Production
catalogue OIDs put the function at 17522 and those two triggers at 17861 and
17913, so the function existed first and their subsystem was built against it.
The migration defining it uses a bare `create function`, not `create or
replace`, so it could not have applied at all had the name already been taken.

What that costs us:

- **Never `create or replace` it to mean something new.** A replaced body
  changes what happens on every update to `crawls` and `crawl_pages`, silently
  and with nothing raised to notice.
- **Never `drop` it with `cascade`.** A plain `drop function` is safe —
  Postgres refuses it while a trigger depends on it — but `cascade` would take
  their two triggers with it and leave their `updated_at` columns stale.
- Behaviour only this product wants belongs in a **new, prefixed function**,
  never in this one.

The crawl tables here do not use it. `nexra_crawls`, `nexra_crawl_pages` and
`nexra_crawl_links` have no `updated_at` column and no triggers at all: a crawl
row records one walk, written once and closed once, so there is nothing for a
modification timestamp to say.

### Pinned connections

A check that a hostname resolves somewhere safe is worthless on its own,
because the name is resolved again when the socket opens — a hostile resolver
answers the check with a public address and the connection with a private one.
The global `fetch` offers no way to say which address a request may use, so
`src/lib/crawl/pinned-request.ts` sends through `node:http`/`node:https` with a
custom `lookup` (`pinnedLookup`). That option is handed to `net.connect`, so it
*replaces* address resolution: the socket goes to the one address the guard
approved and the system resolver is never consulted for that request.

The hostname is deliberately left alone. `host` and `servername` stay the name
from the URL, so the `Host` header, TLS SNI, and certificate hostname
verification all still work against the name — only the address lookup is
replaced. `rejectUnauthorized` keeps its default, there is no custom
`checkServerIdentity`, and `servername` is never an address. Connection pooling
is off (`agent: false`), because the default agent keys sockets by host and
port and a reused socket could outlive the pin that opened it.

The pin is re-checked against the address policy twice: once before the request
is built and once inside the lookup callback. Node's bundled `undici` would
also work through a custom dispatcher, but no builtin module exposes it, so
using it would mean taking a dependency for something the platform already
does.

### Deterministic crawl findings (T1–T5)

`src/lib/crawl/findings` applies 36 fixed rules (rule version 3; T5 added the
version-2 rules, M2 the version-3 rules) to what one
crawl recorded (`compute.ts`, `rules.ts`, `contract.ts`): titles, meta
descriptions, H1s, canonicals, 4xx/5xx, redirect chains and loops, broken
internal links (only when the target page was fetched with an error),
robots.txt, robots-meta and X-Robots-Tag noindex, sitemap conflicts, deep
pages, pages with no observed inbound link, JSON-LD, and — since T5 — an H3
on a page with no H2, images with no alt attribute, internal links with no
anchor text, and internal links with generic anchor text (a fixed list,
`GENERIC_ANCHOR_TEXTS`). A null field is unknown and yields nothing; duplicates are found
within one crawl; a finding carries a stable id, category, severity, the URLs
it names, the exact observed values and one sentence, and the report carries
coverage, true per-rule counts and fixed limitations (no site-wide totals, no
indexation, no orphan claims, no external broken links, no vitals or
rankings). The two page reviews receive a bounded block of these findings
after the crawl evidence (`findings/grounding.ts`, T2).

Since T3 the crawl service records the findings when an own-site crawl
finishes in a reviewable state, through
`nexra_crawl_findings_record` into `nexra_crawl_findings_reports` and
`nexra_crawl_findings` (migration `20260928120000`), once per crawl and rule
version; a competitor crawl, a failed crawl and a store that keeps no
findings record nothing, and a recording failure is logged and never fails
the crawl. `crawlService().getCrawlFindings(projectId, crawlId)` reads the
newest recorded report for the project's crawl: `unavailable` when the store
keeps no findings, `not-found` for a crawl that is not the project's,
`not-recorded` (with the crawl) when nothing was recorded — a crawl made
before findings were kept, still running or failed — and `recorded` with the
report. The rows are immutable and go only with their crawl.

T4 shows them. `GET /api/crawls/<id>/findings?project=<id>`
(`src/app/api/crawls/[crawlId]/findings/route.ts`) is read-only and operators
only: the operator is confirmed first, both ids are validated by shape
(`findings/request.ts`), the read is rate-limited as a crawl read, and each
service answer maps to a fixed code (503 `unavailable`, 404 `not-found`, 200
`{ status: "not-recorded", crawl }` or `{ status: "recorded", crawl, report
}`); an exception is logged by name and answered `failed`. The *Observed
findings* section inside the crawl panel (`src/components/crawl/
crawl-findings.tsx`) reads that endpoint for the crawl on screen and keeps
every state apart: loading, not stored on this deployment, a failed read
(never "no findings"), nothing recorded (worded by the crawl's own status), a
report with no findings (worded as "not a clean result", naming what was not
looked at) and a report. The presenter (`findings/present.ts`) groups by
severity then rule in recorded order, shows the true per-rule count from the
report header beside the rows on screen, says when a rule or the read was
cut, shows an absent observed value as "—", and carries a provenance note:
within this crawl, not site-wide; no indexation, ranking, traffic or vitals;
not fixture data. The section offers no control — nothing fixes, dispatches
or writes — and the Technical SEO screen still renders its modelled registry,
labelled as such; mapping one onto the other remains a separate feature.

### The Director reads the recorded findings (T6)

The SEO Director's `priority-review` still takes one input, a source run id,
checked against the Director's own project before anything is formatted.
Since T6, when the upstream review's own evidence summary names a crawl —
`crawl-review`, `on-page-review` and `answer-readiness-review` record one —
the dispatch (`src/lib/agent-runs/task-grounding.ts`, `agent-run` case) reads
the findings recorded for that crawl (T3) through
`crawlService().getCrawlFindings(projectId, crawlId)` for the Director's
project and appends them after the quoted review as a second block
(`src/lib/crawl/findings/director-grounding.ts`): the crawl, when and under
which rule version the findings were recorded, the coverage, the true count
per rule, and each finding by rule id, severity, URLs, exact observed values,
sentence and id — bounded exactly like the T2 block (at most ten per rule,
under 16,000 bytes, a cut named, the counts always complete) and ending with
the same limitations. Nothing is recomputed and the crawl itself is not
re-read. Findings that are unavailable (no store), not recorded (a crawl from
before T3, or one that never finished) or not the project's are one fixed note
each that tells the Director to rank nothing on findings; a report with no
findings says no rule fired and that this is not a clean bill of health. A
review written over a Search Console report or a performance run gets no
second block and reads nothing. The Director's evidence summary gains
`recordedFindings` (status, crawl and report ids, rule version, counts, cuts,
bytes). The instructions now ask for a BASIS on every item — OBSERVED when it
rests on a recorded finding cited by rule id and URL, PROPOSED when it rests
on the review's inference — say the recorded finding wins a disagreement, and
forbid stating or estimating any ranking, traffic, click, revenue or vitals
effect. The specialist reviews' prompts are unchanged.

### The Director's project bundle (M5; deployed; one production run completed; panel browser verified)

`project-priority-review` is the SEO Director's second task and the first
hand-off with more than one source. It takes no input at all: the project is
the run's own, and which runs are read is decided on the server at execution
time by the fixed rules in `src/lib/agent-runs/director-bundle.ts`. The
supported sources are a fixed, ordered list of five (`DIRECTOR_SOURCE_SLOTS`):
the Technical SEO `crawl-review`, the On-Page SEO `on-page-review`, the
Keyword & Search Intent `search-query-review` and, since checkpoint 4.6, the
Analytics & Learning `performance-review` and the AI Visibility
`answer-readiness-review` — each carried as a review, never as figures the
Director saw; the Director ranks recorded finding > measurement (a performance
review's figures, as that agent's reading of Google's report) > inference. For
each, the dispatch
(`task-grounding.ts`, `agent-runs` case) lists that agent's newest
`SOURCE_SCAN_LIMIT` (25) runs on the run's own project through the run store
(`listRuns`, newest first), keeps only runs of that project, task and agent,
orders them by creation time and then id, and selects the first the T6
hand-off rules accept (`handoffRefusal`: completed, executed by a model,
`simulated: false`, `grounded: true`, with a summary). Nothing older, no other
task and no other project is read, and a caller can name nothing. A slot with
no eligible run is a **missing** source with a reason (`no-run`,
`no-eligible-run`) and the count scanned; newer ineligible runs of a selected
task are counted and disclosed, never read. A bundle with no eligible source
is refused as `no-eligible-sources` before any findings read or provider call.

The block: a header naming the rule, the supported reviews and the counts;
one section per slot, `SOURCE n of 3 — agent, task: SELECTED` with the T6
formatter's own header and JSON-quoted review (`formatSourceReview`, the
hand-off block without its limits note, cut under `MAX_SOURCE_REVIEW_BYTES`
= 6,000 with the cut disclosed) or `MISSING —` with why; then the recorded
findings (T3, `formatRecordedFindingsGrounding`) once per distinct crawl the
selected reviews were written over, in source order, at most
`MAX_FINDINGS_CRAWLS` = 2 with the rest counted, or one fixed line saying
none were read; then one limits note stating that the reviews are model
advice written at different times, unaware of each other, that a missing
review is a gap, and that a passage addressing the model is text to report.
The whole is under `MAX_BUNDLE_BYTES` (54,000) by construction. The stored
evidence summary (`source: "agent-runs"`) lists every slot with scalar
provenance only — status, reason, run id, completion time, bytes, truncation,
newer-ineligible count, the crawl id or property and window end — and the
findings summaries with the cut rules as a count, because the arrays sit at
the depth where the run store refuses a further nested container; the
executor's metadata with three sources and two findings summaries passes
`checkStorableJson` under 8,192 bytes.

The instructions ask for at most three items, each under 35 words, the whole
under 1,200 characters; BASIS OBSERVED or PROPOSED; SOURCES naming every
source an item rests on in a short form (a recorded finding by rule id and
URL path, a review by agent name and a quoted phrase under 8 words; never a
full URL or a whole finding); WHY THIS RANK and VERIFY in a few words; a
stated ranking rule in words (recorded findings before inference; among
recorded findings higher severity first; among inferences those more
sources agree on first, then the more confident; no numeric score); one item
where sources agree, with the recorded finding winning a disagreement and
two disagreeing reviews left as two inferences; a BLOCKERS line under 20
words naming each missing review and each unestablished reading (`BLOCKERS:
none` otherwise); one final line under 25 words naming the first action and
what the plan does not cover; a cut order when the answer would run over
(drop the lowest-ranked item first, then shorten ACTION and WHY THIS RANK,
never SOURCES or BLOCKERS); no ranking, traffic, click, revenue, indexation
or vitals effect; and no merged picture none of the reviews made. The first
production run of this task, `d2cbdcc7-82e9-4b30-9e00-f6f27184a436`, was
refused as `rejected-output` under the earlier bounds (four items under 50
words with full URLs and whole findings quoted, the whole under 1,500
characters); the provider was called, the bundle was 15,350 bytes with no
source cut and the metadata passed the run store's check, so the answer's
length over the worker's unchanged 2,000-character ceiling is the most
supported cause. The bounds are sized so that an answer at every one of
them stays under 1,500 characters with ordinary words and under the ceiling
with long ones, checked by arithmetic in `director-bundle.test.ts` and
through the worker in `output-screen.test.ts`. The single-run `priority-review`,
its reader, block, instructions and control are unchanged, and neither
Director task is ever a hand-off source. After PR #19 (`3121ff3`) tightened
the instructions, a production run completed on 26 Sep with a stored bundle
summary. The operator verified in the browser that the *Project Director
review* panel restores that run with its bundle summary.

On screen, the *Project Director review* panel
(`src/components/projects/project-director-panel.tsx`, on the project screen
beneath the specialist controls) previews the same rule over the same listing
the Run History panel reads — one bounded `GET /api/agent-runs?project=…&agent=…&limit=25`
per supported agent, then `selectDirectorSources` — so the operator sees, per
supported review, the eligible run (id, completion time, newer ineligible
count) or that it is missing and why; the shared control (`QueuedReview`) is
offered only when at least one source is eligible (`projectDirectorRequest`)
and its request carries no input. The completed result's provenance line
(`outputProvenance`, `agent-runs`) names how many of the three reviews were
read, which runs, which are missing, and how many crawls' findings were read,
and calls both layers advice. No agent writes, page edits or publishing exist;
the plan is a proposal, and nothing queues on its own. No migration: the run
table's task-type check is a format rule.

### More of what a crawl observes (T5)

Migration `20260929120000_extend_crawl_page_signals.sql` adds nullable
columns, and nothing else: on `nexra_crawl_pages`, `x_robots_tag` (observed:
the response header as sent, collapsed, at most 200 characters),
`robots_noindex` and `robots_nofollow` (derived: the robots meta and the
header read together, true when either says the directive or `none`),
`h2_count`, `h3_count`, `image_count` and `images_without_alt` (observed;
an image with `alt=""` is decorative by the page's own statement and is not
counted); on `nexra_crawl_links`, `anchor_text` (observed: the anchor's
text, collapsed, at most 200 characters, an image link's alt standing in,
empty when it has neither). Every column is null on a row written before
the migration, on a URL that never answered, and — for the counts — on a
non-HTML response; a URL never reached can carry none of them (constraint).
The migration also lets `nexra_crawl_findings.category` be `images`. No
grant, policy, trigger or function changes; RLS stays on with no policies.
The crawler (`extract.ts`, `fetcher.ts`, `engine.ts`) records all of them
on every fetch and honours an `X-Robots-Tag: nofollow` header exactly as it
honours the meta tag: no edge recorded, nothing queued. Budgets, the address
guard, robots.txt handling, the allow-list and the user agent are unchanged.
**Deploy order:** the page and link inserts name the new columns, so the
application built from T5 must be deployed only after this migration is
applied to production; until then a crawl on that deployment would fail to
save its pages. It is applied to production and recorded (harness suites
`signals` and `signals-upgrade` cover it locally).

### Crawl content signals (M2; deployed, production verified)

Migration `20261001120000_extend_crawl_page_content_signals.sql` adds nine
nullable columns to `nexra_crawl_pages`, and nothing else: `word_count`
(observed: whitespace-separated words in the fetched HTML's visible text,
outside script, style, template, noscript, svg and the head; a count over the
markup as served, not a rendered page and not a measure of quality),
`html_lang` (the html element's `lang` as written, at most 64 characters;
empty when written empty), `hreflang_count` and `hreflang_malformed`
(`<link rel="alternate" hreflang>` elements, and how many of them carry an
empty or ill-formed value or no href; a well-formed value is a BCP 47-shaped
tag or `x-default`), `og_tag_count`, `og_title` and `og_image` (`<meta
property="og:…">` elements and the first title and image contents, bounded),
`twitter_card` (the first `twitter:card` content, at most 64 characters) and
`response_ms` (whole milliseconds this server waited on the final hop, from
sending the request to reading the body, or the headers when the body was not
read: one connection from one place at one moment, never a user's experience
and never a Core Web Vital). Every column is null on a row written before the
migration, on a URL that never answered, and, for everything but
`response_ms`, on a non-HTML response; a URL never reached can carry none of
them (constraint). The migration also lets `nexra_crawl_findings.category`
be `content`. No grant, policy, trigger or function changes; RLS stays on
with no policies. The crawler (`extract.ts`, `fetcher.ts`, `engine.ts`)
records all of them on every fetch; budgets, the address guard, robots.txt
handling, the allow-list, the user agent and every T5 reading are unchanged.
Not added, on purpose: a first H2 or H3 (the counts exist and no rule needs
the text), and nothing about indexation, Core Web Vitals, rankings, traffic
or a rendered page.

The crawl evidence block adds one line per signal beside the existing ones,
each labelled for what it is (a word count "as served, not rendered"; a
response time "of THIS SERVER'S fetch … not a user metric, not a Core Web
Vital"), with "not established (not recorded for this page)" for a page from
before M2, and its limits note says what a word count and a response time are
not. The Technical SEO, On-Page SEO and Answer-readiness reviews and the
competitor comparison read that block, so all four see the new lines; the
On-Page instructions name the new signals as counts and declarations, not
judgements of quality or depth, and bound the answer to four findings under
1,500 characters (PR #13, `6760cfc`, after the first On-Page review over the
M2 crawl was refused; two reviews have since completed under the bound, the
latest 25 Sep); the Answer-readiness instructions are unchanged (their length
is pinned by a live-incident test). Findings rule
version 3 adds four low-severity rules over the new signals, each yielding
nothing on a page recorded before M2: `html-lang-missing` (absent or empty
`lang`), `hreflang-malformed` (any malformed alternate), `social-metadata-missing`
(no og: tag and no twitter:card) and `thin-page-candidate` (a 200 page that
does not say noindex, under `THIN_PAGE_MAX_WORDS` = 150 visible words, worded
as a candidate for review, never a verdict). **Deploy order:** the page insert
names the new columns, so the application built from M2 must be deployed only
after this migration is applied to production. It is applied to production
and recorded (harness suites `content` and `content-upgrade` cover it
locally).

### Finding triage and the observed section on the Technical screen (M3; deployed; one triage decision recorded; browser verified)

M3 began with a gap audit against the original M3 goals. A deterministic
issue registry (T1, T5, M2), persisted findings per crawl (T3), the live
findings read path and panel (T4), the two page reviews grounded on the
findings (T2; they recompute the same fixed rules over the same crawl, so a
stored report would add nothing) and the Director's hand-off (T6) were
complete. Severity, category and true per-rule counts, plus the Director's
OBSERVED/PROPOSED ranking, already cover prioritisation, so no scoring system
was added. Two things were missing and are delivered here: an operator's
decision about a finding, and a live view of a stored project's findings on
the Technical SEO screen. Comparing findings across crawls (appeared,
persisted, disappeared) is left for a later milestone; the stable finding
key makes it possible, and triage is already keyed by it.

**Triage.** `nexra_crawl_finding_triage` (migration `20261002120000`) keeps
one row per project and finding key — `open`, `acknowledged`, `resolved` or
`ignored`, an optional note of at most 500 characters, who set it and when,
and the exact finding, report and crawl the decision was last made on. It is
a decision about an observation, kept in its own table: the findings tables
gain no column, no grant and no trigger, and their guards still refuse every
update. Keyed by project and finding key, a decision made on one crawl's
finding applies when a later crawl records the same finding again (the
section says "decided … on an earlier crawl's finding with the same key"),
and setting it again on the later crawl moves the binding forward. The one
write is `nexra_crawl_finding_triage_set(project, crawl, key, status, note,
operator)` (`security definer`, empty `search_path`, a transaction advisory
lock per project and key): `set` with the previous status, `not-found` for
a crawl that is not stored or not the project's, `not-recorded` for a key
not recorded for that crawl; a status outside the four or a note over the
limit raises and writes nothing. Insert and update triggers check the row
names its own project's finding with that key and rule; the row's identity
never changes; a decision is never re-dated earlier; a direct delete or
truncate is refused, and a row goes only with the finding it was set on.
`service_role` gets SELECT and EXECUTE on the function only; RLS is on with
no policies. Nothing resolves automatically, expires, dispatches an agent or
changes a page. Harness suites `triage` (84 assertions) and `triage-races`
(two operators on one key wait and the later decision wins; a rolled-back
first decision leaves the second; different keys do not wait).

**Server.** `src/lib/crawl/findings/triage/` holds the contract (statuses,
note normalisation, request parsing), the store contract, the Supabase store,
the presenter and the request helpers. The crawl service gains
`getLatestCrawlFindings(projectId)` — the most recently recorded report
across the project's own crawls (the findings store's
`getLatestReportHeader`), re-checked against the crawl's project, with the
report and every decision recorded for the project; `unavailable` when no
findings are kept, `none` when nothing was ever recorded — and
`setFindingTriage`, which checks the crawl is the project's before the
database does. `GET /api/crawls/latest-findings?project=<id>` (operators only,
crawl-read rate limit, the project must be stored) answers `none` or
`recorded` with the crawl, the report and the decisions. `POST
/api/crawls/<id>/findings/triage` (same-origin, operators only, a bounded
JSON body of exactly `project`, `findingKey`, `status` and optional `note`,
its own 60-per-ten-minutes limit) answers `set`, 404 `not-found` or
`not-recorded`, 503 `unavailable`. Logs carry ids, the outcome and the
statuses; never the note.

**Screen.** The Technical SEO page reads the stored roster from the Projects
repository and mounts *Observed findings* (`src/components/technical/
observed-findings.tsx`) once, above the modelled views. The section has its
own stored-project selector (the modelled filters range over the fixture
roster, and the two are never mixed), the *Observed* label, and every state
apart: no stored project, loading, not stored on this deployment, a failed
read (never "no findings"), nothing recorded ("this says nothing about the
site"), a report with no findings ("not a clean result"), and a report. The
presenter (`triage/present.ts`) lists the 50 most severe findings in recorded
order with the true totals beside them, counts decisions over the findings
read (a finding with no decision is open), shows a decision's note and time,
and says when it was made on an earlier crawl. The one control records a
decision — a status and a note — and the wording after a save says it is what
the operator decided, not a change to the page. The provenance note names
observed data, decisions as an operator's record, within this crawl, no
indexation, ranking, traffic or vitals, and nothing fixture. The T4 section
inside the crawl panel is unchanged and still offers no control.

**Checkpoint 3.2 (the live Technical SEO screen).** The screen no longer
mounts any fixture: the modelled views are gone from it, and *Observed
findings* is its Issues tab, following the screen's own stored-project
selector (the section shows no selector of its own when the screen passes a
project). One read, `GET /api/crawls/latest-overview?project=<id>` (operators
only; the project id shape, then the crawl read limit, then the project is
checked before the service; 503 when crawls are not stored), answers `none`
or `crawled` with the project's latest own-site crawl (the crawl confined to
exactly the project's host, so never a competitor's), its pages (at most
500, `pagesCut` at the bound), a count summary of its recorded edges
(internal, external, nofollow, external hosts; no edge list leaves the
server) and its report at the current rule version (`recorded`,
`not-recorded`, or `other-rules` for a report under earlier rules). The
presenter (`src/lib/crawl/overview/present.ts`) derives live tiles, the
Overview panels (findings by severity and category, pages by their highest
severity, declared signals at a glance with unknown readings counted apart,
top findings, most affected pages), Crawlability, Schema (detected types
only), Internal links (no inbound link from the fetched pages) and Pages
(rows link to `/technical/pages/<crawl-page id>`). Every section carries one
coverage banner in the crawl panel's wording, and every aggregate says it is
of the fetched pages. Core Web Vitals, Opportunities, answer-engine access,
index coverage and the health score are hidden: this product holds nothing
to back them. The findings coverage line now leads with the crawl's stop
reason. No schema change.

**Checkpoint 3.3 (page detail and finding history).** `/technical/pages/<id>`
reads one recorded page by its `nexra_crawl_pages` uuid, rendered on the
server per request (no prerender, no fixture): the id's shape, then the
operator, then the crawl read limit, then `getCrawlPageDetail`, which checks
the page → crawl → project chain and that the crawl is confined to the
project's own host (`CrawlStore.getPage`). A fixture id, an unknown id or a
competitor crawl's page is not found. The view (`src/lib/crawl/page-detail.ts`)
shows the response (server response labelled crawler-measured), declared
indexing, metadata and markup, linking counts, the recorded edges into and out
of the page with anchor text (from the crawl's bounded edge read), and the
findings of its report at the current rules that name the page, with their
decisions; a page not fetched shows only that it was discovered. Finding
history (`src/lib/crawl/findings/history.ts`, `GET
/api/crawls/finding-history?project=`, the *Finding history* panel on the
Issues tab) is derived on read from the project's own crawls (the newest 10)
and their reports (`CrawlFindingsStore.listReportHeaders`): consecutive
reports at the current rule version compared by finding key — persisted,
appeared, changed (a gone and a new key of the same rule sharing a URL), and
for a key no longer named, resolved only when the later crawl fetched every
page it named, otherwise not re-checked. Reports under earlier rules are not
compared, and a crawl with no report is "not recorded", never recomputed.
Nothing is stored; no schema change.

**Checkpoint 3.4 (Keywords observed surfaces).** The Keyword Intelligence
screen (`src/components/keywords/keywords-workspace.tsx`) reads observed data
only, for one stored project: `GET /api/search-console/keywords` answers the
Keywords, Groups and Opportunities tabs through the pure presenter
`src/lib/search-console/keywords/screen.ts` (filters by query text, intent
hint and opportunity label; position buckets from each query's latest
average position, labelled "Search Console average position, not rank";
intent hints labelled "hint"; the four M4 rule labels with the rows each
names; a line naming the stored windows read). Movement mounts the P4a/P4d
stored-history section and Cannibalisation the P4c overlap section, each on
its own existing read. The modelled keyword universe is not shown: no
volume, difficulty, cost per click, potential, SERP, content gap,
competitor, AI search or Lists reading, no Discover or Import dialog, no
session-only bulk action; `/keywords/clusters/[clusterId]` is removed.
`ObservedQueryView.query` is the exact stored query (the *Record as task*
source, which the database matches exactly); `queryLabel` is the
200-character display cut. No schema change.

**Checkpoint 3.5 (curated keywords).** Migration
`20261006120000_curated_keywords.sql` (see `supabase/README.md`) adds the
operator's keyword list: `nexra_keywords`, one row per project and exact
query text with a status (`tracked`, `paused`, `archived`), an optional group
label, target page on the project's host and note, and no figure of any kind;
and the append-only `nexra_keyword_events`. Five `security definer` functions
are the only writes. `src/lib/keywords`: the contract (request shapes: 1–100
exact queries per add, kept as sent; one field or status per action; the host
rule), the Supabase store over the five functions, the observed join
(`observed.ts`: a keyword's link to the stored Search Console rows by exact
query text — Google's figures when observed, "not observed in stored rows"
otherwise, never zero — and its per-window figures and pages from the latest
pair window), and the service (list with the link, add, detail with events
and the tasks whose keyword source is the exact query, actions).
`GET /api/keywords?project=`, `POST /api/keywords` and
`POST /api/keywords/<id>`: operator, same origin for writes, 120 reads and 60
writes per ten minutes. `/keywords/<id>` is rendered on the server per
request from the keyword's uuid (the id's shape, the operator, the read
limit, then the service, which requires the keyword's project to be stored);
fixture ids are not found. The Keyword Intelligence screen's Lists tab shows
the list and an import form, and each observed row offers *Track*. Curated
keywords are not agent grounding. The migration is applied to production and
recorded (see `supabase/README.md`).

**Checkpoint 3.6 (Phase 3 closing).** The modelled keyword and technical
components that no route referenced any more were removed (36 files, found by
an import-graph scan from the `src/app` entries); the sidebar's build-status
note says Technical SEO and Keyword Intelligence are observed data. The fixture
screens' 18 links to the removed `/keywords/clusters/<id>` route stay 404 until
those screens' own phases (operator decision). No schema or behaviour change.

**Deploy order:** the migration must be applied to production before this
code is deployed; the read route answers 503 until then only if the store is
missing, but the write and the triage read would fail on the missing table.
It is applied to production and recorded, and one operator decision is
recorded through the triage route. The operator verified in the browser that
the *Observed findings* section shows the recorded findings and the decision's
state.

### Agent tasks: the Project Manager's real task core (deployed, production verified)

The Project Manager's detail tabs are modelled (`src/lib/mock/agents`), and
until this checkpoint nothing in the product could hold a task an operator
actually decided on. `nexra_agent_tasks` (migration `20261003120000`) is the
smallest persisted task entity: one row per operator decision naming the
project, a title, the owning registry agent, a status (new rows are
`backlog`), a priority and — always — the record it came from. Two source
kinds exist. `director-run`: the source ref is the id of an `agent_runs` row
that the database checks is the same project's, completed, and the SEO
Director's (`priority-review` or `project-priority-review`); another
project's run answers `run-not-found`, never which of the two. `keyword`: the
source ref is the exact query text as Google reported it and this product
stored it — a `key` of a snapshot's `queries` rows or a `query` of a query ×
page row for the same project — so the identity is the one those immutable
rows already carry and no keyword id is invented; a query this product never
stored for the project answers `keyword-not-found`. No uniqueness is declared
on (project, source): a Director run proposes several actions and two
operator-approved tasks are never collapsed.

The one write is `nexra_agent_task_create` (`security definer`, empty
`search_path`), reached through `src/lib/agent-tasks` — a contract
(`contract.ts`: the fixed sets, the request parsers), a store contract, the
Supabase store (one `rpc`, one bounded project-scoped read newest first by
`created_at` then `id`, at most 100), the service (`listTasks`, `createTask`;
never queues, executes or assigns anything) and `agentTaskService()` wiring
with the fixture roster answering `unavailable`. `GET /api/agent-tasks?project=…[&status=…][&limit=…]`
and `POST /api/agent-tasks` (`{ project, title, sourceKind, sourceRef,
owningAgent, priority? }`, same origin, operator, 30 per ten minutes) are the
route; a caller never chooses the status. On screen, *Record as task*
(`src/components/agent-tasks/record-task-control.tsx`) sits beneath a
completed SEO Director result in the shared review control and in a *Task*
column of the *Observed query inventory* rows: the first click opens a form
with a proposed title (the Director review's closing first-action line, or
`Review the observed query "…"`), a prefilled owning agent (Project Manager,
or Keyword & Search Intent) and `medium` priority; only *Create task* posts,
once. The Project Manager's Tasks tab gains one live section, *Live tasks*
(`live-tasks-panel.tsx`, labelled *Live · persisted*), reading the endpoint
for one stored project and showing title, owning agent, status, priority,
source and recorded time; the modelled board beneath it is now labelled
modelled. No task is created automatically, no agent is assigned or run by a
task existing, and no status change path exists yet. Harness suite `tasks`
(80 assertions); focused tests under `src/lib/agent-tasks`.

### Agent task workflow: status, owner, handoff, history (deployed, production verified end-to-end)

The task core recorded a task and refused every later change. Migration
`20261004120000` adds the smallest workflow that keeps an operator in front
of each change (`supabase/README.md`, *Agent task workflow*): an append-only
`nexra_agent_task_events` history (`created` by trigger and backfilled,
`status-changed`, `owner-changed`, `handoff-requested`, `handoff-run-linked`,
ordered by an identity `seq`), the fixed transition map restated once in SQL
and once in `TASK_TRANSITIONS` (`contract.ts`, drift-tested against the
migration), and four `security definer` functions each taking the project
beside the task, so a task of another project answers `task-not-found`, never
which. `src/lib/agent-tasks` grows: the store contract and Supabase store gain
`getForProject`, `listEvents` (by `seq`, at most 200), `setStatus`,
`setOwner`, `handoffRequest` and `handoffLink` (one `rpc` each, answers checked
field by field); the service gains `readTask`, `changeStatus`, `changeOwner`
and `handoff`. `GET /api/agent-tasks/<id>?project=…` answers the task with its
history; `POST /api/agent-tasks/<id>` takes exactly `{ project, action:
"status", status }`, `{ project, action: "owner", owningAgent }` or
`{ project, action: "handoff" }` (operator, same origin, sixty per operator per
ten minutes; 404 `task-not-found`, 409 with the fixed code and the unchanged
task for `same-status`, `terminal`, `transition-not-allowed`, `same-owner`,
`handoff-active`, `handoff-unsupported`, `run-refused`).

**Handoff.** A handoff creates at most one queued run for the task's owning
agent and executes nothing; the scheduled worker or a separate *Run Now* on
the project's review panel for that review does (the Agents screen's run
history has no Run Now). Which task the agent is handed is the server's
knowledge, never the browser's: `handoff.ts` maps an agent only when it has
one own read-only review whose input the server fills without choosing a
record — SEO Director → `project-priority-review`, Project Manager →
`intake-review`, Research & Evidence → `evidence-pack-review`, Content
Strategist → `content-plan-review` (no input), Keyword & Search Intent →
`search-query-review` and Analytics & Learning → `performance-review` (the
product's own `INVENTORY_RANGE_ID` window). Since checkpoint 2.3 five more
agents are mapped with a record the operator chooses (below). The Writer (a
`draft`-policy task, which fails the read-only drift test) stays deferred:
the panel says *Handoff not supported yet* and nothing is recorded. A drift
test checks every mapping against the task-type definitions (the agent may
run it, policy read-only, the input parses with the operator's record where
it reads one, and never without it). The flow is: the service reads the task
and refuses an unsupported owner before writing; `handoffRequest` records the
intention under the row lock (refused `handoff-active` while a linked run is
queued or running); the existing `createRun` of the run service is called
with a server-side `CreateRunOptions.sourceTaskId`, which is merged into the
stored input after the task type has parsed its own (a request body carrying
`sourceTaskId` is refused as an unknown field), so the run row says where it
came from and the run path's own duplicate rule treats the same handoff twice
as one run; `handoffLink` verifies the same project, the owning agent and the
provenance and appends the link, once. A refused run path leaves the request
in the history and answers `run-refused`. No specialist instruction changes.

**UI.** The *Live tasks* panel (still *Live · persisted*, above the modelled
board, which is unchanged) gains an *Actions* column with
`task-row-controls.tsx`: *Change status* offers only the moves the map allows
from the current status; *Change owner* offers the twelve registry agents;
*Hand off* is enabled only for a mapped owner and opens a confirmation naming
the task type the agent would be handed and that nothing runs on confirm, then
*Confirm handoff* posts once and shows the queued run's id and status;
*View history* reads the task endpoint and lists the events. A terminal task
shows no control. Harness suite `task-workflow` (150 assertions); focused
tests `contract`, `service`, `handoff`, `surface` under `src/lib/agent-tasks`
and the provenance case in `agent-runs/create-run.test.ts`.

**Release.** PR #20 (`47fae75d…`) merged the workflow and its migration was
applied and recorded. PR #21 (`073bf85e…`): the review panels' restore treats
`sourceTaskId` as provenance, not evidence, and shows a running run before a
queued one before finished ones, so a handoff-queued run is restored and
*Run now* executes it instead of queueing a plain run. PR #22 (`2e8116ce…`):
the 1,300-character intake bound above. Verified in production on task
`30e79092…` and run `be1b692e…`: handoff-requested and handoff-run-linked
events, one completed attempt (`claude-opus-5`, 1,552-character screened
summary), no duplicate run, no provenance leak, task unchanged.

**Handoff outcome read-back (Phase 2, checkpoint 2.2).** `GET
/api/agent-tasks/[taskId]` now also answers `outcome`: what became of the
task's newest handoff, computed at read time and never stored. The service's
`readOutcome` (`src/lib/agent-tasks/outcome.ts`, `service.ts`) takes the
newest `handoff-run-linked` event by `seq`, reads that run through the run
service's `getRun`, and shows it only when the run exists, is the task's
project's and names the task as `sourceTaskId`; otherwise it answers
`unavailable` with the run id and infers nothing (`none` when no run is
linked). States: `queued`, `running`, `retrying` (a failed run queued again,
with its fixed failure and next attempt time), `completed` (the screened
summary, the model and the attempt count), `failed` (the fixed code and
message; `rejected-output` says no answer was stored) and `cancelled`. The
projection carries no run input, creator or metadata beyond the model. The
task's history view renders it above the events, with no control. No event,
no migration, no task or run write: the run row stays the one record of how
the run ended, and the task's status never changes because its run finished.

**Handoffs with an operator-chosen record (Phase 2, checkpoint 2.3).**
Technical SEO → `crawl-review`, On-Page SEO → `on-page-review`, AI Visibility
→ `answer-readiness-review` and Authority & Backlink →
`outbound-link-review` each read one of the project's own-site crawls; Market
& Competitor Intelligence → `competitor-comparison-review` reads one
competitor domain the project recorded at intake. The server never chooses:
the handoff request carries at most one record (`crawlId` or
`competitorDomain`, parsed in `contract.ts`), and the service checks it before
anything is written — `record-required` when a record-reading owner gets
none, `record-not-accepted` when a record reaches an owner whose review takes
none or of the other kind, `record-invalid` when the crawl is not the
project's own-site crawl (another project's, a competitor's, unknown) or the
domain is not one the project recorded (canonicalised with the crawl
service's rule; the run input carries the canonical host). The confirmation
lists the choosable records through `GET /api/agent-tasks/[taskId]?view=
handoff-choices` (the ten newest own-site crawls, or the recorded competitor
hosts), starts with none chosen and cannot confirm without one. Execution-time
grounding is unchanged and re-checks the record. No schema change. Verified in
production: handoff run `bcefb1e4…` (Technical SEO `crawl-review` over crawl
`3398ff1a…`, task `30e79092…` event 11) completed with a 1,946-character
summary.

**Task priority change (Phase 2, checkpoint 2.3b).** Migration
`20261005120000` (see `supabase/README.md`) adds
`nexra_agent_task_set_priority` and a `priority-changed` event. `POST
/api/agent-tasks/[taskId] { project, action: "priority", priority }` calls it
through the service under the same 60-per-ten-minutes action limit; it
answers `priority-changed`, or `same-priority` / `terminal` (409) and
`task-not-found` (404). *Live tasks* offers *Change priority* beside *Change
status* and *Change owner* (choose one of the four, Apply, recorded
feedback), and the history renders the event. A priority change queues
nothing and tells no agent anything. The event read selects every column.
Merged as PR #31 (`0921c1f8…`); the migration is applied to production and
recorded, and the round trip high → medium on task `30e79092…` is browser
verified (events seq 15 and 16).

**The learning loop (Phase 6, checkpoint 6.7, decision Q7; migration
`20261008120000`, applied and recorded 28 Sep).** A priority change may cite one completed
SEO Director `project-priority-review` of the same project: `POST
/api/agent-tasks/[taskId] { project, action: "priority", priority,
directorRunId? }`; the database accepts only such a run and otherwise answers
`run-not-accepted` (409), writing nothing. *Change priority* gains an optional
*Because of Director run…* chooser listing the project's completed Director
reviews (read through `GET /api/agent-runs?project=&agent=seo-director`),
starting with none. `GET /api/agent-tasks?project=&view=cited-priority`
(operator, read limit) answers the project's cited priority changes, newest
first, at most 50, each with its task's title. The chain is shown where it is
recorded (`src/lib/agent-tasks/learning-chain.ts`): the task history names a
cited run and the performance review its stored bundle summary read, and each
Analytics Learnings entry shows *What followed, as recorded* — performance
review → the Director runs whose bundle read it → the priority changes citing
each. Nothing is inferred; citing a run queues and changes nothing.

**Approval records (Phase 6, checkpoint 6.8, decision Q1; migration
`20261009120000`, applied and recorded 28 Sep).** `nexra_approvals` and its two functions (see
`supabase/README.md`); `src/lib/approvals` holds the contract (outcomes parsed
fail-closed, the payload digest `nexra-approval-payload/1` over kind, target
and payload) and a store over the two functions. Nothing consumes an approval
yet and no route or screen reads the table; C7 (6.11) is the first consumer.
The run-claim gate is unchanged.

**Tasks as grounding and the task plan review (Phase 2, checkpoint 2.4).** A
thirteenth evidence kind, `task`, and one read-only task type,
`task-plan-review` (Project Manager only, no input, parsed like
`intake-review`). The reader (`src/lib/agent-tasks/grounding.ts`) reads the
run's own project's tasks through the task store's one bounded read (the
newest 100; a read at the bound says older tasks were not seen), keeps the
open ones (every status but `completed` and `cancelled`), orders them by
priority (critical first), then creation time (oldest first), then id, and
supplies at most 25, each as one line: a short id (8 characters, longer only
where two shown ids share a prefix), the title quoted as one JSON string,
status, priority, owning agent, source kind (never the source text), age in
days, and the linked run's state computed by the checkpoint 2.2 rules (none,
unavailable, not established, queued, running, failed with its code and
queued again, completed, failed with its code, cancelled). No run's summary,
input or error message is supplied. Every title passes the run table's
credential detector first; a match is withheld with a fixed disclosure and
nothing of it leaves the reader. The task block is bounded to 6,000 UTF-8
bytes inside the 12,000-byte evidence ceiling; when tasks are cut to fit, one
line says how many were left out, and a title is never cut mid-way. No open
tasks is grounded evidence that says so; a task store that cannot be read
refuses the attempt (`tasks-not-readable`) before any provider is reached.
The instructions follow the structural bound checkpoint 2.3d proved: one
RECORDED line (under 25 words, never dropped), at most five PROPOSED steps
(each under 25 words, citing tasks by short id), one BLOCKERS line (tasks
whose linked run failed or was refused, with the code), one NEXT line (under
15 words), and, last, the whole answer under 1,300 characters. It assigns,
schedules, queues, executes and changes nothing, never describes anything as
done, and makes no traffic or ranking claim. Nothing is recorded from it
(decision Q6): an operator applies what they accept through each task's own
status, owner and priority actions. It is queued from the *Task plan review*
panel beside the intake review on the project screen, and executed there by
Run Now or by the scheduled worker. No schema change: the run table checks
only that a task type is well formed. Merged as PR #32 (`2305b605…`). Verified
in production: run `567a3f11…` completed at 435 characters with RECORDED, one
PROPOSED step, BLOCKERS and NEXT, citing the one open task by short id, grounded
in evidence kind `task` (1,406 bytes, no title withheld); it added one extra
"Observation:" line outside the fixed order, a cosmetic finding left as is.

**Crawl-review output bound (checkpoint 2.3c).** Over the same five-page crawl
the Technical SEO review's unbounded answers ran 1,596 to 1,946 characters, and
an unlinked panel run, `f7b68573…`, was refused as `rejected-output` at the
worker's 2,000-character ceiling. `CRAWL_REVIEW_INSTRUCTIONS` now carry the
On-Page review's bound (PR #13): at most 4 findings and the whole answer under
1,500 characters, the lowest-severity findings dropped first and the coverage
statement never dropped. The worker's screen is unchanged.

Live result (27 Sep): the findings cap held (3 findings) but the character cap
did not — bounded run `2e8b7ab3…` completed at 1,926 characters and bounded run
`98e56366…` was refused as `rejected-output`. **Checkpoint 2.3d** makes the
bound structural, copying the Director and intake fixes: one COVERAGE line
(under 25 words, never dropped), at most three findings of three capped lines
(OBSERVED under 20 words, INFERENCE under 12, RECOMMENDATION under 15), one NEXT
line (under 15 words), and, as the last rule, the whole answer under 1,200
characters, dropping the lowest-severity finding first. The evidence, safety and
findings-block sentences are unchanged.
Verified live: run `941cc617…` on the bounded build (PR #30) completed at 1,138
characters with 3 findings and both the COVERAGE and NEXT lines.

### Safety boundaries

- **Off by default.** `CRAWL_ENABLED` must be set *and* `CRAWL_ALLOWED_HOSTS`
  must name the project's host, matched exactly. A parent domain does not
  authorise its subdomains.
- **The target is never request input.** The body carries a project id; the
  host comes from that project's stored `domain`.
- **Address guard on every hop, and the approved address is what gets dialled.**
  Redirects are followed manually so each hop is re-resolved, re-checked and
  re-pinned on its own; loopback, RFC1918, CGNAT, link-local (including the
  `169.254.169.254` metadata endpoint), IPv6 ULA/link-local, and their
  IPv4-mapped spellings are all refused. Only `http`/`https`, only ports
  80/443, no credentials in URLs.
- **Same-site.** Fetching is confined to the project's host and its
  subdomains, on a label boundary (`evil-example.com` does not match
  `example.com`). External links are recorded, never fetched.
- **Bounded.** 10 s per request, 60 s per crawl, 2 MB per response (streamed
  and abandoned past the cap), 10 redirect hops, 300 links per page.
  `Crawl-delay` is honoured up to 5 s. Pages, depth and concurrency are
  configurable within fixed ceilings:

  | Variable | Default | Range | Stored on the crawl row |
  |---|---|---|---|
  | `CRAWL_MAX_PAGES` | 50 | 1–500 | yes (`max_pages`) |
  | `CRAWL_MAX_DEPTH` | 3 | 0–10 | yes (`max_depth`) |
  | `CRAWL_CONCURRENCY` | 3 | 1–5 | no |

  The defaults are the values that shipped, so setting none of them changes
  nothing. A value that will not parse as a plain decimal integer, or that
  falls outside its range, throws `CrawlConfigurationError` and the crawl
  service is never constructed — a misconfigured server refuses to crawl
  rather than crawling with limits nobody chose. The depth ceiling of 10 is
  the same bound `crawl_pages.depth` declares, so no configurable depth can
  produce a row the table rejects.

  Concurrency is not stored on the crawl row, and that is deliberate: the
  budget records what a crawl was *allowed to observe*, which a reader of the
  record needs in order to tell a five-page crawl from a five-page site. How
  quickly we asked is a property of the run, not of the readings it produced.
- **robots.txt is obeyed, and an unreadable one is not permission.** A file
  that could not be fetched leaves `robots_state = 'unavailable'` and every
  page's `robots_txt_allowed` null.
- **Operators only**, same-origin for the write, 10 crawls per operator per 10
  minutes shared through Postgres, one at a time per operator.
- **No new secret.** The crawl variables are policy, not credentials.

## Security model

- Secrets are server-only environment variables; none has a `NEXT_PUBLIC_` name,
  and configuration readers refuse one that does. Verified: no secret value,
  secret variable name, or provider SDK code in `.next/static`.
- Row level security on every table; `service_role` only; lifecycle and lease
  rules enforced by triggers and definer functions.
- Operators: Auth-server check on every write and data read; same-origin writes;
  JSON bodies ≤ 16 KB.
- Worker: `CRON_SECRET` ≥ 32 characters, compared in constant time via SHA-256,
  never logged or stored; a bare 401 for every failure.
- Rate limits shared across instances (Postgres, `src/lib/security/app-rate-limit.ts`):
  sign-in 5 per email address (stored as a hash) and 50 overall per 15 min;
  project creation 10/10 min, run creation 30/10 min, run actions 60/10 min,
  crawl starts 10/10 min, crawl reads 120/10 min, finding triage decisions
  60/10 min, and manual worker triggers 30/10 min per operator; scheduled jobs
  60/hour per job. Agent tasks: create 30, read 120 and action 60 per 10 min.
  Server Actions per operator per 10 min: draft save 30, edit 60, fact-check
  30, approve 20; article create 10, save 60, check record 120, approve 30,
  propose 30; draft publication propose 10, withdraw 20; competitor list
  update 10; project create 10.
  Refusals are 429 with `Retry-After` (sign-in: a fixed "too many attempts"
  message). If the shared count cannot be read, the request is refused. On the
  fixture data source, counts are per process.
- Stored failures and API errors are fixed codes and messages; no exception or
  provider text.
- Logs are JSON lines with allowlisted fields (run, project, agent, task,
  attempt, executor, transition, duration, error code, job counts); values that
  look like credentials are redacted.

## Environment variables

All server-only. `.env.example` has placeholders.

| Variable | Required | Secret | Purpose |
|---|---|---|---|
| `PROJECTS_DATA_SOURCE` | production: `supabase` | no | data source; unset = fixtures, no runtime |
| `SUPABASE_URL` | with Supabase | no | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | with Supabase | **yes** | server database access |
| `SUPABASE_PUBLISHABLE_KEY` | yes | no | sign-in |
| `NEXRA_OPERATOR_EMAILS` | yes | no | operator allow-list |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | for Search Console | no | service account |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | for Search Console | **yes** | service account key |
| `SEARCH_CONSOLE_PROPERTIES` | for Search Console | no | project → property map |
| `CRON_SECRET` | production | **yes** | scheduled worker credential |
| `NEXRA_AGENT_EXECUTOR` | no | no | `mock` (default) or `ai` |
| `NEXRA_AI_PROVIDER` | with `ai` | no | `anthropic` |
| `ANTHROPIC_API_KEY` | with `ai` | **yes** | provider key |
| `NEXRA_AI_MODEL` | no | no | defaults to `claude-opus-5` |
| `CRAWL_ENABLED` | production, for crawls | no | enables the crawler |
| `CRAWL_ALLOWED_HOSTS` | with crawls | no | exact-host allow-list |
| `CRAWL_USER_AGENT` | no | no | fetch identity |
| `CRAWL_MAX_PAGES`, `CRAWL_MAX_DEPTH`, `CRAWL_CONCURRENCY` | no | no | budgets; refused when out of range |

## Deployment requirements

Continuous integration (`.github/workflows/ci.yml`) runs typecheck, lint, the
production build, the full `node --test` suite and a secret scan on every pull
request and every push to `master`, on Node 22 with no Supabase, Vercel or
Anthropic value: the build and the tests use the fixture data source. The scan
(`scripts/secret-scan.mjs`, `npm run secret-scan`) refuses the credential shapes
`safety.ts` and the sign-in configuration refuse — private keys, `sb_secret_`
keys, JWTs, provider key prefixes and single-token credential literals — over
the lines a pull request adds, or the whole tree on a push; a test fixture is
admitted only by naming its file and pattern in `.github/secret-scan-allowlist`.
CI verifies and never deploys; Vercel deploys `master` on its own. Branch
protection on `master` is configured but not enforced on the current GitHub
plan; merge discipline is the operator's explicit approval plus green CI on
every pull request.

1. Apply all migrations in order and reload the API schema.
2. Set the environment variables above in the hosting project (production scope),
   including a fresh random `CRON_SECRET` (`openssl rand -hex 32`).
3. Create operator accounts in Supabase Auth; disable open sign-ups.
4. Keep Fluid compute enabled (the default). On Pro or Enterprise, optionally
   switch to the 10/15-minute schedule above.
5. Keep `NEXRA_AGENT_EXECUTOR` unset until a provider key and budget are agreed.
6. After deploying, call `GET /api/worker/status` with the worker credential and
   check that counts return and `expiredLeases` stays at 0.

The application is deployed with the daily schedule, and the operator has
exercised live crawls, the Search Console panel, AI-executed reviews for every
agent, the scheduled snapshot capture, article persistence and checks, finding
triage, and the Project Manager task workflow. The deployment plan was not
verifiable from this repository.

## Known limitations

- The crawler has been run against a real origin on the deployment. The
  address policy (see *Pinned connections* above) has therefore been exercised
  once, on an allow-listed host; it has not been exercised against a hostile
  resolver.
- A crawl runs inside the operator's request, so a crashed or timed-out request
  leaves its row `running` with no `finished_at`. There is no recovery sweep
  (that needs the scheduler this milestone deliberately omits); a reader should
  treat a `running` crawl older than its `max_duration_ms` as abandoned.
- A sitemap is read only when the origin serves it as XML, plain text, or HTML.
  One served as something else is recorded as `unavailable`, which leaves
  sitemap membership unknown rather than false.
- Only the crawl panels and the three crawl-grounded agent tasks read crawl
  data, beside the Technical SEO screen's *Observed findings* section, which
  reads recorded findings and triage; its other tabs and the page detail
  screen are fixture data.
- A competitor crawl is read by one task, the comparison review, and only
  beside the project's own newest crawl; the evidence pack sees only that a
  competitor crawl exists. The Market & Competitor Intelligence agent's
  other screens remain fixture-only.
- The evidence pack organises records this product already holds. It adds
  no source: the Research & Evidence agent's registry brief about primary
  sources and dated citations describes a capability the product does not
  have, and the Content Studio's brief sources remain fixtures. The pack
  control checks the project's own newest crawl once, when the panel loads;
  an own-site crawl run afterwards on the same page is not seen until the
  page is reloaded. The content plan reads the same records and has the
  same limitation. The Writer's section draft is one section per run, held
  in the run's 2,000-character summary until it is saved from the run into a
  draft table with immutable versions, exact-version fact-check and approval
  (Stages 1–4); no publishing exists, and the Content Studio's drafts, briefs,
  coverage, linking and recommendations remain fixtures. The Authority & Backlink agent's
  outbound link review reads only the edges one own-site crawl recorded:
  no backlink data provider, verified inbound link, referring-domain,
  anchor-text or placement record exists, none is derived from outbound
  edges, and the Backlinks & Authority screen remains fixtures. A saved
  content draft can be edited into immutable versions, one exact version
  fact-checked against the records this product holds, and the current
  version approved only when its recorded check passed, and an approved
  current version proposed for publication to the one registered
  destination; no publishing exists, a proposal and an approval send
  nothing anywhere, the destination's content path is unresolved, the
  website dry-run renders offline from a pinned template and is incomplete
  for a draft that is only one section, the
  Content Studio does not
  show drafts, and a fixture data source cannot keep them. A crawl
  completed before `internal_links_out` was derived from recorded edges
  keeps the raw anchor count it stored, which reads high; no backfill was
  performed, and a fresh crawl records the corrected count. The comparison control checks
  the project's own newest crawl once, when the panel loads: an own-site
  crawl run afterwards on the same page is not seen until the page is
  reloaded. A grounding refusal fails the attempt as `execution-failed`
  with the fixed message every reader's refusal carries; the reason is not
  stored on the run. On the measured, fixture-backed workspace the
  competitors tab is still session-only; the persisted editor and the
  comparison control are on the unmeasured workspace, where every
  intake-created project renders.

- Execution runs inside a request or a cron invocation, not a long-lived
  worker: one invocation handles at most 5 runs, so sustained backlogs drain at
  the schedule's pace.
- Shared limits use fixed windows: up to twice a limit can pass across a window
  boundary.
- On the default daily schedule, automatic retries and recovery of abandoned
  attempts happen once a day unless an operator triggers them.
- Rows written before migration `20260918120000` may carry a cancellation time
  from the application server's clock; every lifecycle time since comes from the
  database.
- The AI executor has no tools or live data; its output is advice, labelled as
  model-generated. The hand-off gives the Director one agent's advice, never
  the evidence behind it, so the Director cannot verify what it ranks and is
  told so; every queue item carries a verification step for a person.
- The hand-off is one upstream run to one Director run, queued by an operator.
  No run records its parent, and no run queues another; automatic chaining
  needs a `source` value and a parent column the run table does not have.
- The intake review's inventory says what evidence exists, never what it
  found, and reads the intake entries only through its own reader; no screen
  shows them. The panel is on the unmeasured project workspace only — the
  measured, fixture-backed workspace does not offer it yet.
- No approval workflow exists; `approval-required` tasks cannot run at all.
- Reporting figures outside Search Console remain fixtures.
- Run history lists the latest 25 runs per filter, without pagination.
