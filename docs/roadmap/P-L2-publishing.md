# P-L2 — Publishing Level 2: design note and threat model

The third milestone of `docs/roadmap/NEXT-FOUR-PLAN.md` (approved 3 Oct 2026 with every default accepted), with the
owner's changes of 3 Oct 2026 (below). It replaces the hand-made route of articles 1–3 — a `/N` template PR at the
then-current `nexra-ai` `main`, a pull request opened from a Claude Code session, and a per-article live-slug
migration — with one in the product: an approved article is **requested** for publication, the request appears as
**Ready to publish**, and one press on the publish page opens the `nexra-ai` pull request, waits for its checks, merges
it (when the mode allows) and records the article as live. No AI run and no DataForSEO call.

## The owner's decisions (3 Oct 2026)

| Plan default | Owner's decision |
|---|---|
| An email (Resend) carries the link to the publish page | **No email, no Resend.** *Request publication…* on an approved article records the request; it appears as a **Ready to publish** item in the Command Center linking to `/publish/[approvalId]`. The same single-use, 24-hour, digest-bound approval; GET never acts, the press is a POST. |
| A fine-grained GitHub token | Already in Vercel as `NEXRA_AI_GITHUB_TOKEN` (Production, Sensitive). Never logged, never returned, never in a client bundle. |
| `NEXRA_PUBLISH_MODE` | Default **`off`**; the first live use will be **`dry-run`**. |
| A reviewer role | Built (PR 3) but **no reviewer by default**: `NEXRA_REVIEWER_EMAILS` unset means nobody holds it. |

Everything else is the plan's: the published-state table (C7b), pin at publish (no more hand `/N` templates), the 6.8
approval used for the first time, an idempotent and resumable publisher, merge only in `merge` mode.

## What the owner does

1. On an approved article with its active publication proposal, *Request publication…*: choose the published date and,
   optionally, a cross-link — a phrase in the live follow-up article to link from. Confirm. This records one approval
   (`article-publication`, 24 hours, single use) bound to the exact request, and one publication row, `requested`.
2. The Command Center shows **Ready to publish** — every request whose approval is unused, unexpired and the newest for
   its article — each linking to `/publish/<approval id>`.
3. The publish page (GET — it reads, it never writes) shows the request, the mode, the `nexra-ai` `main` commit it would
   build on, and the exact files with their SHA-256 — rendered on the server from the stored, approved version against
   the files read at that commit. A refusal is named (a changed site structure, an anchor not found, a live slug).
4. **Publish** (POST, same origin, operator or reviewer) re-renders, consumes the approval, commits the files on a new
   branch, opens the pull request and — in `merge` mode, once the pull request's checks are green — merges it with the
   head commit it recorded, then records the article as live. In `dry-run` it stops after opening the pull request; the
   owner merges on GitHub and presses **Check status**, which records the merge it finds. Every step is recorded; a
   failed step can be continued without a second approval.

## Data model (migration `20261023120000_article_publications.sql`, PR 2)

`nexra_article_publications` — one row per publication request:

- **Bound at the request, never changed:** project, article, version, version row id, content SHA-256, the C5 approval,
  the active proposal, destination, slug, published date, the optional cross-link anchor, the request payload's
  SHA-256, the 6.8 approval it recorded (unique), who requested it and when.
- **Progress, changed only by the functions:** `status` (`requested` → `publishing` → `pull-request-open` → `merged` →
  `live`), the mode it ran in (`dry-run` or `merge`), the base commit, the rendered files (path, kind, SHA-256, base
  SHA-256), the branch, pull request number and URL, head commit, merge commit, live-check time, and the last error
  (code, step, time) — set without changing the status, cleared by the next step.

Functions (`security definer`, empty `search_path`, the article and publication row locks; EXECUTE for `service_role`
only):

- `nexra_article_publication_request(project, request jsonb, payload_sha256, operator)` — checks in the database that
  the article is `approved` at that version, the version row and content hash match, the C5 approval is the version's
  current one and the proposal is the article's active one for that version, destination and slug; refuses
  `already-published` (a merged or live row for the article) and `publication-in-progress`; records the 6.8 approval
  (`article-publication`, target the article, 24 hours) through `nexra_approval_record` and the row, `requested`.
- `nexra_article_publication_start(project, publication, payload_sha256, mode, base_commit, files jsonb, operator)` —
  `requested` → `publishing`: consumes the approval through `nexra_approval_consume` (every refusal — `used`,
  `expired`, `superseded`, `digest-mismatch` … — writes nothing), re-checks the article and proposal, records the mode,
  base commit and files. On a row already past `requested` it answers `resume` and writes nothing.
- `nexra_article_publication_progress(project, publication, step, detail jsonb, operator)` — the next step in order
  (`pull-request-open`, `merged`, `live`) or `error` (code and step, no status change); anything else `out-of-order`.

