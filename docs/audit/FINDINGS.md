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
- Status: open

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
- Status: open

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
- Status: open

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
- Status: open

### A0-07 — The renderer's `/2` template pins are stale against nexra-ai `main`
- Severity: info
- Evidence: `src/lib/content/articles/website/template.ts` pins `lib/blog.ts` `c4af6f5c…` and the live article
  `c2f2da23…` at `1a688bd`; nexra-ai `main` `9a69c8c` holds `d6f1c74c…` and `e5f173dd…` (6.11). By design the
  renderer refuses `registry-changed` / `live-article-changed` against the current files.
- Impact: none for V1 (no second publish is planned); a second article cannot be rendered until the template is
  re-pinned — a post-V1 checkpoint, already in the backlog.
- Suggested fix: none in the audit; re-pin at the next publishing checkpoint.
- Effort: S
- Status: accepted (no fix)

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
- Status: open

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
- Status: open

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
- Status: open — (b) done, see A1-08; (a) and (c) still open

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

Checklist result: 17 PASS, 1 FAIL (item 10, docs → A0-01 / A2-01), 1 OPERATOR (item 15 → A2-05), 3 record-only
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
- Status: open

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
- Status: open

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
- Status: open (decision needed)

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

### A2-05 — Backups and point-in-time recovery: not visible from the session
- Severity: low (unknown; could be higher)
- Evidence: `get_project` reports only `ACTIVE_HEALTHY`, PostgreSQL 17.6.1, region `ap-southeast-1`, created 13 Sep;
  no backup or PITR field is exposed. On Supabase's Free plan there are **no** automatic backups; Pro keeps daily
  backups (7 days) and PITR is an add-on.
- Impact: if the project is on the Free plan, the only copy of every run, article, approval and proposal is the
  live database.
- Suggested fix: the operator reads Supabase → Database → Backups and records the plan and retention here; if
  none, decide on Pro or a scheduled `pg_dump` kept outside Supabase, and run one restore drill (A6-14).
- Effort: S (check) / M (backups)
- Status: open (operator)

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
- Status: open

## Post-V1 backlog additions (from the audit)

- **Client access needs roles and per-project scoping.** Today any email on `NEXRA_OPERATOR_EMAILS` gets full
  control of every project, every run and every write (`operatorFromUser` is the whole authorisation model; RLS
  holds no policies and `service_role` bypasses it). Before any client or second operator is given a login: a role
  table, project membership, RLS policies keyed on `auth.uid()` for the read paths, and the write functions
  checking membership. Recorded in A1/A2; a design note is the first step.

## A3 — Agents

_(pending)_

## A4 — Screens

_(pending)_

## A5 — Content path

_(pending)_

## A6 — Operations

_(pending)_
