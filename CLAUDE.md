# Nexra SEO Command Center

Professional, agency-grade AI SEO platform. This file defines the operating rules for the
project. Read it before writing any code.

**Current milestone: Premium Frontend Foundation Only.**

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

## 2. Approach: Frontend-First

Build the product surface first, with realistic mock data. The UI defines the data contracts;
backend work follows later, and only when explicitly requested. Every screen must look and
behave as if the data were real.

## 3. Initial Build Scope

The initial build focuses **only** on:

- Premium application shell
- Sidebar
- Header
- Dashboard
- Main routes/pages
- Working navigation
- Responsive layout
- Reusable UI components
- Realistic mock SEO data
- Mock AI agent activity

## 4. Explicitly Out of Scope (Until Requested)

Do **NOT** build any of the following until the user explicitly asks:

- Real backend / server logic
- Database
- Authentication
- APIs (real endpoints, real data fetching)
- AI integrations (LLM calls, agent runtimes)
- Scraping / crawling
- Billing / payments / subscriptions
- External integrations (GSC, GA4, Ahrefs, Semrush, CMS, webhooks, and similar)

Mock data and mock agent activity stand in for all of the above.

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
- Run the available checks (type check, lint, build) before committing.

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

Agents are **mocked** in the current milestone: statuses, activity feeds, run history, and
outputs are realistic fixtures, not live executions.

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

| Phase | Scope |
|---|---|
| Phase 1 | Foundation — app shell, sidebar, header, routing, layout system, UI primitives, mock data layer |
| Phase 2 | Command Center |
| Phase 3 | Projects |
| Phase 4 | AI Agents |
| Phase 5 | Keyword Intelligence |
| Phase 6 | Content Studio |
| Phase 7 | Competitor Intelligence |
| Phase 8 | Technical SEO |
| Phase 9 | AI Visibility |
| Phase 10 | Backlinks & Authority |
| Phase 11 | Analytics |
| Phase 12 | Reports |

Phases are executed in order. Each phase is broken into bounded features, and each bounded
feature gets its own workflow cycle (§1) and Git checkpoint (§10).

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
