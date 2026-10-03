import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { evidenceLimiter, evidenceService } from "@/lib/evidence";
import { parseDecideRequest } from "@/lib/evidence/contract";
import { isRunId } from "@/lib/keyword-snapshots/contract";
import { logEvent } from "@/lib/observability/log";

/**
 * The owner's decision on one evidence unit (M4, PR 6): POST /api/evidence/units/<unitId> { project, decision }.
 * Operators only, same origin. `admitted` only for a supported unit whose quote the database found (409
 * `not-admissible`); a decision is made once (409 `already-decided`).
 */

export async function POST(request: NextRequest, context: { params: Promise<{ unitId: string }> }) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const { unitId } = await context.params;
  if (!isRunId(unitId)) return errorResponse("bad-request", 400);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseDecideRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const limited = await limitResponse(evidenceLimiter("write"), operator.id);
  if (limited) return limited;
  try {
    const result = await evidenceService().decide(parsed.projectId, unitId.toLowerCase(), parsed.decision, operator.id);
    logEvent("info", "evidence.decide", { projectId: parsed.projectId, outcome: result.status });
    switch (result.status) {
      case "admitted":
      case "rejected":
        return json({ status: result.status, unit: result.unit });
      case "not-set-up":
        return errorResponse("not-set-up", 503);
      case "unit-not-found":
        return errorResponse("not-found", 404);
      default:
        return errorResponse(result.status, 409);
    }
  } catch (error) {
    logFailure("evidence decide", error);
    return errorResponse("failed", 500);
  }
}
