import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { isRunId, isSnapshotProjectId, secondsUntilMidnightUtc } from "@/lib/keyword-snapshots/contract";
import { logEvent } from "@/lib/observability/log";
import { projectRepository } from "@/lib/projects/repository";
import { describeCapRefusal } from "@/lib/providers/dataforseo/config";
import { serpLimiter, serpService } from "@/lib/serp";
import { parseSerpRequest } from "@/lib/serp/contract";

/**
 * Google results for an accepted opportunity (M4, PR 3).
 *
 *   GET  /api/serp?project=<id>[&opportunity=<uuid>]
 *   POST /api/serp   { project, opportunity }
 *
 * Operators only; the write from this site's own pages only. The POST is one paid DataForSEO call ($0.0024 live, 0 in
 * the sandbox) against the shared daily cap; the keyword is the opportunity's, chosen by the database. Nothing here runs
 * an agent or fetches a page.
 */

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const project = request.nextUrl.searchParams.get("project");
  const opportunity = request.nextUrl.searchParams.get("opportunity");
  if (!isSnapshotProjectId(project) || (opportunity !== null && !isRunId(opportunity))) return errorResponse("bad-request", 400);
  const limited = await limitResponse(serpLimiter("read"), operator.id);
  if (limited) return limited;
  try {
    const result = await serpService().read(project, opportunity === null ? null : opportunity.toLowerCase());
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({ view: result.view });
  } catch (error) {
    logFailure("serp read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseSerpRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const limited = await limitResponse(serpLimiter("run"), operator.id);
  if (limited) return limited;
  try {
    if ((await projectRepository.getProjectById(parsed.projectId)) === null) return errorResponse("project-not-found", 404);
    const started = Date.now();
    const result = await serpService().run(parsed.projectId, parsed.opportunityId, operator.id);
    logEvent("info", "serp.run", {
      projectId: parsed.projectId,
      outcome: result.status,
      runId: result.status === "finished" ? result.run.id : null,
      status: result.status === "finished" ? result.run.status : null,
      count: result.status === "finished" ? result.results : null,
      durationMs: Date.now() - started,
    });
    switch (result.status) {
      case "finished":
        return json({ status: "finished", run: result.run, results: result.results }, 201);
      case "not-set-up":
      case "not-configured":
        return errorResponse(result.status, 503);
      case "cap-invalid":
        return json({ error: "cap-invalid", message: describeCapRefusal(result.reason) }, 503);
      case "cap-reached": {
        const response = json({ error: "cap-reached", spentUsd: result.spentUsd, capUsd: result.capUsd, estimateUsd: result.estimateUsd, message: `Daily provider cap reached ($${result.spentUsd.toFixed(2)} of $${result.capUsd.toFixed(2)} used today); resets at midnight UTC.` }, 429);
        response.headers.set("Retry-After", String(secondsUntilMidnightUtc(new Date())));
        return response;
      }
      case "run-active":
        return errorResponse("run-active", 409);
      case "project-not-found":
      case "opportunity-not-found":
        return errorResponse(result.status, 404);
      case "failed-to-record":
        return errorResponse("failed", 500);
    }
  } catch (error) {
    logFailure("serp run", error);
    return errorResponse("failed", 500);
  }
}
