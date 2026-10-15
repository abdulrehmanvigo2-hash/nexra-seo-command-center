# OC1 — One-Click Article: design note

Status: **design only — no code in this PR. Approved by the owner with every default (D1–D7), 14 Oct 2026.** Proposed 14 Oct 2026 from the Nexra SEO Intelligence Lab
(research R-001 / R-003, after comparing the M16 "AI Search Dominance Engine" architecture with this product).

## Why

Every step that turns a keyword into a live article already works (M1–M6, M8, the checker, P-L2). The owner stopped
using the product for articles on 12 Oct 2026 because one article takes **about 14 separate operator actions across
several screens**:

| # | Today's action | Module |
|---|---|---|
| 1 | Build and approve the topic map | M1 |
| 2 | Accept an opportunity | M2 |
| 3 | *Fetch Google results…* + confirm | M4 SERP |
| 4 | Add source URLs + fetch | M4 sources |
| 5 | *Queue extraction…* + confirm (+ Run now) | M4 `evidence-extract` |
| 6 | **Admit / Reject** each extracted unit | M4 |
| 7 | *Draft brief…* + confirm + Run now | M5 `opportunity-brief` |
| 8 | *Draft article…* + confirm + Run now per part | M6 `article-part-draft` |
| 9 | *Open in editor* → Import → Create | F9 import |
| 10 | *Check all units* | checker |
| 11 | Approve the article version | approvals |
| 12 | *Request publication…* (date) | P-L2 |
| 13 | **Publish** on `/publish/<approvalId>` | P-L2 |
| 14 | Merge the `nexra-ai` PR on GitHub + *Check status* (dry-run mode) | P-L2 |

The problem is chaining and the number of decisions, not missing capability.

## Goal

The owner does **three things**: enter a keyword → **Gate 1: approve the plan** → **Gate 2: approve publishing**.
Everything between the gates runs by itself, through the existing tasks, caps and records.

## What it reuses (nothing parallel is built)

- **Runs:** every step is an ordinary agent run (`POST /api/agent-runs`, `execute`, read back). No new agent, no new
  task type for the steps themselves; same daily caps, same spend confirmation, same run history.
- **Driver pattern:** the existing *Check all units* loop (`src/lib/content/articles/checks/check-all-loop.ts`) — a
  browser-driven driver with injected I/O that re-reads state before every step, resumes from where it stopped, and
  stops on a failed run, a refused request, a cap, or the operator's Stop. OC1 generalises this pattern to the whole
  pipeline. **Why browser-driven:** on the Vercel Hobby plan the cron worker runs once a day (`vercel.json`:
  `/api/worker/process` at 05:30 UTC) and each function is capped at 300 s, so a server-side chain of ~20 model runs
  would take days or time out. The page drives one run at a time instead; closing the page pauses, reopening resumes.
- **Gates:** the existing approval records (`src/lib/approvals`) and P-L2's single-use, digest-bound publish approval.

## The flow

**Screen: New article** (Content Studio) — one field: keyword, or pick an accepted opportunity. Country/language
default to the project's (US / English). A keyword with no opportunity creates one through M2's existing accept path.

**Stage A — research (automatic):**
1. SERP for the keyword (M4; counts against the DataForSEO daily cap).
2. Sources: the top organic URLs of Google's top ten — at most 10 (owner, 15 Oct; migration `20261029120000` raises M4's daily
   source limit from 5 to 10), one per domain, excluding the project's own domain — fetched through the existing safe
   `fetchSource` path (robots, size, off-site and unsafe-URL rules unchanged).
3. `evidence-extract` per fetched source.
4. Units that are `supported` **and** whose quote was found on the page are **pre-ticked** for admission — never
   admitted without Gate 1.
5. `opportunity-brief` (M5) — see decision D3 on which evidence it sees.

**Gate 1 — Approve the plan (one screen):** the brief's ANGLE, OUTLINE, FAQ, EVIDENCE NEEDED; the pre-ticked units
(each can be unticked); the cost already spent and the estimate for the rest. One button: **Approve & write**. It
records one approval and admits the ticked units.

**Stage B — write and check (automatic):**
6. `article-part-draft` for every part (M6).
7. Assemble → import → create the article version (see decision D2).
8. Check all units. A unit `unsupported` or `failed` triggers at most **2** automatic re-drafts of the part it
   belongs to (`article-revision-draft`), then the driver stops and lists what still needs the operator.

**Gate 2 — Approve publishing (one screen):** the rendered article, the checker summary (e.g. "13 / 13 supported"),
the publish date (default today). One button: **Approve & publish** → the article approval, *Request publication*,
and **Publish** (P-L2) in sequence. In `merge` mode the PR merges once its checks are green; in `dry-run` the screen
says the PR must be merged on GitHub. Then it shows the Search Console URL-inspection link for the new page.

## Decisions (recommended defaults in bold)

| # | Question | Options |
|---|---|---|
| D1 | Where the driver runs | **Browser-driven, resumable (like Check all)** / server cron (days per article on Hobby) |
| D2 | Import without the editor's Import + Create presses (6.x rule "nothing is saved automatically") | **Allowed only after Gate 1 approval, recorded as the approver's action** / keep manual import |
| D3 | Does the brief see the pre-ticked units before Gate 1? | **Yes, labelled "not yet admitted"; only admitted units can back a statement at check time** / brief only after admission (adds a third gate) |
| D4 | Automatic re-drafts per failing part | **2**, then stop / 0 / 1 |
| D5 | Spend confirmation | **Once at start for Stage A, once at Gate 1 for Stage B, each showing the estimate and today's usage** / per run |
| D6 | Publish mode | **Unchanged (`dry-run`) until one OC1 article publishes cleanly; then the owner decides `merge`** / switch now |
| D7 | Information-gain / fan-out (R-002) | **Not in OC1; added to Stage A only if R-002 Phase A shows value** / include now |

## Cost (estimates from the M4/M5/M6 design notes, not measured)

SERP ~$0.0024 · extraction up to 10 × $0.06–0.15 · brief ~$0.10–0.20 · parts 8 × $0.05–0.10 · checks ~$0.06 a unit ·
re-drafts only on failure. **About $1.80–3.30 an article** (with ten sources). Gate 1 shows the real spend so far and the estimate.

## Safety unchanged

Two human gates; nothing is published without Gate 2. Daily run caps, the DataForSEO cap and spend confirmations
apply to every run. Every step is an ordinary recorded run. Outside text (SERP titles, fetched pages) stays text to
report, never instructions or evidence until admitted. No secret is read or shown by the screens.

## Pull requests (after approval, one change each)

1. This note.
2. The pipeline planner + driver (pure, injected I/O, tests) — generalising the Check-all driver.
3. Stage A: auto source pick + pre-ticked admit list (tests).
4. Gate 1 screen + approval record.
5. Stage B: write → import → check chain with the re-draft limit (tests).
6. Gate 2 screen: approve → request → publish + indexing link.
7. Docs: BACKEND.md, RUNBOOK.md.

Each: bounded feature → tests → typecheck → lint → build → secret scan → commit → **stop for review**.

## Success measure

- Operator actions per article: **14 → 3**.
- Time from keyword to Gate 2.
- Articles per week made through OC1 vs written outside the product.

## Owner actions

Approve this note and decisions D1–D7 (or change any), then approve PR 2.
