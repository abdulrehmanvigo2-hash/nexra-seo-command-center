import type { NextRequest } from "next/server";
import { agentRunService } from "@/lib/agent-runs";
import { errorResponse, failureResponse, json, logFailure } from "@/lib/agent-runs/http";
import { admitWorker } from "@/lib/agent-runs/worker-http";
import { logEvent } from "@/lib/observability/log";

/**
 * Scheduled stale-run recovery.
 *
 *   GET or POST /api/worker/recover   Authorization: Bearer <CRON_SECRET>
 *     → { job: "recover", recovered: [{ runId, attemptNumber }] }
 *
 * Fails up to 25 running attempts whose lease has expired, and their runs,
 * with `lease-expired`. Safe to call at any frequency and concurrently: an
 * attempt closed once is no longer running, and a run another transaction
 * holds is left for the next call. Nothing to recover is a 200 with an empty
 * list. Whether a recovered run is tried again is the queue job's decision
 * (`/api/worker/process`), under the retry policy.
 *
 * GET because Vercel Cron sends GET. Authorized only by the worker
 * credential; an operator session is not accepted here.
 */

export async function GET(request: NextRequest) {
  return recover(request);
}

export async function POST(request: NextRequest) {
  return recover(request);
}

async function recover(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const refused = await admitWorker(request, "recover");
    if (refused) return refused;

    const result = await agentRunService().recoverStaleRuns();
    if (!result.ok) return failureResponse(result);

    logEvent("info", "worker.invocation", {
      job: "recover",
      recovered: result.recovered.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return json({ job: "recover", recovered: result.recovered });
  } catch (error) {
    logFailure("worker recover", error);
    return errorResponse("failed", 500);
  }
}
