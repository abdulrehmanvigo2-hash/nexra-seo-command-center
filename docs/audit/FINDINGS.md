# Full audit — findings

Base: `master` `88cb186` (FULL V1). Format and severities: `AUDIT-PLAN.md` §3. The audit records; it does not fix.
Each part appends its findings under its heading; A0 holds what the planning pass found.

## A0 — found while planning (30 Sep 2026)

### A0-01 — Migration history differs from the repository in 8 versions, not the 1 documented
- Severity: medium
- Evidence: `select version, name from supabase_migrations.schema_migrations` (34 rows) against
  `ls supabase/migrations` (33 files). Production rows with no file of that version: `20260919120000`
  (`create_crawls`, 15 statements), `20260920120000` (`create_crawl_pages`, 25), `20260921120000`
  (`create_crawl_page_signals`, 7), `20260922111302`, `20260922111312`, `20260922133139`, `20260922133152`,
  `20260922172606` (the five content-draft migrations), `20260923043554` (`create_articles`, the documented Q10
  mismatch). Repository files with no row of that version: `20260920120000_create_crawls`,
  `20260920120100_grant_crawls_to_service_role`, `20260922120000`, `20260922120100`, `20260922130000`,
  `20260922130100`, `20260922140000`, `20260923120000`. Rows `20260923180000` and `20260924120000` hold no
  statement text. The six single-statement rows `20261005120000`–`20261011120000` hash exactly to their files.
  `docs/RUNBOOK.md:107-112` documents only the `20260923…` pair.
- Impact: the history is not a truthful record of what the repository files did; `supabase migration list` and
  `db push` are unusable as a check (the runbook already forbids `db push`); an operator reading the runbook would
  believe one mismatch exists. Whether the *schema* matches each renumbered file is unverified (A2-2).
- Suggested fix: A2 verifies the schema for each pair; then a decision — extend the Q10 note to the full list (docs,
  S) or repair the history with the CLI's `migration repair` under §6 (M). Never re-execute a migration.
- Effort: S (docs) / M (repair)
- Status: superseded by A2-01 (the schema matches the repository; severity low there)

### A0-02 — Five legacy crawl tables and four functions exist in production that nothing in the repository names
- Severity: medium
- Evidence: production tables `crawls` (9 rows, 19 columns, 2 triggers), `crawl_pages` (43, 19, 2), `crawl_urls`
  (43, 4, 0), `crawl_page_signals` (40, 15, 1), `crawl_links` (0, 7, 0); `security definer` functions
  `crawls_guard_update`, `crawl_pages_claim`, `crawl_pages_count_change`, `crawl_pages_recover_expired`, each
  executable by `service_role`. Created by the production-only history rows `20260919120000`, `20260920120000`,
  `20260921120000` (A0-01). `grep -rnE "\b(crawls|crawl_pages|crawl_urls|crawl_page_signals|crawl_links)\b" src`
  finds no table reference; `supabase/migrations/*.sql` creates only the `nexra_`-prefixed crawl tables.
- Impact: unmanaged schema and data in production; `service_role` can still write these tables and call the claim
  and recover functions; the 5.4 guards do not cover them; the docs (BACKEND.md, README) do not mention them, so an
  operator restoring or auditing would not expect them.
- Suggested fix: decision needed — record them as retired (docs) and, under §6, a migration that revokes
  `service_role`'s writes and EXECUTE on them, then drops them after an export; or keep and document.
