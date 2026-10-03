# M5 — The strategist bound to an accepted opportunity: design note

The first milestone of the M5/M6/M8 plan (approved 3 Oct 2026 with every default; M9 postponed). Today the Content
Strategist's `content-plan-review` reads the whole project; nothing turns **one accepted opportunity** — its cluster,
its keywords, Google's results and the evidence the owner admitted — into a brief the Writer (M6) can draft from.

## What it does

A new task, **`opportunity-brief`** (Content Strategist, read-only), input `{ opportunityId }`. One run reads one
accepted opportunity of the run's own project and answers a brief in a fixed order:

- `ANGLE:` one line — what this article says that the existing page (or Google's top results) does not.
- `OUTLINE:` 3 to 6 `H2:` lines, each with a short purpose; the first H2 answers the primary keyword's question.
- `FAQ:` 2 to 4 questions, drawn from People Also Ask where recorded.
- `EVIDENCE:` one line per outline H2 naming what supports it — a site record, an admitted unit `E<n>`, or "opinion"
  — and `EVIDENCE NEEDED:` what no record supports yet.
- `LINKS:` up to 3 internal paths from the crawl the article should link to.
- `LIMITS:` and `NEXT:` lines, as every structural task.

The whole answer stays under 1,800 characters (the worker's 2,000 ceiling, tested at every cap).

## Grounding — evidence kind `opportunity`

Read on the server at execution time, for the run's own project only; a refusal before any provider call when the
opportunity is not the project's:

1. **The opportunity** — title, action (write / expand / refresh / fix), score and its scored lines (each labelled
   observed, provider estimate or derived, as M2 recorded them).
2. **Its cluster** — topic, primary keyword, supporting keywords, coverage, the existing page or the candidate slug,
   and the provider's volume and difficulty, labelled **provider estimate, never observed**.
3. **Google's results** — the newest completed SERP run for the opportunity (M4): organic titles and domains, People
   Also Ask, related searches, labelled "the provider's listing, never evidence"; "none recorded" otherwise.
4. **Admitted evidence** — the opportunity's admitted units (M4), `E1` upward, claim and quote.
5. **Search Console** — the stored query × page rows whose query is one of the cluster's keywords or whose page is the
   existing page (the latest window), "not observed" when none.
6. **The site** — the newest own-site crawl's fetched paths (for LINKS) and the existing page's title and h1.

Every block is bounded (12,000 bytes in all). No new table, no migration: a brief is the run's stored answer, and the
screen shows the newest completed brief per opportunity (decision: no briefs table).

## Screen

On Content Studio's **Evidence** tab, per opportunity: **Draft brief…** (the queue confirmation with today's run caps;
Run now beside a queued run) and the newest completed brief, its sections shown as written, labelled "a model's
proposal". Before the run, nothing is shown in its place.

## Cost

One run, about $0.10–$0.20 (the grounding is at most 12,000 bytes; the answer under 1,800 characters).

## Pull requests (stacked drafts on `master` `f145d4e`)

1. This note, the M4 applied notes and the M9 backlog item.
2. The `opportunity-brief` task: the reader, the grounding, the hash-pinned instructions, the brief parser.
3. The screen: *Draft brief…* and the newest brief on the Evidence tab.
4. Docs: `docs/BACKEND.md` task list and the agent pages' queue note.

## Owner actions

Approve the merges and the first live brief run (one run, about $0.15).
