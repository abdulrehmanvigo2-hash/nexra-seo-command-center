import "server-only";

import { createAiExecutor } from "@/lib/agent-runs/ai-executor";
import { crawlService } from "@/lib/crawl";
import { unavailableAgentRunStore, type AgentRunStore } from "@/lib/agent-runs/contract";
import type { AgentExecutor } from "@/lib/agent-runs/executor";
import { mockAgentExecutor } from "@/lib/agent-runs/mock-executor";
import { createAnthropicProvider } from "@/lib/agent-runs/providers/anthropic";
import { readAiProviderConfig, selectExecutor } from "@/lib/agent-runs/providers/config";
import { createAgentRunService, type AgentRunService } from "@/lib/agent-runs/service";
import type { AgentRunsDatabase } from "@/lib/agent-runs/supabase/schema";
import { createSupabaseAgentRunStore } from "@/lib/agent-runs/supabase/store";
import { createTaskGrounding } from "@/lib/agent-runs/task-grounding";
import { unavailableArticleCheckStore, type ArticleCheckStore } from "@/lib/content/articles/checks/contract";
import type { ArticleChecksDatabase } from "@/lib/content/articles/checks/supabase/schema";
import { createSupabaseArticleCheckStore } from "@/lib/content/articles/checks/supabase/store";
import { unavailableDraftStore, type ContentDraftStore } from "@/lib/content/drafts/contract";
import type { ContentDraftsDatabase } from "@/lib/content/drafts/supabase/schema";
import { createSupabaseDraftStore } from "@/lib/content/drafts/supabase/store";
import { logEvent } from "@/lib/observability/log";
import { selectProjectDataSource } from "@/lib/projects/data-source";
import { INVENTORY_RANGE_ID, RUN_INVENTORY_LIMIT } from "@/lib/projects/grounding";
import { projectRepository } from "@/lib/projects/repository";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { AsyncRateLimiter } from "@/lib/security/shared-rate-limit";
import { getSearchConsoleReport, searchConsoleProvider } from "@/lib/search-console";
import { createSupabaseServerClient, readSupabaseServerConfig } from "@/lib/supabase/server";

/**
 * The server's agent runtime — the one place that wires it together.
 *
 * Runs live beside projects: with `PROJECTS_DATA_SOURCE=supabase` they are
 * kept in the `agent_runs` table, whose rows reference stored projects. With
 * the mock roster there is nowhere to keep them, and every call answers
 * `unavailable` rather than pretending.
 *
 * The executor is chosen by `NEXRA_AGENT_EXECUTOR` (`@/lib/agent-runs/providers/config`):
 * the mock executor by default, or the AI executor over the configured
 * provider. An AI executor with no provider configured is still installed, so
 * each attempt fails visibly with `provider-not-configured` instead of
 * quietly producing simulated output.
 *
 * Each server process gets one random worker label and a 60-second lease
 * renewed every 15 seconds. An attempt may take 30 seconds with the mock
 * executor and 120 with the AI executor.
 *
 * Server-only: route handlers call it after confirming the operator or the
 * worker credential.
 */

const MOCK_TIMEOUT_MS = 30_000;
const AI_TIMEOUT_MS = 120_000;

/**
 * The draft store the fact-check reader reads versions from: the same two
 * tables the draft service writes, through a client of their own. Built
 * here rather than imported from the draft service, which depends on this
 * module for the run reads.
 */
function draftStoreForRuntime(): ContentDraftStore {
  return storesInSupabase()
    ? createSupabaseDraftStore(createSupabaseServerClient<ContentDraftsDatabase>(readSupabaseServerConfig(process.env)))
    : unavailableDraftStore;
}

/**
 * The article check store the article-check reader reads versions and unit
 * rows from: the article tables and `nexra_article_check_units`, read only,
 * through a client of its own — for the same reason as the draft store.
 */
function articleCheckStoreForRuntime(): ArticleCheckStore {
  return storesInSupabase()
    ? createSupabaseArticleCheckStore(createSupabaseServerClient<ArticleChecksDatabase>(readSupabaseServerConfig(process.env)))
    : unavailableArticleCheckStore;
}

