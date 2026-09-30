# Full audit — plan and inventory (A0)

Base: `master` `88cb186` (FULL V1, 30 Sep 2026). Written 30 Sep 2026 as checkpoint A0.

**Audit rule.** The audit finds and records. It makes no fix, refactor, production write, run, migration or
nexra-ai write. Read-only production queries are allowed where a check needs one, and each is named in the
checklist. Every finding goes to `FINDINGS.md` in the format at the end of this file; a fix is a separate,
separately approved checkpoint.

Parts: A1 Security, A2 Database, A3 Agents, A4 Screens, A5 Content path, A6 Operations. Each part is one
checkpoint: run its checklist, record its findings, open one docs-only draft PR.

---

## 1. Inventory (facts, as of `88cb186`)

### 1.1 Routes and screens

21 pages (`src/app/**/page.tsx`); every one but `/login` is under the `(app)` group and behind the operator gate.

| Route | Screen | Data |
|---|---|---|
| `/` | Command Center | observed (6.3) |
| `/projects`, `/projects/[projectId]` | Projects, a project | mixed: fixture figures labelled Modelled; live panels (crawls, reviews, articles, Director) |
| `/agents`, `/agents/[agentId]` | AI Agents, an agent | mixed: fixture sections labelled Modelled; live Run History and *Queue a review* (6.2, 6.6b) |
| `/keywords`, `/keywords/[keywordId]` | Keyword Intelligence, a curated keyword | observed (3.4, 3.5) |
| `/content`, `/content/[articleId]` | Content Studio, an article | observed (5.2) |
| `/technical`, `/technical/pages/[pageId]` | Technical SEO, a crawled page | observed (3.2, 3.3) |
| `/competitors`, `/competitors/[host]` | Competitor Intelligence, a competitor | observed (4.4) |
| `/ai-visibility` | AI Visibility | observed (4.5) |
| `/backlinks` | Outbound Links | observed (4.5) |
| `/analytics` | Analytics | observed (4.3) |
| `/reports` | Reports (generated on read) | observed (6.4) |
| `/settings` | Settings | browser preferences only |
| `/dev/data`, `/dev/ui` | development previews of the fixture data and the UI primitives | fixture; not in the sidebar; `robots: noindex`; **shipped in the production build** (see A0-06) |
| `/login` | Sign-in | public |

Server Actions (8 files, `"use server"`): `src/app/(app)/projects/{actions,article-actions,article-approval-actions,article-check-actions,article-proposal-actions,draft-actions,publication-actions}.ts` and `src/app/login/actions.ts`.

Gate: `src/proxy.ts` (matcher: everything but `_next/static`, `_next/image` and the icons) → `src/lib/auth/access.ts`
(`LOGIN_PATH` public; `HEALTH_PATH` public for GET/HEAD only; everything else needs an operator session — a confirmed
user listed in `NEXRA_OPERATOR_EMAILS`). Every data route and Server Action re-checks the operator server-side.

### 1.2 API endpoints

32 route files under `src/app/api`:

- **Agent runs (3):** `agent-runs`, `agent-runs/[runId]`, `agent-runs/worker`.
- **Agent tasks (2):** `agent-tasks`, `agent-tasks/[taskId]`.
- **Content (7):** `content-articles`, `content-article-checks`, `content-article-approvals`,
  `content-article-proposals`, `content-drafts`, `content-publications`, `content-publications/dry-run`.
- **Crawls (9):** `crawls`, `crawls/[crawlId]`, `crawls/[crawlId]/findings`, `crawls/[crawlId]/findings/triage`,
  `crawls/competitor-overview`, `crawls/finding-history`, `crawls/latest-findings`, `crawls/latest-outbound`,
  `crawls/latest-overview`.
- **Keywords (2):** `keywords`, `keywords/[keywordId]`.
- **Search Console (5):** `search-console/history`, `search-console/keywords`, `search-console/latest-window`,
  `search-console/query-pages`, `search-console/report`.
- **Worker (3):** `worker/process`, `worker/recover` (Bearer `CRON_SECRET`), `worker/status` (Bearer or an operator
  session).
- **Health (1):** `health` — public GET/HEAD, no data.

Rate limits: `src/lib/security/app-rate-limit.ts` (per-instance), `shared-rate-limit.ts` and the database
`rate_limit_consume` (the daily caps, `src/lib/agent-runs/daily-caps.ts`; sign-in limits in `src/lib/auth/sign-in-limits.ts`).

### 1.3 Agents and tasks

12 registry agents (`src/lib/mock/agents/registry.ts`, `AGENT_IDS`): `seo-director`, `project-manager`,
`market-intelligence`, `keyword-intent`, `content-strategist`, `research-evidence`, `writer`, `on-page-seo`,
`technical-seo`, `ai-visibility`, `authority-backlink`, `analytics-learning`. Profiles, statuses and activity feeds
are fixture data; runs are real.

