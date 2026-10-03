# The next four milestones: M2 → M3 → P-L2 → M4

A read-only plan written 3 Oct 2026 after M1 went live, and **approved by the owner on 3 Oct 2026 as written, with
every default in the decisions table accepted**. Each milestone still gets its own design note, its own stacked draft
PRs and the owner's approval for every merge, migration apply and first live run (`CLAUDE.md` §6).

Inputs read: `NEXT-PHASE-BRIEF.md`, `PHASE-0-AUDIT.md`, `M1-topical-map.md`, the approved topic map in production,
the stored Search Console rows, the crawl findings, the four live articles, the article, approval and proposal system,
the renderer and templates `/2`–`/4`, and the backlog.

## What production holds (3 Oct, read-only)

- **The approved topic map** (`2213a93d…`, approved 11:29 UTC): 10 clusters — 3 covered, 0 partial, 7 gaps, 3 with no
  estimate, 6 excluded terms.
- **The pinned follow-up article has no recorded keywords.** `nexra_article_publication_live_articles` returns
  `keywords: null` for `ai-lead-follow-up-automation` (a pinned template slug with no article record). Its ten
  keywords live only in the `/2` template, so the map cannot see the page, although they include "automated lead
  follow-up", "reactivate old CRM leads", "appointment booking automation" and "WhatsApp lead automation". Without a
  fix, M2 would recommend new articles that compete with the page that holds 38 of the site's 44 query × page
  impressions.
- **Search Console is thin:** the latest window (ending 29 Sep) has 15 query × page pairs and 44 impressions, almost
  all on the follow-up article, positions 54–86, 1 click in 30 days. The crawl (`75d1bfbe…`) has 5 findings, on the
  home, about and contact pages.
- **Article 2's proposal** was re-recorded as `2b8b07d1…` (3 Oct 11:16 UTC).

---

## M2 — Opportunities

**For the owner.** One ranked list of what to do next. Each opportunity is a cluster of the approved map with one
action — write, expand, refresh or fix — and a score from 0 to 100 whose every point is explained on screen. Accepting
one turns it into a task; nothing runs or publishes.

**Design.**
- Scored **on read** from the approved map, the stored query × page pairs, the crawl findings and the live articles;
  nothing is stored until the owner accepts (like the derived finding history).
- **Score rules, version 1**, each line shown with its points and label:
  - **Demand** (provider estimate, up to 30): 30 at 1,000 or more searches a month, 20 at 100–999, 10 at 10–99; no
    estimate counts 0 and reads "unknown, not counted".
  - **Difficulty** (provider estimate, up to 15): 15 at 20 or below, 10 at 21–40, 5 at 41–60.
  - **Observed demand** (Search Console, up to 20): impressions on the cluster's queries in the latest window,
    matched by the D7 rule — 20 at 20 or more, 10 at 5–19, 5 at 1–4.
  - **Position band** (Search Console, 10): average position 4–20, refresh only.
  - **Coverage** (derived, up to 15): a gap scores 15 and means "write"; a partial scores 10 and means "expand"; a
    covered cluster is listed only when Search Console signals a refresh.
  - **Intent fit** (derived, 5): commercial or transactional.
  - **Findings:** a crawl finding on the mapped page adds a separate "fix" opportunity, 5 points per medium finding.
  - **Cannibalisation flag:** the cluster's queries observed on two or more pages adds "review before writing", not
    points.
- **Migration 1:** the live-articles read returns the ten keywords pinned for `ai-lead-follow-up-automation` from the
  `/2` template. The owner then rebuilds the map (free).
- **Migration 2:** an immutable table of accepted opportunities (score, rules version, signals, evidence ids, the task
  it created); tasks gain the source kind `opportunity`; one function records the opportunity and creates its task in
  one transaction.
- **Screen:** a new top section on Keyword Intelligence's existing *Opportunities* tab (the query labels stay below);
  each row opens its "Why" list; *Accept as task…* opens the F3 confirmation, which states there is no cost.
- **Owners by fixed rule:** Content Strategist for write, expand and refresh; Technical SEO for fix.

**Cost.** No AI run and no DataForSEO call.

**PRs, stacked:** (1) docs, this plan, the M2 design note; (2) migration and harness: the pinned article's keywords;
(3) migration and harness: the opportunity table, the task source kind, the accept function; (4) the scoring library,
tested on the real map's shape; (5) service, store, routes; (6) the Opportunities section.

## M3 — Content calendar

**For the owner.** A month view of accepted work, each item with a date and the stage it has reached — read from the
task and its linked article, from proposed to published. It never publishes.

**Design.**
- **No new lifecycle.** The stage is derived on read: task backlog → *Proposed*; task ready → *Approved*; task in
  progress with no article → *Research*; article drafting → *Draft*; article checked → *Review*; article approved →
  *Ready*; an active proposal → *Publication proposal*; the slug live → *Published*.
