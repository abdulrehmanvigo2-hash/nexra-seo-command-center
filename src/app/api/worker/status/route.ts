import type { NextRequest } from "next/server";
import { agentRunService } from "@/lib/agent-runs";
import { errorResponse, failureResponse, json, logFailure } from "@/lib/agent-runs/http";
import { describeExecution } from "@/lib/agent-runs/providers/config";
import { isAuthorizedWorker } from "@/lib/agent-runs/worker-http";
import { getOperator } from "@/lib/auth/session";

/**
 * Agent runtime diagnostics.
 *
 *   GET /api/worker/status   Authorization: Bearer <CRON_SECRET>, or an operator session
 *     → { runtime: { queuedDue, queuedWaiting, running, expiredLeases, failed, … },
 *         execution: { executor, aiProvider, model } }
 *
 * Counts and configuration states only — no run contents, no values from the
 * environment. `expiredLeases` above zero means recovery has work waiting;
 * a growing `queuedDue` with an old `oldestDueQueuedAt` means the queue job is
 * not running.
 */

export async function GET(request: NextRequest) {
  const worker = request.headers.has("authorization") && isAuthorizedWorker(request, "worker/status");
  if (!worker && !(await getOperator())) return errorResponse("unauthorized", 401);

  try {
    const result = await agentRunService().runtimeStatus();
    if (!result.ok) return failureResponse(result);
    return json({ runtime: result.status, execution: describeExecution(process.env) });
  } catch (error) {
    logFailure("worker status", error);
    return errorResponse("failed", 500);
  }
}
