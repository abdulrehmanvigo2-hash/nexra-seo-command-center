# Nexra SEO Command Center

Professional, agency-grade AI SEO platform. This file defines the operating rules for the
project. Read it before writing any code.

**Current stage: Stage 5 (publication) of the content workflow. Milestones A and B are
complete; next planned is Milestone C1 (see §0).**

---

## 0. Current Checkpoint

GitHub `master`: `6331f359ff0cb0be03c3efb55f0183a3e6520133`

**Completed content-workflow stages:**

- Stage 1: durable Writer draft persistence
- Stage 2: immutable operator version history
- Stage 3: exact-version fact-check
- Stage 4: exact-version approval gate
- Stage 5A: publication proposal + exact-version preview
- Stage 5B: website artifact dry-run

**Next planned work (not started):** Stage 5 / Complete Article Assembly —
Milestone C1: Pure Article Contract.

**Current safety boundaries:**

- No automatic publishing.
- No write path to the `abdulrehmanvigo2-hash/nexra-ai` GitHub repository exists.
- The current production draft, Version 2, remains **Needs review**.
- There is no active publication proposal for Version 2.
- The content workflow has no Create PR, Merge, Deploy or Publish control.
- Any external write requires explicit user approval (§6).

Update this section at every Git checkpoint that changes the stage, the next planned
milestone, or a safety boundary.

---

## 1. Development Workflow

Every unit of work follows this loop, without skipping steps:

```
Plan → Build One Bounded Feature → Test → Fix → Git Commit → Next Feature
```

- **Plan** — state what will be built, which files are touched, and what is explicitly out of scope.
- **Build one bounded feature** — one feature per cycle. No opportunistic side-work.
- **Test** — run the app locally, exercise the feature, check the console for errors.
- **Fix** — resolve everything found in testing before moving on.
- **Git commit** — one checkpoint per completed feature (see §10).
- **Next feature** — only after the previous cycle is closed.

## 2. Current Architecture

A Next.js 16 application (read `AGENTS.md` before writing Next.js code) with a Supabase
Postgres production backend. `docs/BACKEND.md` is the detailed reference; `supabase/README.md`
lists the migrations in order.

- **Operator authentication** — Supabase Auth. One level: operator or nobody; operators are
  confirmed users listed in `NEXRA_OPERATOR_EMAILS`. `src/proxy.ts` gates every page, and every
  write and data endpoint re-checks the operator server-side.
- **Database** — Row level security with no policies on every table; the server alone uses
  `service_role`. Lifecycle and immutability rules are enforced in Postgres (triggers,
  `security definer` functions).
- **Live agent execution** — the agent runtime (`src/lib/agent-runs`, `/api/agent-runs/*`,
  `/api/worker/*`) queues and runs tasks for the twelve registry agents, with attempts, leases,
  retries and a scheduled worker. The executor is `mock` by default or `ai` (Anthropic).
- **Crawl grounding** — the crawl foundation (`src/lib/crawl`, `/api/crawls/*`) records own-site
  and competitor crawls; crawl-grounded agent tasks read those records.
- **Google Search Console grounding** — a read-only service account (`src/lib/search-console`);
  the Search Console panel and two agent tasks read the project's own report.
- **Content workflow** (`src/lib/content`, `/api/content-drafts`, `/api/content-publications`):
  - immutable content drafts and operator versions;
  - version-bound fact-check of one exact version;
  - exact-version approval;
  - publication proposals for one exact approved version, which publish nothing;
  - website artifact dry-run, rendered offline, which writes nothing anywhere.

Everything else on screen (rankings, technical, competitor, backlink, AI-visibility and
reporting figures) is still modelled fixture data from `src/lib/mock`. It must stay labelled as
such (`src/config/build-status.ts`). Never present fixture data as live, or live data as a
fixture.

## 3. Build Principles

- Extend the existing modules and patterns; do not introduce a parallel implementation.
- Server-side first: validation, authorisation and state rules live on the server and, where
  they protect data, in the database.
- Grounded, not invented: agents and renderers use only records the product holds. A missing
  value is reported as missing, never filled in.
- Every screen keeps real states (loading, empty, error, not connected) and honest labels.
- Every change is additive and reversible unless the user approves otherwise. Existing
  migrations are never edited; a schema change is a new migration.