- **Migration:** tasks gain a planned date, changed only through a set-date function that records a
  `plan-date-changed` event; a second function links an article to a task (`article-linked` event). Both follow the
  2.3b priority pattern.
- **Date suggestions:** *Suggest dates* spreads accepted items by score at one a week by default; they are proposals
  the owner confirms before anything is saved.
- **Screen:** a *Calendar* tab in Content Studio — a month grid on desktop, a list on phones — with *Set date* and
  *Link article*.

**Cost.** No new AI run; articles use the existing plan and check runs (about $0.06 a check run, observed).

**PRs:** (1) migration and harness: planned date, the two functions and events; (2) the calendar library (stages, date
suggestions); (3) routes; (4) the Calendar tab; (5) *Link article* on the article editor and detail.

## P-L2 — Publishing Level 2

**For the owner.** Approve an article and request publication; an email arrives; its link opens a signed-in page with
the exact files; one press opens the `nexra-ai` pull request, waits for its checks, merges and records the article as
live. The hand template re-pin and the per-article live-slug migration end.

**Design.**
- **Published-state table (C7b):** one row per publication (article, version, approval, commit, merge, file hashes,
  date). The live-articles read includes these rows, so runbook §7 step 5 ends.
- **Pin at publish:** the publisher reads `nexra-ai` `main` through the GitHub API and checks the files' structure, not
  fixed hashes, recording the commit and hashes on the publication row. This replaces the hand-made `/N` templates;
  the cross-link becomes optional and is chosen on the publish page.
- **Approval:** the 6.8 approvals table is used for the first time — a request records a 24-hour, single-use approval
  bound to the payload digest. The emailed link only opens the page: GET never acts; the press is a POST that consumes
  the approval.
- **Publisher:** consume the approval, render, commit the three files on a branch, open the pull request, wait for
  green checks, merge if the mode allows, record the publication, check the live page. Idempotent per approval;
  resumes after a failure.
- **Mode switch:** `NEXRA_PUBLISH_MODE` = `off` (default), `dry-run` (opens the pull request and stops) or `merge`.
- **Reviewer role:** set by an environment variable; a reviewer reads everything and uses the publish page but cannot
  queue paid work.

**Cost.** No AI run, no DataForSEO call; GitHub and email are free at this volume.

**PRs:** (1) design note and threat model; (2) migration and harness: the published-state table and the read joining
it; (3) the reviewer role; (4) pin at publish (read files at a commit, check structure, optional cross-link); (5)
GitHub client, server-only, tested with recorded responses; (6) the publisher service with the mode switch; (7) email
notifier and the `/publish/[approvalId]` page; (8) screens: *Request publication…* and publication history; (9)
runbook §7 rewritten for P-L2.

**Amended by the owner (3 Oct 2026, `docs/roadmap/P-L2-publishing.md`):** no email and no Resend — a request appears as a
*Ready to publish* item in the Command Center linking to `/publish/[approvalId]` (PR 7 builds that instead of the email
notifier); `NEXRA_PUBLISH_MODE` defaults to `off` and is first used as `dry-run`; the reviewer role is built with no
reviewer by default. Owner action 4 (Resend) is dropped; the token (action 3) is already in Vercel.

## M4 — Research and evidence with outside sources

**For the owner.** For an accepted opportunity, the product records Google's top results and People Also Ask
questions, fetches those pages with the existing crawler, and stores each fact as an evidence unit with its source,
quote, retrieval time and status. The owner admits or rejects units. The checker can then pass a statement backed by
an admitted outside source, so fewer paragraphs need "Our view", and the article gets a Sources section.

**Design.**
- **SERP data:** the provider runs table gains a `serp` kind; a results table holds rank, URL, title, snippet and type
  (organic, question, related).
