# Audit summary — Nexra SEO Command Center, FULL V1

30 September 2026. Six parts (A1–A6) plus the planning pass (A0), run between `master` `3a3f5c6` and `6a019b0`. The
checklist and each item's mark are in `AUDIT-PLAN.md`; every finding, with evidence and a suggested fix, is in
`FINDINGS.md`.

**Rules the audit kept:** find and record only — no fix, refactor or migration; no production write and no agent
run; production read with read-only queries only; no secret value printed; nothing written to nexra-ai.

## Bottom line

**Nothing critical or high was found.** V1 does what it claims:

- **Access:** every page and data route sits behind the operator gate.
- **Database:** RLS is on everywhere, with no policies, and the server alone holds the secret key. The production
  schema equals the repository's, object for object.
- **Agents:** they can only write advisory text; every state change needs an operator's action.
- **Spend and publishing:** spend is capped per day; the renderer and the publication records fail closed.
- **CI:** it has been green on all 48 pushes to `master`.

The weaknesses are operational (no backups, no alerting) and in the operator's content workflow (forms, the
verdict gate's variance, a few one-click paid actions). None has caused harm yet. Two of them could lose data or
money without warning: the backups and the one-click runs.

## Results

| Part | Checklist items | PASS | FAIL | Operator | Record-only | Findings (all statuses) |
|---|---|---|---|---|---|---|
| A0 Planning | — | — | — | — | — | 8 |
| A1 Security | 30 | 27 | 2 | 1 | 0 | 8 |
| A2 Database | 22 | 17 | 2 | 0 | 3 | 11 |
| A3 Agents | 18 | 15 | 0 | 0 | 3 | 11 |
| A4 Screens | 16 | 12 | 2 | 0 | 2 | 12 |
| A5 Content path | 16 | 14 | 0 | 1 | 1 | 10 |
| A6 Operations | 14 | 5 | 5 | 1 | 3 | 9 |
| **Total** | **116** | **90** | **11** | **3** | **12** | **69** |

| Findings | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| Live (open, accepted or backlog) — 64 | 0 | 0 | 10 | 27 | 27 |
| Superseded (A0-01, A0-02, A0-07, A4-12) — 4 | | | | | |
| Fixed (A1-08: public sign-up turned off by the operator) — 1 | | | | | |

## The ten medium findings

**Data safety**

1. **A2-05 and A6-01 — no backups, no restore procedure, no drill.** The project is on Supabase's Free plan. The
   database is the only copy of every run, article, approval and proposal. Decision pending: the Pro plan, or an
   own scheduled dump job.
2. **A6-02 — nothing alerts.** There is no uptime monitor, cron-failure alert or log drain, and the Vercel logs cannot
   be read from these sessions. An outage or a skipped deploy is found by chance.
3. **A2-03 — a legacy crawl subsystem lives in production.** Five tables and four functions, last written on
   19 Sep, are referenced by nothing in the repository. The recommendation is to retire them once you confirm no
   other tool uses them (still open).

**One-click spend**

4. **A4-01 — review controls queue a paid run on one click, and no screen can cancel it.** The morning worker then
   executes it. Run Now calls the model at once, also without confirming. The daily caps bound the cost.

**The content workflow (lessons of 6.10)**

5. **A5-01 — the next article needs renderer work, not just a re-pin.** The pins are stale by design and fail closed.
   Beyond them, the live-slug and keyword-overlap checks read a hand-typed list, and the cross-link has one fixed
   target that no rendered article can serve.
6. **A5-02 — checker variance and no carry-forward cost 8 of the 20 check runs for one article.** Identical text
   passed, then failed. This is backlog, and the draft fact-check shares the risk (A3-03).
7. **A5-03 — about 35 hand-typed fields per article, with no import.** The H2 and H3 add buttons sit side by side.
   V1 of the live article was lost to that.
8. **A5-04 — attestation locators are paragraph indexes.** An inserted line moves an "Our view" label onto another
   paragraph without warning.
9. **A5-05 — "Edit as version N" sits beside the version selector and above Approve, and stays on a live article.**
   One save would return the published article's record to `drafting`.

## Suggested order of fixes

Each is its own checkpoint under the operator's approval (§6 where it is one):

1. **Backups and alerting** (A2-05, A6-01, A6-02). Choose the backup option, write runbook §6, run one restore
   drill, and add an uptime monitor on `/api/health`.
2. **Confirm before spending** (A4-01, A4-02, A4-03). One-line confirmations on Queue, Run Now, the crawls and the
   check-result records; a Cancel control on queued runs; "Queue …" labels.
3. **Database hygiene migration** (A0-03, A0-04, A2-02, A2-11). Revoke the surplus grants and the
   public EXECUTE, and retire the legacy subsystem once A2-03 is decided.
4. **Operator content workflow** (A5-03, A5-04, A5-05). A paste-JSON import, text-bound attestations, and Edit
   moved away from Approve, with a confirm on approved articles.
5. **Before article 2** (A5-01, A5-07, A5-08). A `/3` template, live slugs and keywords from every live article, an
   optional or chosen cross-link, and the component pin checked. Then the post-V1 carry-forward and checker v3
   (A5-02).
6. **Honest words** (A4-04, A4-05, A4-06, A6-04, A6-05, A3-09, A6-06). Remove the no-op controls, rewrite the page
   subtitles, drop the two dead links, add a "no data in the previous window" state, rewrite the README, and correct
   the runbook's migration notes and the bundle figure.
7. **Security headers and cookies** (A1-01, A1-02). CSP, frame, referrer and content-type headers; `Secure`
   cookies.

## Waiting on the operator

**Decisions**

- A2-03: retire or document the legacy tables. Please say whether any other tool used them.
- A2-05 and A6-01: the backup option.
- A6-02: an uptime monitor (an external service, §6).
- A4-08: keep the `/dev` pages for development only, or delete them.
- The grant revokes in fix 3 need a migration approval.

**Checks only you can run**

- A1-07: Vercel environment variables target Production only; HSTS is present on the production host.
- A2-06: turn on leaked-password protection in Supabase Auth.
- A4-10: time 3–4 pages in a normal foreground tab, cold and warm, with the network panel open (Command Center,
  Technical Pages tab, Reports, Analytics).
- A5 item 9: on the live article, check the three "Our view" labels, FAQPage, the canonical on www and the
  cross-link from the follow-up article.
- A6 item 8: which secrets have been rotated since they were created, by name only.

## Post-V1 backlog additions from the audit

- Client access needs roles and per-project scoping. Today any listed operator email gets full control (A1/A2).
- The verdict-variance fixes should cover the draft fact-check (A3-03).
- A published state for the live article (A5-06, with the designed C7b route).
- A per-task `max_tokens` and token counts on failed attempts (A3-02).