- Effort: M
- Status: closed — F6: the five tables and four functions dropped by migration `20261013120000_retire_legacy_crawl_subsystem.sql` (PR #83, `5eaaf0b`), applied and recorded 30 Sep, after backup run `36740624220`

### A0-03 — `anon` and `authenticated` hold TRUNCATE, TRIGGER and REFERENCES on the legacy `crawl_links` table
- Severity: low
- Evidence: `information_schema.role_table_grants` for `table_schema='public'`, grantees `anon` and `authenticated`:
  exactly six rows, all on `crawl_links` (TRUNCATE, TRIGGER, REFERENCES each). No SELECT, INSERT, UPDATE or DELETE
  for either role on any table. RLS does not gate TRUNCATE.
- Impact: a holder of the public (anon) key could truncate this table (0 rows today) and create triggers or foreign
  keys against it; the application's own tables are unaffected. A leftover of Supabase's default privileges on a
  table created outside the repository's grant pattern.
- Suggested fix: a migration `revoke all on table public.crawl_links from anon, authenticated` (or its drop under
  A0-02).
- Effort: S
- Status: closed — F6: `crawl_links` dropped (30 Sep, migration `20261013120000`); `anon` and `authenticated` now hold no table privilege in `public`

### A0-04 — Trigger functions are executable by `anon` and `authenticated` through PUBLIC's default EXECUTE
- Severity: info
- Evidence: `has_function_privilege('anon', oid, 'execute')` is true for 17 functions: the `*_guard_*`,
  `*_check_insert`, `set_updated_at` trigger functions and the platform's `rls_auto_enable`. All return `trigger` or
  `event_trigger` and cannot be called directly.
- Impact: none today; hygiene only (the repository's later migrations revoke PUBLIC explicitly; the earlier ones did
  not).
- Suggested fix: a migration revoking EXECUTE from PUBLIC and the API roles on the 16 application trigger functions,
  matching the later pattern.
- Effort: S
- Status: open

### A0-05 — 32 production function bodies carry CRLF line endings from SQL-editor pastes
- Severity: info
- Evidence: `select proname from pg_proc where prosrc like E'%\r%'` → 32 of 103 functions, from `agent_run_claim`
  to `set_updated_at` (the migrations applied through the SQL editor before the hash-checked method of 3.5). The
  6.12a apply replaced the one live-slug function that had this.
- Impact: none at runtime; a byte comparison of a production function body against its repository file fails for
  these, so A2-7 must normalise line endings before comparing. Any *other* divergence would be masked without that.
- Suggested fix: none required; A2 compares with normalised endings and records any real difference.
- Effort: S
- Status: open

### A0-06 — Development preview routes `/dev/data` and `/dev/ui` ship in the production build
- Severity: low
- Evidence: `src/app/(app)/dev/data/page.tsx`, `src/app/(app)/dev/ui/page.tsx`; no `NODE_ENV` guard or `notFound()`;
  `robots: { index: false }`; behind the operator gate (`access.ts` allows only `/login` and `/api/health` without a
  session); absent from the sidebar.
- Impact: an operator can reach two fixture-only pages in production; no data exposure (fixture and UI primitives),
  but they are surfaces outside the documented product and not covered by the Modelled-label rule.
- Suggested fix: decision — remove them, or return `notFound()` unless `NODE_ENV === "development"`.
- Effort: S
- Status: fixed — F7: `/dev/data` and `/dev/ui` removed from the build

### A0-07 — The renderer's `/2` template pins are stale against nexra-ai `main`
- Severity: info
- Evidence: `src/lib/content/articles/website/template.ts` pins `lib/blog.ts` `c4af6f5c…` and the live article
  `c2f2da23…` at `1a688bd`; nexra-ai `main` `9a69c8c` holds `d6f1c74c…` and `e5f173dd…` (6.11). By design the
  renderer refuses `registry-changed` / `live-article-changed` against the current files.
- Impact: none for V1 (no second publish is planned); a second article cannot be rendered until the template is
  re-pinned — a post-V1 checkpoint, already in the backlog.
- Suggested fix: none in the audit; re-pin at the next publishing checkpoint.
- Effort: S
- Status: superseded by A5-01 (a re-pin alone is not enough)

### A0-08 — Deployment confirmation cannot be done from this session
- Severity: info
- Evidence: the Vercel API answers 403 to this session; the proxy refuses `www.nexraagency.com` and the production
  host; CLAUDE.md §0 records "deployment id not read" for the merges of PR #56–#59 and #65–#67.
- Impact: the runbook's §2.1 (confirm the deployment id, READY and the alias after every merge) rests on the operator;
  the 27 Sep auto-deploy skip shows why it matters.
- Suggested fix: the operator confirms the current production deployment is at `88cb186` (A6-2); consider a Vercel
  token scoped to read deployments for the session, under §6.
- Effort: S
- Status: open

## A1 — Security (30 Sep 2026, at `3a3f5c6`)

Checklist result: 27 PASS, 2 FAIL (items 8 → A0-03, 21 → A1-01), 1 OPERATOR (item 14 → A1-07 (a)); item 30 was run by the operator on 30 Sep (A1-08). (PR #69 tagged item 14 with item 30's result by mistake; corrected in the A2 checkpoint.) The evidence
that produced the PASS marks, in brief:

- **Gate (items 1, 2, 5, 22):** `src/lib/auth/access.ts` — only `/login`, `GET|HEAD /api/health`, `/auth/*` and
  `/api/worker/*` pass without an operator session; the matcher in `src/proxy.ts` excludes only `_next/static`,
  `_next/image` and the icons. All 29 non-worker API routes call `getOperator()` (`src/lib/auth/session.ts`, a
  `getUser()` round-trip) and every one of the 15 exported Server Actions does too (`article-proposal-actions.ts`
  through its shared `dependencies()` helper). All 9 operator POST routes call `isSameOrigin` (`Origin` equal to the
  request origin, else `Sec-Fetch-Site: same-origin`); the two worker POST routes use the Bearer instead. Local run
  of the production build with no environment: every page → 307 to `/login?next=…` (`/dev/data` and `/dev/ui`
  included), every API route → 401 `{"error":"unauthorized"}`, a Server Action POST to `/projects` → 401, the worker
  routes → 401 with no, or a wrong, Bearer; `/login` 200; `/api/health` 200 `not-configured`.
- **Operator identity (item 3):** `operatorFromUser` requires a string `email_confirmed_at` and a listed email; the
  proxy's claims check is optimistic and every write re-checks. Production: 1 auth user, confirmed, provider `email`.
- **Sign-in and worker (items 4, 6, 7):** 5 attempts per email and 50 overall per 15 minutes, database-backed, the
  email never stored (`sign-in-limits.ts`); the worker secret is compared as SHA-256 digests with `timingSafeEqual`,
  must be ≥ 32 characters, and unset means every worker request is refused (`worker-auth.ts`); `log.ts` redacts any
  value `looksLikeSecret` flags; the sign-in action logs only `error.name`.
- **Database (items 8–11, 26–29):** RLS on all 31 tables, 0 policies, no DML grant to `anon`/`authenticated` except
  the legacy `crawl_links` (A0-03); all 37 `security definer` functions owned by `postgres` with an empty
  `search_path` (the platform's `rls_auto_enable` uses `pg_catalog`); EXECUTE for `service_role` only on the
  application's functions; 11 guard triggers enabled on `projects`, `agent_runs`, `agent_run_attempts` and the three
  `nexra_crawl*` tables, 0 triggers disabled anywhere; the D3 `reserve_slug` triggers enabled and READ COMMITTED the
  default; `rate_limit_windows` holds 18 key shapes, all expected, none carrying an email or address;
  `src/lib/approvals` is imported by no route or action; the draft-proposal update guard makes the binding immutable
  and `withdrawn` final, so `service_role`'s UPDATE grant on that table reaches only the withdraw path.
- **Secrets (items 12, 13, 15):** `npm run secret-scan` clean; every one of the 20 allowlist entries is a test file;
  the five `NEXT_PUBLIC_` refusals each have a test; a pattern scan of both repositories' full history (private
  keys, JWTs, `sk-ant-`, `ghp_`, AWS ids, the service-role variable) finds only the synthetic test fixtures — and the
  one non-credential item in A1-04.
- **Input and output (items 16–19, 23, 24):** GET routes validate `?project=` before any read (`isStorableProjectId`
  or the id regex → 400 `invalid`); POST routes read bodies through `readJsonBody` (16 KiB cap) and a contract parser;
  stored answers pass the output screen and grounding quotes are withheld on `looksLikeSecret`; the crawler's
  `network-guard.ts` blocks loopback, private, link-local (169.254.169.254 included), IPv4-mapped and IPv6 ULA /
  link-local / `::1` addresses, pins each hop to the resolved address, re-guards every redirect, and the fetcher caps
  the body at 2 MiB and 10 s over `http`/`https` on allowed ports only; the renderer's hostile-text test holds; the
  Anthropic request is `system` + one user message only; no Search Console answer carries the property.
- **Rate limits (item 25):** runs create 30 / action 60 per 10 min; tasks create 30 / read 120 / action 60; crawls
  start 10 / read 120 / triage 60; keywords read 120 / write 60; every article, draft, publication and project Server
  Action has its own; sign-in 5 / 50 per 15 min; health 120 per minute; the daily run caps.

### A1-01 — No security headers are configured
- Severity: low
- Evidence: `next.config.ts` is the empty template (`const nextConfig: NextConfig = {}`); the local production build
  answers `/login` with `X-Powered-By: Next.js` and no `Content-Security-Policy`, `X-Frame-Options` /
  `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`. Only `Cache-Control:
  private, no-store` is set (by the proxy). HSTS is not verifiable from this session (Vercel adds it at its edge on
  production; the operator should confirm with `curl -I` — A1-07).
- Impact: an authenticated operator page can be framed by another site (clickjacking of the review and approval
  controls); the browser has no CSP to contain an injected script; the referrer leaks operator URLs (which carry
  project ids and article ids) to any external link. All bounded by the operator-only audience and `httpOnly`,
  `sameSite=lax` cookies.
- Suggested fix: a `headers()` entry in `next.config.ts` for every route — `frame-ancestors 'none'` (or
  `X-Frame-Options: DENY`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  a `Permissions-Policy` denying camera/microphone/geolocation, and a CSP (start in report-only) — plus
  `poweredByHeader: false`. A code checkpoint with a header test.
- Effort: S
- Status: fixed — PR #81 (`75e51b8`): security headers on every route and no `X-Powered-By` (production headers to be confirmed by the operator with `curl -I`)

### A1-02 — Session cookies are written without the `Secure` attribute
- Severity: low
- Evidence: `src/lib/auth/config.ts` `SESSION_COOKIE_OPTIONS = { path: "/", sameSite: "lax", httpOnly: true }`;
  `@supabase/ssr`'s `DEFAULT_COOKIE_OPTIONS` (`dist/module/utils/constants.js`) set `path`, `sameSite`, `httpOnly:
  false` and `maxAge` only — neither sets `secure`. The app improves on the library (`httpOnly: true`), but no
  `Secure` flag is written.
- Impact: a browser will also send the session cookie on a plain-`http` request to the production host (for example
  a typed `http://` URL before Vercel's redirect to `https`), exposing it to a network observer once. `sameSite=lax`
  and `httpOnly` limit the rest.
- Suggested fix: add `secure: true` to `SESSION_COOKIE_OPTIONS` when the configured Supabase URL is `https` (it
  always is outside localhost); a test in `config.test.ts`.
- Effort: S
- Status: fixed — PR #81 (`75e51b8`): session cookies `Secure` in a production build

### A1-03 — `npm audit`: one high advisory, in the lint toolchain only; 12 packages outdated
- Severity: info
- Evidence: `npm audit --json` → 1 high, 0 others: `brace-expansion` (≤ 1.1.20 and 4.0.0–5.0.11; CPU / stack
  exhaustion on hostile patterns) reached through `eslint` → `minimatch` and `eslint-config-next` →
  `typescript-eslint`. `npm ls brace-expansion --omit=dev` → empty: it is not in the production dependency tree.
  `npm outdated` lists 12 packages.
- Impact: none at runtime; the vulnerable code runs only in `npm run lint` on trusted input.
- Suggested fix: bump the ESLint chain at the next dependency checkpoint; nothing urgent.
- Effort: S
- Status: open

### A1-04 — A dangling commit on GitHub holds the production approver's auth user id (known)
- Severity: info
- Evidence: commit `38696afd96bc04ff1b58da5f665089244acbbd5d` (28 Sep, the first push of checkpoint 6.8b) added
  `src/lib/content/articles/test-support/v4-pin.json` with the real `approvedBy` (the operator's Supabase Auth user
  id, `b2f9fb2…`). It was replaced by the placeholder `00000000-0000-4000-8000-00000000a4a4` in `49b6042`, the only
  commit of PR #59, before the merge. `git merge-base --is-ancestor` on the unshallowed clone: **not** an ancestor of
  `master`; the object is still served by GitHub by its SHA (a dangling commit). No credential-shaped text exists
  anywhere in either repository's history (the A1 scan).
- Impact: a user id is an identifier, not a credential: it grants nothing and Supabase RLS holds no policies keyed
  on it. It does identify the operator's account to anyone holding the SHA.
- Suggested fix: accept as is; optionally ask GitHub support to purge the unreachable object.
- Effort: S
- Status: accepted (no fix)

### A1-05 — The Supabase publishable (anon) key is server-only in this application
- Severity: info
- Evidence: the key is read only in `src/lib/auth/config.ts` and used only by `src/proxy.ts` and
  `src/lib/auth/server-client.ts` (server side); there is no `createBrowserClient` and no `"use client"` module
  imports Supabase; sign-in is a Server Action; `SUPABASE_PUBLISHABLE_KEY` has no `NEXT_PUBLIC_` name and the config
  refuses a secret key in its place; a grep of `.next/static` for the key shape, `PUBLISHABLE`, `SERVICE_ROLE` or the
  project host finds nothing. `service_role` is read only by `src/lib/supabase/server.ts` (`import "server-only"`).
- Impact: this application never publishes the anon key, so A0-03's TRUNCATE grant is reachable only by someone who
  already holds the key from the Supabase dashboard — which keeps A0-03 at **low**. Supabase treats the anon key as
  public by design, so the revoke in A0-03 still applies.
- Suggested fix: none here (see A0-03).
- Effort: S
- Status: accepted (no fix)

### A1-06 — Direct table writes by the application, and which guard covers each
- Severity: info
- Evidence: `agent_runs` insert and patch (`agent-runs/supabase/store.ts:62,132` — `agent_runs_guard_update`
  limits the patch; claims and finishes go through the `security definer` functions); `nexra_crawls` insert and the
  completion update, `nexra_crawl_pages` / `nexra_crawl_links` inserts (`crawl/supabase/store.ts:68,83,114,123` —
  the 5.4 truncate guards only; no column guard on the completion update); `projects` insert and the
  `competitor_domains` update (`projects/supabase/gateway.ts:96,107`); `nexra_content_drafts` compensating delete
  (`drafts/supabase/store.ts:113`); `nexra_content_publication_proposals` withdraw update
  (`publications/supabase/store.ts:112`, guarded). Every other write is a `security definer` function.
- Impact: none found; the crawl completion update is the engine's own row. Recorded so A2 can decide whether
  `nexra_crawls` should gain an update guard like `agent_runs`.
- Suggested fix: none required.
- Effort: S
- Status: accepted (no fix)

### A1-07 — Three checks the operator must run (not checkable from this session)
- Severity: info
- Evidence: (a) Vercel → Project → Environment Variables: every secret targets **Production** only (the C6 release
  checked this once); (b) Supabase → Authentication → Providers/Settings: email confirmation required and whether
  public sign-up is enabled (harmless either way — an unlisted account gets nothing — but "disabled" is the smaller
  surface); (c) `curl -I https://<production host>/login` shows `strict-transport-security` (Vercel's default) and,
  after A1-01, the new headers.
- Impact: unverified assumptions in the runbook until run.
- Suggested fix: run the three checks and note the results in this file.
- Effort: S
- Status: open — (b) done, see A1-08; **(a) PASS** (operator, 30 Sep, Vercel dashboard for
  `nexra-seo-command-center`: every variable targets Production only; `SUPABASE_SERVICE_ROLE_KEY`, the Anthropic key,
  the Google private key and `CRON_SECRET` are marked sensitive; no `POSTGRES_*`, `DATABASE_URL` or `SUPABASE_DB_*`
  name exists, so the database password is held nowhere in Vercel); (c) still open

### A1-08 — Supabase Auth: public sign-up was enabled; turned off by the operator on 30 Sep
- Severity: low (closed)
- Evidence: operator's reading of Supabase → Authentication on 30 Sep 2026: "Allow new users to sign up" was **ON**
  and was turned **OFF** the same day; "Allow anonymous sign-ins" **OFF**; "Confirm email" **ON**; exactly one user
  exists (the operator), which the read-only A1 query also showed (1 `auth.users` row, confirmed, provider `email`).
- Impact while it was on: anyone who knew the Supabase project URL and the publishable key could create an account.
  Such an account got nothing: `getOperator()` (`src/lib/auth/session.ts`) asks the Auth server for the user and
  passes it through `operatorFromUser` (`src/lib/auth/access.ts`), which admits only a user whose
  `email_confirmed_at` is set **and** whose email is on `NEXRA_OPERATOR_EMAILS`; the proxy's claims check
  (`operatorFromClaims`) applies the same list. Every page, API route and Server Action runs one of these two, so an
  unlisted account is redirected to `/login` or answered 401 exactly like a signed-out visitor, and RLS holds no
  policies keyed on `auth.uid()`. The only cost was an unwanted row in `auth.users` and a confirmation email per
  attempt. The key itself is not published by this application (A1-05).
- Suggested fix: none further; the setting is now off, and `NEXRA_OPERATOR_EMAILS` stays the gate.
- Effort: S
- Status: fixed by the operator (30 Sep, Supabase dashboard)

## A2 — Database (30 Sep 2026, at `961104f`)

Checklist result: 17 PASS, 2 FAIL (item 10, docs → A0-01 / A2-01; item 15 → A2-05, answered by the operator on 30 Sep: Free plan, no backups), 3 record-only
items done (A2-01, A2-03). Nothing high or above. The comparison method: the 33 repository migrations applied to a
disposable PostgreSQL 16, then on both sides `md5` of every function's `pg_get_functiondef` (CRLF removed), every
table's ordered column list, constraint set, index set, trigger set, grants and RLS flag — 253 rows locally, the
same 253 on production once the five legacy tables, their four functions and the platform's `rls_auto_enable` are
set aside. Result: **columns, constraints, indexes, triggers and RLS identical in aggregate (26 tables each);
functions 98 = 98 with 3 differing; grants 26 = 26 with 7 differing** — both examined below.

### A2-01 — Verdict on the migration-history differences (A0-01): the schema is the repository's; only the record is wrong
- Severity: low (A0-01 reduced from medium: the drift is in the history table, not in the schema)
- Evidence, per version:
  - `20260919120000 create_crawls`, `20260920120000 create_crawl_pages`, `20260921120000 create_crawl_page_signals`
    (production only): their statements create only the legacy objects `crawls`, `crawl_urls`, `crawl_pages`,
    `crawl_page_signals`, their indexes, triggers and functions — **not this repository's schema** (A2-03). No
    recorded statement creates `crawl_links`; it was made outside any recorded migration.
  - `20260920120000_create_crawls.sql` and `20260920120100_grant_crawls_to_service_role.sql` (repository only, no
    row): every object they create exists in production and hashes identically (`nexra_crawls`,
    `nexra_crawl_pages`, `nexra_crawl_links`: columns, constraints, indexes, triggers, RLS), and the grants file's
    effect is present (`service_role` SELECT/INSERT/UPDATE/DELETE on the three; nothing for `anon` /
    `authenticated`). Verdict: **identical, unrecorded**.
  - `20260922111302` ↔ `20260922120000_create_content_drafts`, `20260922111312` ↔ `…120100_grant…`, `20260922133139`
    ↔ `…130000_content_draft_save_version`, `20260922133152` ↔ `…130100_…guard_delete`, `20260922172606` ↔
    `…140000_create_content_publication_proposals`: every table, constraint, index, trigger and grant identical; the
    functions `nexra_content_drafts_guard_update`, `nexra_content_draft_versions_guard_update` and
    `nexra_content_draft_save_version` differ from the files **in whitespace, line breaks and comments only** —
    the same conditions, statements, error texts and `search_path` (read side by side). Verdict: **identical
    (renumbered; three functions applied from an earlier formatting of the same text)**.
  - `20260923043554` ↔ `20260923120000_create_articles`: every article object hash-identical. Verdict: **identical
    (renumbered, the documented Q10 pair)**.
  - `20260923180000`, `20260924120000` (rows without text): the check-unit and approval objects exist and are
    hash-identical to the files. Verdict: **identical (recorded by `migration repair`, text absent)**.
  - `20260925120000` → `20261011120000`: version numbers match; the six single-statement rows hash exactly to their
    files; the schema hashes match.
  - Repository files edited after creation: `20260920120000` and `20260920120100` (both rewritten on 20 Sep to move
    off the legacy names, by the commit whose header records the collision) and `20260923180000` (two commits on
    23 Sep) — in every case the applied schema equals the current file.
- Impact: none on behaviour; `supabase migration list` / `db push` stay unusable as a check, and the runbook's
  "one mismatch" sentence understates the record.
- Suggested fix: docs — replace the runbook's Q10 note with this list; optionally, under §6, `migration repair`
  to insert rows for `20260920120000` and `20260920120100` and to mark the five `202609221…` and the `20260923043554`
  rows as the repository's versions (never re-executing anything). The legacy rows belong with A2-03's decision.
- Effort: S (docs) / M (repair)
- Status: fixed (docs) — F7: `docs/RUNBOOK.md` §1.5 lists all eight differences; no repair (never re-executing anything; a repair stays a §6 decision)

### A2-02 — `service_role` holds REFERENCES, TRIGGER and TRUNCATE on seven tables beyond what any migration grants
- Severity: low
- Evidence: production vs the repository build, grants kind: `agent_runs`, `projects`, `nexra_crawls`,
  `nexra_crawl_pages`, `nexra_crawl_links`, `nexra_content_drafts`, `nexra_content_draft_versions` carry
  `service_role=DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`; the migrations grant only
  SELECT/INSERT/UPDATE/DELETE there. The 19 later tables match the migrations exactly. Cause: Supabase's default
  privileges grant ALL to `service_role` on a new table; the early migrations never revoked the surplus.
- Impact: the server's key can TRUNCATE the two draft tables (the 5.4 guards cover the other five) and can create
  triggers on all seven — a schema-changing capability the application never needs. Bounded by `service_role`
  being server-only (A1-05).
- Suggested fix: one migration revoking REFERENCES, TRIGGER and TRUNCATE from `service_role` on the seven tables.
- Effort: S
- Status: fixed — migration `20261012120000_revoke_surplus_grants.sql` (PR #81, `75e51b8`) applied and recorded 30 Sep; the seven tables now `service_role=arwdm`. Follow-up, not in this fix: PostgreSQL 17's MAINTAIN (`m`: VACUUM, ANALYZE, REINDEX, CLUSTER, LOCK) is still held by `service_role` on these seven (and the five legacy tables), which `information_schema` does not list; the application never needs it

### A2-03 — The legacy crawl subsystem (A0-02): provenance, use, last write, recommendation
- Severity: medium (unchanged from A0-02; a decision is needed)
- Evidence: created by the production-only history rows of 19–21 Sep (`create_crawls`, `create_crawl_pages`,
  `create_crawl_page_signals`; `crawl_links` by no recorded row). The repository's own `20260920120000` header,
  rewritten on 20 Sep, calls them "a separate, live crawl subsystem with its own data, triggers and dependent tables
  … not ours and not described anywhere in this repository". Last write: `crawls.updated_at` 2026-09-19 15:27 UTC,
  `crawls.finished_at` 15:28, `crawl_pages.fetched_at` 15:28, `crawl_page_signals.parsed_at` 15:28 — nothing since.
  Referenced by: no file in `src`, `scripts` or `supabase`; no cron (`vercel.json` names only the worker routes);
  only their own five triggers (`set_updated_at` ×3, `crawls_guard_update`, `crawl_pages_maintain_counts`). Functions:
  `crawl_pages_claim`, `crawl_pages_recover_expired` (security definer, EXECUTE `service_role`),
  `crawl_pages_count_change` (security definer trigger function, `postgres` only), `crawls_guard_update` (plain) —
  A0-02's "four security definer" is three. Advisors: two unused indexes (`crawl_page_signals_parsed`,
  `crawl_links_crawl_to_idx`). Grants: `anon`/`authenticated` on `crawl_links` (A0-03); `service_role` ALL on the
  other four.
- Impact: 135 rows of another system's data and four callable functions live in the production database with no
  owner in this repository; any restore, audit or `db push` has to know about them.
- Suggested fix: decision — **retire**, once the operator confirms no other system reads them (the last write was
  the day before the repository disowned them): one §6 migration that exports the rows (a `copy` to a file kept
  outside the repository), revokes every grant, and drops the five tables and four functions; or **keep and
  document** them in `docs/BACKEND.md` and the runbook. Either way A0-03's revoke comes first.
- Effort: M
- Status: closed — operator decision 30 Sep: retire. Backed up by run `36740624220` (artifact `nexra-backup-36740624220`, kept until 30 Oct; the only copy of the 135 rows), re-verified unused, then dropped by migration `20261013120000` (PR #83), applied and recorded 30 Sep

### A2-04 — 20 foreign keys have no covering index
- Severity: info
- Evidence: the performance advisor's `unindexed_foreign_keys` (20) and the same query run directly: the
  `project_id` / `run_id` / `version` / `approval_id` keys on `nexra_agent_task_events`, `nexra_article_approvals`,
  `nexra_article_check_units`, `nexra_article_publication_proposals` (4), `nexra_article_version_sources` (3),
  `nexra_content_drafts`, `nexra_content_publication_proposals` (3), `nexra_crawl_finding_triage` (3),
  `nexra_crawl_findings`, `nexra_keyword_events`. The main run and content tables hold 2–6 indexes each; every
  reference in the schema is a foreign key, so orphan rows are impossible and the consistency checks hold: each
  article's `current_version` equals its highest version and its `approved_version`, one approval each, the current
  version's units complete and all passed (4 of 4, 7 of 7), one active proposal; every run's `attempt_count` equals
  its attempt rows (82 / 83), no run left `running` or `retrying`, no attempt unfinished.
- Impact: none at today's sizes (the largest of these tables holds 23 rows); a cascade or lookup on a large table
  would scan.
- Suggested fix: add the indexes in one migration when a table approaches thousands of rows; not before.
- Effort: S
- Status: accepted (no fix)

### A2-05 — Backups and point-in-time recovery: none (Free plan)
- Severity: **medium** (raised from low on 30 Sep: the operator confirmed the plan)
- Evidence: `get_project` reports only `ACTIVE_HEALTHY`, PostgreSQL 17.6.1, region `ap-southeast-1`, created 13 Sep;
  no backup or PITR field is exposed. **Operator (30 Sep): Supabase project "nexra-seo" is on the Free plan**, which
  keeps no automatic backups and offers no point-in-time recovery; Pro keeps daily backups (7 days) and PITR is an
  add-on.
- Impact: the only copy of every run, article, version, approval and proposal is the live database. A mistaken
  write, a platform incident or a project pause loses it; the 5.4 guards stop deletes but not a lost database.
- Options recorded (decision pending, operator): **(A)** the Pro plan with daily backups (and PITR if wanted);
  **(B)** an own scheduled dump job — a `pg_dump` of the public schema on a schedule, kept outside Supabase, with
  one restore drill (A6-14). Either needs §6 approval (a paid service, or a credential for the dump job).
- Effort: S (A) / M (B)
- Status: fix in progress — F1 (the operator chose to stay on the Free plan with an own encrypted nightly backup, `.github/workflows/backup.yml`, RUNBOOK §6; merged as PR #74; the first two runs on 30 Sep failed at the connection, fixed by F1b and a re-entered secret; run `36720332709` green on 30 Sep, see RUNBOOK §6.2 *Run history*); closed once the operator's restore drill passes

### A2-06 — Auth: leaked-password protection is disabled
- Severity: low
- Evidence: security advisor `auth_leaked_password_protection` (WARN).
- Impact: an operator could set a password known from a breach; with one operator and no public sign-up
  (A1-08), the exposure is that one account.
- Suggested fix: the operator enables it in Supabase → Authentication → Password settings.
- Effort: S
- Status: open (operator)

### A2-07 — Task-event sequence gaps 17–18 are undocumented
- Severity: info
- Evidence: `nexra_agent_task_events` holds seq 1–21 with 12, 13, 14, 17, 18 absent; CLAUDE.md documents 12–14
  (the 2.3b rolled-back probe) but not 17–18, which the 6.7 apply's always-rolled-back probes consumed on 28 Sep
  (two `priority-changed` inserts, one accepted, one refused).
- Impact: none; history is ordered by `seq` and never assumed contiguous. A reader of the docs would not expect
  the second gap.
- Suggested fix: one sentence in CLAUDE.md §0 (the 6.7 record).
- Effort: S
- Status: open

### A2-08 — Five rate-limit windows older than two days remain
- Severity: info
- Evidence: `rate_limit_windows`: 26 rows, 5 with `window_start` before 28 Sep (oldest 27 Sep 10:30 UTC);
  `pg_stat_user_tables` shows 384 deletes, so cleanup runs but does not remove every expired window.
- Impact: none (the daily keys are read by date; stale rows are ignored).
- Suggested fix: none required; A3 may note the cleanup rule.
- Effort: S
- Status: accepted (no fix)

### A2-09 — The scheduled capture is running daily; A0's row counts are already stale
- Severity: info
- Evidence: `nexra_search_console_snapshots` holds 6 rows for `nexra-agency` (windows ending 21–26 Sep, captured
  25–30 Sep at 06:19–06:20 UTC, all `connected`, `source: scheduled`); `nexra_search_console_query_pages` 55 rows in
  5 windows (10, 10, 10, 12, 13). A0 recorded 5 and 42 on the morning of 30 Sep, before the 05:30 UTC job ran.
- Impact: none; evidence for A6-5 that both cron jobs run. The 7-day P4d comparison first qualifies when a window
  ending 28 Sep is stored (captured 2 Oct), as the 4.1 note predicted.
- Suggested fix: none.
- Effort: S
- Status: accepted (no fix)

### A2-10 — The 37 `security definer` functions, checked one by one
- Severity: info
- Evidence: all 37 owned by `postgres`; 36 with `search_path = ""`, the platform's `rls_auto_enable` with
  `pg_catalog`; EXECUTE: 31 application functions `service_role` (and the owner) only; the two `security definer`
  trigger functions (`agent_runs_close_cancelled_attempt`, legacy `crawl_pages_count_change`) owner only; the two
  legacy claim/recover functions `service_role`; `rls_auto_enable` PUBLIC (A2-11). 12 of the 37 carry CRLF bodies
  (A0-05) — every one hash-identical to the repository once normalised.
- Impact: none.
- Suggested fix: none.
- Effort: S
- Status: accepted (no fix)

### A2-11 — The platform's `rls_auto_enable` is executable by `anon` and `authenticated` through the REST `rpc` path
- Severity: low
- Evidence: security advisor `anon_security_definer_function_executable` and
  `authenticated_security_definer_function_executable` (both WARN) on `public.rls_auto_enable()`; the function is
  a `security definer` event-trigger function (`RETURNS event_trigger`) with no ACL (PUBLIC default). PostgREST
  exposes it at `/rest/v1/rpc/rls_auto_enable`.
- Impact: a call fails (an event-trigger function cannot be invoked directly), so no action results; the surface is
  still needless and the advisor will keep flagging it.
- Suggested fix: `revoke execute on function public.rls_auto_enable() from public, anon, authenticated;` in a
  migration (the event trigger keeps working under its owner).
- Effort: S
- Status: fixed — the same migration, applied 30 Sep: `rls_auto_enable` is `{postgres=X/postgres}`, not executable by `anon` or `authenticated`; the `ensure_rls` event trigger still enabled

## Post-V1 backlog additions (from the audit)

- **Client access needs roles and per-project scoping.** Today any email on `NEXRA_OPERATOR_EMAILS` gets full
  control of every project, every run and every write (`operatorFromUser` is the whole authorisation model; RLS
  holds no policies and `service_role` bypasses it). Before any client or second operator is given a login: a role
  table, project membership, RLS policies keyed on `auth.uid()` for the read paths, and the write functions
  checking membership. Recorded in A1/A2; a design note is the first step.
- **Verdict variance beyond the article checker (A3-03).** The draft fact-check is judged under the same default
  sampling; carry-forward and instructions v3 should cover it too.
- **Publishing Level 2 (operator decision, 30 Sep, after F7).** Replace the lean V1 route (a pull request opened from
  a Claude Code session, merged by the operator) with: an approved article's proposal sends an email to the operator
  (or a named assistant); one click approves the exact version and payload, consuming a 6.8 approval record; the
  product then publishes automatically through the designed C7 route (C7b published-state table, a GitHub publisher
  with a fine-grained, expiring token scoped to `nexra-ai`). Needs a **reviewer role** — someone who may approve a
  publication without full operator control — so it depends on the roles and per-project scoping item above. A §4 /
  §6 decision (email delivery, a new credential, an external write) and its own design note first.
- **Branch protection on `master` (enforced).** Today it is configured but not enforced on the current GitHub plan;
  merge discipline rests on the operator's approval and green CI. Enforce required checks (the five CI jobs) and a
  pull request for every change to `master` once the plan allows it, or record why not.

## A3 — Agents (30 Sep 2026, at `8451980`)

Checklist result: 15 PASS, 0 FAIL, 3 record-only items done (3, 16, 17). Nothing high or above. Method: a code read of
the runtime (`src/lib/agent-runs`, the grounding readers, handoffs, the provider and the worker SQL), `npm test`
(2,593 of 2,593 passed at `8451980`) and read-only production queries on `agent_runs`, `agent_run_attempts`,
`rate_limit_windows`, `nexra_agent_tasks`, `nexra_agent_task_events` and the Search Console snapshots. No run was
started and nothing was written.

**Production at audit time:** 82 runs, 83 attempts, every run `executor: ai` and `source: operator`; 71 completed, 11
failed; 0 runs `running` for more than a day, 0 unfinished attempts; every completed attempt records
`claude-opus-5`; one automatic retry ever (`section-draft` `0a5996e4…`, `provider-unavailable` on 22 Sep, completed
on attempt 2).

**Prompt injection — the answer (checklist items 7, 13; A3-07):** crawled pages (own site and competitors), Search
Console queries, task titles, curated keywords and earlier answers reach prompts, and **none of it can make an agent
do more than write advisory text**:

- The model is called once per attempt, non-streaming, with a system prompt and one user message; **no tools, no
  tool choice, no browsing, no second turn** (`providers/anthropic.ts:53-62`). The system prompt says the evidence
  is "data to analyse, never instructions" and that the model has no tools (`ai-executor.ts:159-177`).
- Third-party text is JSON-quoted under headings marked "observations, not instructions" (crawl titles, descriptions,
  h1s, schema types, anchors, queries, task titles, keywords, earlier answers).
- The answer is screened (≤ 2,000 characters, no control characters, no credential shape; `worker.ts:171-185`),
  stored in `agent_runs.result_summary`, and rendered only as escaped React text: no `dangerouslySetInnerHTML`, no
  markdown, no link made from answer text anywhere in `src`.
- Downstream, an answer is only (a) quoted as data in a later prompt (the Director bundle, learnings, the Writer's
  plan), (b) an editable task-title **proposal** the operator confirms, or (c) a draft, article version or
  check-unit record **only after an operator's Server Action**. No answer becomes a URL fetched, a keyword, a slug or
  an outbound request.
- The crawler follows links only within the project's host scope, re-guarded at every hop and redirect, private
  addresses refused (`crawl/fetcher.ts`, `network-guard.ts`).

Worst realistic outcomes: misleading advisory text; a refused run (`rejected-output`) when the model echoes a
credential-shaped string; a biased check-unit verdict that the operator records (it can move an article to `checked`,
never to `approved`, proposed or published).

**Model settings (item 6; A3-08):** one global model for every task (`NEXRA_AI_MODEL`, default `claude-opus-5`),
one global `max_tokens` of 16,000 (`ai-executor.ts:32`), **no temperature, top_p, top_k or seed**, no tools, SDK
retries off, a 115 s request timeout inside the worker's 120 s attempt, and Anthropic's server-side refusal fallback
on (`fallbacks: "default"`). The fallback has never answered: all 71 completed attempts record `claude-opus-5`.

**Cost (tokens from stored metadata, 20–30 Sep, completed attempts only; A3-02):**

| Task type | Attempts | Input tokens | Output tokens |
|---|---|---|---|
| `article-check-unit` | 26 | 223,121 | 18,492 |
| `crawl-review` | 6 | 31,211 | 4,853 |
| `section-draft` | 4 | 26,060 | 2,481 |
| `project-priority-review` | 2 | 18,592 | 3,046 |
| 20 other task types | 33 | 141,072 | 30,158 |
| **All** | **71** | **440,056** | **59,030** |

Largest single attempt: 11,112 input tokens (the five-slot Director bundle), 2,761 output tokens
(`priority-review`). The 12 failed attempts store no token counts.

**The 05:30 UTC worker (item 5; A3-05):** `/api/worker/process` (bearer `CRON_SECRET`, constant-time, 60 calls an
hour per job) re-queues retryable failures (at most 25), then claims up to 5 due runs in 240 s, then captures
Search Console in the time left (at most 45 s). `/api/worker/recover` at 04:00 fails up to 25 attempts whose lease
expired (`lease-expired`, which the next process call may retry). Both are **idempotent under overlap**: every claim
is a row lock (`for update skip locked` for the queue), a repeated snapshot window answers `exists`, and the harness
`claim-races` suite proves two claimers never take one run. The six stored snapshots were captured at **06:19–06:20
UTC** each day, so the job fires about 50 minutes after its schedule (Hobby timing, documented).

### A3-01 — 11 of the 27 task instructions are not hash-pinned
- Severity: low
- Evidence: 16 instruction constants are pinned by SHA-256 in tests (the Director and single-run priority reviews,
  crawl, answer-readiness, performance, task plan, the article check unit, and the nine second tasks). Not pinned:
  `project-review` and `keyword-research` (inline text), `ON_PAGE_REVIEW_INSTRUCTIONS` (the M2 bound),
  `SEARCH_QUERY_REVIEW_INSTRUCTIONS`, `INTAKE_REVIEW_INSTRUCTIONS`, `COMPETITOR_COMPARISON_INSTRUCTIONS`,
  `EVIDENCE_PACK_INSTRUCTIONS`, `CONTENT_PLAN_INSTRUCTIONS`, `SECTION_DRAFT_INSTRUCTIONS`,
  `OUTBOUND_LINK_REVIEW_INSTRUCTIONS` and `FACT_CHECK_INSTRUCTIONS` (the last two only regex-matched for a few
  sentences). Every task is named in at least two test files, and `TASK_TYPES.length === 27` is pinned in three.
- Impact: an edit to one of those eleven texts, including the bounds that ended the 21–27 Sep refusals, passes CI
  unnoticed.
- Suggested fix: add a hash pin per constant in its existing test file (the 6.5 pattern).
- Effort: S
- Status: open

### A3-02 — Cost: refused attempts record no token use, and `max_tokens` is eight times the stored ceiling
- Severity: low
- Evidence: the token table above. The 11 `rejected-output` failures and the one `provider-unavailable` attempt
  store no metadata, so their spend is invisible. `max_tokens` is 16,000 for every task, while the worker stores at
  most 2,000 characters (about 500 tokens); a runaway answer is paid in full and then refused. Output-token counts
  also run well above the visible answer: `page-query-alignment-review` 1,980 output tokens for a 1,074-character
  answer, `priority-review` up to 2,761. The likeliest cause is the model's reasoning being billed as output; not
  investigated.
- Runaway risk: **bounded.** The daily caps count attempts as well as runs (100 in all, 40 a project; counters in
  `rate_limit_windows` read 13, 7 and 8 for 30, 29 and 28 Sep), a run has at most 3 attempts and at most 2 automatic
  retries, and nothing queues a run except an operator. The worst day is about 100 × (≤ 17,000 input + 16,000
  output) tokens.
- Suggested fix: record input and output tokens on a failed attempt when the provider returned them, and set
  `max_tokens` per task nearer the answer bound (for example 4,000). Pricing is left to the operator's own price
  sheet.
- Effort: S
- Status: open

### A3-03 — Verdict-style tasks exposed to the checker variance (6.10b)
- Severity: info (recorded as backlog, per checklist item 16)
- Evidence: no sampling parameter is sent (A3-08), so an identical prompt can be judged differently. The 6.10b
  finding covers `article-check-unit`. The **other verdict-style task** is `draft-fact-check` (Research & Evidence),
  whose classified statements the operator records on a draft version (`drafts/parse-fact-check-output.ts`). Every
  other task writes advisory text: variance changes its wording or ranking, never a recorded state. The Director's
  plan feeds a task only through the operator's confirmed proposal.
- Impact: a draft's fact-check can pass on one run and not on the next, like an article unit.
- Suggested fix: the post-V1 items (carry a passed result forward; checker instructions v3), extended to the draft
  fact-check; optionally a fixed low temperature for the two verdict tasks, as its own decision.
- Effort: M
- Status: backlog (post-V1)

### A3-04 — The learning loop cites correctly; relevance is the operator's call
- Severity: info
- Evidence: four `priority-changed` events exist on task `30e79092…`; only seq 21 (high → medium, 28 Sep 14:36 UTC)
  cites a run, `288639f4…`: a completed `project-priority-review` of the same project, as the trigger and the function
  both require. The task came from Director run `34eb010b…`; the cited later run's bundle read the five reviews
  `941cc617`, `66df0fb1`, `73f38c16`, `17623686` and `5b6cef01`, and its answer names the host variant the task is
  about. The chain performance review → Director run → priority change reads as recorded.
- Impact: none. The database proves the cited run is an eligible Director review; nothing checks that it concerns the
  task, which the operator chooses.
- Suggested fix: none.
- Effort: S
- Status: accepted (no fix)

### A3-05 — Recovery and automatic retries wait for the daily jobs
- Severity: low
- Evidence: both cron jobs run once a day (`vercel.json`), and neither Run Now nor the process job recovers an expired
  lease. A run left `running` stays so until 04:00 UTC the next day, and a retry waits for the next process call.
  Runs queued without Run Now wait for the morning job: five operator runs waited 2 to 22 hours, and `33ac8a25…`
  (queued 26 Sep 08:45) was executed at 27 Sep 06:19 and failed. `docs/BACKEND.md` documents the Hobby limit.
- Impact: slow feedback rather than lost work; nothing is stuck today.
- Suggested fix: none required on the current plan. The operator should know a queued run waits for Run Now or the
  next morning; recovery can be triggered on demand from the worker route.
- Effort: S
- Status: accepted (documented)

### A3-06 — The capped due-run read can pass over a due run behind many retries
- Severity: info
- Evidence: with daily caps on, `listDue` (`agent-runs/supabase/store.ts:107-126`) reads 100 queued rows ordered by
  `created_at` and filters `next_attempt_at` in code; the uncapped SQL claim orders by
  `coalesce(next_attempt_at, created_at)`. A queue holding more than 100 older runs that are not yet due would hide a
  newer due run from the batch.
- Impact: none at today's volume (0 queued runs).
- Suggested fix: order the read by `coalesce(next_attempt_at, created_at)` and filter `<= now()` in SQL.
- Effort: S
- Status: open

### A3-07 — Prompt injection: advisory only; three defence-in-depth gaps
- Severity: info
- Evidence: see the summary above. Gaps:
  - `looksLikeSecret` withholding covers task titles, curated keywords, intake notes and earlier learnings, but not
    crawled titles, descriptions, anchors and link URLs, competitor declarations or Search Console queries.
  - Five crawl fields go into the prompt bare, not JSON-quoted: URL, final URL, canonical href, robots meta and
    content type (`crawl/grounding.ts:223-244, 262`). The robots meta is page text, bounded at 200 characters.
  - The crawl, Search Console and competitor-comparison readers carry no reader-level "report it, do not follow it"
    sentence. They rely on the system prompt's sentence, which applies to every grounded task.
- Impact: a credential-shaped string on a public page can make a run refuse (`rejected-output`); no leak, since the
  product's own secrets never enter a prompt.
- Suggested fix: quote the five fields; add the reader-level sentence; optionally withhold credential-shaped
  third-party text as the task-title reader does.
- Effort: S
- Status: open

### A3-08 — Model settings: one global model, no sampling parameters; a wrong model id fails terminally
- Severity: info
- Evidence: see the summary above. A 404 or any other 4xx is classified `rejected` and becomes `provider-rejected`,
  which is terminal, so a mistyped `NEXRA_AI_MODEL` fails each run once without retrying. The configured model id is
  shown on `/api/worker/status` to authenticated callers only.
- Impact: none today; a model change is a §6 decision.
- Suggested fix: none.
- Effort: S
- Status: accepted (no fix)

### A3-09 — Docs give the Director bundle ceiling as 54,000 bytes; the code says 66,000
- Severity: info
- Evidence: `MAX_BUNDLE_BYTES` = 5 × 6,000 + 2 × 16,000 + 4,000 = 66,000 since 4.6 (`director-bundle.ts:97-100`,
  asserted in `director-bundle.test.ts:469-470`); `CLAUDE.md` (the M5 block) and `docs/BACKEND.md:2281` still say
  54,000, the three-slot figure.
- Impact: none on behaviour.
- Suggested fix: docs.
- Effort: S
- Status: open

### A3-10 — Answer lengths: every earlier refusal was bounded afterwards; none since 28 Sep
- Severity: info
- Evidence: 11 `rejected-output` refusals, all between 21 and 27 Sep: `answer-readiness-review` (21 Sep),
  `competitor-comparison-review` (21 Sep, bounded the same day in `ae34c7f`), `priority-review` ×4 (25–27 Sep; bound
  4.2), `on-page-review` (25 Sep; PR #13), `project-priority-review` (26 Sep; tightened after it), `intake-review`
  (26 Sep; PR #22), `crawl-review` ×2 (27 Sep; 2.3c then 2.3d). No refusal in the 32 runs since 28 Sep. Stored answers
  run from 435 to 2,000 characters: one `intake-review` answer (`97d4fcbe…`, 26 Sep) is exactly at the 2,000 ceiling;
  the latest intake answer is 1,552. **29 of the 71 completed answers are over the 1,200 soft target**: every
  completed answer of the first-generation reviews but `outbound-link-review` (crawl 5 of 6, intake 4 of 4, search
  query 3 of 3, and 2 of 2 each for answer-readiness, competitor comparison, content plan, evidence pack, on-page,
  performance, priority and project priority) and one second task (`competitor-page-gap-review`, 1,247). The other
  second tasks ran 951–1,192; check units, drafts and the task plan 390–1,156. Full-caps worst cases asserted by tests: 1,787
  (answer-readiness), 1,633 (Director), 1,978 (four second tasks and the revision draft), 1,972 (scoped V1), 1,879
  (learning), all under 2,000.
- Impact: none; the 1,200 target stays soft, as 4.8 decided.
- Suggested fix: none.
- Effort: S
- Status: accepted (no fix)

### A3-11 — `approval-required` is latent
- Severity: info
- Evidence: the policy is defined (`action-policy.ts:23`) and refused at queue time (`service.ts:276`) and before
  each attempt (`worker.ts:324`, `policy-blocked`); no task uses it (25 `read-only`, 2 `draft`). Only a client-wording
  test names the refusal.
- Impact: none; the path is untested end to end until a task uses it.
- Suggested fix: when the designed publishing route (post-V1) adds an approval-required task, add a worker test for
  `policy-blocked`.
- Effort: S
- Status: accepted (latent)

## A4 — Screens (30 Sep 2026, at `95bf284`)

Checklist result: 12 PASS, 2 FAIL (items 5 → A4-04, 7 → A4-06), 2 record-only items done (4, 8). Highest severity:
**medium** (A4-01). Production was checked by the operator, read-only, with the prompt in
`docs/audit/A4-PRODUCTION-PROMPT.md` (item 9; results below, A4-10…A4-12).

**Method (local only; production was not touched).** A production build (`next build`, then `next start`) was
signed in as a local test operator through a throwaway stand-in for Supabase Auth and the data API, kept in the
session's scratchpad and never committed. Three passes:

- **A: fixture roster, no database.** The screens' "not kept" states.
- **B: one stored project with no other records.** Empty states.
- **C: every data read failing.** Error states.

Playwright (Chromium) loaded each of the 21 pages at **375 px and 1,280 px**. It recorded:

- the HTTP status, page errors, console errors and failed requests;
- horizontal overflow of the document, and any element wider than the viewport outside a scroll container;
- text still reading "Loading" after load plus 4 s;
- unnamed buttons and unlabelled inputs;
- 16 keyboard tab stops inside the main content (after the skip link), each checked for a visible outline or ring.

A second script clicked every write-looking control once on a fresh load. **Every non-GET request was aborted in
the browser and recorded**, so nothing was written even locally. A code read then traced every write control to its
endpoint or Server Action and its confirmation step.

**Per page (local).** Unknown ids were used for the five detail pages, so they show the in-shell "not found" screen:

| Page | Renders | Empty / error / not-kept states | Console | 375 / 1,280 overflow | Focus visible |
|---|---|---|---|---|---|
| `/` Command Center | yes | all three, per tile, never a zero | failed loads only in A and C | none | yes |
| `/projects` | yes | fixture roster (Modelled) | none | none | yes |
| `/projects/[id]`, stored project with no fixture | yes | live panels, empty and failed reads stated | C only | none | yes |
| `/projects/[id]`, fixture id | yes | Modelled sections, crawl panel live | none | none | yes |
| `/agents` | yes | Modelled sections; Run History states | A and C | none | yes |
| `/agents/[agentId]` | yes | as above, plus Queue a review | A and C | none | yes |
| `/keywords` | yes | all three | A and C | none | yes |
| `/keywords/[keywordId]` | yes; unknown id → not found | not kept, read failure | 404 document | none | yes |
| `/content` | yes | all three | A and C | none | yes |
| `/content/[articleId]` | yes; unknown id → not found | **read failure → generic error boundary (A4-07)** | 404 / 500 document | none | yes |
| `/technical` | yes | all three | A and C | none | yes |
| `/technical/pages/[pageId]` | yes; unknown id → not found | **read failure → generic error boundary (A4-07)** | 404 / 500 document | none | yes |
| `/competitors` | yes | all three | none | none | yes |
| `/competitors/[host]` | yes; unrecorded host → not found | — | 404 document | none | yes |
| `/ai-visibility` | yes | all three | A and C | none | yes |
| `/backlinks` (Outbound Links) | yes | all three | A and C | none | yes |
| `/analytics` | yes | all three ("a read failure, not an empty window") | C | none | yes |
| `/reports` | yes | Observed / Not recorded / Not read / Not kept per section | A and C | none | yes |
| `/settings` | yes | browser preferences only, says so | none | none | yes |
| `/dev/data`, `/dev/ui` | yes (A4-08) | demo | none | none | yes |
| `/login` | signed in → `/` | — | — | none | yes |

The console errors are the browser's own "Failed to load resource" lines for the 404, 500 and 503 answers each pass
provoked. No page threw a script error. No page left "Loading" on screen. No button was unnamed and no visible input
lacked a label. Long real-world text (titles, URLs, many rows) was not loaded locally, so overflow with production
data is left to the operator's read-only pass.

### A4-01 — Paid agent runs are queued, and run, on one click; no screen can cancel a queued run
- Severity: **medium**
- Evidence: every review control is the shared queued-review button (`agent-runs/queued-review.tsx:231`, POST
  `/api/agent-runs` at `:121`), with no confirmation step. That includes "Analyze with … Agent", "Run project
  Director review", "Hand off to SEO Director", "Run fact-check with Research & Evidence Agent" and "Check this unit".
  They appear on the project screen, `/keywords`, `/analytics`, `/ai-visibility`, `/backlinks` and `/competitors`.
  The agent page's **Queue** is gated only by two selects.
  - Each click creates a run row that cannot be deleted (5.4) and counts toward the daily cap.
  - The scheduled worker executes it, a paid model call, at the next morning job with no further action.
  - **No UI control calls the API's `cancel` action** (grep: none in `src/components`).
  - **Run Now** (`agent-runs/run-now.tsx:73`, POST `{action:"execute"}`) makes the model call immediately, also
    without a confirmation.
  - The labels say "Analyze…" and "Run…", which read as immediate, although the control only queues; the grey summary
    beneath says so.
- Impact: a stray click spends model tokens and leaves a permanent run record. Spend is bounded by the daily caps
  (40 a project, 100 in all) and one run's size (A3-02).
- Suggested fix: a one-line confirmation on Queue and Run Now naming the task and that it will call the model; a
  Cancel control on queued runs (the API action exists); labels that say "Queue …".
- Effort: S–M
- Status: fix in progress — F3 (draft PR): a confirmation before every Queue and Run now (task, project, record, today's cap usage), "Queue …" labels, and Cancel on queued runs through the existing action; closed on merge

### A4-02 — Crawls start on the first click
- Severity: low
- Evidence: **Run Crawl** (`crawl/crawl-panel.tsx:240`, POST `/api/crawls` at `:140`) and **Crawl competitor site**
  (`crawl/competitor-crawls-panel.tsx:251`, POST at `:192`) have no confirmation step. The local click test recorded
  the POST on the first click.
- Impact: an outbound fetch of the project's site, or of a third party's site, within the crawl budgets and the host
  allow-list, and a durable crawl record.
- Suggested fix: the same one-line confirmation, naming the host and the page budget.
- Effort: S
- Status: fix in progress — F3 (draft PR): Run crawl and Crawl competitor site confirm first, naming the host and page budget; closed on merge

### A4-03 — Check results are recorded on the first click, and they are final
- Severity: low
- Evidence: "Record result on this unit" / "Record as failed" / "Record as checking"
  (`content/article-check-section.tsx:365`) and "Record result on version N" (`content/draft-panel.tsx:649`) have no
  confirmation step. A passed or needs-review unit is final for that version and can move the article to `checked`.
  "Save as draft" (`draft-panel.tsx:146`) also saves on the first click; that one is harmless.
- Impact: a mis-click fixes a verdict for that version; a new version is the only way back.
- Suggested fix: an inline confirm naming the outcome ("Record passed for unit 3 of version 6?").
- Effort: S
- Status: open

Every other write already confirms first. That covers creating a project, the task controls, keyword Track, article
and draft approval, both proposal flows, triage and the keyword curation forms. Article approval adds the
attestation tick, and the article proposal adds a modal plus a server confirmation token.

### A4-04 — Controls that do nothing, outside any Modelled section
- Severity: low
- Evidence:
  - **Run SEO Analysis** (`projects/project-detail-header.tsx:120`, a primary button) only shows "Analysis simulated —
    no agent run was started" for 4 s (`project-workspace.tsx:144`). It sits in the project header, above every
    Modelled section. It is reachable in production: stored projects with fixture ids (for example `halcyon-fintech`)
    open the fixture workspace. The crawl panel's description cites it even on the stored-project screen, where it
    does not exist (`crawl-panel.tsx:238`).
  - The header's **search** field cancels its own submit (`layout/header.tsx:219`) and searches nothing. Its
    placeholder is "Search projects, keywords, reports".
  - The header's **workspace switcher** changes only its label, and shows fixture plans and counts ("Agency · 12
    projects") from `src/lib/mock/workspace.ts`. Production (operator's walkthrough, 30 Sep): it reads "Nexra
    Agency" on every page, including the fixture project `halcyon-fintech`, where it reads as that project's owner.
  - The **notifications** panel says alerts "will appear here once agents are live". Agent runs are live
    today.
  - These last three are on every page.
  - The session-only controls inside Modelled sections are labelled and are not counted here: project settings,
    notes, competitors, issue and task statuses, and the agent-page blockers and settings.
- Impact: §12 says "no control that does nothing". These four suggest capabilities the product does not have.
- Suggested fix: remove Run SEO Analysis (the crawl and the reviews are the real actions) and the search field, or
  mark them Modelled. Drop the workspace switcher or show only the one real workspace. Reword the notifications text.
- Effort: S
- Status: fixed — F7: Run SEO Analysis and its simulated notice removed (and the crawl panel's reference to it); the header search field and the fixture workspace switcher removed; the notifications panel says the product sends no alerts and links to Run History

### A4-05 — Page subtitles promise features the observed screens hide or never claim
- Severity: low
- Evidence: the header subtitle of each screen comes from `src/config/navigation.ts`, written for the modelled
  screens:
  - Technical SEO: "Crawlability, indexation, Core Web Vitals, schema, and overall site health". Vitals and a health
    score are hidden (Q1); indexation is "declared by the page — not whether Google indexed it".
  - Competitor Intelligence: "Competitive landscape, SERP overlap, positioning, and share of voice". §13 *Scoped V1*
    says it never claims SERP positions or share of voice.
  - Keyword Intelligence: "Keyword discovery, clustering, and search-intent classification". The screen shows stored
    queries, lexical hints and "a shared word, not a topic".
  - Analytics: "Performance, trends, and attribution across every active project". It shows one project, the latest
    window only, "not a trend", and hides Attribution.
  - Reports: "Client-ready reporting, scheduled deliveries, and exports". There is no schedule, no send and no export
    beyond Print.
  - Command Center: "…SEO health…". There is no health score.
- Impact: the one line under each title contradicts the screen's own honest labels.
- Suggested fix: rewrite the six descriptions to what each screen reads. AI Visibility and Outbound Links already
  were.
- Effort: S
- Status: fixed — F7: the Command Center, Keyword Intelligence, Content Studio, Technical SEO, Competitor Intelligence, Analytics and Reports subtitles name only what each screen reads

### A4-06 — Two fixture links still lead to "not found" inside the fixture project workspace
- Severity: low
- Evidence: `dashboard/content-snapshot.tsx:164` links each fixture page to `/content/<fixture id>` (article detail
  needs a uuid). `projects/project-competitors.tsx:191` links to `/competitors/<competitorId>` (the route is keyed by
  host). Both are mounted by `projects/project-workspace.tsx` (`:318`, `:345`). 6.3 removed the same links from the
  Command Center only.
- Impact: dead links on the fixture workspace, which production shows for the stored projects that carry fixture ids.
- Suggested fix: drop the links (render the names as text), as 6.3 did.
- Effort: S
- Status: fixed — F7: both fixture names render as text

### A4-07 — Two detail pages crash into the generic error screen when their read fails
- Severity: low
- Evidence: pass C (every read failing) — `/content/[articleId]` and `/technical/pages/[pageId]` answer HTTP 500 with
  "This screen failed to load". Every other screen states the failure in place ("The crawl records could not be read
  just now…"), as does the keyword detail ("The keyword's records could not be read just now. Reload in a moment.").
- Impact: honest, but inconsistent; the operator loses the shell's context for a transient read failure.
- Suggested fix: catch the store read in the two pages and render the in-place failure state.
- Effort: S
- Status: fixed — F7: both pages catch a failed read and state it in place, keeping the shell

### A4-08 — `/dev/data` and `/dev/ui` ship in the production build
- Severity: info (A0-06; decision)
- Evidence: both build as static pages (`○`) and render behind the operator gate, with demo controls ("Simulate
  loading", "Add project", button variants). They are in no navigation.
- Impact: none beyond a signed-in operator finding demo pages.
- Suggested fix: decision — keep for development only (return not found unless `NODE_ENV` is `development`) or
  delete.
- Effort: S
- Status: fixed — F7 (with A0-06): the two routes removed

### A4-09 — Changing the project data source needs a rebuild
- Severity: info
- Evidence: built with the fixture roster, `/projects/[projectId]` and `/agents/[agentId]` prerender (`●`); built
  with the stored roster, they render on demand (`ƒ`). The local harness first ran a fixture build against the stored
  roster. It served a cached 404 for a stored project, and every background revalidation failed with
  `DYNAMIC_SERVER_USAGE`. Rebuilt with the stored roster, the page rendered at once. Production builds with the stored
  roster, so it is not affected.
- Impact: none in production; a trap for anyone switching `PROJECTS_DATA_SOURCE` without a rebuild.
- Suggested fix: one line in the runbook.
- Effort: S
- Status: open

**Production pass (operator, 30 Sep, read-only).** Cowork (Claude in Chrome) opened the 26 URLs of
`A4-PRODUCTION-PROMPT.md` at 1,094 px, typing addresses only and clicking nothing. Every page was shown or loading; none
redirected to `/login`, showed "not found", crashed or scrolled sideways, and `/api/health` answered 200 in 1.4 s. The
375 px production pass was skipped; the local passes cover narrow widths. Results that need a record: A4-10, A4-11
and A4-12, plus the switcher note under A4-04.

| # | Page | Walkthrough result |
|---|---|---|
| 1–13 | Command Center, Projects, both project pages, AI Agents, two agent pages, Keywords (two tabs), a curated keyword, Content, both articles | shown, 17–36 s |
| 14–15 | Technical (Overview, Issues) | shown, 49 s and 58 s |
| 16, 18, 20–24 | Technical Pages tab, Competitors, AI Visibility, Outbound Links, Analytics (two tabs), Reports | skeletons only after 75–145 s |
| 17, 19 | Technical page detail, competitor detail | shown, 6 s and 10 s |
| 25 | Settings | shown, 36–113 s |
| 26 | `/api/health` | 200, 1.4 s |

### A4-10 — The automated walkthrough saw slow or unfinished loads that a normal tab does not
- Severity: low
- Evidence: in the walkthrough, 7 pages stayed on skeletons after 75–145 s and the others took 17–58 s (table
  above). The operator then opened `/reports` in a normal foreground Chrome tab at about 09:25 UTC: fully loaded in
  about 2 s. Supabase edge logs for 08:40–09:25 UTC show every database request answered 200, with no errors. Most
  likely cause: the walkthrough ran in a background tab that Chrome throttles, and it opened 26 pages in quick
  succession; not reproduced by hand.
- Impact: none established; a real slow load would hide every observed screen behind skeletons.
- Suggested fix: in A6, a simple manual timing check of 3–4 pages (Command Center, Technical Pages tab, Reports,
  Analytics), cold and warm, in a foreground tab, with the browser's network panel.
- Effort: S
- Status: open (A6 check)

### A4-11 — Two small layout breaks in production
- Severity: low
- Evidence (operator's walkthrough): on `/technical/pages/771a12e3…` the "Final URL" value wraps in the middle of a
  word; on `/settings` the text of the "Opens on" dropdown is cut off. Neither scrolls the page sideways.
- Impact: cosmetic; a URL broken mid-word is harder to read and copy.
- Suggested fix: break long URLs at `/` (or allow `overflow-wrap: anywhere` only for URL values); widen the
  "Opens on" select or let its text truncate with an ellipsis.
- Effort: S
- Status: fixed — F7: URL facts on the page detail break only after `/`, `?`, `&` or `=`; the "Opens on" select is wider and ends an overlong name with an ellipsis

### A4-12 — "The previous window could not be read" on the Search Console comparison
- Severity: info (to investigate in A6)
- Evidence: `/projects/nexra-agency` and `/keywords` show "No comparison: the previous window could not be read." in
  the Search Console section, while the current window reads normally.
- Code: the live report (`src/lib/search-console/provider.ts:284`) sets `comparison-unavailable` in two different
  cases: the earlier window's request failed, **or** it succeeded and returned no data (`previous.value === null`).
  Both show the same words (`present.ts:78`). Nexra Agency's property is young, so the likeliest cause is an earlier
  30-day window with no data, which the text calls a failed read. Not yet confirmed.
- Impact: the period comparison is missing on the project's two main Search Console surfaces, and, if the cause is
  an empty earlier window, the page states a read failure that did not happen (the no-zero rule's mirror image).
- Suggested fix: in A6, confirm which case it is from the server logs (without starting a run); if it is the empty
  window, give it its own state and wording ("No data in the previous window").
- Effort: S
- Status: superseded by A6-04 (cause: an empty earlier window, reported as a failed read)

**Remaining fixture data (item 4).** Importers outside `src/lib/mock`, by module:

- `agents` 31, `projects` 13, `dashboard` 9, `seo` 7;
- `competitors`, `reports`, `technical` and `workspace` 2 each;
- `ai-visibility`, `analytics`, `backlinks` and `keywords` 1 each;
- `content` none directly (other fixture modules use it).

The two unimported components kept in 6.12b, `keywords/pagination` and `projects/unmeasured-selection-notice`, are
still unimported.

## A5 — Content path (30 Sep 2026, at `6a019b0`)

Checklist result: 14 PASS, 0 FAIL, 1 OPERATOR (item 9), 1 record-only item done (16). Highest severity: **medium**
(A5-01 … A5-05). Method:

- a code read of the path, from draft to article (C1, C2), check units (C4), approval (C5), proposal (C6), the
  website renderer (6.9b) and the live slugs (6.12a);
- the four content test files run (132 of 132 pass);
- the stored V6 of article `1003104c…` rendered locally against nexra-ai `main` `9a69c8c` (files read with git,
  nothing written);
- read-only production queries.

**Production at audit time.**

- Article `1003104c…` is `approved` at V6 (`5ae7594d…`, 7 of 7 units passed). Its approval `98195295…` has 3
  paragraphs attested and the tick recorded.
- Article `c89182f9…` is `approved` at V4 (`e9db287f…`, 4 of 4 units passed). Its approval `5f02d149…` has nothing
  attested.
- Proposals: `5f229630…` is withdrawn and `ea85edb0…` is proposed; 0 draft proposals.
- All 23 check units are bound to existing versions (0 orphans).
- Recomputed hashes of nexra-ai `main`: `lib/blog.ts` `d6f1c74c…`, the follow-up article `e5f173dd…`, the new
  article `7e1e1e3c…` and `components/site/article.tsx` `beb543a0…`, all as recorded at 6.11.

**The renderer against `main` (item 8).**

| Files given to the renderer | Answer |
|---|---|
| `main` as it is | `registry-changed` (`lib/blog.ts`) |
| pinned registry, `main` follow-up article | `live-article-changed` |

The pins do what they were built for. The renderer refuses to write over files that changed since the pin, rather
than silently re-applying a stale edit.

### A5-01 — The next article needs renderer work beyond a re-pin
- Severity: medium (supersedes A0-07)
- Evidence: `website/template.ts` pins one commit (`1a688bd`), one registry hash, one live article and a hand-typed
  list. Current `main` is refused, as above. Re-pinning alone is not enough:
  - `slug-live` checks the template's own list (`render.ts:234`), which holds only `ai-lead-follow-up-automation`,
    not `liveSlugsFor`. The proposal step would still refuse the live slug, because C6 reads `liveSlugsFor`.
  - Keyword overlap compares against the follow-up article's ten keywords only (`render.ts:240`,
    `template.ts:81`). A third article could repeat `ai-dead-lead-reactivation`'s keywords undetected.
  - The cross-link is mandatory, with one fixed target (`render.ts:507`). It edits only plain JSX text lines inside a
    `<P>` (`:133`, `:476-488`). The renderer writes every paragraph as a string literal (`:287`), so an article it
    rendered can never be a cross-link source.
  - The component-file pin (`beb543a0…`) is recorded but never checked (A5-07).
- Impact: no second article can be rendered, by design. A naive re-pin would weaken the slug and overlap checks, and
  the cross-link step cannot target any rendered article.
- Suggested fix (before the next article):
  1. A `/3` template pinned at the then-current `main`.
  2. Live slugs and keywords taken from every live article (the registry, or `liveSlugsFor` plus the recorded
     keywords).
  3. A cross-link made optional, or its target chosen per article, with a way to link from a rendered article.
  4. After the merge, a `LIVE_SLUGS_AFTER_PIN` entry and its SQL twin, as in 6.12a.
- Effort: M
- Status: open (post-V1, before article 2)

### A5-02 — Checker variance and no carry-forward cost 8 of the 20 check runs for one article
- Severity: medium (recorded as backlog, per 6.10b; A3-03 covers the draft fact-check)
- Evidence: article `1003104c…` used 20 `article-check-unit` runs and recorded 17 results.
  - 7 of those 17 re-checked unit text identical, hash for hash, to text that had already passed on an earlier
    version: V3's metadata and lead (passed on V2), and five of V6's seven units (passed on V5).
  - One more run refused unit text that had passed twice: the V4 metadata unit (`25e52823`, passed on V2 and V3).
  - Results bind to one version (unique on version and unit), and approval needs every unit of the current version.
  - No temperature or seed is sent, and the server-side refusal fallback may answer with another model.
  - With a carry-forward, about 12 runs would have sufficed.
- Impact: extra spend, extra wait and a flaky gate: identical text can pass and later fail. Each re-check can flip.
- Suggested fix: the post-V1 carry-forward (reuse a passed result when the unit hash is identical) and checker
  instructions v3. Optionally a fixed low temperature for the two verdict tasks, as its own decision (§6).
- Effort: M
- Status: backlog (post-V1)

### A5-03 — Entering an article is about 35 typed fields, with no import
- Severity: medium
- Evidence: `article-panel.tsx:621-757` has no paste, JSON or canonical-text import. For the 6.10b article (3 H2s,
  4 FAQs, a CTA, 2 links, 3 attestations) that is:
  - about 35 text inputs, 9 selects and about 9 "Add" clicks, each typed or pasted by hand;
  - "Add H3" (inside the last section) directly above "Add section" (outside it), both plus-icon ghost buttons
    (`:671-678`);
  - no way to promote an H3 to an H2 or move one.

  V1 of the article was lost to exactly that mistake, and V3 to V5 were re-entered by hand. The server actions
  already accept any `content`, so an import is a client-side change.
- Impact: operator error and time on every version; each mistake costs a version and, after a check, re-check runs.
- Suggested fix: a "Paste article JSON" box: validate with the C1 validator, fill the form (`formFromContent`), then
  save as now. Label the add buttons "Add H3 to this section" and "Add H2 section".
- Effort: S
- Status: open — F4 (draft PR) did the labelling part: "Add H3 inside section N" and "Add H2 section" are labelled and set apart, and each section and H3 box is named; the paste/import is still open

### A5-04 — Attestation locators are paragraph indexes and do not follow edits
- Severity: medium
- Evidence: a locator is `<section id>/<paragraph index>` (`editor-form.ts:91-93`), and the form's attestation list
  is never updated when the text changes:
  - Inserting or deleting a line earlier in a section silently re-points an attestation to a different paragraph.
    That paragraph then carries the "Our view" label without the operator choosing it.
  - Removing an H3, or renaming a section id, leaves a locator with no matching option. The select shows "Choose a
    paragraph…", so the attestation looks lost, and the validator refuses it at save (`attestation-target`).
- Impact: a first-hand or opinion label can land on the wrong paragraph of a published article. The checker then
  treats that paragraph's statements as ATTESTED, not checked.
- Suggested fix: bind an attestation to the paragraph's text (or a stable id) and warn when its target moves or
  disappears.
- Effort: S–M
- Status: fix in progress — F4 (draft PR): each attestation is bound in editor state to its paragraph's text and follows it through inserted, removed or moved lines and renamed sections; a changed or removed paragraph clears the mark until chosen again; a pre-save preview lists each label with its paragraph's first words. No content format change; closed on merge

### A5-05 — "Edit as version N" sits beside the version selector, above Approve, and stays on a live article
- Severity: medium
- Evidence:
  - The button (`article-panel.tsx:343-347`, the default button style) shares a row with the Version select. "Approve
    version N…" renders directly below it in the same style.
  - Clicking it writes nothing, but it unmounts the approval section and discards a started confirmation and its
    attestation tick.
  - The button stays on approved and published articles; it is hidden only when archived. Saving from it creates
    V(N+1) and sets the article to `drafting` (`20260923120000_create_articles.sql:613-616`).
  - For `1003104c…`, which is live, one save would leave the product saying `drafting` for a published article and
    make V6 unapprovable (approval needs the current version).
- Impact: the near-miss the operator reported during approval; a live article's record can be knocked out of
  `approved` by one save.
- Suggested fix: move Edit away from the approval controls (or make it a quiet button). On an approved article,
  confirm first ("This article is approved; a new version returns it to drafting and needs a full re-check").
- Effort: S
- Status: fix in progress — F4 (draft PR): "Edit as version N…" moved to the foot of the article, away from the version selector and the approval; on an approved or checked article it confirms first (a new version returns it to drafting; the approved version stays on record; a live article says so); closed on merge

### A5-06 — The live article's proposal stays "proposed"; nothing in the product says it is published
- Severity: info (by the lean V1 decision, 6.10b)
- Evidence: proposal `ea85edb0…` is `proposed`. No published state exists (C7b deferred). Publication is recorded
  only in three places: CLAUDE.md §0, nexra-ai PR #9 (merge `9a69c8c`) and `LIVE_SLUGS_AFTER_PIN`.
- Impact: the Content Studio, the Command Center and Reports show the article as approved with an active proposal,
  never as live.
- Suggested fix: the post-V1 published-state table (C7b), or at least a read-only "live" badge from
  `LIVE_SLUGS_AFTER_PIN`.
- Effort: S (badge) / M (C7b)
- Status: backlog (post-V1)

### A5-07 — The component-file pin is recorded but never checked
- Severity: low
- Evidence: `template.ts:70-72` records `components/site/article.tsx` with a hash. `render.ts` never reads it, and the
  renderer takes no component source.
- Impact: a changed component (a renamed export, a changed `Meta`) would be found only by the site's build.
- Suggested fix: add the component file to `sources` and hash-check it like the other two.
- Effort: S
- Status: open

### A5-08 — The `unsafe-input` refusal has no behavioural test
- Severity: low
- Evidence: `article-website.test.ts:366` names the code in the list assertion only; its four paths
  (`render.ts:192, 195, 232, 255`) are not exercised.
- Impact: a regression in the renderer's id and slug guards would pass CI.
- Suggested fix: tests with a malformed id, a malformed approval id and an unsafe slug.
- Effort: S
- Status: open

### A5-09 — The attestation limits live in the app only
- Severity: low
- Evidence: the 40% of sentences, half a section and the number ban are enforced once, in `validate.ts:383-405`,
  and re-applied on every read. The database counts the list (1–50) and nothing else
  (`20261010120000_attested_paragraphs.sql:57-127`). The UI copy hard-codes "40%" and "half".
- Impact: a direct `service_role` RPC could store format-2 text that breaks the limits; the app never does.
- Suggested fix: document it beside the migration, or add a coarse SQL check.
- Effort: M
- Status: open

### A5-10 — Two small content-path notes
- Severity: info
- Evidence:
  - The proposal preview's completeness list still says `readingTime` is "missing … never estimated"
    (`website-completeness.ts`), while the 6.9b renderer derives it.
  - The draft store's compensating delete (`drafts/supabase/store.ts:106-121`) is not atomic. A crash between its two
    inserts would leave a draft parent without a version.
- Impact: wording only; an orphan draft row in a rare crash.
- Suggested fix: reword; move draft creation into one RPC when that code is next touched.
- Effort: S
- Status: open

**Reader quality (item 16, a record, not a finding).** The live article's four sentences quoting the site's meta
descriptions exist because the checker's only evidence is the site's own crawl. They read as self-referential. The
post-V1 item "checker external sources" is what would let them read naturally.

## A6 — Operations (30 Sep 2026, at `6a019b0`)

Checklist result: 5 PASS, 5 FAIL (items 1, 3, 4, 11, 14), 3 record-only items done (2, 7, 10), 1 OPERATOR (8).
Highest severity: **medium** (A6-01, A6-02). Method:

- a read of `docs/RUNBOOK.md`, `docs/BACKEND.md`, `README.md`, `supabase/README.md` and CLAUDE.md against the code;
- the CI history on `master` (GitHub Actions API);
- `npm outdated` and `npm audit`, read-only;
- the Supabase documentation for Free-plan limits;
- read-only production queries.

The Vercel API and the production host were not reachable from this session, as in every Phase 6 session.

**Worker timing.** The six stored snapshots were captured at 06:19–06:20 UTC each day from 25 to 30 Sep, with no day
missed. The job is scheduled for 05:30; on the Hobby plan Vercel fires it within the hour. A missed day is never
backfilled: the capture takes the 30-day window for the current date only (`snapshots/capture.ts:164-179`). A
missed run is otherwise picked up by the next morning's run (A3-05).

**Supabase Free plan, from Supabase's documentation, against current use.**

| Limit | Current use |
|---|---|
| The project pauses after 7 days of low database activity | the daily worker and operator use are activity; a paused project stops the whole product until resumed (restorable for 90 days) |
| The database turns read-only at 500 MB | 16 MB |
| Egress 5 GB uncached plus 5 GB cached | not measured |
| No backups (A2-05) | — |

**CI.** All 48 `master` push runs since the gates began (26 Sep, `6363db53`) passed, except one cancelled run, which
the next push superseded by design (6.5). The workflow pins Node 22 and holds no credential. Branch protection is
configured but not enforced on the current plan, and merge discipline is documented (item 7).

### A6-01 — No backup, no restore procedure, no drill
- Severity: medium (with A2-05)
- Evidence:
  - the Free plan keeps no backups (A2-05);
  - `docs/RUNBOOK.md` (§1–§5) has no backup or restore section; neither does `docs/BACKEND.md` or CLAUDE.md;
  - no restore drill is recorded.

  The database holds the only copy of append-only records: runs, attempts, articles, versions, check units,
  approvals, proposals, task events and snapshots.
- Impact: a lost or corrupted database cannot be recovered. The guards stop deletes, not a platform loss.
- Suggested fix: decide A2-05's option (Pro plan with daily backups, or a scheduled `pg_dump` kept outside
  Supabase). Add a runbook §6: how to take a dump (public schema and data, plus `supabase_migrations`), where it is
  kept, and a restore drill into a disposable local cluster, run once and recorded.
- Effort: S (docs) / M (drill)
- Status: fix in progress — F1 (the operator chose to stay on the Free plan with an own encrypted nightly backup, `.github/workflows/backup.yml`, RUNBOOK §6; merged as PR #74; the first two runs on 30 Sep failed at the connection, fixed by F1b and a re-entered secret; run `36720332709` green on 30 Sep, see RUNBOOK §6.2 *Run history*); closed once the operator's restore drill passes

### A6-02 — Nothing tells the operator when something breaks
- Severity: medium
- Evidence:
  - The runbook recommends an uptime monitor on `/api/health` (§3) but records none, and none is known to exist.
  - Nothing alerts on a failed or skipped cron run, a `rejected-output` spike, a daily-cap hit, a failed Search
    Console capture or a missing auto-deploy (the 27 Sep `ddc6cbb4` skip was found by chance).
  - `logEvent` expects a platform log drain (`log.ts:6-7`); none is configured.
  - Vercel's logs and deployments cannot be read from these sessions (403).
  - Supabase emails the owner before pausing a Free project; that is the only automatic warning in the stack.
- Impact: an outage, a stopped worker or a skipped deploy is found only when the operator happens to look.
- Suggested fix: under §6 approval, one free uptime monitor on `/api/health` (non-200 or timeout). A short daily
  check in the runbook: `/api/worker/status`, the day's snapshot row, and the Vercel cron log. Later, a log drain
  with an alert on `failed` worker outcomes.
- Effort: S
- Status: open (operator decision)

### A6-03 — Deployment ids are not recorded for the last 20 merges
- Severity: low
- Evidence: CLAUDE.md §0 records deployment ids up to PR #52 (`dpl_5fzpNZrB…`, 28 Sep 07:59 UTC). For PR #53 to
  PR #72 it says "not read" (Vercel 403) or nothing. The operator confirmed some builds in the browser (#55, #58)
  but did not record ids. Rollback step 1 (`RUNBOOK.md:143-146`) starts from "CLAUDE.md §0 names the current
  production deployment and the one before it".
- Impact: a rollback depends on the Vercel dashboard's Production list, which still works but is not the documented
  first step. There is no record of which build served which commit.
- Suggested fix: make the dashboard list the runbook's primary rollback step; restore read access for a Vercel token
  in a later session (§6), or have the operator note the id after each merge.
- Effort: S
- Status: open

### A6-04 — "The previous window could not be read" is an empty window, reported as a failed read (cause of A4-12)
- Severity: low
- Evidence:
  - All seven stored live Search Console reads for `nexra-agency` (20–28 Sep) carry `comparison-unavailable`. In the
    same batch, the current window's totals, queries and pages all read normally.
  - For a 30-day range ending on day X, the previous window is X−59 … X−30
    (`date-windows.ts:54-73`): for the latest read, 28 Jul – 26 Aug.
  - The live report marks the comparison unavailable when that request fails **or** when it succeeds with no rows or
    zero impressions (`provider.ts:284`, `mappers.ts:43-47`). The screen and the agents' evidence then say "could not
    be read" (`present.ts:78`, `grounding.ts:185-189`).
  - Only a failed request is logged, and the log does not say which window failed.
  - A second request failing on every one of seven occasions while the first always succeeds is unlikely. The
    property's history is young, so an earlier window with no impressions is by far the likelier cause.
  - Conclusion: data availability, mislabelled by the code. It could not be proved from logs (there is no log line
    for the empty case).
- Impact: the screen and seven agent runs were told a read failed when Google reported no data. It is the mirror image
  of the no-zero rule.
- Suggested fix: a separate state, `comparison-no-data` ("No data in the previous window"), with its own grounding
  line (a hash-pin update), and the window named in the failure log.
- Effort: S
- Status: fixed — F7: a separate `comparison-no-data` state ("Google has no data for the previous window yet"), with its own grounding line; "could not be read" only for a failed request, whose log line now names the window and dimensions

### A6-05 — README.md is stale and partly false
- Severity: low
- Evidence:
  - `README.md:30-37` says "Backend Phase 6 is complete" in an old sense, and "**Nothing has been deployed.**"
  - `:82-83` says all agent activity is mocked.
  - `:158-161` says "The application has not been scaffolded … There is no `package.json`."
  - No setup or scripts are documented, and the roadmap still says "Backlinks & Authority".
- Impact: misleads any new reader, contributor or reviewer.
- Suggested fix: rewrite the status to FULL V1 (live, what is observed and what is modelled) and add local setup
  (Node 22, `npm ci`, `.env.example`, the scripts). Point to CLAUDE.md, BACKEND.md and RUNBOOK.md.
- Effort: S
- Status: open

### A6-06 — The runbook's migration notes are incomplete
- Severity: low
- Evidence: `RUNBOOK.md:107-112` and `supabase/README.md:174-177` name one history mismatch; A0-01 and A2-01 found
  eight. The hash-checked apply method (`:42`) names two migrations, while §0 records it for six (`20261006120000` to
  `20261011120000`). The SQL-editor path (`:37-40`) does not warn that a paste can change line endings, which is the
  source of the CRLF function bodies (A0-05).
- Impact: an operator reading `migration list` is misled. The method that avoided the CRLF problem looks optional.
- Suggested fix: copy A2-01's per-version table into §1.5, name all six hash-checked applies, and make that method
  the default, with a line-ending warning.
- Effort: S
- Status: open

### A6-07 — Server Actions log the message of any error
- Severity: low
- Evidence: 13 `console.error` sites in the content and project Server Actions print
  `${error.name}: ${error.message}` for any error: `projects/actions.ts:73,142`, `article-actions.ts:63,97`,
  `article-approval-actions.ts:62`, `draft-actions.ts:52,113,170,223`, `publication-actions.ts:83,115`,
  `article-check-actions.ts:67` and `proposals/requests.ts:50`. The store errors carry PostgREST's `message` (not
  `details`). The agent-run routes use an allow-listed `logFailure` (`http.ts:126-134`). No secret, email or model
  answer was found on these paths.
- Impact: a third-party or database message (for example a `raise exception` text that includes an argument) can
  reach the logs.
- Suggested fix: route these through a `logFailure`-style helper that prints a message only for the product's own
  store error classes.
- Effort: S
- Status: open

### A6-08 — Versions and dependencies
- Severity: info
- Evidence:
  - Node 22.22.2 locally, `NODE_VERSION: "22"` in CI. There is no `engines`, `.nvmrc` or `packageManager`, and
    Vercel's Node version is set only in its dashboard. `npm test` needs Node's native type stripping.
  - Next 16.3.4 (latest 16.3.7), React 19.2.8 (19.3.0), `@supabase/supabase-js` 2.116.0 (2.117.2),
    `@anthropic-ai/sdk` 0.126.0 (0.129.0), TypeScript 5.9.3 (7.0.2).
  - 12 packages are outdated. `npm audit --omit=dev` shows 0; the one high advisory is A1-03's lint-toolchain
    `brace-expansion`, unchanged.
- Impact: none now; a Node mismatch between local, CI and Vercel is possible.
- Suggested fix: pin Node (`engines` or `.nvmrc`); take the Next patch releases in a normal checkpoint.
- Effort: S
- Status: open

### A6-09 — Fixed counts in CLAUDE.md go stale daily
- Severity: info
- Evidence (item 11): production equals CLAUDE.md / A0 on every count but two. Runs 82, attempts 83, articles 2,
  versions 10, units 23, approvals 2, proposals 2, keywords 2, tasks 1, events 16, crawls 8 and 34 history rows all
  match. The two that grow every morning differ: snapshots 6 (doc 5) and query-page rows 55 (doc 42).
- Impact: none; a reader may take a daily-growing figure as a fixed fact.
- Suggested fix: record daily-growing counts with their date, or not at all.
- Effort: S
- Status: accepted (no fix)

**Unchanged and correct (for the record):**

- The environment variables: `docs/BACKEND.md`, `.env.example` and the code agree on the same 19 names.
- The documented cron schedule, health behaviour (2 s timeout, 120 a minute), daily caps and worker batch match the
  code.
- The slow-database path of `/api/health` is tested (`health.test.ts:28`).
- The runbook has the one-redeploy rule for an auto-deploy skip. The cause of the 27 Sep skip is still unknown
  (item 13).
- No Create PR, Merge, Deploy or Publish control exists in the product.
