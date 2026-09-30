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

## A1 — Security

_(pending)_

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