27 task types (`src/lib/agent-runs/task-types.ts`); 25 are `read-only`, 2 are `draft` policy (`section-draft`,
`article-revision-draft`); none is `approval-required`.

| Agent | Tasks |
|---|---|
| any | `project-review` |
| seo-director | `priority-review`, `project-priority-review` |
| project-manager | `intake-review`, `task-plan-review` |
| market-intelligence | `competitor-comparison-review`, `competitor-page-gap-review` |
| keyword-intent | `keyword-research`, `search-query-review`, `keyword-opportunity-review` |
| content-strategist | `content-plan-review`, `content-refresh-review` |
| research-evidence | `evidence-pack-review`, `draft-fact-check`, `article-check-unit` |
| writer | `section-draft` (draft), `article-revision-draft` (draft) |
| on-page-seo | `on-page-review`, `page-query-alignment-review` |
| technical-seo | `crawl-review`, `finding-history-review` |
| ai-visibility | `answer-readiness-review`, `schema-entity-review` |
| authority-backlink | `outbound-link-review`, `internal-link-review` |
| analytics-learning | `performance-review`, `learning-review` |

Evidence kinds: `none`, `project`, `crawl`, `crawl-links`, `search-console`, `agent-run`, `agent-runs`, `task`,
`competitor-comparison`, `evidence-pack`, `content-draft`, `draft-version`, `article-unit`. Executor `mock` or `ai`
(Anthropic, `@anthropic-ai/sdk`; model from `NEXRA_AI_MODEL`); the worker's 2,000-character output ceiling; daily
caps 40 a project and 100 in all per UTC day.

### 1.4 Database (production, read-only, 30 Sep)

- **31 tables** in `public`, RLS enabled on all, **0 policies**; 92 non-internal triggers, 0 disabled; 103 functions.
- **26 tables** are created by the repository migrations (`projects`, `agent_runs`, `agent_run_attempts`,
  `rate_limit_windows`, `nexra_crawls`, `nexra_crawl_pages`, `nexra_crawl_links`, `nexra_crawl_findings_reports`,
  `nexra_crawl_findings`, `nexra_crawl_finding_triage`, `nexra_search_console_snapshots`,
  `nexra_search_console_query_pages`, `nexra_content_drafts`, `nexra_content_draft_versions`,
  `nexra_content_publication_proposals`, `nexra_articles`, `nexra_article_versions`, `nexra_article_version_sources`,
  `nexra_article_check_units`, `nexra_article_approvals`, `nexra_article_publication_proposals`, `nexra_agent_tasks`,
  `nexra_agent_task_events`, `nexra_keywords`, `nexra_keyword_events`, `nexra_approvals`).
- **5 tables are not in the repository:** `crawls` (9 rows), `crawl_pages` (43), `crawl_urls` (43),
  `crawl_page_signals` (40), `crawl_links` (0) — the pre-`nexra_` crawl schema; with 5 triggers and 4 `security
  definer` functions (`crawls_guard_update`, `crawl_pages_claim`, `crawl_pages_count_change`,
  `crawl_pages_recover_expired`). No file in `src` or `supabase/migrations` names them (A0-02).
- **37 `security definer` functions**; every function has an empty `search_path` except the platform's
  `rls_auto_enable` event-trigger function (`pg_catalog`).
