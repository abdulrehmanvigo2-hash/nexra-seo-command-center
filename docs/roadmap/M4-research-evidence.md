# M4 — Research and evidence with outside sources: design note

The fourth milestone of `docs/roadmap/NEXT-FOUR-PLAN.md` (approved 3 Oct 2026 with every default of its decisions table:
SERP live advanced, top 10; outside page text stored capped at 20,000 characters, internal only, quotes at most 300;
admitted units plus a Sources section, article format `/3`; P-L2 before M4; the daily DataForSEO cap stays $1.00).

Today the checker can pass only what the project's own records hold, so every general explanation is "Our view". M4
lets an outside page support a statement — but only through a chain the owner sees and decides at every link:

```
accepted opportunity → SERP (one paid call) → source fetched (crawler rules) → evidence-extract run (one AI run)
  → units recorded, each quote checked word for word against the stored text → the owner admits or rejects
  → checker v4 may cite an admitted unit → the article lists its sources (format /3)
```

Nothing becomes a fact silently: a unit whose quote is not found in the stored text is **needs review** and cannot be
admitted; a unit nobody admitted is never shown to the checker.

## 1. SERP (PR 2 migration, PR 3 code)

- **One call per accepted opportunity:** DataForSEO `serp/google/organic/live/advanced`, depth 10, the F0 location and
  language (United States / English). The keyword is **chosen in the database**: the primary keyword of the accepted
  opportunity's cluster — never a request parameter.
- **Shared with F0:** the same mode (`DATAFORSEO_MODE`, sandbox unless exactly `live`), host rule, credentials, daily
  cap ($1.00, ceiling $5.00, enforced under the same UTC-day lock; a SERP and a keyword snapshot share one budget), one
  open run per project, the F3 confirmation with today's usage, no retry in live mode (a timeout is `unknown`, counted
  at its estimate).
