import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { logEvent } from "@/lib/observability/log";
import { opportunityLimiter, opportunityService } from "@/lib/opportunities";
import { isOpportunityProjectId, parseAcceptRequest } from "@/lib/opportunities/contract";
import { projectRepository } from "@/lib/projects/repository";

/**
 * Content opportunities (M2, PR 5): read a project's scored opportunities, or accept one as a task.
 *
 *   GET  /api/opportunities?project=<id>
 *   POST /api/opportunities   { project, clusterId, action, findingKey? }
 *
 * Operators only, confirmed with the Auth server here; the write from this site's own pages only. The list is scored
 * on read from stored records; an accept recomputes it on the server and records the one named through the database
 * function, which creates its backlog task. It pays for nothing and runs no agent. Every answer is a fixed code; "not
 * set up" (the migration not applied, or no store) is a 503 the screen reads as a calm state.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (!isOpportunityProjectId(project)) return errorResponse("bad-request", 400);

  const limited = await limitResponse(opportunityLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const result = await opportunityService().read(project);
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({ view: result.view });
  } catch (error) {
    logFailure("opportunities read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseAcceptRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(opportunityLimiter("write"), operator.id);
  if (limited) return limited;

  try {
    if ((await projectRepository.getProjectById(parsed.projectId)) === null) return errorResponse("project-not-found", 404);
    const started = Date.now();
    const result = await opportunityService().accept(parsed.projectId, { clusterId: parsed.clusterId, action: parsed.action, findingKey: parsed.findingKey }, operator.id);
    logEvent("info", "opportunity.accept", {
      projectId: parsed.projectId,
      outcome: result.status,
      runId: result.status === "accepted" || result.status === "exists" ? result.opportunity.id : null,
      durationMs: Date.now() - started,
    });
    switch (result.status) {
      case "accepted":
        return json({ status: "accepted", opportunity: result.opportunity }, 201);
      case "exists":
        return json({ status: "exists", opportunity: result.opportunity });
      case "not-set-up":
        return errorResponse("not-set-up", 503);
      case "no-approved-map":
      case "map-not-approved":
        return errorResponse(result.status, 409);
      case "opportunity-not-found":
      case "cluster-not-found":
        return errorResponse(result.status, 404);
      case "project-not-found":
        return errorResponse("project-not-found", 404);
      case "invalid":
        logEvent("warn", "opportunity.accept.invalid", { projectId: parsed.projectId, reason: result.reason });
        return errorResponse("invalid", 422);
    }
  } catch (error) {
    logFailure("opportunities accept", error);
    return errorResponse("failed", 500);
  }
}