- **Grants:** `service_role` SELECT on 30 tables (not `crawl_links`), INSERT/UPDATE/DELETE on the 11–13 tables the
  application writes directly (projects, runs, crawl tables, drafts, draft proposals' withdraw) and TRUNCATE on 12 —
  TRUNCATE and DELETE on `projects`, `agent_runs`, `agent_run_attempts` and the crawl tables are refused by the 5.4
  guard triggers, not by grants. `anon` / `authenticated`: no SELECT/INSERT/UPDATE/DELETE anywhere; **TRUNCATE,
  TRIGGER and REFERENCES on legacy `crawl_links`** (A0-03); EXECUTE on 17 trigger functions through PUBLIC's default
  (not callable directly; A0-04).
- **Roles:** `postgres` and `service_role` bypass RLS; `anon`, `authenticated` do not; none is superuser.
- **Migration history:** 34 rows. Repository: 33 files. Version numbers match for 26; **8 differ** and one repo file
  has no row (A0-01). Two rows (`20260923180000`, `20260924120000`) hold no statement text. The six single-statement
  rows `20261005120000`–`20261011120000` hash exactly to their files. 32 functions carry CRLF bodies from SQL-editor
  pastes (A0-05).

### 1.5 Environment variables (names only)

From `.env.example` (19): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXRA_OPERATOR_EMAILS`, `PROJECTS_DATA_SOURCE`, `CRON_SECRET`, `NEXRA_AGENT_EXECUTOR`, `NEXRA_AI_PROVIDER`,
`NEXRA_AI_MODEL`, `ANTHROPIC_API_KEY`, `CRAWL_ENABLED`, `CRAWL_ALLOWED_HOSTS`, `CRAWL_CONCURRENCY`, `CRAWL_MAX_DEPTH`,
`CRAWL_MAX_PAGES`, `CRAWL_USER_AGENT`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`,
`SEARCH_CONSOLE_PROPERTIES`. No `NEXT_PUBLIC_` variable is read; five config modules refuse to start when a secret is
given a `NEXT_PUBLIC_` name (`supabase/server.ts`, `search-console/config.ts`, `crawl/config.ts`,
`agent-runs/providers/config.ts`, `security/worker-auth.ts`). `.env*` is ignored except `.env.example`. Secrets in
this list: the service-role key, `CRON_SECRET`, the Anthropic key, the Google private key.

### 1.6 Scheduled jobs and workers

`vercel.json`: `/api/worker/recover` daily 04:00 UTC; `/api/worker/process` daily 05:30 UTC (the run queue — 5 runs,
240 s — then the Search Console snapshot capture in the time left). Both Bearer `CRON_SECRET`. Run Now on the
review panels and agent pages executes one queued run through `POST /api/agent-runs/<id> {action:"execute"}`.

### 1.7 External integrations

- **Supabase** (`@supabase/supabase-js`, `@supabase/ssr`): Postgres and Auth; the server alone holds
  `service_role`; the browser holds the publishable key for the session only.
- **Anthropic** (`@anthropic-ai/sdk`): the `ai` executor; default sampling (no temperature or seed).
- **Google Search Console**: a read-only service account; JWT to `oauth2.googleapis.com/token`, reads from
  `www.googleapis.com/webmasters/v3` (`src/lib/search-console/google-client.ts`).
- **The crawler**: outbound fetches to hosts in `CRAWL_ALLOWED_HOSTS` (own sites and recorded competitors).
- **Vercel**: hosting, cron, auto-deploy of `master`; branch deployments are ignored.
- **GitHub**: CI only (`.github/workflows/ci.yml`: typecheck, lint, build, test, secret-scan on every PR and push to
  `master`; no credential; verifies, never deploys).
- **nexra-ai**: no write path in the product; the one V1 write was a Claude Code session (6.11).

Dependencies: 7 runtime (`next`, `react`, `react-dom`, `parse5`, the two Supabase packages, the Anthropic SDK),
8 development.

### 1.8 Tests and gates

- `npm test`: 141 test files, 2,593 tests (node `--test`, `src/lib/**/*.test.ts`).
- SQL harness (`supabase/tests/run.sh`, disposable local PostgreSQL 16): 36 suites, 80 checks; expected assertion
  counts pinned per suite (25 counted suites, from `c2` 54 to `live-slugs-upgrade` 10).
- Gates: `npm run typecheck`, `lint`, `build`, `secret-scan` (`scripts/secret-scan.mjs`, 24 allowlisted fixture
  lines), `git diff --check`; CI runs the first five.
- Docs: `CLAUDE.md`, `docs/BACKEND.md`, `docs/RUNBOOK.md`, `docs/website-renderer-6.9.md`, `supabase/README.md`.

---

## 2. Audit plan

Pass/fail rule for every item: **PASS** when the check holds exactly as stated; **FAIL** produces a finding with
evidence; **N/A** must say why. A check that cannot be run from the session (the Vercel API refuses it; the
production host is proxied off) is recorded as *not checkable here* with what the operator should run instead.

### A1 Security (30 items) — run 30 Sep 2026 at `3a3f5c6`: 27 PASS, 2 FAIL, 1 OPERATOR (item 14 corrected in A2: the operator's Auth result belongs to item 30)

Method: code read of the gate, every route and Server Action; a local `next start` of the production build with no
environment (sign-in unconfigured) probed with curl; one read-only production query; `npm audit`; a scan of both
repositories' history. Findings: `FINDINGS.md` A1-01…A1-07. Additional questions the operator asked (the anon key's
reach, service_role's scope, secrets in history, dependencies, headers and cookies, the `/dev` routes) are answered
under A1-05, A1-04, A1-03, A1-01, A1-02 and item 5.

**Gate and sessions**
1. Every page under `(app)` and every API route except `/api/health` (GET/HEAD) and `/login` refuses an unauthenticated **[PASS]**
   request — read `access.ts` and `proxy.ts`; confirm the matcher covers every route in §1.1–1.2; a test per route
   class exists in `src/lib/security/security.test.ts`.
2. Every Server Action re-checks the operator before any read or write (grep `"use server"` files for the gate call **[PASS]**
   as the first statement).
3. The operator list (`NEXRA_OPERATOR_EMAILS`) is compared against a *confirmed* Supabase user (email confirmed), not **[PASS]**
   just an email string.
4. Sign-in rate limits hold (`sign-in-limits.ts`): limit, window, and what a locked-out operator sees. **[PASS]**
5. `/dev/data` and `/dev/ui` are behind the gate (A0-06) — decide whether they should exist in production at all. **[PASS (gated); decision open — A0-06]**

**Worker and cron**
6. `/api/worker/process` and `/recover` refuse without a Bearer that equals `CRON_SECRET` (constant-time compare); **[PASS]**
   `/status` accepts an operator session as well — confirm nothing else does.
7. Cron secrets are never logged; worker logs carry ids, outcomes and durations only. **[PASS]**

**Database access**
8. RLS enabled on all 31 tables and 0 policies (re-run the A0 query); `anon` and `authenticated` hold no DML grant on **[FAIL — A0-03 (legacy `crawl_links` only)]**
   any table — FAIL for `crawl_links` (A0-03).
9. Every `security definer` function has an empty `search_path` and owner `postgres`; EXECUTE only for **[PASS; A0-04 recorded]**
   `service_role` where the migration grants it; trigger functions' PUBLIC EXECUTE (A0-04) recorded.
10. The application's direct writes (`.insert/.update/.delete` in `src/lib/**/supabase/*.ts`) are each covered by an **[PASS; A1-06 recorded]**
    update/delete guard trigger or are on a table designed for direct writes; list them.
11. Delete/truncate guards (5.4) enabled on projects, runs, attempts, the crawl tables; verify `tgenabled = 'O'`. **[PASS]**

**Secrets**
12. `npm run secret-scan` clean on the tree; the 24 allowlist entries are each a synthetic fixture (read each). **[PASS]**
13. No `NEXT_PUBLIC_` variable carries a secret; the five refusal checks have tests. **[PASS]**
14. Vercel environment variables target Production only (operator check in the dashboard — not checkable here). **[OPERATOR — A1-07 (a)]**
15. `.gitignore` excludes `.env*` except `.env.example`; `git log -p` finds no secret ever committed (scan history **[PASS; A1-04 recorded]**
    with the secret scanner over `git log -p`).

**Input handling**
16. Every API route validates its request shape before touching a service (project id, uuid, ranges, limits). **[PASS]**
17. Output screening (`looksLikeSecret`, `output-screen`) covers every stored model answer and every grounding block **[PASS]**
    that quotes stored text.
18. The crawler only fetches hosts in `CRAWL_ALLOWED_HOSTS`; redirects off-host refused; response size and time **[PASS]**
    bounded; no private-network address reachable (SSRF).
19. The renderer's `tsString` escaping holds for every content field (hostile-text test present). **[PASS]**

**Health and headers**
20. `/api/health` returns exactly three fields, never an error string; its 120/min cap holds. **[PASS]**
21. Security headers (CSP, frame-ancestors, referrer-policy) — record what `next.config` sets; FAIL if none. **[FAIL — A1-01]**
22. Same-origin checks on write routes (`origin`/`sec-fetch-site`) present where CLAUDE.md says so. **[PASS]**

**Runtime**
23. The Anthropic client sends only the grounded prompt; no environment or file content reaches it. **[PASS]**
24. Search Console credentials are read once, never returned by any route (`property` never returned). **[PASS]**
25. Rate limits on every write route (list route → limiter). **[PASS]**

**Records**
26. Two curated keywords, one task, the article rows are the only operator-created data; nothing unexpected in **[PASS]**
    `rate_limit_windows` (26 rows; read them).
27. `nexra_approvals` has 0 rows and nothing consumes it yet — confirm no route imports `src/lib/approvals`. **[PASS]**
28. The C6 slug lock triggers are enabled and READ COMMITTED is the default (re-run the D3 preflight). **[PASS]**
29. `service_role` UPDATE on `nexra_content_publication_proposals` is the withdraw path's only use **[PASS]**
    (`publications/supabase/store.ts:112`) and the update guard limits it to status/withdrawn fields.
30. Supabase Auth settings: email confirmation required, no sign-up open to the public (operator check; not **[PASS — run by the operator 30 Sep: sign-up was ON and is now OFF, anonymous OFF, confirm email ON, 1 user; A1-08]**
    checkable here).

### A2 Database (22 items) — run 30 Sep 2026 at `961104f`: 17 PASS, 2 FAIL, 3 DONE (record-only items; item 15 was OPERATOR until the operator answered on 30 Sep)

Method: a reference database built on a disposable PostgreSQL 16 from the 33 repository migrations, then every
function, table, constraint, index, trigger, grant and RLS flag hashed on both sides (CRLF normalised) and compared;
read-only production queries for history, legacy objects, integrity, statistics, storage, realtime and extensions;
the Supabase security and performance advisors. Findings: `FINDINGS.md` A2-01…A2-11.

1. Migration history vs repository, row by row: version, name, statement count, hash — the A0 query; record every **[DONE — A2-01 (every difference classified)]**
   difference (A0-01) and classify each as *renumbered*, *unrecorded* or *text absent*.
2. For each renumbered pair, confirm the production schema equals what the repository file would create (compare **[PASS — A2-01: identical for every pair (5 object kinds hash-identical; 3 functions differ in formatting only)]**
   `pg_get_functiondef` / `\d` against the file, ignoring CRLF) — the answer to "is only the version different?".
3. `20260920120100_grant_crawls_to_service_role.sql`: confirm its grants exist in production though no row records it. **[PASS — the grants exist; the row is missing (A2-01)]**
4. The two rows without text (`20260923180000`, `20260924120000`): confirm they were recorded with `migration repair` **[PASS — objects present and identical to the files]**
   and that their objects exist.
5. Legacy tables `crawls`, `crawl_pages`, `crawl_urls`, `crawl_page_signals`, `crawl_links` (A0-02): what created **[DONE — A2-03 (recommendation: retire, after the operator confirms no other system owns them)]**
   them, what reads them (nothing in the repo), whether their rows matter, and a decision (keep as legacy / archive
   and drop under §6).
6. Legacy functions `crawl_pages_claim`, `crawl_pages_count_change`, `crawl_pages_recover_expired`, **[DONE — A2-03 (3 are security definer, 1 is not; executable by service_role; referenced by nothing)]**
   `crawls_guard_update`: `security definer`, executable by `service_role`, referenced by nothing in the repo.
7. CRLF function bodies (A0-05): the 32 functions; confirm each behaves as its repository text (the harness runs the **[PASS — every function compared with CRLF normalised; only the 3 formatting-only differences (A2-01)]**
   repository text, so any divergence would be in production only) — sample-verify by normalising line endings and
   diffing `prosrc` against the file's function body for each.
8. Every guard trigger enabled (92, 0 disabled — re-check at audit time); every append-only table refuses UPDATE, **[PASS — 92 triggers, 0 disabled; no probe (no data write approved)]**
   DELETE and TRUNCATE in an always-rolled-back probe as `service_role` **only if a data write is approved for the
   probe; otherwise read `tgenabled` only**.
9. Row counts and fingerprints of the article, version, unit, approval and proposal tables equal the 6.12a values. **[PASS — all five fingerprints equal the 6.12a values]**
10. The C2 mismatch decision (Q10) still documented; the runbook's "one mismatch" sentence corrected to the A0-01 list. **[FAIL — docs: the runbook names one mismatch; A0-01 lists eight (A2-01 gives the verdict)]**
11. `rate_limit_windows`: rows are only the expected keys (daily caps, sign-in, app limits); no stale windows. **[PASS; A2-08 recorded (5 windows older than 2 days)]**
12. Indexes: every FK and every filter the routes use has an index (read `pg_indexes`; compare to the query shapes in **[PASS with A2-04 (20 foreign keys without a covering index, all on small tables)]**
    the stores).
13. `pg_stat_user_tables` dead tuples / bloat on the append-only tables — info only. **[PASS — dead tuples ≤ 38 on any table; autovacuum runs on the active ones]**
14. Supabase advisors (`get_advisors` security and performance) — record every item. **[DONE — A2-06, A2-11, A2-04 (the advisor items)]**
15. Backups: PITR/daily backup setting for project `nmseedcgtxelufewvbvr` (operator check). **[FAIL — run by the operator 30 Sep: Free plan, no backups or PITR; A2-05 raised to medium, decision pending (Pro plan or an own dump job)]**
16. The `set_updated_at` and `rls_auto_enable` functions: platform-provided, not in the repo; record. **[PASS — `set_updated_at` is the repository's (20260913120000); `rls_auto_enable` is the platform's (A2-11)]**
17. `service_role` SELECT missing on `crawl_links` and the grant asymmetry on the legacy tables — part of A0-02. **[DONE — part of A2-02 / A2-03]**
18. Extensions installed vs used (`list_extensions`). **[PASS — pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp; nothing unused by the platform]**
19. Storage buckets: `storage.buckets` has 5 triggers — confirm no bucket exists and storage is unused. **[PASS — 0 buckets, 0 objects]**
20. Realtime: `realtime.subscription` — confirm no publication includes an application table. **[PASS — no publication holds a table]**
21. The `nexra_content_publication_proposals` UPDATE grant and its guard (A1-29). **[PASS (A1-29)]**
22. Migration files never edited after apply: `git log --follow` on each applied file shows one commit (or docs-only **[PASS — three files carry two commits each, all before their apply; the applied schema equals the current files (A2-01)]**
    header changes never applied — record any).

### A3 Agents (18 items) — run 30 Sep 2026 at `8451980`: 15 PASS, 0 FAIL, 3 DONE (record-only items)

Method: a code read of the runtime, grounding, handoffs, provider and worker SQL; `npm test`; read-only production
queries on runs, attempts, rate-limit windows, tasks, task events and snapshots. Findings: `FINDINGS.md` A3-01…A3-11.

1. All 27 task types: registry entry, grounding reader, instructions, tests — a table; FAIL for any without a test. **[PASS — every task named in ≥ 2 test files; A3-01 (11 instructions not hash-pinned)]**
2. Output bounds: each structurally bound instruction's worst case (full caps) under the 2,000 ceiling (the 6.5/6.6c **[PASS — full-caps worst cases 1,633–1,978, all under 2,000; live lengths and refusals in A3-10]**
   tests); the live answer lengths from production runs (read `agent_runs.result_summary` lengths, read-only) against
   the 1,200 soft target; list refusals (`rejected-output`) with dates.
