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
| Shared rate limits | `src/lib/security/shared-rate-limit.ts` | `public.rate_limit_windows` |
| Logs | `src/lib/observability/log.ts` | stdout (JSON lines) |

Everything else on screen — rankings, content, technical, competitor, backlink,
AI-visibility, and reporting figures — is still modelled fixture data, labelled
as such. Nothing measures it yet.

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

## Agent runtime

An operator asks one of the twelve registry agents to run a task on a stored
project. Two task types exist, both read-only: `project-review` (any agent) and
`keyword-research` (Keyword & Search Intent). Input is parsed strictly per task
type, bounded, and screened for credentials; unknown fields are refused.

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
  output; stored metadata is provider, model, token counts, `grounded: false`.
  Raw provider responses are not stored. Provider failures map to
  `provider-unavailable` or `provider-rejected`; provider text is dropped.

No AI provider key is configured in this environment. The provider was verified
against simulated HTTP responses (success, refusal, truncation, 400/401/404,
429/500/529, network failure), not against the live API.

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

Nothing has been deployed.

## Known limitations

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
  model-generated. It has not been exercised against the live provider.
- No approval workflow exists; `approval-required` tasks cannot run at all.
- Reporting figures outside Search Console remain fixtures.
- Run history lists the latest 25 runs per filter, without pagination.
