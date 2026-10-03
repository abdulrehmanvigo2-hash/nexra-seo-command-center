import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { evidenceLimiter, evidenceService } from "@/lib/evidence";
import { parseRecordUnitsRequest } from "@/lib/evidence/contract";
import { isRunId, isSnapshotProjectId } from "@/lib/keyword-snapshots/contract";
import { logEvent } from "@/lib/observability/log";

/**
 * Evidence units (M4, PR 6).
 *
 *   GET  /api/evidence/units?project=<id>&source=<uuid>
 *   POST /api/evidence/units   { project, source, run }   — record a completed evidence-extract run's units
 *
 * Operators only; the write from this site's own pages only. Recording reads the run's stored answer, parses it (a
 * malformed one is refused whole), and the database checks every quote against the stored page. Nothing is admitted
 * here, and no AI or provider is called.
 */

const STATUS: Record<string, number> = {
  "not-set-up": 503,
  "run-not-found": 404,
  "source-not-found": 404,
  "run-not-accepted": 409,
  "run-not-completed": 409,
  "source-not-fetched": 409,
  exists: 409,
  "answer-malformed": 422,
  "no-units": 422,
  "invalid-unit": 422,
};

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const project = request.nextUrl.searchParams.get("project");
  const source = request.nextUrl.searchParams.get("source");
  if (!isSnapshotProjectId(project) || !isRunId(source)) return errorResponse("bad-request", 400);
  const limited = await limitResponse(evidenceLimiter("read"), operator.id);
  if (limited) return limited;
  try {
    const result = await evidenceService().listUnits(project, source.toLowerCase());
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({ units: result.units });
  } catch (error) {
    logFailure("evidence units read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseRecordUnitsRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const limited = await limitResponse(evidenceLimiter("write"), operator.id);
  if (limited) return limited;
  try {
    const result = await evidenceService().recordUnits(parsed.projectId, parsed.sourceId, parsed.runId, operator.id);
    logEvent("info", "evidence.units", { projectId: parsed.projectId, outcome: result.status, count: result.status === "recorded" ? result.units : null });
    if (result.status === "recorded") return json(result, 201);
    return errorResponse(result.status, STATUS[result.status] ?? 409);
  } catch (error) {
    logFailure("evidence units record", error);
    return errorResponse("failed", 500);
  }
}