3. `rejected-output` history: every occurrence, its task, and whether a bound was later added. **[DONE — A3-10 (11 refusals, 21–27 Sep, each task bounded afterwards; none since 28 Sep)]**
4. Daily caps: `daily-caps.ts` keys and windows; the counters in `rate_limit_windows` for the last days; the held-run **[PASS — create and execute counters per project and in all, per UTC day, read in production; held path tested]**
   path (`heldByCap`) covered by a test.
5. The worker: claim (`skip locked`), lease, heartbeat, recovery (`recover_expired`), retry policy and costs **[PASS — skip-locked claim, 60 s lease, 15 s heartbeat, recovery and retry pinned by tests and the harness; A3-05, A3-06]**
   (`retry-cost.test.ts`); the 04:00 recover job's effect on a run left `running`.
6. Provider: abort classification (Q11), rate-limit and 5xx classification, timeout values; the API key read once. **[PASS — A3-08]**
7. Grounding ceilings: every evidence kind's byte ceiling and truncation line; a missing reader never fails a run **[PASS — every kind has a ceiling and a stated cut; second-task appendices never fail a run]**
   (6.5 rule) — one test per kind.
8. The Director bundle: five slots, `MAX_BUNDLE_BYTES`, the stored summary within the run store's check. **[PASS — five slots, 66,000 bytes; A3-09 (docs say 54,000)]**
9. Handoffs: 11 of 12 agents; the Writer deferred by decision; the record chooser refusals **[PASS — 11 agents mapped, the Writer deferred, every refusal code tested]**
   (`record-required` etc.) tested.
