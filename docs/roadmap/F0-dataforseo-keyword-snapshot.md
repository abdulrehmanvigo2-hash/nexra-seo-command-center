# F0 — DataForSEO keyword snapshot: design note

Design note for the first milestone of the next phase (PR 1 of F0), 1 Oct 2026. The brief is
`docs/roadmap/NEXT-PHASE-BRIEF.md`; the Phase 0 audit that recommended F0 is `docs/roadmap/PHASE-0-AUDIT.md`
(§F for the scope, §G for the provider assessment). This note is documentation only: it creates no code,
migration, environment variable or credential, and it makes no call to DataForSEO.

**What F0 is:** one operator-triggered snapshot of keyword metrics for ten approved seed topics, fetched from
DataForSEO, stored append-only with full provenance, shown on Keyword Intelligence labelled as a **provider
estimate**, and protected by a server-side daily dollar cap and the F3 spend confirmation. It must work against
DataForSEO's free sandbox first, switched by an environment flag, before any paid call.

**What F0 is not:** no agent reads these rows (M1 decides that); no SERP, backlink or rank data; no schedule; no
refresh; no second location; no write to any external service except the DataForSEO API itself.

---

## Decisions (operator, 1 Oct 2026)

| # | Question | Decision |
|---|---|---|
| Q1 | The seed topics | **Exactly these 10:** AI lead follow-up; AI dead lead reactivation; reactivate old CRM leads; AI lead qualification; automated lead follow-up; AI SDR; appointment booking automation; WhatsApp lead automation; AI receptionist for small business; missed call text back |
| Q2 | Location and language | **United States / English** — `location_code` 2840, `language_code` `en`. One location per run. |
| Q3 | Daily cap | `DATAFORSEO_DAILY_CAP_USD` **defaults to $1.00**. The SQL hard ceiling stays **$5.00**: the database refuses any cap above it, whatever the variable says. |
| Q4 | Resume of a partial run | **Allowed in live mode, but only through the same F3 spend confirmation dialog** (the estimate for the missing calls shown, the operator confirms). Never automatic; the system never retries a live call on its own. |

The seed list is fixed in code for F0 (a constant, tested); a different list is a later change under its own
approval. The seeds are stored on every run row, so what was asked is always on record.

---

## 1. Endpoints and cost

Two DataForSEO Labs endpoints, both synchronous ("live" in DataForSEO's naming, which means the answer comes in
the same response — not to be confused with the live/sandbox mode below):

| Endpoint | Calls per run | Returns | Why |
|---|---|---|---|
| `dataforseo_labs/google/keyword_overview/live` | 1 call carrying all 10 seeds | search volume, 12 monthly volumes, CPC, competition, keyword difficulty, search intent | Every metric for the seeds in one call; no separate difficulty call needed |
| `dataforseo_labs/google/related_keywords/live` | 1 call per seed, `depth` 1, `limit` 20 | up to 20 related keywords, each with the same metrics | Gives M1 something to cluster |

Not used in F0: `bulk_keyword_difficulty` (the overview already carries difficulty), `keyword_suggestions`,
`search_intent`, the Google Ads search-volume endpoint, and every SERP and Backlinks endpoint (later milestones).

