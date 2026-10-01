# Next-phase brief (operator, 1 Oct 2026)

The operator's master brief is reproduced below as received, without edits. The operator's adjustments
(A–G), given with the Phase 0 request, follow it and **override the brief** where they differ. The Phase 0
audit is `docs/roadmap/PHASE-0-AUDIT.md`.

---

## The brief, as received

Claude Code Master Brief — Nexra SEO Command Center Next Phase
OBJECTIVE
Extend the existing Nexra SEO Command Center into an evidence-grounded, multi-agent SEO operating system.
Do NOT rebuild features that already exist.
The desired long-term loop is:
GSC + Crawl + Keyword Data → Keyword Intelligence → Topical Map → Opportunity Scoring → Content Calendar → SERP Research → Research & Evidence → Content Strategy → Writer → SEO Director Review → Human Approval → Publication Proposal → Performance Monitoring → Content Refresh → Internal Linking → Backlink Opportunities → Learning Loop
The system must remain evidence-grounded and approval-controlled.

0. NON-NEGOTIABLE SAFETY RULES

Before changing anything:

1. Inspect the current repository and production architecture.
2. Determine what is already implemented.
3. Reuse existing tables, APIs, components, agent infrastructure and patterns wherever possible.
4. Do not recreate functionality that already exists.
5. Do not delete working functionality simply to fit this plan.
6. Do not modify production data manually.
7. Do not run Supabase migrations against production.
8. Do not deploy.
9. Do not merge to master/main.
10. Do not push unless explicitly authorized.
11. Never print, modify or commit ".env" values.
12. Never expose API keys, tokens or credentials.
13. Do not publish content.
14. Do not create backlinks.
15. Do not send outreach.
16. Do not modify DNS.
17. Do not perform external write actions.

All development should remain:
READ → ANALYZE → PROPOSE → APPROVE → IMPLEMENT → TEST → VERIFY.
Stop at every approval checkpoint.
PHASE 0 — CURRENT-STATE AUDIT
Do this FIRST and make no code changes.
Inspect:

* agent registry
* worker/execution architecture
* task system
* grounding architecture
* project data model
* crawl storage
* crawl findings
* Search Console persistence
* keyword intelligence
* article/content system
* article versions
* Research & Evidence workflow
* SEO Director
* approval gates
* publication proposals
* UI routes
* Supabase schema/migrations
* cron/worker architecture
* tests
* production/mock boundaries

For every relevant capability classify it as:
REAL + GROUNDED REAL + API-ONLY PARTIAL MOCK/UI-ONLY MISSING
Produce a dependency map showing what can be reused.
Do not proceed until the audit is approved.
M1 — TOPICAL MAP + KEYWORD CLUSTERING
Goal:
Turn stored keyword/GSC data into structured SEO topics.
The system should model:
Topic → Cluster → Primary Keyword → Supporting Keywords → Search Intent → Existing Page → Candidate New Page → Evidence
Use real stored data wherever available.
Do not invent:

* search volume
* CPC
* keyword difficulty
* SERP positions
* traffic estimates

Unknown values must remain explicitly unknown.
Add a Topical Map UI.
Each cluster should clearly distinguish:
OBSERVED DATA
from
MODEL-GENERATED RECOMMENDATION.
Human approval must be required before recommendations become planned work.
M2 — CONTENT OPPORTUNITY ENGINE
Build an evidence-based opportunity scoring system.
Possible signals:

* GSC impressions
* clicks
* CTR
* average position
* query/page relationship
* existing content
* crawl findings
* cannibalization signals
* keyword cluster coverage
* missing content
* content freshness

Never manufacture missing metrics.
Every score must be explainable.
Example:
Opportunity: AI Sales Agent for Small Business
Evidence: GSC impressions: observed Current ranking page: observed Cluster gap: derived Existing article: none Recommendation: create supporting article
The UI must expose WHY an opportunity received its priority.
M3 — CONTENT CALENDAR
Turn approved opportunities into proposed work.
Create:
Topic Target keyword Search intent Recommended content type Proposed date Evidence Status
Statuses should follow existing project conventions where possible.
Conceptually:
PROPOSED → APPROVED → RESEARCH → DRAFT → REVIEW → READY → PUBLICATION PROPOSAL
The calendar must NOT automatically publish anything.
SEO Director or operator approval remains mandatory.
M4 — REAL RESEARCH & EVIDENCE AGENT
Convert the existing Research & Evidence capability from mock/partial to grounded execution.
Inputs:

