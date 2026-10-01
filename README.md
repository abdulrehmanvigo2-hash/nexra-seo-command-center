# Nexra SEO Command Center

An operator-only SEO workspace for the Nexra agency: twelve specialist AI agents that review a
client site from the records this product holds, and a content workflow that takes an article
from draft to check, approval and a publication proposal.

## Status

**Full V1, in production** since 30 Sep 2026 at `nexra-seo-command-center.vercel.app` (Vercel,
deployed from `master` on every merge). Its first article is live on the agency website
(`/blog/ai-dead-lead-reactivation`). A full audit followed; its findings and their fixes are in
[`docs/audit/`](docs/audit/).

What the product does today:

- **Reads only its own records.** The screens and agents use this product's own crawls of a
  project's site and its recorded competitors, the project's Google Search Console report and
  stored snapshots, the operator's curated keywords, tasks, and earlier agent runs. There is no
  paid SEO data provider: no rankings, search volume, backlinks or AI-citation data.
- **Twelve agents, 27 task types** — every one read-only except the Writer's two drafts, which
  write nothing but a draft for review — run by a queue with
  attempts, leases, retries, a scheduled worker and daily spend caps (40 runs a project, 100 in
  all, per UTC day). Every run is started by an operator.
- **Content workflow:** articles checked statement by statement against the stored evidence,
  approved one exact version at a time, and recorded as a publication proposal. The product
  publishes nothing itself; publishing is a pull request to the website, merged by the operator.
- **Labelled honestly.** Screens over stored data carry an Observed badge; the remaining fixture
  figures (on the Projects, project, agent and AI Agents screens) are marked Modelled.

## Stack

- **Next.js 16** (App Router) and React 19, TypeScript, Tailwind CSS 4 — read
  [`AGENTS.md`](AGENTS.md) before writing Next.js code.
- **Supabase** Postgres (row level security on, no policies; the server alone uses the
  `service_role` key) and Supabase Auth for operator sign-in.
- **Anthropic** API for agent runs (`NEXRA_AGENT_EXECUTOR=ai`; simulated output otherwise).
- **Google Search Console** through a read-only service account.
- **Vercel** hosting, with two daily cron routes for the worker.
- **GitHub Actions** for CI (every pull request and push to `master`) and a nightly encrypted
  database backup.

## Run it locally

Needs Node.js 22 (the version CI uses) and npm.

```bash
npm ci
cp .env.example .env.local   # fill in what you need; every variable is described there
npm run dev                  # http://localhost:3000
```

With `.env.local` empty, the application stays closed (sign-in needs the Supabase variables
and `NEXRA_OPERATOR_EMAILS`) and the Projects roster falls back to fixtures. Agent runs use the
simulated executor unless `NEXRA_AGENT_EXECUTOR=ai` and a provider key are set; that spends
money on every attempt.

### Checks

The same gates run in CI and must pass before a merge:

```bash
npm test               # unit tests
npm run typecheck
npm run lint
npm run build
npm run secret-scan
bash supabase/tests/run.sh   # SQL harness on a disposable local PostgreSQL 16 cluster (Linux/WSL)
```

The SQL harness never connects to a hosted database: it creates its own cluster on a Unix
socket and deletes it afterwards.

## Documentation

| Where | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The operating rules, approval gates and the full checkpoint record. Read it first. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | How production is changed and checked: migrations, deployments, rollback, health, spend caps, backups and restore. |
| [`docs/BACKEND.md`](docs/BACKEND.md) | Backend architecture, security model and environment variables. |
| [`supabase/README.md`](supabase/README.md) | Every migration, in order, and whether it is applied. |
| [`docs/audit/`](docs/audit/) | The V1 audit: findings, their status, and the post-V1 backlog. |

## Security

- Secrets never enter the repository or the browser: `.env*` files are ignored (only
  `.env.example`, with empty values, is tracked), and no secret carries a `NEXT_PUBLIC_` prefix.
- Every page requires an operator session except `/login` and the data-free `/api/health`;
  every data and write route re-checks the operator on the server.
- Any change to production data, schema, credentials or an external service needs the
  operator's explicit approval (`CLAUDE.md` §6).