**Pricing (to be re-confirmed on DataForSEO's pricing page before the live run).** Public sources put Labs
prices after the ~20% rise of 1 Jul 2026 at about **$0.012 per call plus $0.00012 per keyword returned**. One
public summary quoted the related-keywords price ten times lower, so the live run goes ahead only once the
operator has confirmed the current figures. The account needs a $50 minimum top-up and has no monthly fee.

| Case | Calculation | Cost |
|---|---|---|
| Expected | overview: $0.012 + 10 × $0.00012 = $0.013; related: 10 × ($0.012 + 20 × $0.00012) = $0.144 | **≈ $0.16 a run** |
| Worst case under the code's own limits | `limit` 20 and `depth` 1 are constants; each paid call is made at most once (a timeout is counted as charged) | ≈ $0.16 |
| Worst case if those limits failed | `limit` 50: ≈ $0.19; the whole run repeated once: ≈ $0.32 | stopped by the daily cap in any case |

The Phase 0 audit estimated ≈ $0.25 for F0; that figure included a separate difficulty call, which this design
drops because the overview endpoint returns difficulty. Either figure sits well under the $1.00 cap.

## 2. Sandbox or live: the mode switch

- **Variable:** `DATAFORSEO_MODE`. Only the exact string `live` selects `api.dataforseo.com`. Unset, empty or
  any other value selects `sandbox.dataforseo.com` — the default is sandbox, and a typo cannot select live.
- **Sandbox:** free; needs the account's ordinary credentials; answers every request with the same dummy sample
  in the real response structure. Sandbox runs record a cost of 0, never count against the cap, and are never
  shown as real: the screen badges them "Sandbox — dummy data, not real".
- **Proof of which mode ran:** the server writes `mode` and `api_host` on every run row from its own
  configuration at reservation time (the browser sends neither); the screen shows the mode badge; a sandbox run's
  rows carry the sandbox's recognisable sample values; and a live run's recorded cost can be set against the
  DataForSEO dashboard.
- **Taking effect:** a Vercel environment variable changes nothing until the next deployment, so every mode
  change is followed by a redeploy, and the first run after it is checked read-only (its `mode` and `api_host`).

## 3. Data model

One migration, three new tables, nothing existing changed. The pattern is the Search Console snapshot
pattern: RLS on with no policies, `service_role` holds SELECT on the tables and EXECUTE on the write functions
only, every write goes through a `security definer` function with an empty `search_path`, and guard triggers
refuse direct writes, deletes and truncates. The run table's `status`, `cost_usd`, `unknown_cost_usd`,
`error_code`, `estimate_usd` (on Resume) and `finished_at` are the only columns that ever change, and only under
the functions' transaction flag, as the agent-task tables do it.

- **`nexra_provider_runs`** — one row per snapshot. Reusable later for SERP and backlink runs (the `kind` check
  is widened by a later migration, never edited).
- **`nexra_provider_requests`** — one row per provider call: endpoint, parameters without secrets, outcome,
  DataForSEO's task id and status code, the reported cost, the item count, the SHA-256 of the raw response
  (the body itself is not stored), sent and received times. `unique (run_id, seq)` makes a repeated record a
  no-op.
- **`nexra_keyword_metrics`** — one immutable row per keyword per run, with the metrics and the full
  provenance (provider, mode, location, language, fetched time, the request it came from). A metric the provider
  did not give stays null; never 0.

**Proposed migration text** (for PR 2; the file does not exist yet, and the body is subject to the harness):

```sql
-- F0: provider runs, provider requests and keyword metrics (append-only, provenance on every row).
create table public.nexra_provider_runs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null
    constraint nexra_provider_runs_project_fkey references public.projects (id) on delete restrict,
  provider text not null check (provider = 'dataforseo'),
  kind text not null check (kind = 'keyword-snapshot'),
  mode text not null check (mode in ('sandbox', 'live')),
  api_host text not null check (api_host in ('api.dataforseo.com', 'sandbox.dataforseo.com')),
  seeds text[] not null check (cardinality(seeds) between 1 and 10),
  location_code integer not null,
  language_code text not null check (language_code ~ '^[a-z]{2}$'),
  status text not null default 'reserved'
    check (status in ('reserved', 'completed', 'partial', 'failed')),
  estimate_usd numeric(10, 4) not null check (estimate_usd >= 0 and estimate_usd <= 5),
  cost_usd numeric(10, 4) check (cost_usd >= 0),              -- sum of the provider's reported cost
  unknown_cost_usd numeric(10, 4) not null default 0          -- timed-out calls, counted at their estimate
    check (unknown_cost_usd >= 0),
  error_code text,
  requested_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);

create table public.nexra_provider_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    constraint nexra_provider_requests_run_fkey references public.nexra_provider_runs (id) on delete restrict,
  seq smallint not null check (seq between 0 and 20),
  endpoint text not null check (endpoint in (
    'dataforseo_labs/google/keyword_overview/live',
    'dataforseo_labs/google/related_keywords/live')),
  params jsonb not null,            -- keywords, location, language, limit, depth; never a credential
  outcome text not null check (outcome in ('succeeded', 'failed', 'unknown')),
  provider_status_code integer,
  provider_task_id text,
  cost_usd numeric(10, 4) check (cost_usd >= 0),
  items integer check (items >= 0),
  response_sha256 text check (response_sha256 ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz not null,
  received_at timestamptz,
  unique (run_id, seq)
);

create table public.nexra_keyword_metrics (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    constraint nexra_keyword_metrics_run_fkey references public.nexra_provider_runs (id) on delete restrict,
  request_id uuid not null
    constraint nexra_keyword_metrics_request_fkey references public.nexra_provider_requests (id) on delete restrict,
  project_id text not null,
  seed text not null,
  keyword text not null check (char_length(keyword) between 1 and 200),
  relation text not null check (relation in ('seed', 'related')),
  search_volume integer check (search_volume >= 0),
  cpc numeric(10, 2) check (cpc >= 0),
  competition numeric(5, 4) check (competition between 0 and 1),
  keyword_difficulty smallint check (keyword_difficulty between 0 and 100),
  intent text,
  monthly_searches jsonb,           -- the provider's 12-month list, as given
  provider_updated_at timestamptz,
  provider text not null check (provider = 'dataforseo'),
  mode text not null check (mode in ('sandbox', 'live')),
  location_code integer not null,
  language_code text not null,
  fetched_at timestamptz not null,
  unique (run_id, seed, keyword)
);

-- Guards (the Search Console / agent-task pattern): inserts only from the functions; the run table's
-- status, cost_usd, unknown_cost_usd, error_code, estimate_usd and finished_at may change only under the
-- functions' flag; every other update, every delete and every truncate raises 23514.

-- Functions: security definer, empty search_path, owned by postgres, EXECUTE for service_role only.
--   nexra_provider_run_reserve(p_project, p_seeds, p_location, p_language, p_mode, p_host,
--                              p_estimate, p_cap_usd, p_requested_by)
--     -> 'reserved' | 'cap-reached' | 'run-active' | 'project-not-found'
--     Raises 22023 when p_cap_usd > 5.00 or p_estimate > p_cap_usd. Under pg_advisory_xact_lock on the
--     UTC day: live spend today = sum over today's live runs of coalesce(cost_usd, estimate_usd) +
--     unknown_cost_usd; refuses when that + p_estimate > p_cap_usd. A sandbox run is recorded with
--     estimate 0 and never counted. 'run-active' while the project has a run in 'reserved'.
--   nexra_provider_request_record(p_run, p_seq, p_endpoint, p_params, p_outcome, p_status_code,
--                                 p_task_id, p_cost, p_items, p_sha256, p_sent_at, p_received_at)
--     -> 'recorded' | 'exists' | 'run-not-found' | 'run-not-open'
--   nexra_keyword_metrics_record(p_run, p_request, p_rows jsonb)   -- one set, validated row by row
--     -> 'recorded' | 'exists' | 'run-not-found' | 'request-not-found' | 'invalid-row'
--   nexra_provider_run_finish(p_run, p_status, p_cost, p_unknown_cost, p_error_code)
--     -> 'finished' | 'run-not-found' | 'run-not-open'      (p_status in completed | partial | failed)
--   nexra_provider_run_resume(p_run, p_estimate, p_cap_usd, p_requested_by)
--     -> 'reserved' | 'cap-reached' | 'run-not-partial' | 'run-not-found'
--     Same cap rule as reserve, for the missing calls' estimate; moves partial -> reserved and adds the
--     estimate to estimate_usd. (Decision Q4: reached only through the confirmation dialog.)

alter table public.nexra_provider_runs enable row level security;
alter table public.nexra_provider_requests enable row level security;
alter table public.nexra_keyword_metrics enable row level security;
-- No policies. service_role: SELECT on the three tables, EXECUTE on the five functions; nothing for anon or
-- authenticated.
```

The migration is applied to production by the runbook's method (§3 of `docs/RUNBOOK.md`: read-only preflight,
tested first on a disposable local cluster, one hash-checked transaction that writes the history row, then
read-only verification), under its own approval.

