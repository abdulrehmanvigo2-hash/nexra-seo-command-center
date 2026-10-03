# M2 — Content opportunities: design note

**Status (3 Oct 2026):** merged (PR #117–#122) and live — migrations `20261020120000` and `20261021120000`
applied to production and recorded after manual backup run `37128565711` (43 and 44 history rows). The owner rebuilds
and approves the topic map; no opportunity has been accepted.

The second milestone of `docs/roadmap/NEXT-FOUR-PLAN.md` (approved 3 Oct 2026 with every default accepted). It turns
the **approved** topic map (M1) into a ranked, explainable list of what to do next, and lets the owner accept an
opportunity as a task. No AI run, no DataForSEO call, nothing published.

## What it reads (all stored records)

- **The project's approved topic map** (`nexra_topic_maps` status `approved`) with its clusters and keywords. A
  proposed map is never scored. Without an approved map the section says so and offers nothing.
- **The latest stored Search Console query × page window** (`nexra_search_console_query_pages`, the newest
  `end_date` for the project's property): each pair's query, page, clicks, impressions and position.
- **The crawl findings** of the newest own-site crawl with a report at the current rule version (the Technical
  screen's read): rule, severity and the URLs each finding names.

The live articles reach the score through the map's coverage, which M1 computed from them.

## The rules (pure, deterministic; rules version 1)

1. **Matching queries to clusters.** A stored query belongs to the first cluster, in map order, one of whose
   non-excluded keywords matches it by the D7 rule (normalised; equal, holds or held by). A query matches no more than
   one cluster. A query that matches none is not counted anywhere.
2. **Observed signals per cluster** (Search Console, labelled *Observed*): the matched pairs' impressions and clicks
   summed, the impression-weighted average position, and the distinct pages they were observed on.
3. **Action:**
   - coverage *gap* → **write** (target: the map's candidate slug);
   - coverage *partial* → **expand** (target: the map's existing page);
   - coverage *covered* → **refresh** only when Search Console signals it — average position 4–20, or at least 20
     impressions with a click-through rate of 1% or less; otherwise the cluster is *monitored* and not listed;
   - each crawl finding whose URLs include the cluster's existing page → one **fix** opportunity per finding.
4. **Points** (each line is shown with its points and its label — *Provider estimate*, *Observed* or *Derived*):

   | Line | Label | Points |
   |---|---|---|
   | Demand: the primary keyword's monthly volume | Provider estimate | 30 at ≥ 1,000; 20 at 100–999; 10 at 10–99; 0 under 10; no estimate → 0, "unknown, not counted" |
   | Difficulty | Provider estimate | 15 at ≤ 20; 10 at 21–40; 5 at 41–60; 0 above 60; none → 0, "unknown, not counted" |
   | Observed impressions on the cluster's queries | Observed | 20 at ≥ 20; 10 at 5–19; 5 at 1–4; 0 when none observed |
   | Position band 4–20 (refresh only) | Observed | 10 |
   | Coverage | Derived | write 15; expand 10; refresh 0 |
   | Intent fit: commercial or transactional | Derived (provider's label) | 5 |
   | A fix: the finding's severity | Derived (crawl finding) | high or critical 10; medium 5; low 2 — added to the cluster's demand and observed lines |

   The score is the sum, at most 100. Ties: score, then the primary keyword's volume (unknown last), then map
   position, then action.
5. **Flag, not points — cannibalisation:** the cluster's matched queries were observed on two or more pages → "review
   before writing".
6. **Priority of the accepted task:** high at 60 or more, medium at 30–59, low under 30.
7. **Owner of the accepted task:** Content Strategist for write, expand and refresh; Technical SEO for fix.

A missing input is said in words ("no Search Console window stored", "no crawl findings recorded") and scores 0 —
never invented.

## Data model

**Migration `20261020120000_pinned_article_keywords.sql` (PR 2).** `nexra_article_publication_live_articles` (F9) is
replaced with the same signature: for the pinned template slug `ai-lead-follow-up-automation` at
`nexra-agency-website`, which has no article record, it returns the ten keywords the `/2` template pins (a repository
drift test checks them against `NEXRA_AI_BLOG_TEMPLATE_V2.liveArticle.keywords`); every other entry is unchanged. The
eligibility and the preview read slugs only and the renderer already uses the template's own set for that slug, so no
proposal, preview or render changes. Its effect: a map rebuilt afterwards sees the follow-up article (expected: 3
covered, 6 partial, 1 gap).

**Migration `20261021120000_opportunities.sql` (PR 3).**
- `nexra_agent_tasks.source_kind` gains `opportunity` (constraint replaced). `nexra_agent_task_create` is unchanged
  and still refuses it: only the accept function creates such tasks.
- `nexra_opportunities` — one immutable row per accepted opportunity: project, map, cluster, action (`write`,
  `expand`, `refresh`, `fix`), finding key (required for a fix, null otherwise), title, score (0–100), rules version,
  priority, signals (a JSON array of 1–20 lines: label, points, source `observed` / `provider-estimate` / `derived`,
  detail), the Search Console window end and crawl read (nullable), the task it created (unique), who accepted and
  when. One row per map, cluster, action and finding. RLS on, no policies; guards refuse an insert outside the
  function and every update, delete and truncate.
- `nexra_opportunity_accept(p_project_id, p_opportunity jsonb, p_operator)` — `security definer`, empty
  `search_path`: checks the map is the project's **approved** map, the cluster is that map's, the action fits the
  cluster's coverage (write ↔ gap, expand ↔ partial, refresh ↔ covered; fix on any cluster with an existing page), the
  crawl is the project's, the signals are well formed and their points sum to the score (capped at 100); derives the
  priority and owning agent itself; creates the task (`backlog`, source kind `opportunity`, source ref the
  opportunity id) and the opportunity row in one transaction. Answers `accepted`, `exists` (the same opportunity was
  accepted before, with its row), `project-not-found`, `map-not-approved`, `cluster-not-found` or `invalid` (with a
  reason). `service_role`: SELECT on the table, EXECUTE on the function.

The server never takes a score from the browser: *Accept* sends the cluster and action, and the server recomputes the
list and records what it computed.

## Service, store and routes (PR 5)

- `src/lib/opportunities/`: contract (types, request parsing, URLs), store contract with an *unavailable* store, the
  Supabase store (the accept function and the bounded reads; a missing schema answers "not set up"), and the service:
  `read(projectId)` → `not-set-up` | `no-approved-map` | `scored` (the list, the monitored count, what was read, and
  which opportunities were already accepted with their tasks); `accept(projectId, key, operatorId)`.
- `GET /api/opportunities?project=` (operator, read limit) and `POST /api/opportunities { project, clusterId, action,
  findingKey? }` (operator, same origin, write limit). 503 `not-set-up` before migration `20261021120000` is applied.
- The task contract's reader learns the source kind `opportunity` (shown "Opportunity"); the create route still
  accepts only `director-run` and `keyword`.

## Screen (PR 6)

A *Content opportunities* section at the top of Keyword Intelligence's *Opportunities* tab, on its own read (the
query labels stay below). Before the migration is applied it reads **Not set up yet** and the rest of the tab is
untouched; without an approved map it says "Approve a topic map first" and links to the *Topical map* tab. One row per
opportunity: action, topic, target page or candidate slug, score, priority, flags; a *Why* list opens each row's lines
with their points and labels. *Accept as task…* opens the F3 confirmation (the task's title, owner, priority, "no cost:
no provider call, no agent run"); an accepted row shows its task instead of the button.

## Tests

- PR 2: harness suites `pinned-keywords` and `pinned-keywords-upgrade`; the TS drift test.
- PR 3: harness suites `opportunities` and `opportunities-upgrade` (existing tasks and events unchanged; the create
  function still refuses the new kind); the security definer inventory names the new function.
- PR 4: the rules on the real map's shape (the approved map `2213a93d…`, the 29 Sep pairs, the 5 findings), and the
  map as it will read after the rebuild.
- PR 5: service and route tests with memory stores; PR 6: presenter tests and a local browser check, "Not set up yet"
  included.

## Pull requests (stacked drafts, one change each)

1. Docs: the folded notes, `NEXT-FOUR-PLAN.md`, this note.
2. Migration `20261020120000` and its harness suites.
3. Migration `20261021120000` and its harness suites.
4. The scoring library.
5. Service, store and routes.
6. The *Content opportunities* section.
