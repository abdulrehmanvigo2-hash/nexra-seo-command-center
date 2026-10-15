import { runHistoryListUrl } from "@/lib/agent-runs/run-history-view";
import { executeOutcome, type ExecuteOutcome } from "@/lib/crawl/review-request";
import type { WritingIo, WritingProgress } from "@/lib/pipeline/write-parts";
import type { AgentRun } from "@/types/agent-run";

/**
 * OC1: the Writer's run calls from the browser, shared by the writing loop (PR 5) and the re-draft (PR 6c) — the same
 * requests Run History's Run now sends.
 */

export async function readRun(runId: string): Promise<AgentRun | null> {
  try {
    const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
    if (!response.ok) return null;
    return ((await response.json()) as { run?: AgentRun }).run ?? null;
  } catch {
    return null;
  }
}

export async function executeRun(runId: string): Promise<ExecuteOutcome> {
  try {
    const response = await fetch(`/api/agent-runs/${encodeURIComponent(runId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "execute" }), cache: "no-store" });
    return executeOutcome(response.status, await response.json().catch(() => null));
  } catch {
    // The attempt may or may not have started; the read-back decides, as Run now's does.
    return executeOutcome(0, null);
  }
}

export function writingIo(projectId: string, stop: { current: boolean }, onProgress: (event: WritingProgress) => void): WritingIo {
  return {
    readRuns: async () => {
      try {
        const response = await fetch(runHistoryListUrl({ projectId, agentId: "writer", limit: 50, offset: 0 }), { cache: "no-store" });
        if (!response.ok) return null;
        const body = (await response.json().catch(() => null)) as { runs?: unknown } | null;
        return Array.isArray(body?.runs) ? (body.runs as AgentRun[]) : null;
      } catch {
        return null;
      }
    },
    execute: executeRun,
    readRun,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    stopRequested: () => stop.current,
    onProgress,
  };
}
