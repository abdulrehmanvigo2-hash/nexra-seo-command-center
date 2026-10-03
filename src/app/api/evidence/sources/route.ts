import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { evidenceLimiter, evidenceService } from "@/lib/evidence";
import { parseSourceFetchRequest } from "@/lib/evidence/contract";
import { isRunId, isSnapshotProjectId } from "@/lib/keyword-snapshots/contract";
import { logEvent } from "@/lib/observability/log";

/**
 * Outside sources for an accepted opportunity (M4, PR 5).
 *
 *   GET  /api/evidence/sources?project=<id>&opportunity=<uuid>
 *   POST /api/evidence/sources   { project, opportunity, serpResult } | { project, opportunity, url }
 *
 * Operators only; the write from this site's own pages only. A POST fetches one page under the crawler's rules
 * (robots.txt first, HTML only, text capped) and records what happened. No AI, no provider call. A source's text never
 * leaves through this route: the answer carries a preview of at most 300 characters.
 */

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const project = request.nextUrl.searchParams.get("project");
  const opportunity = request.nextUrl.searchParams.get("opportunity");
  if (!isSnapshotProjectId(project) || !isRunId(opportunity)) return errorResponse("bad-request", 400);
  const limited = await limitResponse(evidenceLimiter("read"), operator.id);
  if (limited) return limited;
  try {
    const result = await evidenceService().listSources(project, opportunity.toLowerCase());
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({ sources: result.sources });
  } catch (error) {
    logFailure("evidence sources read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseSourceFetchRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const limited = await limitResponse(evidenceLimiter("fetch"), operator.id);
  if (limited) return limited;
  try {
    const result = await evidenceService().fetchSource(parsed.projectId, parsed.opportunityId, parsed.target, operator.id);
    logEvent("info", "evidence.source", { projectId: parsed.projectId, outcome: result.status, status: result.status === "recorded" ? result.source.fetchState : null });
    switch (result.status) {
      case "recorded":
        return json({ source: result.source }, 201);
      case "not-set-up":
        return errorResponse("not-set-up", 503);
      case "source-limit":
        return errorResponse("source-limit", 429);
      default:
        return errorResponse(result.status, 404);
    }
  } catch (error) {
    logFailure("evidence source fetch", error);
    return errorResponse("failed", 500);
  }
}
