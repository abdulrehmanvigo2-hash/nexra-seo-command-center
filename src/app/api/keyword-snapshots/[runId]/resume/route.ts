import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { keywordSnapshotLimiter, keywordSnapshotService } from "@/lib/keyword-snapshots";
import { isRunId } from "@/lib/keyword-snapshots/contract";
import { runResultResponse } from "@/lib/keyword-snapshots/http";
import { logEvent } from "@/lib/observability/log";

/**
 * Resume one partial snapshot run for its missing calls (F0, decision Q4).
 *
 *   POST /api/keyword-snapshots/<runId>/resume
 *
 * Operators only, from this site's own pages, through the confirmation the
 * screen shows first. Nothing resumes on its own: this is the only way a
 * partial run makes another call. The server recomputes the estimate for
 * the missing calls and reserves it against the daily cap.
 */

export const maxDuration = 300;

export async function POST(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const { runId } = await context.params;
  if (!isRunId(runId)) return errorResponse("not-found", 404);

  const limited = await limitResponse(keywordSnapshotLimiter("run"), operator.id);
  if (limited) return limited;

  try {
    const started = Date.now();
    const result = await keywordSnapshotService().resume(runId.toLowerCase(), operator.id);
    logEvent("info", "keyword-snapshot.resume", {
      runId: runId.toLowerCase(),
      outcome: result.status,
      status: result.status === "finished" ? result.run.status : null,
      count: result.status === "finished" ? result.requests.length : null,
      durationMs: Date.now() - started,
    });
    return runResultResponse(result);
  } catch (error) {
    logFailure("keyword-snapshots resume", error);
    return errorResponse("failed", 500);
  }
}
