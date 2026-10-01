# Phase 0 — current-state audit against the next-phase brief (M1–M11, P-L2)

Read-only audit, 1 Oct 2026, `master` at `0d917e67`. The brief and the operator's adjustments (A–G) are in
`docs/roadmap/NEXT-PHASE-BRIEF.md`; the adjustments override the brief.

**How this was done:**
- read the repository: the task registry (`src/lib/agent-runs/task-types.ts`), the grounding modules, the
  content, crawl, Search Console and keyword libraries, the routes, the migrations and the tests;
- read production with read-only `SELECT`s only (counts and shapes, no row content beyond ids and dates);
- read the GitHub Actions run list for the backup workflow.

**What it did not do:** no code change, run, migration, data write, nexra-ai write or paid API call. No account
was created anywhere. DataForSEO's site is blocked by this session's network proxy, so its prices come from
public reviews and its documentation snippets (sources at the end); the operator should confirm them on
DataForSEO's pricing page before any spend.

---

## 1. Production facts (read-only, 1 Oct 04:40 UTC)

| Fact | Value | Note |
|---|---|---|
| Projects | 10 rows | Only `nexra-agency` has crawls or Search Console data; the other 9 are seed fixtures |
| Real site | `nexraagency.com` | Market United States, English (US), 1 recorded competitor (`2vautomation.ai`) |
| Search Console snapshots | 6 | Windows ending 21–26 Sep, captured daily 25–30 Sep by the scheduled worker; latest 30-day window: 151 impressions |
| Distinct Search Console queries | 12 | Same 12 in the snapshots' top queries and in the query × page rows (55 rows, 3 pages, 5 windows) |
| Curated keywords | 2 | Operator records (3.5) |
| Crawls | 8 | 7 own-site, 1 competitor; **every crawl stopped on a 5-page budget** (production `CRAWL_MAX_PAGES`; code default 50, ceiling 500) |
| Crawl pages | 99 | 7 own-site crawls × 7 rows (5 fetched, 2 discovered only) + 50 competitor rows |
| Crawl links | 586 | 7 own-site crawls × **46 identical edges** + 264 competitor edges |
| Newest own-site crawl | `75d1bfbe`, 27 Sep | Predates the 30 Sep article `/blog/ai-dead-lead-reactivation` |
| Agent runs / tasks | 82 / 1 | Last run 30 Sep 02:28 UTC |
| Articles / drafts | 2 / 2 | One published (6.11), one verification article |
| Migrations | 37 files, 38 history rows | All applied (F9 on 1 Oct) |

## 2. Verification of the preliminary findings (adjustment E)

| Finding | Verdict | Detail |
|---|---|---|
| 12 GSC queries, 2 keywords, 6 GSC snapshots, 99 crawl pages, 1 real site | **Confirmed** | See §1. The 99 pages hold only 7 distinct own-site URLs. |
| M1/M2 need DataForSEO data | **Confirmed** | 12 queries and about 150 impressions a month cannot seed a topical map or rank opportunities by demand. Volume, difficulty and related keywords exist nowhere in the product. |
| M7/M11 need 2–3 months of history | **Confirmed, with dates** | The P4d comparison needs two stored windows at least 7 days apart: the first such pair arrives around 2 Oct (window ending 28 Sep against 21 Sep). A fair 28-day vs 28-day decay comparison needs about 60 days of daily snapshots, so early December. Measuring the new article's effect needs it indexed first, so January. |
| M4 checker is real and grounded, own-site evidence only | **Confirmed** | `article-check-unit` reads the evidence pack: the newest own-site crawl, the default Search Console window, and which competitor crawls exist. No external source is admitted (6.10b scope decision; 6.1b option b deferred). |
| Learning loop (6.7) exists | **Confirmed** | One cited priority change in production: task `30e79092` seq 21 → Director run `288639f4` → performance review `17623686`. |
| M8 has 586 crawl links to build on | **Corrected** | It has **46 distinct own-site edges over 5 fetched pages**. The rest are repeat crawls of the same 5 pages and a competitor's links. M8 needs a full own-site crawl first, which means raising `CRAWL_MAX_PAGES` in production (a §6 environment change); the latest crawl does not include the new article. |
| Order: DataForSEO → M1 → M2 → P-L2 → M4 → M3 → M5/M6 → M8 → M9 → M7/M11 → M10 | **Mostly agreed, two changes** | See E. |

