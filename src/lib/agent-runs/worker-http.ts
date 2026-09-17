import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { agentRunLimiter } from "@/lib/agent-runs";
import { errorResponse, limitResponse } from "@/lib/agent-runs/http";
import { logEvent } from "@/lib/observability/log";
import { authenticateWorker, readWorkerSecret } from "@/lib/security/worker-auth";

/**
 * What the scheduled worker routes share: the credential check and the
 * shared per-job invocation limit.
 *
 * A refused request gets a bare 401 — the same whether the header was
 * missing, wrong, or the secret is not configured — so a caller learns nothing
 * about the configuration. The server log says which, and never what the
 * header held.
 */

export type WorkerJob = "recover" | "process" | "status";

export function isAuthorizedWorker(request: NextRequest, route: string): boolean {
  const verdict = authenticateWorker(request.headers.get("authorization"), readWorkerSecret(process.env));
  if (verdict === "authorized") return true;
  logEvent(verdict === "unconfigured" ? "error" : "warn", "worker.unauthorized", { route, reason: verdict });
  return false;
}

/** Null when the worker may proceed; otherwise the response refusing it. */
export async function admitWorker(request: NextRequest, job: WorkerJob): Promise<NextResponse | null> {
  if (!isAuthorizedWorker(request, `worker/${job}`)) return errorResponse("unauthorized", 401);
  const limited = await limitResponse(agentRunLimiter("scheduled-worker"), job);
  if (limited) logEvent("warn", "worker.rate_limited", { job });
  return limited;
}