10. The learning loop: `priority-changed` with a cited run only when that run is a completed **[PASS — A3-04 (the one citation reads as recorded)]**
    `project-priority-review` of the same project — the trigger and the function both; the one production citation
    (task `30e79092…` seq 21) still reads as recorded.
11. Instruction hash pins: every pinned hash in tests equals the current text (`npm test` covers; list the pins). **[PASS — 16 pins, `npm test` 2,593 of 2,593; A3-01]**
12. The mock executor covers every task type (so `NEXRA_AGENT_EXECUTOR=mock` never crashes). **[PASS — all 27 covered; the switch is exhaustive and type-checked]**
13. Output screening on every stored answer (`output-screen.test.ts`) and the `looksLikeSecret` withholding in **[PASS — A3-07 (prompt injection: advisory only; three defence-in-depth gaps)]**
    grounding.
14. Run history view: `runNowOffered` only on queued runs of the page's agent (6.6b tests). **[PASS]**
15. Production run totals: 82 runs, 83 attempts, all executors and models as recorded; any run `running` or `retrying` **[PASS — 82 runs, 83 attempts, all `ai`, every completed attempt `claude-opus-5`, 0 stale]**
    for more than a day (read-only).
16. The checker variance finding (6.10b): document the default-sampling setting and the post-V1 items (carry-forward, **[DONE — A3-03 (backlog; the draft fact-check is the other verdict task)]**
    instructions v3) as backlog, not findings.