## 4. Out of Scope Until Explicitly Requested

Do **NOT** build any of the following until the user explicitly asks:

- Publishing content to any website, or any write to the `nexra-ai` repository (branch,
  commit, pull request, merge, deployment)
- Create PR / Merge / Deploy / Publish controls in the product
- Billing / payments / subscriptions
- New external integrations (GA4, Ahrefs, Semrush, CMS, webhooks, and similar)
- Replacing a fixture-backed screen with live data, beyond the feature requested

## 5. Dependency Rules

Before adding **any** dependency, package, MCP server, CLI, SDK, or tool:

1. **Inspect the current project first** — read `package.json` and the existing code.
2. **Identify what is actually required** for the current bounded feature.
3. **Avoid unnecessary installations** — no "nice to have" packages.
4. **Prefer existing dependencies** — solve it with what is already installed.
5. **Install only safe, project-level dependencies** needed for the current task.

No global installs. Nothing added "for later".

## 6. Approval Required

Ask the user and wait for explicit approval before any of these:

- Authentication
- API keys
- Paid services
- Paid APIs
- OAuth
- Database setup
- Production credentials
- External webhooks
- System-level changes
- Global CLI installs
- DNS / domain changes
- Deployment configuration
- Applying a migration to the production database, or changing production data
- Switching the agent executor, AI provider or model (`NEXRA_AGENT_EXECUTOR`,
  `NEXRA_AI_PROVIDER`, `NEXRA_AI_MODEL`)
- Any write to an external repository or service, including `nexra-ai` (branch, commit,
  pull request, merge, deployment, publication)

## 7. Security Rules

- **Never expose secrets in frontend code.**
- **Never hardcode** API keys, tokens, passwords, webhook secrets, or private credentials.
- **Use environment variables** for all configuration and secrets.
- **Never commit `.env` secrets to Git.** `.env*` files stay in `.gitignore`; only
  `.env.example`, with empty placeholder values, is committed.
- Any value carrying a client-exposure prefix (for example `NEXT_PUBLIC_*`) is public by
  definition — never put a secret behind one.
- Verify no secrets are staged before every commit.

## 8. File Safety Rules

- **Do not modify unrelated files.** Touch only what the current feature requires.
- **Do not delete working files or make destructive changes without approval.**
- **Preserve working UI and existing functionality.** No refactors bundled into feature work.
- No mass reformatting, no renaming sweeps, no restructuring outside the requested scope.

## 9. Testing Discipline

- **Test every completed feature before continuing.**
- Run the app locally and exercise the feature by hand.
- Check every route the change touches.
- Check the browser console and the terminal for errors and warnings.
- Verify responsive behaviour at mobile, tablet, and desktop widths.
- Verify no regressions in previously working screens.
- Run the available checks before committing: `npm test`, `npm run typecheck`,
  `npm run lint`, `npm run build`, and `npm run db:seed:check` when the seed or projects change.
- Add unit tests beside the code for every new server module, contract or renderer.

## 10. Git as a Checkpoint System

After each completed bounded feature:

1. **Review changed files** — `git status`, `git diff`.
2. **Run available checks** — type check, lint, build.
3. **Verify no secrets are included** in the staged diff.
4. **Make a clear commit** describing the completed feature.

One feature per commit. Commit messages state what was built, in plain language.

## 11. Development Order

```
Local Project → Localhost Testing → Git Checkpoint → GitHub → Vercel
```

**Production hardening must happen before public deployment.** No deployment step is taken
until the user asks for it and the hardening pass is complete.

## 12. Product Standards

Primary UI language: **English**.

The product should feel:

- Premium
- Modern
- Clean
- Professional
- Technical
- Agency-grade
- SaaS-ready
- Data-focused

**Avoid:**

- Cheap template appearance
- Excessive gradients
- Random animations
- Clutter
- Oversized cards
- Cartoon visuals
- Dead buttons
- Broken links
- Inconsistent spacing

Design discipline: a consistent spacing scale, a restrained palette, dense but legible data
display, real states (loading, empty, error), and no control that does nothing.

## 13. Architecture

### Main Navigation

The sidebar supports these destinations, in this order:

