import type { NextRequest } from "next/server";
import { agentRunService } from "@/lib/agent-runs";
import { errorResponse, failureResponse, json, logFailure } from "@/lib/agent-runs/http";
import { runProcessJob } from "@/lib/agent-runs/process-job";
import { admitWorker } from "@/lib/agent-runs/worker-http";
import { logEvent } from "@/lib/observability/log";
import { searchConsoleSnapshotCapture } from "@/lib/search-console/snapshots";

/**
 * Scheduled queue processing, then the Search Console snapshot capture.
 *
 *   GET or POST /api/worker/process   Authorization: Bearer <CRON_SECRET>
 *     → { job: "process", scheduledRetries: [...], executed: [...], stoppedBy,
 *         snapshots: { status: "captured" | "skipped" | "timed-out" | "failed", … } }
 *
 * Three steps, in one invocation (`src/lib/agent-runs/process-job.ts`):
 *   1. The retry policy re-queues failed runs whose failure is retryable and
 *      which have attempts left, each with a backoff (2, 4, 8 … minutes).
 *   2. Due queued runs are claimed and executed one at a time — at most five,
 *      and none started once a further attempt could overrun this function's
 *      time limit.
 *   3. With the time left — at most 45 seconds, never into the response
 *      margin — one bounded Search Console snapshot capture for the projects
 *      the server's own configuration maps (milestone M1). Skipped when too
 *      little time is left; cut off at a hard deadline otherwise. It never
 *      delays or changes the queue, whose answer is returned as before.
 *
 * Every claim goes through the database lease, so overlapping invocations,
 * operators executing by hand, and a second scheduler never run the same
 * attempt twice; every snapshot goes through the one database function, so
 * two captures of one window record it once. With nothing due, the answer is
 * a 200 with an empty list. Stale-run recovery is a separate job
 * (`/api/worker/recover`).
 *
 * GET because Vercel Cron sends GET. Authorized only by the worker credential.
 */

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return processJob(request);
}

export async function POST(request: NextRequest) {
  return processJob(request);
}

async function processJob(request: NextRequest) {
  try {
    const outcome = await runProcessJob({
      admit: () => admitWorker(request, "process"),
      processQueue: (options) => agentRunService().processQueue(options),
      capture: (options) => searchConsoleSnapshotCapture().capture(options),
      log: logEvent,
    });
    if (outcome.kind === "refused") return outcome.response;
    if (outcome.kind === "queue-failed") return failureResponse(outcome.failure);

    logEvent("info", "worker.invocation", {
      job: "process",
      scheduled: outcome.queue.scheduled.length,
      claimed: outcome.queue.batch.executed.length,
      stoppedBy: outcome.queue.batch.stoppedBy,
      durationMs: outcome.durationMs,
    });
    return json({
      job: "process",
      scheduledRetries: outcome.queue.scheduled,
      executed: outcome.queue.batch.executed,
      stoppedBy: outcome.queue.batch.stoppedBy,
      snapshots: outcome.snapshots,
    });
  } catch (error) {
    logFailure("worker process", error);
    return errorResponse("failed", 500);
  }
}