17. `approval-required` policy exists in the contract but no task uses it — record as latent (6.1 finding). **[DONE — A3-11]**
18. The 1,200-character soft target overshoot (4.8): current numbers from production; still under 2,000. **[PASS — 29 of 71 completed answers over 1,200, none over 2,000 (A3-10)]**

### A4 Screens (16 items) — run 30 Sep 2026 at `95bf284`: 12 PASS, 2 FAIL, 2 DONE (record-only items)

Method: a local production build signed in as a test operator against a throwaway stand-in for Supabase (three
passes: fixture roster with no database, one stored project with no records, every read failing), Playwright at 375
and 1,280 px on all 21 pages, a click test with every write aborted in the browser, and a code read of every write
control. Production is left to the operator (read-only prompt: `A4-PRODUCTION-PROMPT.md`). Findings: `FINDINGS.md`
A4-01…A4-12.

1. Every sidebar destination resolves to a real route (13 entries incl. Settings); no dead link in the shell. **[PASS — all 12 sidebar destinations and every page loaded locally (200, or the in-shell "not found" for unknown ids)]**
2. Observed screens (Command Center, Keywords, Content, Technical, Competitors, AI Visibility, Outbound Links, **[PASS — `modelled-screens.test.ts` green (`npm test` 2,593 of 2,593)]**
   Analytics, Reports): import no fixture module (`modelled-screens.test.ts` + a grep for `@/lib/mock` in each screen's
   component tree).
