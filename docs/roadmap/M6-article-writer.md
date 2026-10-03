# M6 — The Writer drafts an article from a brief: design note

This is the second milestone of the M5/M6/M8 plan, approved on 3 Oct 2026 with every default (M9 is postponed). M5
gives one accepted opportunity a brief: an angle, an outline of 3 to 6 H2s, FAQs, the support behind each H2, and the
internal links. M6 lets the Writer draft a whole article from that brief.

The draft is written part by part. It is assembled into the article editor's import JSON, together with an evidence
map, and then opened in the editor. **Nothing is saved until the operator presses Create or Save.** After that the
existing path applies unchanged: check units, approval, proposal and publishing.

The critical rule of the brief (`NEXT-PHASE-BRIEF.md`, M6): the Writer writes only from approved evidence or from
clearly non-factual connective prose, and no unsupported factual claim passes silently.

## The task — `article-part-draft` (Writer, policy `draft`)

**Input:** `{ briefRunId, part }`.

- `briefRunId` names a completed `opportunity-brief` run of the run's own project. The run must have been executed by
  the model, and its answer must read back with `parseBrief`.
- `part` is one of:
  - `opening` — the title, meta title, meta description, slug proposal, excerpt, lead and one introduction paragraph;
  - `section-1` … `section-6` — the body of the brief's H2 with that number;
  - `closing` — an answer to each of the brief's FAQs, the CTA title and the CTA body.

One part per run keeps every answer under the worker's 2,000-character ceiling. A six-H2 brief takes eight runs.

**Grounding** (evidence kind `brief`) is read at execution time:

1. **The brief.** The run is re-read by id and checked: same project, completed, model-executed, parseable. It is
   quoted as **a proposal, never evidence**.
2. **The opportunity's records.** M5's block is re-read through the same reader. It covers the cluster and its
   keywords, Google's listing (never evidence), the admitted units `E1`…`En`, the Search Console rows and the
   site's crawled paths.
3. **The PART block.** It names what to write; for a section it gives the H2's heading, purpose, support line and the
   links the brief placed under it.

The run refuses before any provider call in these cases:

- `brief-not-usable` — not this project's run, not completed, simulated, or off-format;
- `brief-part-missing` — a section number the outline lacks;
- `opportunities-not-kept`, `opportunity-not-readable` — as M5.

**The answer has a fixed order and is parsed.** Every paragraph line starts with `P:` and ends with exactly one tag:

| Tag | Meaning |
|---|---|
| `[crawl /path]` | rests on what that crawled page declared |
| `[evidence En]` | rests on that admitted unit's quote |
| `[opinion]` | the agency's view; proposed as an attested paragraph (basis `opinion`), so it must state no number |
| `[connective]` | prose that states no fact (a transition, a definition of the article's own scope) |

- **opening:** `TITLE:` (under 12 words), `META TITLE:` (under 60 characters), `META DESCRIPTION:` (under 155
  characters), `SLUG:` (lowercase words joined by hyphens), `EXCERPT:` (under 25 words), `LEAD:` (under 35 words,
  ending with a tag), one `P:` (under 40 words), then `LIMITS:`.
- **section-n:** two or three `P:` lines, each under 45 words. Then at most one `LINK:` line — a path the brief placed
  under this H2, a dash, and anchor text under 6 words that appears word for word in one of the paragraphs. Then
  `LIMITS:`. The heading is the brief's own, so it is not repeated.
- **closing:** one `A<n>:` line per brief FAQ (an answer under 25 words, ending with a tag), `CTA TITLE:` (under 8
  words), `CTA BODY:` (under 25 words), then `LIMITS:`.

The instructions are hash-pinned. A full-caps answer of every part is tested under 2,000 characters.

## Assembly — runs to import-ready JSON (pure, `src/lib/briefs/assemble-article.ts`)

For each part, the newest completed, model-executed run is taken. Earlier runs of the same part are kept in run
history and never mixed in. The result is an `ArticleContent` that `importArticleJson` accepts.

| Field | Value |
|---|---|
| `topic` | the cluster's topic |
| `searchIntent` | the cluster's intent, or `informational` (flagged) |
| `keywords` | the primary keyword, then the supporting keywords (excluded ones left out; at most 20) |
| `slug`, `title`, meta, `excerpt`, `lead` | the opening's |
| `introduction` | the opening's paragraph |
| `sections` | one per H2: an id from the heading, the brief's heading, the paragraphs with their tags removed |
| `faqs` | the brief's questions, each with its answer |
| `internalLinks` | the sections' `LINK:` lines |
| `ctaTitle`, `ctaBody` | the closing's |
| `category` | `AI Automation`, the live articles' common category (flagged so the operator checks it) |
| `topicDecision` | `unset` (the operator decides) |
| `attestations` | each `[opinion]` paragraph, basis `opinion` |
| `citations` | each admitted unit a paragraph cites: its page's URL, its host as publisher and title, and its retrieval date (flagged so the operator gives a title) |

**The evidence map** lists every paragraph, the lead and every FAQ answer, with its locator, its tag and a status:

- **record** — the cited crawled path or admitted unit exists in the grounding;
- **opinion** — and whether it states a number, which the attestation rule refuses;
- **connective**;
- **unsupported** — no tag, an unknown tag, or a record the grounding does not hold.

The C1 validator runs on the result, and every issue is listed. An **unsupported** line is never dropped silently: it
stays in the text and is listed first, and the editor hand-off shows it before anything else. Missing parts are named.

## Screens

**Brief panel (M5) — *Draft article…*.** One confirmation queues every part of the newest brief:

- It lists the N runs (opening, each section, closing), the project and today's run usage.
- It refuses before sending anything when today's project or overall cap has fewer than N runs left.
- The runs are queued one by one, and the first refusal stops the batch and is reported.
- Each part's state is listed with **Run now** on a queued run. The scheduled worker also runs them.

**Assembled draft — *Open in editor*.** A read-only route, `GET /api/briefs/draft?project=&brief=`, computes the
assembly on read (no table). The panel shows the evidence map, unsupported lines first, and the validator's issues.

*Open in editor* goes to the project screen with `?importBrief=<briefRunId>`. The article editor fetches the same
route and fills its import box, and the operator presses *Import* and then Create. Nothing is saved automatically.

## Cost

One run per part, at about $0.05–$0.10 each. A six-H2 article is eight runs, at about $0.40–$0.80. Re-running one
part costs one run.

## Pull requests (stacked drafts on M5)

1. This note.
2. The `article-part-draft` task: the reader, the grounding, the hash-pinned instructions and the part parser.
3. The assembly library: the runs become import JSON and an evidence map, validated.
4. Queue all parts: *Draft article…* with the cap check, and the part list with Run now.
5. The editor hand-off: the draft route, the assembled-draft view and *Open in editor* through `importArticleJson`.
6. Docs: `docs/BACKEND.md`.

No table, no migration, no environment change.

## Owner actions

- Approve the merges.
- Approve the first live article draft: one brief, eight runs, about $0.60.
