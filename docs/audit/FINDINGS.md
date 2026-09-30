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

Checklist result: 27 PASS, 2 FAIL (items 8 → A0-03, 21 → A1-01), 1 OPERATOR (item 14 → A1-07); item 30 was run by the operator on 30 Sep (A1-08). The evidence
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

## A2 — Database

_(pending)_

## A3 — Agents

_(pending)_

## A4 — Screens

_(pending)_

## A5 — Content path

_(pending)_

## A6 — Operations

_(pending)_