function configuredExecutor(store: AgentRunStore): { executor: AgentExecutor; timeoutMs: number } {
  if (selectExecutor(process.env) === "mock") {
    return { executor: mockAgentExecutor, timeoutMs: MOCK_TIMEOUT_MS };
  }
  const config = readAiProviderConfig(process.env);
  if (config.status !== "configured") {
    logEvent("warn", "agent_executor.unconfigured", { executor: "ai", reason: config.problem });
    return { executor: createAiExecutor(null), timeoutMs: AI_TIMEOUT_MS };
  }
  const provider = createAnthropicProvider({
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: AI_TIMEOUT_MS - 5_000,
  });
  // The Research & Evidence pack reads the same records through the same
  // services: the newest own-site crawl by exact host, the default Search
  // Console window through the cached provider, and competitor crawls by
  // exact host for availability only. Intake notes and earlier runs are not
  // read at all. The Writer's draft re-reads the same pack, through the same
  // readers, beside the completed plan it was written over.
  const evidencePackReaders = {
    getProjectById: (id: string) => projectRepository.getProjectById(id),
    getProjectIntake: (id: string) => projectRepository.getProjectIntake(id),
    listProjectCrawls: (projectId: string) => crawlService().listCrawls(projectId, 1),
    listCompetitorCrawls: async (projectId: string, competitorHost: string) => {
      const listed = await crawlService().listCompetitorCrawls(projectId, competitorHost, 1);
      return listed.ok ? listed.crawls : [];
    },
    crawls: crawlService(),
    searchConsole: (projectId: string) =>
      getSearchConsoleReport(searchConsoleProvider(), projectId, INVENTORY_RANGE_ID),
  };
  return {
    // The evidence a task may see is read here, from this product's own
    // records, and decided by the task type's declaration
    // (`@/lib/agent-runs/task-grounding`) — never by the executor.
    executor: createAiExecutor(
      provider,
      createTaskGrounding({
        crawls: crawlService(),
        // The same read the Search Console panel makes, through the same
        // cached provider: a run reads what the screen shows, nothing more.
        searchConsole: (projectId, rangeId) =>
          getSearchConsoleReport(searchConsoleProvider(), projectId, rangeId),
        // A hand-off reads the upstream run from the same store the runtime
        // keeps its own runs in: one record, read by id, checked against the
        // Director's project before a word of it is formatted.
        runs: store,
        // The Project Manager's intake review reads the run's own project
        // record and an inventory of what the other three readers hold for
        // it — counts and states, through the same services, never contents.
        projects: {
          getProjectById: (id) => projectRepository.getProjectById(id),
          getProjectIntake: (id) => projectRepository.getProjectIntake(id),
          listCrawls: (projectId) => crawlService().listCrawls(projectId),
          searchConsole: (projectId) =>
            getSearchConsoleReport(searchConsoleProvider(), projectId, INVENTORY_RANGE_ID),
          listRuns: (projectId) => store.listRuns({ projectId, limit: RUN_INVENTORY_LIMIT }),
        },
        // The Market & Competitor Intelligence comparison reads the newest
        // own-site crawl and the newest crawl of one recorded competitor,
        // through the same listings the panels read: own-site crawls are the
        // project's exact host, competitor crawls the competitor's exact host,
        // and the service re-checks the domain against the stored record.
        comparison: {
          getProjectById: (id) => projectRepository.getProjectById(id),
          getProjectIntake: (id) => projectRepository.getProjectIntake(id),
          listProjectCrawls: (projectId) => crawlService().listCrawls(projectId, 1),
          listCompetitorCrawls: async (projectId, competitorHost) => {
            const listed = await crawlService().listCompetitorCrawls(projectId, competitorHost, 1);
            return listed.ok ? listed.crawls : [];
          },
          crawls: crawlService(),
        },
        evidencePack: evidencePackReaders,
        // The Writer's section draft reads one completed plan from the same
        // store the runtime keeps its own runs in — one record, by id,
        // checked against the run's project before a word of it is
        // formatted — and re-reads the pack that plan was written over.
        draft: { runs: store, evidencePack: evidencePackReaders },
        // The Authority & Backlink review reads one crawl record through the
        // same crawl service and that crawl's stored edges through its one
        // bounded link read. No host is fetched.
        links: {
          crawls: crawlService(),
          links: { listLinks: (crawlId, limit) => crawlService().listCrawlLinks(crawlId, limit) },
        },
        // The Research & Evidence fact-check reads one saved draft version
        // from the draft tables — by project, id and number, checked against
        // the run's project before a word of it is quoted — and re-reads the
        // pack it rests on through the same readers.
        factCheck: { drafts: draftStoreForRuntime(), evidencePack: evidencePackReaders },
        // The Research & Evidence article check reads one article version by
        // project, id and number, regenerates its check units from the stored
        // text, and re-reads the pack through the same readers. Reads only.
        articleCheck: { checks: articleCheckStoreForRuntime(), evidencePack: evidencePackReaders },
      }),
    ),
    timeoutMs: AI_TIMEOUT_MS,
  };
}

function storesInSupabase(): boolean {
  return selectProjectDataSource(process.env) === "supabase";
}

function configuredService(): AgentRunService {
  const store = storesInSupabase()
    ? createSupabaseAgentRunStore(
        createSupabaseServerClient<AgentRunsDatabase>(readSupabaseServerConfig(process.env)),
      )
    : unavailableAgentRunStore;
  const { executor, timeoutMs } = configuredExecutor(store);

  return createAgentRunService({
    store,
    executor,
    projects: projectRepository,
    timeoutMs,
  });
}

let service: AgentRunService | null = null;

export function agentRunService(): AgentRunService {
  service ??= configuredService();
  return service;
}

/*
 * Rate limits for the runtime's write and execution paths. Shared across
 * instances through Postgres when runs are stored there; per process
 * otherwise, where nothing can run anyway.
 */

type LimitName = "create" | "action" | "operator-worker" | "scheduled-worker";

const LIMITS: Readonly<Record<LimitName, { readonly limit: number; readonly windowSeconds: number }>> = {
  /** Runs created, per operator. */
  create: { limit: 30, windowSeconds: 600 },
  /** Execute, cancel, and retry, per operator. */
  action: { limit: 60, windowSeconds: 600 },
  /** Manual worker triggers, per operator. */
  "operator-worker": { limit: 30, windowSeconds: 600 },
  /**
   * Scheduled worker invocations, per job. The default schedule needs one a
   * day and a Pro schedule at most six an hour; this caps what a leaked
   * secret could drive.
   */
  "scheduled-worker": { limit: 60, windowSeconds: 3_600 },
};

export function agentRunLimiter(name: LimitName): AsyncRateLimiter {
  return appRateLimiter(`agent-runs.${name}`, LIMITS[name]);
}