* approved content opportunity
* keyword cluster
* stored GSC evidence
* crawl evidence
* existing site content
* permitted SERP/research provider data

Output structured evidence units.
Each factual unit should contain enough provenance to determine:
CLAIM SOURCE SOURCE TYPE URL/reference where applicable RETRIEVAL TIME SUPPORT STATUS
Support states:
SUPPORTED NEEDS REVIEW UNSUPPORTED
The agent must never silently convert unsupported statements into facts.
M5 — REAL CONTENT STRATEGIST
Input:
approved opportunity + Research & Evidence package
Output:

* primary intent
* target audience
* article objective
* recommended format
* H1
* H2/H3 outline
* questions to answer
* evidence requirements
* internal-link opportunities
* CTA recommendation

Every strategy should reference its underlying evidence package.
No publishing.
M6 — REAL WRITER AGENT
Convert the approved strategy + evidence into an article draft.
Critical rule:
The Writer may write only from approved evidence or clearly non-factual connective prose.
Required outputs:

* title
* meta title
* meta description
* slug proposal
* article body
* headings
* citations/references where required
* internal-link proposals
* CTA
* evidence mapping

No unsupported factual claim should silently pass.
Use the existing article version system.
Every material revision should produce or preserve version history according to existing architecture.
Workflow:
Writer → Evidence validation → SEO Director → Human approval.
No automatic production publishing.
M7 — CONTENT DECAY / REFRESH AGENT
Use historical Search Console snapshots.
Detect meaningful deterioration such as:

* falling clicks
* falling impressions
* worsening average position
* falling CTR
* query loss
* competing internal page
* outdated evidence

Do not trigger from arbitrary single-snapshot noise.
Use bounded comparison windows.
Generate:
REFRESH RECOMMENDED
with evidence showing:
previous period vs current period vs reason for recommendation.
Then:
Refresh recommendation → new research → proposed changes → new article version → SEO Director → human approval.
Never overwrite production content automatically.
M8 — INTERNAL LINKING AGENT
Analyze existing stored site pages and approved content.
Recommend:
SOURCE PAGE → ANCHOR CONCEPT → TARGET PAGE → REASON
Prevent:

* fabricated URLs
* broken target pages
* irrelevant links
* excessive exact-match anchors
* duplicate unnecessary recommendations

Initially recommendations only.
Do not modify production pages.
M9 — BACKLINK OPPORTUNITY AGENT
Do NOT build an automated backlink-exchange system yet.
Build an opportunity intelligence layer.
Potential future inputs:

* competitor backlink data
* known referring domains
* niche relevance
* destination pages
* authority/quality metrics from approved providers

Output:
Domain Relevant page Opportunity type Target Nexra page Evidence Suggested outreach angle Risk/review status
Possible opportunity types:
RESOURCE PAGE GUEST CONTRIBUTION MENTION BROKEN LINK PARTNERSHIP DIRECTORY COMPETITOR GAP
No email sending.
No backlink placement.
No automated outreach.
Human approval required.
M10 — NEXRA COPILOT / MCP LAYER
Design this only after M1–M9 are stable.
Goal:
Allow an authorized assistant such as Claude/compatible MCP clients to query the Command Center safely.
Example requests:
"Show the best content opportunities for Nexra Agency."
"Why did this article lose clicks?"
"Prepare next month's proposed SEO calendar."
"Show unresolved technical findings."
"Draft a refresh proposal for this article."
MCP tools must be permission-scoped.
Start READ-ONLY.
Separate:
READ TOOLS
from
PROPOSE ACTION TOOLS
from
WRITE/ACTION TOOLS.
No production mutation through MCP in the first release.
M11 — SEO LEARNING LOOP
After sufficient real historical data exists, connect outcomes back into planning.
Loop:
OBSERVE → ANALYZE → PROPOSE → APPROVE → EXECUTE → MEASURE → LEARN
Examples:
Article created → GSC data collected → query movement measured → cluster performance updated → next recommendation generated.
The system must distinguish:
OBSERVED RESULT
from
MODEL INTERPRETATION.
Never claim causation merely because performance changed after an action.
ARCHITECTURAL PRINCIPLE
The product should NOT become:
"AI writes 30 articles per month."
It should become:
"An evidence-grounded SEO operating system that continuously observes a site, identifies opportunities, coordinates specialist agents, proposes work, measures results and learns — while keeping consequential actions behind explicit approval gates."
AGENT TARGET STATE
Technical SEO Agent → REAL / GROUNDED
On-Page Agent → REAL / GROUNDED
Keyword & Search Intent Agent → REAL / GROUNDED
SEO Director → REAL / GROUNDED
Project Manager → REAL
Market / Competitor Agent → REAL
Content Strategist → REAL
Research & Evidence Agent → REAL / GROUNDED
Writer → REAL / EVIDENCE-CONSTRAINED
AI Visibility Agent → later grounded implementation
Authority / Backlink Agent → REAL / RECOMMENDATION-ONLY initially
Analytics & Learning Agent → REAL after sufficient historical data.
DEVELOPMENT METHOD
Do NOT implement M1–M11 in one giant branch.
Use bounded milestones.
For each milestone:

1. Inspect existing implementation.
2. State what already exists.
3. State exactly what is missing.
4. Propose minimal schema changes.
5. Propose APIs.
6. Propose worker/agent changes.
7. Propose UI changes.
8. Define grounding rules.
9. Define approval boundaries.
10. Define tests.
11. Identify risks.
12. STOP.

Wait for operator approval.
Only after approval should implementation begin.
After implementation:

* typecheck
* lint
* build
* unit tests
* relevant integration tests
* secret scan

Report results.
Do not deploy.
FIRST TASK NOW
Do ONLY Phase 0.
Perform a read-only audit of the existing repository against M1–M11.
Return a matrix:
Capability | Current State | Evidence | Existing Components | Missing Pieces | Dependencies | Recommended Milestone
Then provide:
A. What is already built and must be preserved
B. What is partially built and should be extended
C. What is genuinely missing
D. Any conflicts between this roadmap and the existing architecture
E. Recommended implementation order based on the ACTUAL repository — not assumptions from this brief
F. The smallest safe first development milestone
Do not edit code.
Do not create a branch yet.
Do not run migrations.
Do not push.
Do not deploy.
Stop after the audit and wait for explicit approval.

---

## Operator adjustments (A–G), which override the brief

A) Workflow: keep our established rules — draft PRs allowed;
   every merge, migration apply and production run only with
   operator approval in chat. Production READ-only queries
   allowed. No writes, runs, migrations, nexra-ai writes.
B) Save the brief verbatim as docs/roadmap/NEXT-PHASE-BRIEF.md
   and the audit as docs/roadmap/PHASE-0-AUDIT.md (one draft PR).
C) Add milestone "P-L2": Publishing Level 2 — article approved →
   email to operator/assistant → one-click approve → product
   opens the nexra-ai PR and publishes; needs reviewer role +
   roles/per-project scoping (already in post-V1 backlog), the
   deferred designed publishing route (published-state table, C7
   approval, GitHub publisher + token).
D) Data provider: operator chose DataForSEO for SERP, keyword
   (volume/difficulty/CPC/related) and backlink data. Assess:
   which endpoints per milestone, cost estimate per month for one
   site, credential handling (Vercel sensitive env), provenance
   storage. Also say what the existing Ahrefs connector could
   cover. Do NOT create accounts or call paid APIs.
E) Verify (or correct) Claude-chat's preliminary findings:
   - production has only 12 GSC queries, 2 keywords, 6 GSC
     snapshots, 99 crawl pages, 1 real site → M1/M2 need
     DataForSEO data; M7/M11 need 2–3 months of history
   - M4 checker is real+grounded but own-site evidence only
   - learning loop (6.7) exists; M8 has 586 crawl links to build on
   - proposed order: DataForSEO foundation → M1 → M2 → P-L2 →
     M4 upgrade → M3 → M5/M6 → M8 → M9 → M7/M11 → M10
F) Smallest safe first milestone: evaluate "DataForSEO keyword
   snapshot" (5–10 seed topics, stored with source + time,
   read-only, < $1) vs alternatives.
G) Also check: did the scheduled Nightly backup (03:17 UTC, 1 Oct)
   run? If not, why (record only).