3. Mixed screens (Projects, a project, AI Agents, an agent): every fixture section wrapped in `ModelledSection`; live **[PASS — the test; the one control outside a Modelled section is A4-04]**
   sections labelled observed (the test).
4. Remaining fixture data: list `src/lib/mock/*` modules and which screens still import each; note the two **[DONE — module importer counts in FINDINGS A4; both 6.12b files still unimported]**
   unimported components kept in 6.12b (`keywords/pagination`, `projects/unmeasured-selection-notice`).
5. No control that does nothing: grep every `onClick`/`action` for a handler that only sets local notice state. **[FAIL — A4-04 (Run SEO Analysis, header search, workspace switcher, notifications text)]**
6. Empty, loading, error and not-connected states on every observed screen (read each component's branches). **[PASS — empty (pass B), read-failure (pass C) and not-kept (pass A) states seen on every observed screen; A4-07]**
7. Remaining 404 links: none expected after 6.3 (grep hrefs to `/content/`, `/competitors/`, `/keywords/clusters`). **[FAIL — A4-06 (two fixture links inside the fixture project workspace)]**
8. `/dev/*` routes (A0-06): keep, gate by `NODE_ENV`, or remove — decision. **[DONE — A4-08 (decision)]**
9. Responsive check at phone/tablet/desktop widths on the observed screens (operator, browser; not checkable here). **[PASS locally — 21 pages at 375 and 1,280 px, no horizontal overflow; production (operator, 30 Sep, 1,094 px): no sideways scroll, two small layout breaks (A4-11), slow automated loads not reproduced by hand (A4-10); the 375 px production pass skipped (covered locally)]**
10. Print view of Reports hides the chrome (`print:hidden`) — read `app-shell.tsx`. **[PASS — sidebar, drawer and header wrapper `print:hidden`; Reports controls hidden in print]**
11. Every screen's project selector defaults to `?project=` then the first stored project; a project with no records **[PASS — `?project=` read on all nine observed screens, else the first stored project; seen in passes A and B]**
    shows honest empty states, never zeros.
12. Labels: "not rank", "not a trend", "declared, as crawled", "a proposal is a record of intent" present where **[PASS — each label present; A4-05 (page subtitles contradict them)]**
    CLAUDE.md says (grep).
13. The Settings screen holds browser preferences only and says so. **[PASS — preferences in this browser only, stated on the screen]**
14. Accessibility basics: form labels, button names, focus order on the review controls (spot check). **[PASS — 0 unnamed buttons, 0 unlabelled inputs, focus visible on every sampled stop; confirm steps in A4-01…A4-03]**
15. Build output: the 11 list pages `force-dynamic` (`ƒ` in `next build`), detail pages as documented. **[PASS — the 11 list pages `ƒ`; detail pages `ƒ` with the stored roster (A4-09)]**
16. `build-status.ts` sidebar note names every observed screen and no more. **[PASS — names the nine observed screens and no more]**

### A5 Content path (16 items)

1. C1 validator refusals (every code) covered by tests; the canonical format `/1` byte-stable (the V4 pin test).
2. C2: versions immutable; `nexra_article_versions` guards; the C2 mismatch (A2-1).
3. C4: unit packing (10 statements / 6,000 bytes / 150 units), the parser's `failed`/`coverage-incomplete` path,
   results bound to one version; production's 23 units all bound to existing versions (read-only).
4. C5: approval only when every unit passed and the article is `checked`; the attestation tick and ≥3-supported rule
   apply only when something is attested; production's 2 approvals consistent with their versions.
5. C6: eligibility blocks in fixed order; the preview `/1` and `/2` hashes reproduce for the two production
   proposals (`bbf3fae3…`, `47178c61…`); the D3 slug lock across both tables.
6. Live slugs: `liveSlugsFor` equals the SQL list (the drift test); D2 and D10 rules; the owning-article rule.
7. The renderer (6.9b): every refusal code tested; `tsString` hostile text; the `/2` template pins
   (`lib/blog.ts` `c4af6f5c…`, live article `c2f2da23…`, `article.tsx` `beb543a0…`) — **now stale against nexra-ai
   `main` `9a69c8c`** (`lib/blog.ts` is `d6f1c74c…`, the live article `e5f173dd…`): record; re-pinning is post-V1 work.
8. The renderer against nexra-ai `main`: render V6 with the live files and confirm `registry-changed` /
   `live-article-changed` are the refusals (the pins protect against a second publish over changed files).
9. The live page: `/blog/ai-dead-lead-reactivation` — title, date, "4 min read", 3 "Our view" labels, FAQPage, canonical
   on www, the cross-link from the follow-up article (operator, browser; the session proxy refuses the host).
10. Article `1003104c…` V6 hash `5ae7594d…` and `c89182f9…` V4 `e9db287f…` unchanged (read-only).
11. Proposal states: `5f229630…` withdrawn, `ea85edb0…` proposed — the one active — and nothing else.
12. The draft path (Stage 1–5B): the draft store's compensating delete still the only DELETE the app makes on a
    content table; draft proposals 0.
13. Attestation limits (40 % / half a section / no numbers) enforced in the validator and mirrored nowhere else that
    could drift.
14. The checker instructions v2 hash `8788932b…` pinned; the parser accepts six- and seven-heading answers.
15. Website completeness reporting never blocks (`readingTime`, `published` at publication time).
16. The four "meta description" sentences in the live article (post-V1 backlog: external sources) — record, not a
    finding.

### A6 Operations (14 items)

1. Runbook §1 (migrations) matches what was actually done for 20261005–20261011 (the CLAUDE.md records); add the A0-01
   list to §1.5.
2. Deployment confirmation: the Vercel API refuses this session (403) and the production host is proxied off — the
   runbook's §2.1 depends on the operator; record which merges of Phase 6 have a confirmed deployment id (from
   CLAUDE.md §0: several "not read").