- **Schema (`20261024120000_serp_results.sql`):** `nexra_provider_runs.kind` gains `serp` and a nullable
  `opportunity_id` (required for `serp`, null for `keyword-snapshot`; the update guard is replaced to keep it
  immutable); `nexra_provider_requests.endpoint` gains the SERP endpoint; new `nexra_provider_serp_reserve(project,
  opportunity, mode, host, estimate, cap, operator)` (`opportunity-not-found` beside reserve's outcomes; the run's
  `seeds` is the one keyword); `nexra_provider_request_record` and `nexra_provider_run_finish` replaced with the same
  signatures — the endpoint must fit the run's kind, and a SERP run plans one call (seq 0); new table
  `nexra_serp_results` (run, request, project, opportunity, keyword, type `organic` / `people-also-ask` /
  `related-search`, rank, URL, domain, title, snippet, the run's provenance) and `nexra_provider_serp_record(run,
  request, rows)`, one set per request. Guards, grants and RLS as F0. The keyword-snapshot reads filter `kind =
  'keyword-snapshot'` so a SERP run never shows as a snapshot.
- **Estimate:** $0.0024 a call (the public $0.002 plus the ~20% rise of 1 Jul 2026, as F0's prices; re-confirm on the
  pricing page before the first live call).

## 2. Sources and units (PR 4 migration, PR 5 fetch)

`20261025120000_evidence.sql`:

- `nexra_evidence_sources` — one fetched outside page: project, opportunity, the SERP result it came from (or none when
  the owner typed the URL), the URL asked and the final URL, fetch state and HTTP status, the robots verdict, the page's
  title, **the visible text capped at 20,000 characters** and its SHA-256 and length, fetched by and at. Internal only:
  never published, never shown outside the Evidence screen, never sent anywhere but to the extraction run.
- `nexra_evidence_units` — one claim from a source: claim (1–500), quote (1–300), the extraction run, `quote_found`
  (computed **in the database**: the quote, whitespace-collapsed, appears in the stored text, whitespace-collapsed),
  status (`supported` only when the quote is found and the run said supported; otherwise `needs-review` or
  `unsupported`), and the owner's decision (`pending` → `admitted` or `rejected`, once, by whom and when).
- Functions (`security definer`, empty `search_path`, EXECUTE for `service_role` only):
  `nexra_evidence_source_record`, `nexra_evidence_units_record(project, source, run, units)` (one set per source and
  run; the run must be a completed `evidence-extract` of that project naming that source) and
  `nexra_evidence_unit_decide(project, unit, decision, operator)` — `admitted` only for a `supported` unit with
  `quote_found`, else `not-admissible`; a decided unit answers `already-decided`.
- **Fetch (PR 5):** the crawler's fetcher — every redirect hop through the address guard, pinned connections, 2 MB
  body bound, 10 s timeout — with the crawler's user agent; `robots.txt` read first and honoured (a disallowed page is
  recorded `robots-disallowed` with no text); HTML only; text taken from the body with scripts, styles, navigation and
  markup removed, whitespace collapsed, cut at 20,000 characters. At most 5 sources per opportunity a day. No AI, no
  provider call.

## 3. Extraction (PR 6)

- Task `evidence-extract` — Research & Evidence, read-only, input `{ sourceId }`, a new evidence kind
  `evidence-source`: the source's URL, title, retrieval time and stored text, quoted as data (never instructions).
- Instructions (hash-pinned, the 2.3d structural shape): at most 8 units, each three lines — `CLAIM:` (under 40
  words), `QUOTE:` (copied word for word, under 300 characters), `STATUS:` `supported` / `needs-review` — then one
  LIMITS line. No number may appear in a CLAIM that is not in its QUOTE.
- **Recording:** the owner presses *Record units* on a completed run; the server parses the stored answer, refuses a
  malformed one whole (`answer-malformed`, nothing recorded), and the database computes `quote_found` for each unit.
- Cost: one AI run per page, about $0.06–$0.15 (the text is at most 20,000 characters).

## 4. The Evidence screen (PR 7)

A tab in Content Studio, **Evidence**, for one project: each accepted opportunity, its SERP (organic results, People
Also Ask, related searches; *Fetch Google results…* behind the F3 confirmation with the cost and today's usage), its
sources (fetch state, robots, text length — the text itself is not shown beyond a 300-character preview), each source's
extraction runs (*Queue extraction…*, confirmed, through the existing run path and daily caps) and units, with
**Admit** / **Reject** (confirmed) on each `supported` unit whose quote was found. Before the migrations every part
reads **Not set up yet**.

## 5. Checker version 4 (PR 8)

- `ARTICLE_CHECK_UNIT_INSTRUCTIONS` v4: one added sentence — a statement may be SUPPORTED by an admitted outside unit
  only when the unit's quote states it, citing the unit as `E<n>`; every v3 sentence word for word (tested). v3 kept.
- Grounding: an **Admitted outside evidence** block — the admitted units of the opportunities whose task is linked to
  the article (M3's `article-linked`), each `E<n>` with its claim, quote, URL and retrieval date; at most 40 units and
  8,000 bytes. No block when there are none (so an article with no admitted units is checked exactly as before).
- F8: the evidence fingerprint covers the block, so admitting or rejecting a unit ends the carry of a passed result
  that rested on records; the instructions hash changes with v4.

## 6. Article format `/3` (PR 9)

- An optional top-level `citations` list (named so because `sources` is the draft provenance a version records, never content) — `{ url, title, publisher, retrievedAt }`, 1 to 20, https only — canonical
  format `nexra-article-content/3` **only when the list is non-empty** (the final member); without it format 1 or 2 byte
  for byte, so every stored text, unit, approval and preview keeps its hash (tested against the V4 pin).
- `20261026120000_article_citations.sql`: the content-format check and the attestation count accept `/3` (only with
  citations; formats 1 and 2 refuse them). The proposal preview gains a CITED SOURCES section only when there are
  citations; its format name stays bound to the attestations. No row changes.
- The renderer (P-L2's pin at publish) renders a **Sources** section — each title as an outside link with
  `rel="nofollow noopener"`, its publisher and retrieval date — through `tsString`, tested against hostile text.

## 7. Cost per opportunity

| Step | Count | Each | Total |
|---|---|---|---|
| SERP (live, advanced, top 10) | 1 | $0.0024 | $0.0024 |
| Source fetch | up to 5 | $0 | $0 |
| `evidence-extract` | up to 5 | $0.06–$0.15 | $0.30–$0.75 |
| **Per opportunity** | | | **about $0.30–$0.75** |

The checker stays about $0.06 a unit. The SERP counts against the $1.00 DataForSEO cap; the extraction runs against
the 40-a-project / 100-in-all daily run caps.

## 8. Pull requests (stacked drafts on `master` `91da3ab`, one change each)

1. This note, the P-L2 applied notes and the backlog item "release a slug on takedown".
2. Migration `20261024120000_serp_results.sql` and its harness suites (`serp`, `serp-upgrade`).
3. The SERP parser, store, service and route (`/api/serp`), and the snapshot reads filtered by kind.
4. Migration `20261025120000_evidence.sql` and its harness suite (`evidence`).
5. Source fetch: robots, HTML only, the text extractor, the store and route (`/api/evidence/sources`).
6. The `evidence-extract` task, its instructions, grounding, answer parser and *Record units*.
7. The Evidence screen.
8. Checker version 4 and the admitted-units block.
9. The `citations` field, format `/3`, migration `20261026120000_article_citations.sql`, the preview, the editor and the
   renderer.

## 9. What the owner does (each under its own approval)

1. Merge M4's PRs in order; apply `20261024120000`, `20261025120000` and `20261026120000` by the §1.2 method after a
   fresh backup.
2. On an accepted opportunity: *Fetch Google results…* (sandbox first, then live: $0.0024).
3. Fetch up to five sources, queue an extraction for each, **Record units**, then admit or reject each unit.
4. Link the opportunity's task to the article (M3), check the article (checker v4) and add its sources (format `/3`).

## 10. What M4 never does

It never publishes outside text, never treats a provider snippet as evidence (only a fetched page's quote can be
admitted), never admits a unit on its own, never fetches a page `robots.txt` disallows, never calls DataForSEO without
the confirmation, and never claims a ranking, a position over time or a citation in an AI answer.
