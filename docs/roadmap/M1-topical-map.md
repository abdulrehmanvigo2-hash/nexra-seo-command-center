# M1 — Topical map and keyword clustering: design note

The first milestone after the F0 foundation (`docs/roadmap/NEXT-PHASE-BRIEF.md`, `PHASE-0-AUDIT.md`; the audit's
order F0 → M1 → M2 → M3 → …). The goal, from the brief: turn stored keyword data into structured topics —
Topic → Cluster → Primary keyword → Supporting keywords → Search intent → Existing page → Candidate page → Evidence —
with observed data kept apart from anything derived, and an approval before a map becomes planned work.

**Status (3 Oct 2026): LIVE.** PR #111–#116 merged (`master` `aad235e`); migration `20261019120000` applied to
production and recorded (42 history rows, backup run `37118598679`, SHA-256 `e0f56ebb…0e69`). The first topic map
(`2213a93d…`) was approved by the owner on 3 Oct 2026: 10 clusters, 3 covered, 0 partial, 7 gaps. M2 follows
(`docs/roadmap/M2-opportunities.md`).

## Decisions (operator, 3 Oct 2026)

- **Q1 — Data:** build over the 41 F0 rows now (run `b50f8fa7…`); operator-chosen seeds for later runs are PR 6.
- **Q2 — Screen:** a *Topical map* tab on Keyword Intelligence, not a new sidebar item.
- **Q3 — No model step in M1.** The map is rule-based and deterministic; the optional Keyword & Search Intent
  recommendation run (and the regrounding of `keyword-research`) moves to M2.
- **Q4 — Stop list:** `ghl`, `white label`, `artisan`, `reddit`, `qualified` are vendor or community terms. A keyword
  holding one is shown as excluded with its reason and never clustered.
- **Q5 — Coverage:** a site page (home, about, contact, blog index) counts as *partial* coverage; only a live article
  counts as *covered*.

## What exists and is reused

- **F0 provider metrics** (`nexra_keyword_metrics`): one row per keyword per run with volume, difficulty, CPC,
  competition and the provider's intent, labelled provider estimate. Seeds the provider returned nothing for have no
  row; the run's `seeds` column still names them.
- **Live articles** (`nexra_article_publication_live_articles`, fix F9): slug, owning article, version and that
  version's keywords, for every published article.
- **The newest own-site crawl** (`crawlService().getLatestCrawlOverview`): each fetched page's URL, title and first
  h1.
- **Patterns:** the F0 store (RLS, no policies, `security definer` writes, guard triggers, "not set up" when the
  migration is missing), the F3 confirmation dialog, the observed / provider-estimate labels.

## The rules (pure, deterministic, tested on the real 41-row shape)

1. **Keyword set.** Every metric row of the project's newest completed live run (sandbox runs are never mapped), plus
   each run seed with no row at all (demand *no estimate*).
2. **Stop list.** A keyword is excluded when one of its words, or a two-word run, is a stop term (Q4). It is listed
   under its seed as *excluded — vendor term* and belongs to no cluster.
3. **Clusters.** One cluster per seed: the seed and its related rows. A keyword returned under two seeds goes to the
   seed whose own row has the higher volume (ties: the earlier seed); the same keyword text in another case is one
   keyword. A seed row and its lower-case twin (`AI SDR`, `ai sdr`) are one keyword.
4. **Primary keyword.** The non-excluded keyword of the cluster with the highest volume; on a tie the seed itself.
   The rest are supporting keywords.
5. **Intent.** The provider's own label on the primary keyword; `null` reads *unknown*, never guessed.
6. **Demand.** *estimated* when the primary keyword has a volume; *no estimate* when the seed had no provider data.
   **Never "no demand".**
7. **Topic.** The seed text, title-cased as the provider gave it; one topic per cluster in M1 (a later milestone may
   group clusters).
8. **Coverage** (tightened at the M1 review, 3 Oct).
   - *covered*: a live article's **primary topic** matches the cluster's primary keyword by the D7 rule (equal, holds
     or held by, normalised). The primary topic is the article's first recorded keyword, and the title or first h1 of
     its own `/blog/<slug>` page when the newest crawl fetched it (the live-articles read carries no title). The
     existing page is that article's route.
   - *partial*: any other overlap between a live article's recorded keywords and the cluster's keywords, naming the
     article with the most matches; or (Q5) a crawled site page's title or first h1 contains a cluster keyword,
     normalised, naming that page's path.
   - *gap*: neither. A candidate page is derived from the primary keyword as a slug (lowercase ASCII words joined by
     hyphens), refused if it equals a live slug, and labelled *candidate — not created*.
