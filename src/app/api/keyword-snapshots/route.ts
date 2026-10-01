import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { keywordSnapshotLimiter, keywordSnapshotService } from "@/lib/keyword-snapshots";
import { isSnapshotProjectId, parseRunRequest } from "@/lib/keyword-snapshots/contract";
import { runResultResponse } from "@/lib/keyword-snapshots/http";
import { logEvent } from "@/lib/observability/log";
import { projectRepository } from "@/lib/projects/repository";

/**
 * Keyword snapshots (F0, PR 4): read a project's provider runs, or make one.
 *
 *   GET  /api/keyword-snapshots?project=<id>
 *   POST /api/keyword-snapshots   { project }
 *
 * Operators only, confirmed with the Auth server here; the write from this
 * site's own pages only. The POST is the one paid action: the server takes
 * the seeds from its own constant, recomputes the estimate, reserves against
 * the daily cap in the database and makes the calls one by one under a
 * deadline; what happened is on the run record. Nothing here runs an agent.
 */

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (!isSnapshotProjectId(project)) return errorResponse("bad-request", 400);

  const limited = await limitResponse(keywordSnapshotLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const result = await keywordSnapshotService().read(project);
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({ view: result.view });
  } catch (error) {
    logFailure("keyword-snapshots read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseRunRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(keywordSnapshotLimiter("run"), operator.id);
  if (limited) return limited;

  try {
    if ((await projectRepository.getProjectById(parsed.projectId)) === null) return errorResponse("project-not-found", 404);
    const started = Date.now();
    const result = await keywordSnapshotService().run(parsed.projectId, operator.id);
    logEvent("info", "keyword-snapshot.run", {
      projectId: parsed.projectId,
      outcome: result.status,
      runId: result.status === "finished" ? result.run.id : null,
      status: result.status === "finished" ? result.run.status : null,
      count: result.status === "finished" ? result.requests.length : null,
      durationMs: Date.now() - started,
    });
    return runResultResponse(result);
  } catch (error) {
    logFailure("keyword-snapshots run", error);
    return errorResponse("failed", 500);
  }
}
