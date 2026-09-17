# Nexra SEO Command Center

An agency-grade AI SEO operating platform.

---

## Overview

Nexra SEO Command Center is an agency-grade AI SEO operating platform. Rather than reporting on
SEO after the fact, it is designed to **coordinate the work itself** — running strategy,
research, production, and measurement as one connected operating system.

It brings the following disciplines under a single command surface:

- **SEO strategy** — priorities, sequencing, and direction across every active project
- **Keyword intelligence** — discovery, clustering, and search-intent classification
- **Competitor research** — market landscape, SERP rivals, positioning, and share of voice
- **Content production** — briefs, topical maps, research, drafting, and on-page optimisation
- **Technical SEO** — crawlability, indexation, Core Web Vitals, schema, and site health
- **AI visibility** — presence and answer-readiness in AI answers and generative engines
- **Backlinks & authority** — link opportunities, digital PR, and authority signals
- **Analytics** — performance measurement and attribution
- **Reporting** — client-ready output drawn from the same data the platform operates on

The platform is built around a team of coordinated AI agents, each owning a specialist domain
and reporting into a central orchestrator.

## Current Status

The frontend is complete, and Backend Phase 6 is complete: Supabase persistence for projects,
operator sign-in, the Google Search Console integration, and the agent runtime (persistent
runs, attempt history, leases and stale-run recovery, a scheduled worker, automatic retries,
shared rate limits, and a provider boundary for AI execution).

Most reporting figures on screen are still modelled fixtures and are labelled as such. The
agent executor defaults to simulated output; AI execution needs a provider key. Nothing has
been deployed.

See [`docs/BACKEND.md`](docs/BACKEND.md) for the backend architecture, security model,
environment variables, and deployment requirements.

## Planned Core Modules

| Module | Purpose |
|---|---|
| **Command Center** | Cross-project overview: health, priorities, and live agent activity |
| **Projects** | Per-client workspaces, scope, and delivery state |
| **AI Agents** | Agent roster, status, run history, and outputs |
| **Keyword Intelligence** | Keyword discovery, clustering, and intent analysis |
| **Content Studio** | Briefs, drafts, and the content production pipeline |
| **Technical SEO** | Site health, crawl and indexation issues, Core Web Vitals, schema |
| **Competitor Intelligence** | Competitive landscape, SERP overlap, share of voice |
| **AI Visibility / AEO / GEO** | Visibility in AI answers and generative search engines |
| **Backlinks & Authority** | Link profile, opportunities, and authority tracking |
| **Analytics** | Performance, trends, and attribution |
| **Reports** | Client-ready reporting and exports |
| **Settings** | Workspace, project, and platform configuration |

## AI Agent Architecture

Twelve specialist agents are planned, coordinated by a central orchestrator:

| # | Agent | Domain |
|---|---|---|
| 1 | **SEO Director / Orchestrator** | Owns strategy, sequences the other agents, arbitrates priorities |
| 2 | **Project Manager** | Intake, scope, scheduling, task state, delivery tracking |
| 3 | **Market & Competitor Intelligence** | Market landscape, SERP competitors, positioning, share of voice |
| 4 | **Keyword & Search Intent** | Keyword discovery, clustering, intent classification, prioritisation |
| 5 | **Content Strategist** | Content plans, briefs, topical maps, internal-linking strategy |
| 6 | **Research & Evidence** | Sources, facts, citations, evidence behind every claim |
| 7 | **Writer** | Drafts content against briefs, tone, and structure |
| 8 | **On-Page SEO** | Titles, meta, headings, entities, internal links |
| 9 | **Technical SEO** | Crawlability, indexation, Core Web Vitals, schema, site health |
| 10 | **AI Visibility / AEO / GEO** | Visibility in AI answers and generative engines, answer-readiness |
| 11 | **Authority & Backlink** | Link opportunities, digital PR, authority signals |
| 12 | **Analytics & Learning** | Performance measurement, attribution, learnings fed back into strategy |