9. **Order.** Clusters by the primary keyword's volume, highest first; *no estimate* clusters last, in seed order.

Everything the map holds is either the provider's figure (labelled) or a derivation of fixed rules (labelled
*derived*). No search volume, difficulty, position or traffic is invented; a null stays a null.

## Data model (migration `20261019120000_topic_maps.sql`, PR 2)

Three tables in the F0 pattern: RLS on, no policies; `service_role` holds SELECT on the tables and EXECUTE on the
two functions only; guard triggers refuse any insert outside the functions, every update apart from the one approval
transition, and every delete and truncate. A map is immutable once recorded; a rebuild is a new map that supersedes
the proposed one.

- **`nexra_topic_maps`** — project, the provider run ids read, the crawl read (nullable), when the live list was read,
  status (`proposed` → `approved`; `superseded`), approver and time, creator and time, and the counts the screen
  shows.
- **`nexra_topic_clusters`** — map, topic, cluster, primary keyword, intent (nullable), demand, coverage, existing
  page (nullable), candidate page (nullable), the primary's volume and difficulty as copied from the metric row (so
  the screen needs no join; the row id keeps the provenance), position.
- **`nexra_topic_cluster_keywords`** — cluster, keyword, role (`primary`, `supporting`, `excluded`), metric row id
  (nullable for a seed with no data), exclusion reason (nullable), volume and difficulty copied.

Functions, both `security definer` with an empty `search_path`:

- `nexra_topic_map_record(p_project, p_map jsonb, p_created_by)` → `recorded` | `project-not-found` |
  `invalid-map`. Writes the map, its clusters and their keywords as one set after validating every row; marks the
  project's earlier `proposed` maps `superseded` in the same transaction. The approved map, if any, is untouched.
- `nexra_topic_map_approve(p_project, p_map_id, p_approved_by)` → `approved` | `map-not-found` | `not-proposed`.
  The one status change: `proposed` → `approved`, with approver and time; the previously approved map of the project
  becomes `superseded`.

## Service, store and routes (PR 4)

- `src/lib/topic-maps/`: contract (types, request parsing, URLs), store contract with an *unavailable* store, the
  Supabase store (every call translates to one function or one bounded read; a missing schema answers
  `TopicMapStoreNotSetUpError`), and the service: `build(projectId, operatorId)` reads the metrics, the live articles
  and the crawl, runs the rules, records the map; `approve`; `read(projectId)` answers the approved map and the
  newest proposed one, with every state named (`not-set-up`, `no-run`, `read`).
- `GET /api/topic-maps?project=` (operator, read limit) and `POST /api/topic-maps { project, action: "build" |
  "approve", mapId? }` (operator, same origin, a write limit). No agent run; nothing paid.

## Screen (PR 5)

A *Topical map* tab on Keyword Intelligence. Header: what the map was built from (the provider run and its date, the
live articles and the crawl), the map's state, **Build map** (free; the F3 dialog with no cost line) and **Approve**
(confirmed) when a proposed map is shown. Before the migration is applied the tab reads *Not set up yet* and the rest
of the screen is untouched (the F0 rule). Then one row per cluster: topic and cluster, the primary keyword with its
volume and difficulty under the *Provider estimate* label, intent (or *unknown*), supporting keywords (expandable),
coverage as *Covered* with the page, *Partial* with the page, or *Gap* with the candidate slug, and a *No estimate
from the provider* badge where that applies. Excluded terms are listed under their cluster, never hidden.

## Operator-chosen seeds (PR 6)

`POST /api/keyword-snapshots { project, seeds? }`: 1 to 10 seeds, each 1–200 characters, trimmed, no duplicates; the
constant list is the default when none are given. The estimate is recomputed from the count; the F3 dialog shows the
seeds it will send and the estimate. The reserve function already refuses more than 10.

## How M1 feeds M2

M2 reads the approved map only. Each cluster carries what M2 needs — the metric rows (demand), coverage (gap or
covered), the existing page (to join the query × page pairs and the crawl findings), intent — and the cluster id
becomes the opportunity's key and later a task's source reference (M3).

## Pull requests, in order, one change each (all stacked, draft, unmerged)

1. Docs: the `20261018120000` applied note, the article 2 proposal placeholder, this note.
2. Migration + harness suites `topic-maps` and `topic-maps-upgrade`.
3. The clustering library, pure, with tests on the real 41-row shape.
4. Service, store, routes.
5. The tab.
6. Operator-chosen seeds for the snapshot.

The migration is applied by §1.2 after a fresh backup, on the operator's word, and recorded in the next PR that
touches the repository.