1. Command Center
2. Projects
3. AI Agents
4. Keyword Intelligence
5. Content Studio
6. Technical SEO
7. Competitor Intelligence
8. AI Visibility
9. Backlinks & Authority
10. Analytics
11. Reports
12. Settings

Every navigation item resolves to a real route. No dead links.

### The 12 AI Agents

| # | Agent | Responsibility |
|---|---|---|
| 1 | SEO Director / Orchestrator | Owns strategy, sequences the other agents, arbitrates priorities |
| 2 | Project Manager | Intake, scope, scheduling, task state, delivery tracking |
| 3 | Market & Competitor Intelligence | Market landscape, SERP competitors, positioning, share of voice |
| 4 | Keyword & Search Intent | Keyword discovery, clustering, intent classification, prioritisation |
| 5 | Content Strategist | Content plans, briefs, topical maps, internal-linking strategy |
| 6 | Research & Evidence | Sources, facts, citations, evidence behind every claim in content |
| 7 | Writer | Drafts content against briefs, tone, and structure |
| 8 | On-Page SEO | Titles, meta, headings, entities, internal links, on-page optimisation |
| 9 | Technical SEO | Crawlability, indexation, Core Web Vitals, schema, site health |
| 10 | AI Visibility / AEO / GEO | Visibility in AI answers and generative engines, answer-readiness |
| 11 | Authority & Backlink | Link opportunities, digital PR, authority signals |
| 12 | Analytics & Learning | Performance measurement, attribution, learnings fed back into strategy |

Agent profiles, statuses and activity feeds come from the fixture registry
(`src/lib/mock/agents`). Agent **runs** are real: the runtime executes read-only review tasks,
grounded in stored projects, crawls, Search Console or earlier runs, plus the Writer's
`section-draft` task. The full task-type list is in `docs/BACKEND.md` (*Agent runtime*).

### Long-Term Agent Workflow

```
Project Added
  → Project Manager
  → SEO Director
  → Competitor Intelligence
  → Keyword Intelligence
  → Content Strategy
  → Research
  → Writing
  → On-Page SEO
  → Technical SEO
  → AI Visibility
  → Authority Building
  → Analytics & Learning
  → Feedback to SEO Director
```

The loop closes: Analytics & Learning feeds back into the SEO Director, which re-prioritises
the next cycle. The UI should represent this as a continuous cycle, not a one-way pipeline.

## 14. Build Sequence

The frontend foundation (app shell, navigation, the twelve screens, UI primitives, fixture
data layer) and the backend foundation (Supabase, operator sign-in, agent runtime, crawl
foundation, Search Console) are complete. Current work follows the content workflow:

| Stage | Scope | Status |
|---|---|---|
| Stage 1 | Durable Writer draft persistence | Complete |
| Stage 2 | Immutable operator version history | Complete |
| Stage 3 | Exact-version fact-check | Complete |
| Stage 4 | Exact-version approval gate | Complete |
| Stage 5A | Publication proposal + exact-version preview | Complete |
| Stage 5B | Website artifact dry-run | Complete |
| Stage 5 / C1 | Complete Article Assembly: Pure Article Contract | Next, not started |

Stages are executed in order. Each stage is broken into bounded features, and each bounded
feature gets its own workflow cycle (§1) and Git checkpoint (§10). Work beyond C1 is decided
with the user and is not planned here.

## 15. Definition of Done

A feature is done only when **all** of the following are true:

- [ ] Requested scope complete
- [ ] UI polished
- [ ] Interactions working
- [ ] No unrelated regressions
- [ ] Local tests passed
- [ ] Changed files reviewed
- [ ] Ready for Git checkpoint

Anything short of this is not done, and the next feature does not start.

## 16. Claude Code Behavior

1. **Read `CLAUDE.md` first.**
2. **Inspect the project** before writing code — existing files, dependencies, patterns.
3. **Identify the relevant files** for the task.
4. **Build only the requested bounded feature.**
5. **Avoid unrelated changes.**
6. **Test the result.**
7. **Report exactly what changed** — file by file.
8. **Report the tests performed** and their outcome.
9. **Report remaining issues** honestly, including anything left incomplete.
10. **Stop before starting the next major feature** unless explicitly asked to continue.

When a request is ambiguous, ask before building. When a rule in this file conflicts with a
request, say so and wait for the user's decision.