The agent pipeline is designed as a closed loop: work flows from project intake through
strategy, research, production, and technical execution, and the resulting performance data
feeds back into the SEO Director to re-prioritise the next cycle.

During the Premium Frontend Foundation phase, all agent activity is **mocked** — realistic
fixtures for status, activity feeds, and outputs, not live executions.

## Development Workflow

Every unit of work follows the same loop:

```
Plan → Build One Bounded Feature → Test → Fix → Git Commit → Next Feature
```

One bounded feature per cycle. No step is skipped, and the next feature does not begin until
the current one is tested, fixed, and committed.

## Development Approach

- **Frontend-first** — the product surface is built first; the UI defines the data contracts
  that any future backend must satisfy.
- **Localhost-first** — every feature is built and verified locally before it goes anywhere else.
- **Mock data during the initial frontend phase** — realistic mock SEO data and mock agent
  activity stand in for live sources, so screens can be designed against believable shapes.
- **Backend and integrations added only after the frontend architecture is stable** — no
  database, auth, live APIs, or third-party integrations until the surface has settled.
- **Git checkpoints after completed features** — each finished bounded feature is reviewed and
  committed as a restore point.

## Deployment Flow

```
Local Development → Localhost Testing → Git → GitHub → Vercel
```

Production hardening is completed before any public deployment.

## Project Rules

Detailed development rules are maintained in [`CLAUDE.md`](CLAUDE.md) — the authoritative
reference for workflow, scope boundaries, dependency and approval gates, security rules,
testing discipline, the build sequence, and the Definition of Done.

Read `CLAUDE.md` before contributing.

## Security

- **Secrets must never be committed.** `.env` files stay out of version control; only an
  `.env.example` with empty placeholder values is tracked.
- **API keys and credentials must stay server-side.** Nothing sensitive is shipped to, or
  referenced from, client-side code — including behind any client-exposure variable prefix.
- **Environment variables will be used for sensitive configuration.** No credential,
  token, password, or webhook secret is ever hardcoded.

## Roadmap

| # | Milestone |
|---|---|
| 1 | Foundation |
| 2 | Command Center |
| 3 | Projects |
| 4 | AI Agents |
| 5 | Keyword Intelligence |
| 6 | Content Studio |
| 7 | Competitor Intelligence |
| 8 | Technical SEO |
| 9 | AI Visibility |
| 10 | Backlinks & Authority |
| 11 | Analytics |
| 12 | Reports |
| 13 | Backend & Integrations |
| 14 | Production Hardening |
| 15 | Deployment |

Milestones 1–12 are frontend work. Milestones 13–15 begin only once the frontend architecture
is stable.

## Local Development

> **Not yet applicable.** The application has not been scaffolded — the repository currently
> contains documentation only (`CLAUDE.md` and this `README.md`). There is no `package.json`,
> no lockfile, and no framework or package manager selected yet, so there are no install or
> dev commands to document.

This section will be filled in with the real commands once the project is scaffolded, covering:

- **Prerequisites** — required runtime and package manager versions
- **Install** — dependency installation
- **Run** — starting the local development server, and the localhost URL it serves on
- **Checks** — type check, lint, and production build
- **Environment** — copying `.env.example` and the variables that need values

## Project Vision

Nexra SEO Command Center is intended to become a **premium commercial AI SEO platform**, not a
basic SEO dashboard.

The distinction is deliberate. A dashboard displays metrics someone else has already gathered
and leaves the thinking to the operator. This platform is being built to *do the work* — to
coordinate a team of specialist AI agents across strategy, research, content, technical
execution, authority building, and measurement, and to close the loop by feeding results back
into the next cycle of strategy.

The standard is agency-grade throughout: premium, modern, clean, professional, technical,
SaaS-ready, and data-focused — a product an agency would run its client work on, and pay for.
