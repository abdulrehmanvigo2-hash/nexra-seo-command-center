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
| Shared rate limits | `src/lib/security/shared-rate-limit.ts` | `public.rate_limit_windows` |
| Logs | `src/lib/observability/log.ts` | stdout (JSON lines) |

Everything else on screen — rankings, content, technical, competitor, backlink,
AI-visibility, and reporting figures — is still modelled fixture data, labelled
as such. Nothing measures it yet. **The crawl foundation does not change that:**
it stores what it observes, and the only readers of it are the crawl panel on
the project workspace and the two crawl-grounded agent tasks below, so every
Technical SEO screen is still fixture data and still says so.

## Supabase

Postgres holds projects, agent runs, attempts, and rate-limit windows. Every
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

## Agent runtime

An operator asks one of the twelve registry agents to run a task on a stored
project. Sixteen task types exist, fifteen read-only and one `draft`: `project-review` (any agent),
`keyword-research` (Keyword & Search Intent, from operator seed keywords),
`crawl-review` (Technical SEO), `on-page-review` (On-Page SEO),
`answer-readiness-review` (AI Visibility),
`search-query-review` (Keyword & Search Intent, from Search Console),
`performance-review` (Analytics & Learning, from Search Console),
`priority-review` (SEO Director, from one other agent's completed review),
`intake-review` (Project Manager, from the project's own stored record) and
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
*Content plan* below); the section draft takes one input, a plan run id,
and is grounded in that plan quoted as a proposal beside the records re-read
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
| `/api/worker/process` | `30 5 * * *` — daily, 05:30 | re-queues retryable failures, then runs up to 5 due runs within a 240 s budget |

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
  `grounded` is `true` only when a record this product holds was actually
  loaded and put in the prompt — the tasks whose type declares
  `evidence: "crawl"` (`crawl-review`, `on-page-review`, `answer-readiness-review`),
  `evidence: "search-console"` (`search-query-review`, `performance-review`) or
  `evidence: "agent-run"` (`priority-review`). Their metadata also carries an
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
(success, refusal, truncation, 400/401/404, 429/500/529, network failure). The
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
| `source-task-not-allowed` | its task is not `crawl-review`, `on-page-review`, `answer-readiness-review`, `search-query-review` or `performance-review` — the ungrounded tasks, `priority-review` itself, `intake-review`, `competitor-comparison-review`, `evidence-pack-review`, `content-plan-review`, `section-draft` and `outbound-link-review` are never sources |
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
and its answer is bounded to 1,500 characters with a fixed closing line
naming what a record cannot establish. It is queued from the Project Manager
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
prohibited-actions list, and no draft storage, editing or publishing
surface exists — a draft lives in the run's 2,000-character summary and is
read in Run History.

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
time, and says that fact-checking, approval and publishing do not exist yet.
There is no fact-check, approve, publish or delete control. The Content
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
notice now reads "Article persistence and article fact-check only — no
approval or publication occurs here.", since C4 adds the article's own
check.)

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
fact-check beneath each version (below). There is no approval, proposal,
publish or delete control.

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

## Crawl foundation

An operator asks for a crawl of a stored project; the engine walks that
project's own host inside fixed budgets and records what each URL returned.
Read-only with respect to the client's site: `GET` requests only, no forms
submitted, no state changed anywhere but our own tables.

**Three agent tasks read this data** — `crawl-review`, `on-page-review` and
`answer-readiness-review`, all through one serialisation with one ownership
check — and the crawl panel on
the project workspace lists the recorded pages. The Technical SEO screens are
unchanged and still render fixtures. Connecting those is a separate feature.

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
| final URL, HTTP status, redirect chain, robots meta, canonical href, title, meta description, H1, JSON-LD types, sitemap membership | crawl depth, internal link counts (within the crawl), canonical-is-self, length fields, robots.txt verdict | Google indexation, Core Web Vitals |

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
whose robots meta says `nofollow` or `none` records no edges and counts zero
on the outbound side. **Crawls completed before this definition took effect
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
  project creation 10/10 min, run creation 30/10 min, run actions 60/10 min, and
  manual worker triggers 30/10 min per operator; scheduled jobs 60/hour per job.
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

## Deployment requirements

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
exercised a live crawl, the Search Console panel and an AI-executed Run Now on
it. The deployment plan was not verifiable from this repository.

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
  data: the Technical SEO screens are entirely fixture data.
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
  in the run's 2,000-character summary: no draft table, no version history,
  no editing, no fact-check pass, no approval workflow and no publishing
  exist, and the Content Studio's drafts, briefs, coverage, linking and
  recommendations remain fixtures. The Authority & Backlink agent's
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