## 3. Capability matrix

States: **REAL+G** real and grounded in stored records; **REAL-API** real, reachable by API with no screen; **PARTIAL**;
**MOCK/UI** fixture or ungrounded; **MISSING**.

| Capability | Current state | Evidence | Existing components | Missing pieces | Dependencies | Milestone |
|---|---|---|---|---|---|---|
| Agent registry (12 agents) | PARTIAL | Profiles, statuses and activity are fixtures (`src/lib/mock/agents`, labelled Modelled); runs are real | 27 task types, 25 grounded; every agent holds ≥ 2 grounded tasks | `project-review` and `keyword-research` have evidence `none` (ungrounded; the instructions forbid inventing metrics) | — | M1 (ground or retire `keyword-research`) |
| Worker and execution | REAL+G | Queue, leases, retries, recover; daily caps of 40 runs a project and 100 overall; Vercel crons `recover` 04:00 and `process` 05:30 | `src/lib/agent-runs/{worker,lifecycle,daily-caps,process-job}.ts` | A per-provider spend cap for paid data calls (the caps count runs, not money) | — | F0 |
| Task system | REAL+G | Tasks, events, status map, owner, priority, handoff, cited priority (6.7) | `nexra_agent_tasks`, `nexra_agent_task_events`, `/api/agent-tasks` | A task source kind for an approved opportunity (sources are `director-run` and `keyword` only) | Migration | M3 |
| Grounding architecture | REAL+G | Evidence kinds: crawl, crawl-links, search-console, competitor-comparison, evidence-pack, content-draft, draft-version, article-unit, agent-run(s), project, task | `task-grounding.ts`, the per-kind readers, byte ceilings, T6 header | Kinds for provider data (keyword metrics, SERP) and for approved opportunities | F0, M1 | F0 → M4 |
| Project data model | REAL | 10 projects, 1 with data; competitors as a domain list | `projects`, delete guards | Per-project roles and scoping (single operator level) | — | P-L2 |
| Crawl storage | REAL+G | Pages, signals (M2), links with anchors, robots, sitemap, network guard | `src/lib/crawl`, `nexra_crawl_*` | A complete own-site crawl (budget 5 in production) | §6 env change | M8 |
| Crawl findings | REAL+G | Rule v3 findings, triage (M3), derived history (3.3) | `src/lib/crawl/findings` | — | — | M2 signal |
| Search Console persistence | REAL+G | Daily snapshots, query × page pairs, history comparison (P4a/P4d) | `src/lib/search-console/{snapshots,query-pages,history}` | Time: 6 windows over 6 days | Calendar time | M2, M7, M11 |
| Keyword intelligence | REAL+G (lexical) | Inventory of 12 queries, intent hints, lexical groups ("a shared word, not a topic"), 4 opportunity labels, 2 curated keywords | `src/lib/search-console/keywords`, `src/lib/keywords`, `/keywords` | Volume, difficulty, CPC, related keywords, any non-lexical clustering | F0 | M1 |
| Topical map and clustering | MISSING | Only lexical groups; the content plan says topical maps exist in no record | — | Topic → cluster → primary/supporting keyword → intent → existing page → candidate page → evidence; an approval step | F0, crawl | M1 |
| Opportunity scoring | PARTIAL | 4 rule labels (low CTR, position band 4–20, no strong landing page, cannibalisation candidate); `keyword-opportunity-review` (a model's reading) | M4 labels, the 6.5 task | An explainable score per opportunity, stored with its signals; a "why" screen | M1 | M2 |
| Content calendar | MISSING | The Content Studio pipeline groups articles by status; tasks have 7 statuses | Task workflow, Content Studio | Calendar entity or a task view with dates; approval before planned work | M2 | M3 |
| SERP research | MISSING | No SERP data anywhere (scoped V1, decision Q4) | Crawler can fetch a competitor's pages under its network guard | SERP provider calls, stored results with provenance | F0 (DataForSEO SERP) | M4 |
| Research & Evidence | REAL+G (own records only) | `evidence-pack-review`; the pack grounds the plan, the Writer and the checker | `src/lib/research/evidence-pack.ts` | Structured evidence units (claim, source, type, URL, retrieval time, status) stored as records; external sources | SERP/provider data; §4 | M4 |
| Content Strategist | REAL+G | `content-plan-review` (one page, seven sections, every fact tagged to its record); `content-refresh-review` | `plan-instructions.ts` | A stored strategy bound to an approved opportunity and an evidence package | M2, M4 | M5 |
| Writer | REAL+G (evidence-constrained) | `section-draft` (from a completed plan, records re-read), `article-revision-draft` (needs-review units only) | `draft-grounding.ts`, `revision-grounding.ts`, article versions, import (F9) | A whole-article draft from strategy and evidence, with an evidence map per statement | M5 | M6 |
| Article system and versions | REAL+G | C1 contract, C2 immutable versions, C4 check units, C5 approval, attestations (6.8b), carry-forward (F8), import (F9) | `src/lib/content/articles` | — (reuse as is) | — | M6, M7 |
| SEO Director | REAL+G | `priority-review`, `project-priority-review` (five-slot bundle, Q7 ranking) | `director-bundle.ts` | Slots for opportunities and calendar items | M2, M3 | M2/M3 |
| Approval gates | REAL | Exact-version approval (C5), the attestation tick, operator confirmations (F3); `nexra_approvals` (6.8) **built but unused** | `src/lib/approvals` | A consumer (C7); a reviewer role | P-L2 | P-L2 |
| Publication proposals | REAL (record-only) | C6 proposals, live articles from records (F9); the renderer (6.9b) produces the three files | `proposals/`, `website/render.ts` | Published-state table (C7b), a publisher, the template re-pin at the current nexra-ai `main` (runbook §7) | P-L2 | P-L2 |
| Content decay / refresh | PARTIAL | P4d history comparison (not yet qualifying); `content-refresh-review`; `learning-review` | `src/lib/search-console/history` | Bounded period-vs-period rules per page and query, and the refresh workflow into a new version | ~60 days of snapshots | M7 |
| Internal linking | PARTIAL | `internal-link-review` (inbound edges among fetched pages); article internal links are syntax-checked and reported `unverified` | `internal-link-grounding.ts`, `internal-links.ts` | A route inventory (from a complete crawl), recommendations as records, an anchor-variety rule | Full crawl | M8 |
| Backlinks | MISSING | Outbound links only, by decision Q4 ("never backlinks") | `outbound-link-review` | Backlink data, opportunity records, review status | F0 (DataForSEO Backlinks) | M9 |
| AI Visibility | PARTIAL | Declared answer-readiness and schema types only; no citations | `declared-readiness.ts` | Mention or citation data | Provider (later) | after M9 |
| Copilot / MCP | MISSING | Every data route needs an operator's browser session | 30+ read routes | Token auth, scoped tool sets (read / propose / write) | M1–M9 stable; §6 auth | M10 |
| Learning loop | PARTIAL | 6.7 cited change; Analytics Learnings chain | `learning-chain.ts` | Outcome measurement per action over enough history | M7 data | M11 |
| UI routes | REAL+G with labelled fixtures | 12 nav screens; every fixture section labelled Modelled (5.7 rule) | `src/app/(app)` | New screens: Topical Map, Opportunities, Calendar | — | M1–M3 |
| Schema and migrations | REAL | 37 migrations, RLS with no policies, `security definer` writes, guards; SQL harness 89 checks | `supabase/` | New tables per milestone, each its own migration | — | each |
| Tests | REAL | `npm test` 2,709; harness 89 checks; CI on every PR | — | — | — | each |
| Production / mock boundary | REAL | `src/lib/mock` used only by labelled sections; build-status note | `modelled-badge.tsx` | Keep provider estimates labelled apart from observed data | — | F0 |
| Email to operator | MISSING | No email dependency; auth email only (Supabase) | — | A mail provider (a new integration, §4/§6) | — | P-L2 |
| Roles | MISSING | One level: operator or nobody (`NEXRA_OPERATOR_EMAILS`) | `src/lib/auth` | Reviewer role, per-project scope | — | P-L2 |

**Reuse map (dependency view):**
- **Search Console store + crawl store + curated keywords → evidence pack** — already feeds Research, Strategist,
  Writer and checker.
- **F0 provider snapshot (new) →**
  - **M1 topical map →**
    - **M2 opportunities**, which also read the crawl findings and the query × page pairs;
    - **→ M3 calendar**, a view over the existing task workflow;
    - **→ M5 strategist**, the existing plan task re-grounded;
    - **→ M6 writer**, the existing article system unchanged.
  - **M4 evidence units** — SERP from F0, plus the crawler.
- **M6 article → C4–C6 → P-L2**, which needs approvals (6.8, built), proposals (C6), the renderer (6.9b) and live
  articles (F9). P-L2 adds email, a reviewer role, C7b and a publisher.
- **Search Console history → M7 → M11**, with the 6.7 learning chain reused.
- **Full crawl → M8.**
- **F0 backlinks → M9.**
- **Everything → M10**, read tools first, over the existing routes.

## A. Already built — preserve

- The agent runtime: queue, leases, retries, daily caps and the worker crons. Plus the 25 grounded task types,
  each with hash-pinned, bounded instructions.
- Every store with its database rules:
  - the crawl records, findings, triage and finding history;
  - Search Console snapshots, query × page pairs and history;
  - curated keywords;
  - tasks and events;
  - the approvals table;
  - the health endpoint and backups.
- The content path, end to end: C1 contract, C2 immutable versions, C4 check units, C5 exact-version approval,
  attestations, F8 carry-forward, C6 proposals, F9 live articles and import, and the 6.9b renderer.
- The observed screens and their honest labels (Observed, Not recorded, Not read, Modelled). And the rule that an
  unknown value reads as unknown, never zero.
- The approval discipline: nothing publishes, approves or runs paid work without an operator confirmation.

## B. Partly built — extend

- **Keyword intelligence** (lexical) → add provider metrics, labelled as provider estimates (F0, M1).
- **Opportunity labels** and `keyword-opportunity-review` → explainable stored scores (M2).
- **Research & Evidence** (own records) → structured evidence units with external sources (M4, §4).
- **Content Strategist and Writer** (one-page plan, section draft) → bound to an approved opportunity and an
  evidence package (M5, M6).
- **History comparison and refresh/learning reviews** → decay rules once history exists (M7).
- **Internal-link review** → recommendations over a complete crawl (M8).
- **The 6.7 learning chain** → outcome measurement (M11).
- **Approvals table (6.8) and renderer (6.9b)** → the C7 publisher (P-L2).

## C. Genuinely missing

- Paid keyword, SERP and backlink data and their provenance store.
- A topical map; a stored opportunity score; a calendar view.
- Structured evidence units.
- Backlink opportunities.
- Email, roles, per-project scope and a publisher.
- Token-authenticated MCP tools.
- A complete own-site crawl.

## D. Conflicts with the existing architecture

1. **Workflow rules.** The brief's rules 9–10 (no merge, no push) and "do not create a branch" are replaced by
   adjustment A: draft PRs, and merges, migrations and runs only with approval in chat. Rule 7 (no production
   migrations) is likewise replaced by the established apply method with approval.
2. **"Convert Research & Evidence from mock."** It is not a mock: it is grounded, in own records only. External
   sources are a new integration (§4) and an evidence-model change. The checker today admits only own records.
3. **Provider data is not "observed."** DataForSEO volumes, difficulty and CPC are a provider's model estimates. They
   must carry provider, endpoint, location, language and retrieval time, and read as *provider estimate* —
   never in the Observed column. The brief's "do not invent" holds only if this label holds.
4. **Calendar statuses.** The brief's PROPOSED → … → PUBLICATION PROPOSAL chain would duplicate the task
   workflow (7 statuses, fixed map, events) and the article statuses. M3 should be a dated view over tasks with a
   new source kind, plus the existing article states — not a third lifecycle.
5. **P-L2 "one-click approve" by email.**
   - Approving from a link alone would bypass the operator gate.
   - The link must open a signed-in confirmation page.
   - The approval must be a single-use, expiring record bound to the exact payload digest, which `nexra_approvals`
     (6.8) already does.
   - An email provider is a new integration (§4/§6).
   - Merging in nexra-ai is an external write (§6) for each article, unless the operator approves standing
     automation.
6. **The repository is public** (GitHub reports `visibility: public`, `private: false`), while the runbook (§6.1)
   and CLAUDE.md say *private*. As a result:
   - CLAUDE.md and the docs publish production identifiers (project ref, run ids, hashes);
   - backup artifacts can be downloaded by any signed-in GitHub user. They are age-encrypted, so their content is
     safe, but the "private repository" claim is wrong.
   - Any DataForSEO or GitHub publishing credential must never touch the repository.
   - Recommended decision before P-L2: make the repository private, or correct the docs. Recorded only.
7. **Daily caps count runs, not money.** Paid data calls need their own spend cap, measured from the provider's
   reported cost.
8. **Ungrounded tasks.** `keyword-research` and `project-review` run with no evidence. That conflicts with
   "evidence-grounded". M1 should ground `keyword-research` on provider data or retire it.
9. **M10 auth.** The API is cookie-session operator-only; MCP needs tokens and scopes — an authentication change (§6).

## E. Recommended order (from the repository, not the brief)

**F0 DataForSEO foundation → M1 → M2 → M3 → P-L2 → M4 → M5/M6 → M8 → M9 → M7/M11 → M10**

This changes the proposed order in two places:
1. **M3 moves before P-L2.** M1 and M2 both end in "approval before planned work", and that work needs somewhere
   to land. M3 is small: a task source kind plus a dated view. P-L2 is the riskiest milestone (email, roles,
   tokens, external writes). It gains nothing from going earlier, and the first article was published by hand.
2. **M8 may move earlier at any point.** It needs no paid data, only a complete crawl (one env change). It is a
   cheap filler while M7/M11 wait for history.

M7/M11 are gated by calendar time, not code: start their design in November and build in December, when about 60
days of snapshots exist. M10 comes last, read tools first.

## F. Smallest safe first milestone

| Option | Value | Risk | Verdict |
|---|---|---|---|
| **F0: DataForSEO keyword snapshot** — 5–10 seed topics, stored with provider, endpoint, location, language, time and reported cost; read-only screen; < $1 | Unblocks M1/M2 with real demand data; small and append-only | Credentials and spend (both §6); provider estimates mislabelled as observed | **Recommended** |
| M1 over the existing 12 queries only | Builds the screen | Too little data to be a topical map; would be rebuilt after F0 | Not first |
| M8 internal links over the current crawl | No paid data | 5 pages and 46 edges; needs the crawl budget change first | Good filler, not first |
| M3 calendar over tasks | Small | Nothing to schedule until M2 | After M2 |

**F0 scope:**
- **Store:**
  - one migration: an append-only provider-request record (provider, endpoint, parameters without secrets,
    location and language codes, retrieval time, the API's reported `cost`, response SHA-256);
  - one keyword-metrics table: exact keyword text, volume, monthly volumes, CPC, competition, difficulty, provider
    intent, the provider's own update date;
  - RLS on with no policies, and a `security definer` write function, like the Search Console snapshots.
- **Fetch:** a server-only DataForSEO client. One operator action with a confirmation that shows the estimated cost
  and today's spend. A daily dollar cap, counted from the reported cost.
- **Screen:** one read-only section on Keyword Intelligence labelled "Provider estimate — DataForSEO, <date>,
  United States / English". Nothing is grounded on it until M1.
- **Tests and design:** unit tests with recorded fixture responses, and harness suites. The design note (F0a) comes
  first, under its own approval.
- **Approvals needed, in order:**
  1. the design note;
  2. the operator opens the DataForSEO account and tops up the $50 minimum;
  3. the credentials go into Vercel as sensitive production variables (§6);
  4. the code PR;
  5. the migration apply;
  6. the first fetch (one run, about $0.25).

---

## G. DataForSEO assessment (adjustment D)

**Endpoints per milestone** (location United States `2840`, language English `en`, the project's recorded market):

| Milestone | Endpoints | What they give |
|---|---|---|
| F0 / M1 | Labs `keyword_overview/live`, `related_keywords/live`, `keyword_suggestions/live`, `bulk_keyword_difficulty/live`, `search_intent/live`; optionally Keywords Data `google_ads/search_volume` | Volume and 12-month trend, CPC, competition, difficulty, provider intent, related and suggested keywords for clustering |
| M2 | Labs `ranked_keywords/live` (own domain and competitor), `competitors_domain/live`, `domain_intersection/live` | Keywords the provider estimates each domain ranks for; gaps against the recorded competitor |
| M4 | SERP `google/organic/task_post` + `task_get/advanced` (standard queue), People Also Ask and related searches from the same result | The current top results and questions for an approved topic; the pages themselves are fetched by the product's own crawler under its network guard |
| Rank tracking (optional) | SERP standard, weekly, for tracked keywords | Positions — complementary to Search Console's average position, labelled apart |
| M7 | None required (Search Console is the source); optionally Labs `historical_rank_overview` | Provider history, labelled as estimate |
| M8 | None (own crawl) | — |
| M9 | Backlinks `summary/live`, `referring_domains/live`, `backlinks/live`, `domain_intersection/live` | The site's and the competitor's referring domains; domains linking to the competitor but not to the site |
| AI Visibility (later) | DataForSEO's AI optimisation / LLM mentions endpoints (verify availability) | Mentions in AI answers |

**Monthly cost for one site:** an estimate from public prices, to be confirmed. The rates assumed are:
- Labs: about $0.01 a task plus $0.0001 an item;
- SERP standard queue: $0.0006 a page;
- Backlinks: from about $0.02 a request plus a small per-row charge;
- account: a $50 minimum top-up, no monthly fee; the Backlinks monthly minimum was dropped in 2026.

| Item | Cadence | Calls | Estimate |
|---|---|---|---|
| F0 keyword snapshot (10 seeds) | once | 1 overview + 10 related + 1 difficulty | **≈ $0.25** (cap $1) |
| M1 keyword refresh (~300 keywords, 20 seeds) | monthly | ≈ 22 tasks | ≈ $0.50 |
| M2 ranked keywords (own + 1–3 competitors) | monthly | 2–4 tasks × ≤ 1,000 items | ≈ $0.25–0.45 |
| M4 SERP research (≈ 10 topics) | monthly | 10 SERPs (advanced) | ≈ $0.05 |
| Rank tracking (50 keywords) | weekly | ≈ 200 SERPs | ≈ $0.12 |
| M9 backlinks (own + competitor) | monthly | ≈ 10 requests + rows | ≈ $0.20–1.00 |
| **Total, typical** | | | **≈ $1.50–2.50 a month**; with a product cap of $10 a month the $50 top-up lasts well over a year |

**Credential handling:**
- DataForSEO uses HTTP Basic auth with a login and an API password. Store them as `DATAFORSEO_LOGIN` and
  `DATAFORSEO_PASSWORD` in Vercel:
  - marked **Sensitive** (not readable after saving);
  - **Production only**, so preview builds hold no credential, as with Supabase today;
  - never `NEXT_PUBLIC_*`.
- Read them in one server-only module that never logs them, and never put them in the public repository or a
  Claude session. The secret scan already guards the tree.
- In the DataForSEO dashboard, set a low balance alert or spend limit if one is offered.

**Provenance storage:**
- Every value carries: provider, endpoint, request parameters, location and language, retrieval time, the
  provider's reported cost and task id, the response hash, and the operator who triggered it.
- Rows are immutable. A refresh is a new snapshot, as with Search Console.
- Screens and grounding blocks label the values "provider estimate", never "observed".

**What the existing Ahrefs connector could cover:**
- **What it is:** a Claude-session connector on the operator's account, not a product integration. Its tools
  include:
  - Keywords Explorer (overview, related and matching terms, volume history);
  - SERP overview;
  - Site Explorer (organic keywords, top pages, backlinks, referring domains, Domain Rating, organic competitors);
  - rank tracker, site audit and its own Search Console views;
  - **Brand Radar** (AI answer mentions and citations).
- **Good for:** one-off analysis in a chat — validating seed topics before F0, sanity-checking DataForSEO figures,
  and an early look at AI Visibility mentions.
- **Limits:**
  - the product server cannot call it;
  - its results are not stored with provenance unless they are imported;
  - each call spends the operator's Ahrefs API units;
  - making it a product data source needs an Ahrefs API key and plan (§4/§6).
- It was **not** called in this audit.

## H. P-L2 — Publishing Level 2 (adjustment C)

**Goal:** article approved → email to the operator or an assistant → one-click approve → the product opens the
nexra-ai PR and publishes.

| Needed | State |
|---|---|
| Exact-version approval (C5) and proposal (C6) | Built |
| Single-use, expiring, digest-bound approval record | Built (6.8, unused) |
| Renderer for the three files | Built (6.9b); re-pin to the current nexra-ai `main` (runbook §7) |
| Live articles from records | Built (F9) |
| Published-state table (C7b) | Missing (migration) |
| GitHub publisher with a fine-grained, expiring token scoped to nexra-ai | Missing; credential (§6) |
| Email provider and a signed confirmation link (opens a signed-in page; never approves on a GET) | Missing; new integration (§4/§6) |
| Reviewer role and per-project scope | Missing (one operator level today) |
| Merge = deploy of nexra-ai | External write per article (§6) unless standing automation is approved |

**Risks:** the highest of all milestones, because it is the product's first automated external write. Recommended
after M3, with its own design note, threat model and a dry-run mode that opens the PR but never merges.

## I. Backup check (adjustment G)

- **No scheduled run yet.** As of 04:43 UTC on 1 Oct the Nightly backup has **no scheduled run** for 03:17 UTC,
  and the repository has never had a run from a `schedule` event. The 4 backup runs so far were all started by
  hand on 30 Sep: two failures, then two successes.
- **What is ruled out:**
  - the workflow is on the default branch (`master`) with its cron line;
  - environment protection would show a waiting run, not none.
- **Cause: not established.** GitHub documents that scheduled events can be delayed or dropped at busy times.
- **Recorded only:**
  - re-check after 03:17 UTC on 2 Oct;
  - if again none, check the workflow's enabled state in the Actions tab and run it by hand.
  - The Vercel crons (Search Console snapshots at 05:30) are separate and unaffected.

## J. Risks

1. **Provider estimates read as facts.** A volume or difficulty without its label would breach "do not invent".
   Mitigation: a separate column and label, never in Observed, tested.
2. **Spend.** A loop or an automatic fetch could drain the balance. Mitigation: operator-triggered calls only at
   first, a daily dollar cap from reported cost, a confirmation with an estimate, and a low prepaid balance.
3. **Credentials in a public repository.** Mitigation: Vercel Sensitive production variables only; the secret
   scan; never in a session or a doc. Decide whether the repository should be private.
4. **Thin data.** 12 queries and a 5-page crawl make any map or score fragile. Mitigation: F0 data, a full crawl,
   and saying "insufficient data" on screen.
5. **History is time-bound.** M7/M11 cannot be tested on real data before December. Mitigation: design and fixture
   tests first, live checks later.
6. **P-L2 external writes.** Mitigation: a signed-in confirmation, single-use digest-bound approvals, a dry-run mode
   and a least-privilege expiring token.
7. **Parallel lifecycles.** A calendar or an opportunity status chain beside the task workflow would split state.
   Mitigation: extend tasks.
8. **Checker variance (6.10b).** More external evidence widens the checker's judgement. Mitigation: F8
   carry-forward; evidence units with explicit status.
9. **Scheduled jobs that silently do not run** (I). Mitigation: verify the first scheduled run of every new cron.

## Sources (DataForSEO pricing, read 1 Oct 2026; the vendor site is blocked by this session's proxy)

- [DataForSEO API: Complete 2026 Guide (Pricing + Endpoints)](https://nextgrowth.ai/dataforseo-api-guide/)
- [DataForSEO Review 2026: Honest Verdict After 12 Weeks](https://nextgrowth.ai/dataforseo-review/)
- [DataForSEO vs SerpApi (2026)](https://nextgrowth.ai/dataforseo-vs-serpapi/)
- [DataForSEO Backlinks API: Python Guide and Cost Comparison](https://nextgrowth.ai/dataforseo-backlinks-api/)
- [Pricing Update in DataForSEO APIs](https://dataforseo.com/update/pricing-update-in-dataforseo-apis)
- [dataforseo_labs/bulk_keyword_difficulty/live (docs)](https://docs.dataforseo.com/v3/dataforseo_labs-bulk_keyword_difficulty-live/)
- [DataForSEO Keyword Research API guide](https://nextgrowth.ai/dataforseo-keyword-research-api/)
- [DataForSEO $50 minimum vs credit APIs](https://scavio.dev/blog/dataforseo-minimum-spend-vs-credit-apis-2026)