The live-slug functions are replaced (same signatures, now `stable`): a `merged` or `live` publication's slug is live
and owned by its article, beside the slugs recorded so far. So the live-articles read, the proposal check and the
renderer see a published article at once, and the per-article live-slug migration (runbook §7 step 5) ends. The table
is append-and-progress only: guards refuse an insert outside the request function, any change to a bound column,
deletes and truncates. RLS on, no policies, `service_role` SELECT.

## Pin at publish (PR 4)

The renderer stops pinning by hash. At publish the server reads three files of `nexra-ai` at `main`'s current commit —
`lib/blog.ts`, `components/site/article.tsx` and the follow-up article — and checks their **structure**: the registry's
array opens and closes on the expected lines and holds a record per live slug; the component file exports every name
the page imports; the follow-up article exists. The commit and each file's SHA-256 are recorded on the publication row.
The cross-link is **optional**: with an anchor, it is placed at the first exact match on a plain text line of a `<P>`
anywhere in the follow-up article; without one, only the new page and the registry change. The `/2`–`/4` templates stay
for the tests and the dry-run that used them.

## GitHub (PR 5)

A server-only client over the REST API with the token from `NEXRA_AI_GITHUB_TOKEN`: read the branch head, read a file
at a commit, create a branch, write one commit of the files (a tree with inline contents on the base commit), find or
open the pull request, read its state and checks (check runs and commit statuses), merge with the recorded head SHA.
Fixed error codes only (`not-configured`, `unauthorized`, `not-found`, `conflict`, `rate-limited`, `unavailable`,
`unexpected`); no response body, header or token is logged or returned. Tested with recorded, synthetic responses.

## The publisher (PR 6)

`NEXRA_PUBLISH_MODE` = `off` (default; publishing is refused before anything is read or consumed), `dry-run` or
`merge`. A publish press: read and check the row, render (reads only), consume (start), then branch → commit → pull
request (each looked up first, so a retry never makes a second) → in `merge` mode, if the checks are green, merge →
live check (one GET of the public page). Checks that are still running end the press with "waiting for checks"; the
next press continues. Routes: `GET /api/publications?project=`, `GET /api/publications/[id]`, `POST /api/publications`
(request), `POST /api/publications/[id]` (publish / continue). Before the migration is applied every read answers 503
`not-set-up` and the screens say **Not set up yet**.

## Screens (PR 7, PR 8)

- *Request publication…* beside an approved article's active proposal (the project screen's article panel).
- **Ready to publish** in the Command Center (a section under the tiles).
- `/publish/[approvalId]`: the request, the mode, the files, **Publish** / **Check status**.
- Publication history on the article detail page and the article panel: each request's status, pull request, merge
  commit, files and last error.

## Threat model

| Threat | Control |
|---|---|
| The GitHub token leaks (logs, responses, client bundle, the public repository) | Read only in a `server-only` module from the environment; never `NEXT_PUBLIC_`; fixed error codes, no response bodies or headers logged; a fine-grained token for `nexra-ai` only, Contents and Pull requests write, 90-day expiry; tests use synthetic recorded responses and no token. |
| A link or a crawler triggers a publication | GET never writes (the page renders a preview only); the press is a POST from this site's own origin, by a signed-in operator (or reviewer), rate limited. |
| An approval is replayed or reused | 6.8 rules in the database: single use, 24 hours, the newest decision on an article wins; the row is unique per approval; a consumed approval resumes its own row and never starts another. |
| The request is changed between approval and publish | The approval binds the SHA-256 of the exact request (article, version, content hash, C5 approval, proposal, destination, slug, date, anchor); the bound columns are immutable; start recomputes the digest from the row and the database compares; the article and proposal are re-checked at start. |
| Content injects code into the site | The 6.9b renderer: every text a string literal through `tsString`, tested against hostile text and built in a copy of the site. |
| `nexra-ai` changed since the last pin | Pin at publish checks structure at the current commit and refuses what it does not recognise; the base commit and file hashes are recorded; a changed file is re-read, never patched blind. |
| Someone pushes to the publication branch | The merge sends the head SHA the product recorded; GitHub refuses a moved head, and the product records `head-moved`. |
| An unattended merge | `off` by default; `dry-run` never merges; `merge` merges only after green checks and one press. |
| A double publication of one slug | One active proposal per slug (C6, D3); a merged or live row refuses a new request; a request in progress refuses another. |
| A partial failure leaves GitHub and the records apart | Every external step looks up before it creates (branch, pull request); the row records each step; **Check status** reads GitHub's state and records what it finds. |
| A reviewer does more than review | `NEXRA_REVIEWER_EMAILS` (empty by default) admits a reviewer to `/publish/*` and its API only; every other page and route, and every paid action, stays operators only. |

## Pull requests (stacked drafts on `master` `11c0b8d`, one change each)

1. This note, the plan's amendment and the applied notes for `20261020120000`–`20261022120000`.
2. Migration `20261023120000` and its harness suites.
3. The reviewer role.
4. Pin at publish.
5. The GitHub client.
6. The publisher service, the mode switch, the store and routes.
7. *Request publication…*, the publish page and **Ready to publish** in the Command Center.
8. Publication history.
9. Runbook §7 rewritten for P-L2.
