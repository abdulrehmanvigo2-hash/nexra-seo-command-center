import type { NextRequest } from "next/server";
import { agentRunService } from "@/lib/agent-runs";
import { errorResponse, failureResponse, json, logFailure } from "@/lib/agent-runs/http";
import { admitWorker } from "@/lib/agent-runs/worker-http";
import { logEvent } from "@/lib/observability/log";

/**
 * Scheduled queue processing.
 *
 *   GET or POST /api/worker/process   Authorization: Bearer <CRON_SECRET>
 *     → { job: "process", scheduledRetries: [...], executed: [...], stoppedBy }
 *
 * Two steps, in one invocation:
 *   1. The retry policy re-queues failed runs whose failure is retryable and
 *      which have attempts left, each with a backoff (2, 4, 8 … minutes).
 *   2. Due queued runs are claimed and executed one at a time — at most five,
 *      and none started once a further attempt could overrun this function's
 *      time limit.
 *
 * Every claim goes through the database lease, so overlapping invocations,
 * operators executing by hand, and a second scheduler never run the same
 * attempt twice. With nothing due, the answer is a 200 with an empty list.
 * Stale-run recovery is a separate job (`/api/worker/recover`).
 *
 * GET because Vercel Cron sends GET. Authorized only by the worker credential.
 */

export const maxDuration = 300;

const MAX_RUNS_PER_INVOCATION = 5;
/** Headroom under `maxDuration` for claiming, recording, and responding. */
const BATCH_BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
  return processQueue(request);
}

export async function POST(request: NextRequest) {
  return processQueue(request);
}

async function processQueue(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const refused = await admitWorker(request, "process");
    if (refused) return refused;

    const result = await agentRunService().processQueue({
      maxRuns: MAX_RUNS_PER_INVOCATION,
      budgetMs: BATCH_BUDGET_MS,
    });
    if (!result.ok) return failureResponse(result);

    logEvent("info", "worker.invocation", {
      job: "process",
      scheduled: result.scheduled.length,
      claimed: result.batch.executed.length,
      stoppedBy: result.batch.stoppedBy,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return json({
      job: "process",
      scheduledRetries: result.scheduled,
      executed: result.batch.executed,
      stoppedBy: result.batch.stoppedBy,
    });
  } catch (error) {
    logFailure("worker process", error);
    return errorResponse("failed", 500);
  }
}
