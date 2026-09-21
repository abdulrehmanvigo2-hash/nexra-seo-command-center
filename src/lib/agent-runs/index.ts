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
import { logEvent } from "@/lib/observability/log";
import { selectProjectDataSource } from "@/lib/projects/data-source";
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