## 4. The daily dollar cap

- **Where:** in the database, inside `nexra_provider_run_reserve` (and `_resume`), under an advisory lock per
  UTC day, so two confirmations at the same moment cannot both pass. The server passes the cap value from
  `DATAFORSEO_DAILY_CAP_USD`; SQL refuses any cap above $5.00 (22023), so no variable can raise it further.
- **Default:** $1.00 when the variable is unset (Q3). A value that will not parse, is negative or is above
  $5.00 refuses every run (`cap-invalid`) rather than falling back — the crawl configuration's rule.
- **What counts:** today's live runs only, at the reported cost once known and at the estimate while a run is
  open, plus timed-out calls at their estimate (they may have been charged). Sandbox runs count 0.
- **When hit:** the request is refused with HTTP 429 and `Retry-After` until midnight UTC; the dialog says
  "Daily provider cap reached ($X.XX of $Y.YY used today); resets at midnight UTC". Nothing is sent to the
  provider and no run row is created. The cap is never raised by the system; the counters are never edited by
  hand (the runbook's existing rule for the run caps).
- **How cost is recorded:** each request row stores the `cost` DataForSEO reports for that call; the run's
  `cost_usd` is the sum of its succeeded requests, and `unknown_cost_usd` the estimate of its timed-out ones.
  The read-only usage route (§5) adds them up for today.

## 5. Spend confirmation (reusing F3)

The F3 pattern is reused as it stands: the pure presenter in `src/lib/agent-runs/spend-confirm.ts`
(`usageLines`, `UsageState`), the dialog in `src/components/spend/spend-confirm.tsx`, and a read-only usage
route in the shape of `GET /api/agent-runs/daily-usage`.

1. **"Fetch provider estimates…"** on Keyword Intelligence opens the confirmation dialog, which shows: the ten
   seeds, the location and language, the mode (**Sandbox — free, dummy data** or **LIVE — charges the DataForSEO
   balance**), the call count (11), the estimate, and today's live spend against the cap, read from
   `GET /api/keyword-snapshots/daily-usage` (operator only, read-only, no provider call).
2. **Confirm** sends one `POST /api/keyword-snapshots`. The server checks the operator and the same-origin rule,
   takes the seed list from its own constant (the browser sends only the project), recomputes the estimate
   itself, reserves against the cap, makes the calls, records each as it returns, and finishes the run.
3. **The result** shows the actual recorded cost beside the estimate, the mode, and a link to the new section.
4. **Cancel** before Confirm does nothing at all. After Confirm there is no cancel: the run is short, and a
   stopped run would still have been charged for the calls already made.
5. **Resume** (Q4) is a second button on a `partial` run. It opens the same dialog with the missing calls, their
   estimate and today's spend; Confirm sends `POST /api/keyword-snapshots/<run>/resume`. Nothing resumes on its
   own.

## 6. Failure handling

- **Time limits:** the existing routes declare `maxDuration = 300` and the worker runs its batch inside 240 s;
  this route does the same — a 30 s timeout per provider call (AbortController, as the Search Console client)
  and a 240 s deadline for the whole run. No call starts after the deadline. The run then ends `partial`.
- **Partial results:** each request row and its metric rows are written as soon as the call returns, so a run
  that stops early keeps everything it got. A `partial` run shows which seeds are missing.
- **Retries, without double charging:**
  - in live mode no call is ever retried by the system — not on timeout, not on a 5xx, not on a network
    error (the Search Console client's bounded retries are deliberately not reused here);
  - a timeout or a network error after sending is recorded `unknown` with its estimate in `unknown_cost_usd`,
    because the provider may have charged for it;
  - a response DataForSEO marks as an error (a top-level or task `status_code` other than 20000) is recorded
    `failed` with no cost, since the provider does not charge for refused tasks;
  - sandbox mode may retry once on timeout (free), which is also how the retry path is tested;
  - `unique (run_id, seq)` and `unique (run_id, seed, keyword)` make a repeated write a no-op;
  - Resume (Q4) asks only for the seqs with no `succeeded` row, under a fresh cap reservation, through the
    dialog.
- **One run at a time:** `run-active` while a project has a run in `reserved`. A run left in `reserved` by a
  crashed process is finished `failed` with `error_code = 'abandoned'` by the next Fetch attempt when it is
  older than 10 minutes (read, then finish; no provider call). The route also carries the write rate limit the
  other operator routes use.
- **Credential or configuration errors:** `provider-not-configured` (a variable missing) and
  `provider-refused` (HTTP 401/403, or DataForSEO's 401xx codes) end the run `failed` before or at the first
  call, with no retry and nothing charged.

## 7. Security (the repository is public)

- **Credentials:** `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` live only in Vercel, marked Sensitive, scoped to
  Production. The repository holds their names with empty values in `.env.example`, nothing else. Never a
  `NEXT_PUBLIC_` prefix.
- **Reading them:** one `server-only` config module, on the Search Console pattern: the status is
  `unconfigured`, `configured` or an error that names the variable, never its value. The config object never
  leaves the server and is never serialised into a response, a log or an error.
- **The Basic auth header** is built inside the HTTP client from the config and is not logged, not returned
  and not stored (the request row's `params` hold the task parameters only, checked by a test).
- **Errors:** fixed text only (`provider-timeout`, `provider-refused`, `provider-error`, `cap-reached`,
  `provider-not-configured`). DataForSEO's `status_message` is never passed to the client or the logs, because
  it can echo the request.
- **Logs:** run id, seq, endpoint, outcome, cost, duration and the mode, through `logEvent` in
  `src/lib/observability/log.ts` — a closed field set.
- **Stored data:** parsed fields and the response's SHA-256 only; the raw body is discarded.
- **Fixtures:** sandbox responses only (dummy data), checked by hand before commit; the secret scan runs on
  them like everything else. No real response is ever committed.
- **The client never sees** the mode variable's value, the cap variable, the host or any header; it sees the
  mode name and the figures the presenter returns.

## 8. Screen

On **Keyword Intelligence**, a new section *Provider estimates* beneath the observed query inventory:

- **Per run, newest first:** a header with the provider, location and language, fetched time, the mode badge
  (**Sandbox — dummy data, not real** or **Live**), status (completed / partial with the missing seeds /
  failed with its code), the recorded cost and the estimate; then a table of keyword, relation (seed /
  related), volume, CPC, competition, difficulty and intent, with the seed each row came from.
- **Labelling, every time:** **"Provider estimate — DataForSEO, <date>, United States / English — not
  observed."** A null metric reads "not given", never 0. The figures are never merged into the observed
  Search Console columns, never shown without the label, and the Observed badge is not used for them.
- **Controls:** *Fetch provider estimates…* (opens the dialog), *Resume…* on a partial run. Nothing else.
- **Empty and error states:** "No provider snapshot recorded" (and the mode the deployment is in), "Provider
  not configured on this deployment", and the read-failed state in place, as the other observed sections do.
- **Grounding:** no agent task reads these rows in F0. A test asserts that no module under
  `src/lib/agent-runs` or any grounding reader imports the snapshot store.

## 9. Tests

- **Config:** sandbox by default; only the exact string `live` is live; a missing credential reads
  `unconfigured`; an error message never contains a variable's value; the cap default, parse failure, negative
  and above-$5 cases.
- **HTTP client (fake fetch):** the right host per mode; the Basic header present on the request and absent
  from every log line and error; the 30 s timeout; error mapping that never echoes the response body or
  `status_message`; no retry in live mode, one retry in sandbox mode.
- **Parsers:** recorded sandbox responses for both endpoints; a missing metric stays null; a malformed row
  refuses the set, not silently drops it.
- **Estimate:** the formula, the `limit` and `depth` constants, the call count.
- **Service (fake fetch, in-memory store):** the cap refuses before anything is sent; a timeout is recorded
  `unknown`, counted at its estimate, never retried; a partial run and a Resume ask only for the missing seqs;
  a sandbox run costs 0 and does not count; the abandoned-run rule; the seed list comes from the constant,
  not the request.
- **Database harness (`supabase/tests/run.sh`):** the three tables, guards (23514 on direct insert, update,
  delete, truncate), grants (nothing for `anon` or `authenticated`); reserve refusing over the cap and
  raising above $5; two reserves racing for the last of the cap (one `reserved`, one `cap-reached`);
  `run-active`; `unique (run_id, seq)`; finish and resume transitions.
- **Presenter and screen:** the label text, the sandbox badge, "not given" for null, the partial run's
  missing seeds; no fixture import; the Observed badge absent from the section.
- **Boundaries:** no grounding module imports the snapshot store.

## 10. Pull requests, in order, one change each

| # | Title | Files | Migration? | Needs the operator's approval for |
|---|---|---|---|---|
| 1 | F0 design note (this file) | `docs/roadmap/F0-dataforseo-keyword-snapshot.md` | no | the design and the decisions above |
| 2 | Provider snapshot schema | `supabase/migrations/<version>_provider_keyword_snapshot.sql`, harness suites, `supabase/README.md` | **yes** (the file only) | the merge; later the **production apply**, as its own step (§6 of CLAUDE.md) |
| 3 | DataForSEO config, client, parsers and estimate | `src/lib/providers/dataforseo/*` (config, client, parse, estimate, the seed constant, tests, sandbox fixtures), `.env.example` | no | the merge (no route, no network path reachable from the app yet) |
| 4 | Keyword snapshot service and routes | `src/lib/keyword-snapshots/*` (contract, service, Supabase store, tests), `src/app/api/keyword-snapshots/*` (POST run, POST resume, GET list, GET daily-usage) | no | the merge |
| 5 | Provider estimates on Keyword Intelligence | the section, the F3 dialog wiring, presenter and tests | no | the merge |
| 6 | Runbook and docs | `docs/RUNBOOK.md` (the variables, the mode switch, the cap, verifying a run, reading the DataForSEO dashboard), `docs/BACKEND.md`, `CLAUDE.md` §0 | no | the merge |

Every PR: CI green, no secrets, no production data; merges only on the operator's explicit approval in chat.

## 11. Live steps, after the code, each its own approval

1. **Apply the migration** to production and record it (the runbook's method; read-only verification after).
2. **The DataForSEO account** already exists, created and email-verified. It is **not topped up**, and nothing
   is topped up at this step.
3. **The operator sets** `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` in Vercel as Sensitive, Production-only
   variables, leaves `DATAFORSEO_MODE` unset (sandbox) and redeploys. The sandbox needs the ordinary credentials;
   it charges nothing. The values are never pasted into chat.
4. **One sandbox run in production**, from the screen through the dialog. Checked read-only: the run row says
   `sandbox` / `sandbox.dataforseo.com`, cost 0, eleven request rows, metric rows present, the badge on screen,
   nothing counted against the cap, no credential in any log line.
5. **The $50 top-up** — only after step 4 passes, and only with the operator's approval. The operator confirms
   the current Labs prices on DataForSEO's pricing page at the same time; the estimate in this note is
   re-checked against them before step 7.
6. **The operator sets** `DATAFORSEO_MODE=live` and redeploys. The next Fetch dialog shows the LIVE warning.
7. **One live run** with the ten seeds (expected ≈ $0.16 at the prices above). Checked read-only: `live` /
   `api.dataforseo.com`, eleven succeeded requests, the recorded cost, the rows and the label on screen.
8. **The recorded cost is set against the DataForSEO dashboard's** figure for the day; a difference is recorded
   in `CLAUDE.md` §0 and the runbook before anything else is built on the data.

## 12. Out of scope and open items

- **Out of scope for F0:** scheduling or refreshing snapshots; a second location or language; grounding any
  agent on provider rows; SERP, ranked-keyword, backlink or AI-visibility endpoints; a monthly cap (the daily
  cap and the top-up size bound spend for now); a cost reconciliation job.
- **Open after F0:** M1 decides how provider estimates are read by agents (as a separate evidence kind,
  labelled "provider estimate", never OBSERVED); the monthly spend ceiling the Phase 0 audit suggested ($10)
  when more than one provider call kind exists.

---

**Sources** (public; DataForSEO's own site is blocked by the session's network proxy, so the prices are to be
confirmed by the operator on DataForSEO's pricing page before the live run):

- DataForSEO, *Pricing update in DataForSEO APIs* — https://dataforseo.com/update/pricing-update-in-dataforseo-apis
- DataForSEO, *DataForSEO Labs API — keyword research* — https://dataforseo.com/apis/dataforseo-labs-api/keyword-research
- DataForSEO docs, *related_keywords/live* — https://docs.dataforseo.com/v3/dataforseo_labs-google-related_keywords-live/
- DataForSEO docs, *Sandbox* — https://docs.dataforseo.com/v3/appendix-sandbox/
- DataForSEO, *Introducing Sandbox for DataForSEO APIs* — https://dataforseo.com/blog/introducing-sandbox-for-dataforseo-apis
- NextGrowth, *DataForSEO API: complete 2026 guide* — https://nextgrowth.ai/dataforseo-api-guide/