3. Rollback (§2.2): the previous production deployment id is recorded for each merge or not — list gaps.
4. `/api/health`: an uptime monitor exists or not (operator); the endpoint's behaviour when the database is slow
   (2 s) tested.
5. Cron: both jobs' last runs succeeded (Vercel logs; operator) — the 05:30 process job's `snapshots` field for the
   last 7 days; snapshot rows continue daily (`nexra_search_console_snapshots` — 5 rows: read-only, list window ends).
6. CI: every PR since #25 merged on green; `master` runs green; the workflow pins Node 22 and no credential.
7. Branch protection: configured but not enforced (plan); merge discipline is documented — record.
8. Secret rotation: which secrets have rotated since creation and when (operator; names only).
9. Logs: no secret or content body in server logs (grep `console.` and the log helpers for what they print).
10. Dependency currency: `npm outdated` and `npm audit` (read-only) — record counts, no upgrade.
11. Docs against production: CLAUDE.md §0 counts (runs 82, attempts 83, articles 2, versions 10, units 23,
    approvals 2, proposals 2, keywords 2, tasks 1, events 16, snapshots 5, query pages 42, crawls 8 + 5 legacy) — one
    read-only query; FAIL on any difference.
12. `docs/BACKEND.md` "Environment variables" section equals `.env.example` (names).
13. The auto-deploy skip of 27 Sep (`ddc6cbb4`): is the cause known now; is a manual-redeploy step in the runbook.
14. Disaster path: a restore drill has or has not been done (operator).

---

## 3. Findings format

Every finding, in `FINDINGS.md`, uses this shape (one block per finding, ids `A<part>-<nn>`; A0 for items found
during planning):

```
### A1-01 — <one-line title>
- Severity: critical | high | medium | low | info
- Evidence: <file:line, query, or command and its output>
- Impact: <what can go wrong, for whom>
- Suggested fix: <the smallest honest change; "decision needed" where it is one>
- Effort: S | M | L
- Status: open | accepted (no fix) | fixed in <PR> | superseded
```

Severity: **critical** — data loss or unauthorised write possible now; **high** — unauthorised read or a broken
safety rule; **medium** — drift that will cause an incident or a wrong operator decision; **low** — hygiene with a
plausible path to harm; **info** — a fact to record, no action implied.
