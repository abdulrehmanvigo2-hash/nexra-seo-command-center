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
project. Eight task types exist, all read-only: `project-review` (any agent),
`keyword-research` (Keyword & Search Intent, from operator seed keywords),
`crawl-review` (Technical SEO), `on-page-review` (On-Page SEO),
`answer-readiness-review` (AI Visibility),
`search-query-review` (Keyword & Search Intent, from Search Console),
`performance-review` (Analytics & Learning, from Search Console) and
`priority-review` (SEO Director, from one other agent's completed review). The
three crawl reviews take one input, a crawl id, and are grounded in the same
recorded crawl; the two Search Console reviews take one input, a range id, and
are grounded in the project's own Search Console report; the priority review
takes one input, a run id, and is grounded in that run's stored output (see
*Agent hand-off* below). Input is parsed strictly per task type, bounded, and
screened for credentials; unknown fields are refused. Adding a task type needs
no migration: the run table checks the id's format, not a list.

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
| `source-task-not-allowed` | its task is not `crawl-review`, `on-page-review`, `answer-readiness-review`, `search-query-review` or `performance-review` — the ungrounded tasks and `priority-review` itself are never sources |
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

### Action policy

Every task type declares `read-only`, `draft`, `approval-required`, or
`executable` (`src/lib/agent-runs/action-policy.ts`). Only `read-only` and
`draft` run. No approval workflow exists, so an `approval-required` task is
refused at creation with `422 {"error":"approval-required"}` and a message
saying so, and, if its policy is tightened after runs were queued, those runs
fail with `policy-blocked` before execution. Both
existing tasks are `read-only`. Never automated: publishing, deleting pages,
creating backlinks, outreach, destructive Search Console actions, DNS or domain
changes.

### Run history UI

Agents → Run History: project and agent filters, status, task, created /
started / finished, attempts (with automatic retries), screened summary labelled
simulated or model-generated, fixed error message, next retry time, and
expandable attempts. 25 runs per page with "Load older runs"
(`GET /api/agent-runs?…&offset=n`, offset ≤ 1,000).

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
- Only the crawl panel and the two crawl-grounded agent tasks read crawl data:
  the Technical SEO screens are entirely fixture data.

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
- No approval workflow exists; `approval-required` tasks cannot run at all.
- Reporting figures outside Search Console remain fixtures.
- Run history lists the latest 25 runs per filter, without pagination.