- **Evidence tables:** sources (the fetched page: URL, time, status, text hash, text capped at 20,000 characters,
  never published) and units (claim, a quote of at most 300 characters, source, type, status — supported, needs review,
  unsupported — and the owner's admit or reject).
- **Extraction:** a Research & Evidence task, `evidence-extract`, with hash-pinned instructions; each quote must appear
  word for word in the stored page text, or the unit is "needs review". Nothing becomes a fact silently.
- **Checker version 4:** may mark a statement supported only by an admitted unit, cited by id. The F8 evidence
  fingerprint includes the admitted units.
- **Article format `/3`:** an optional `sources` field, used only when present (earlier bytes and hashes unchanged),
  rendered through P-L2's pin at publish.

**Cost.** One SERP (live, advanced, top 10) about $0.002; one extraction run about $0.06–$0.15 a page; one opportunity
(1 SERP, 5 pages) about $0.30–$0.75. The checker is unchanged at about $0.06 a unit.

**PRs:** (1) design note; (2) migration and harness: the `serp` kind and results table; (3) SERP client, parser,
service and route; (4) migration and harness: sources, units, the admit function; (5) source fetch (robots, text
capped); (6) the `evidence-extract` task and the quote check; (7) the Evidence screen; (8) checker version 4 and the
admitted-units block; (9) the `sources` field, format `/3`, and rendering.

---

## Decisions (defaults chosen; all accepted by the owner, 3 Oct 2026)

| Question | Default chosen | Why | What changes if the owner disagrees |
|---|---|---|---|
| Record the pinned article's keywords before scoring? | Yes, M2 PR 2 | Otherwise M2 proposes articles that compete with the best page | M2 shows "write" for four topics the follow-up article covers |
| Store scores, or compute on read? | Compute on read; store only what is accepted | No stale scores, one lifecycle fewer | A scored-set table per run |
| Any AI step in M2 or M3? | No | Rules are explainable and free, as in M1 | A Director slot (about $0.10–$0.20 a run) |
| DataForSEO ranked keywords in M2? | No | Positions 54–86: little to read | About $0.03 a call, one more provider-estimate signal |
| Where opportunities live | Top of the existing Opportunities tab | No 13th sidebar item | A new tab or screen |
| Calendar statuses | Derived from task and article | No third lifecycle (brief and audit) | A calendar table with its own statuses |
| Who sets dates | The owner; optional suggestions at 1 a week | Nothing scheduled without the owner | Automatic dates |
| Calendar location | A Content Studio tab | Content work lives there | A sidebar item |
| Order inside P-L2 | Dry-run before merge | The first automated external write | Merge from day one |
| Who merges in P-L2 | The product, in `merge` mode, after green checks and one press | Matches "one-click publish" | The product opens the PR; the owner merges on GitHub |
| GitHub credential | Fine-grained token for `nexra-ai` only, 90-day expiry | Decision Q2 of 6.1; free | A GitHub App (no expiry, more setup) |
| Email provider | Resend, free plan | 3,000 emails a month is far beyond need | Postmark ($15 a month), or no email |
| Roles | One reviewer role by environment variable; per-project scope deferred | One real site | A project-members table now |
| Template re-pin | Automatic at publish, checking structure | Ends the hand `/N` PRs | Keep hand pins |
| Cross-link | Optional, chosen on the publish page | Mandatory only because of the old pin | Stays mandatory |
| SERP mode | Live, advanced, top 10 | One call, no polling, about $0.002 | Standard queue, $0.0006 but delayed |
| Outside page text | Stored capped at 20,000 characters, internal; quotes ≤ 300 characters | Every quote checkable; the repository stays public | Hashes and quotes only, weaker verification |
| How outside facts reach articles | Admitted units plus a Sources section (format `/3`) | An outside fact must be cited | Units ground the checker only, no citations |
| Order of P-L2 and M4 | P-L2 first | M4's renderer change rides on the publish-time pin | M4 first needs one more hand template |
| Daily DataForSEO cap | Stays at $1 | M4 spends under $0.05 a day | Raise to $2 |

## Owner actions outside the code

1. Every batch: approve the merges, the migration applies after a fresh backup, and the first live run of each new
   task.
2. M2: rebuild and approve the topic map after the pinned-keywords migration is applied (free).
3. P-L2, GitHub: a fine-grained personal access token — repository access `abdulrehmanvigo2-hash/nexra-ai` only;
   Contents read and write, Pull requests read and write, Metadata read; 90-day expiry — stored in Vercel as
   `NEXRA_AI_GITHUB_TOKEN`, Sensitive, Production only.
4. P-L2, email: a Resend account (free) with a verified sending subdomain such as `notify.nexraagency.com` (three DNS
   records, a §6 DNS change); `RESEND_API_KEY` in Vercel (Sensitive, Production only) and `NEXRA_PUBLISH_NOTIFY_EMAILS`.
5. P-L2, reviewer: create the assistant's sign-in user and add the email to `NEXRA_REVIEWER_EMAILS`, if an assistant
   will review.
6. P-L2, mode: `NEXRA_PUBLISH_MODE` — `dry-run` first, `merge` only after approving standing automation for merges.
7. M4: no new credential; approve each research run's spend (within the existing DataForSEO balance, about $50.86).

## Timeline

About 29 stacked draft PRs in 6 batches, each closed by the owner's merge and any migration apply:

| Batch | PRs | Migration applies | Gate |
|---|---|---|---|
| M2 | 6 | 2 | rebuild the map |
| M3 | 5 | 1 | — |
| P-L2, part one | 1–6 (published-state table, dry-run publisher) | 1 | token in Vercel |
| P-L2, part two | 7–9 (email, publish page, runbook) | — | Resend set up; first dry-run publication |
| M4, part one | 1–3 (SERP) | 1 | first SERP run |
| M4, part two | 4–9 (evidence, checker, sources) | 1 | first extraction run; first article with sources |
