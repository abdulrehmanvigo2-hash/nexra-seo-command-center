import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { logEvent } from "@/lib/observability/log";
import { projectRepository } from "@/lib/projects/repository";
import { topicMapLimiter, topicMapService } from "@/lib/topic-maps";
import { isTopicMapProjectId, parseTopicMapRequest } from "@/lib/topic-maps/contract";

/**
 * Topical maps (M1, PR 4): read a project's maps, build one, or approve one.
 *
 *   GET  /api/topic-maps?project=<id>
 *   POST /api/topic-maps   { project, action: "build" } | { project, action: "approve", mapId }
 *
 * Operators only, confirmed with the Auth server here; the writes from this
 * site's own pages only. A build reads stored records and writes one map
 * through the database function; it pays for nothing and runs no agent.
 * Every answer is a fixed code; "not set up" (the migration not applied, or
 * no store) is a 503 the screen reads as a calm state.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (!isTopicMapProjectId(project)) return errorResponse("bad-request", 400);

  const limited = await limitResponse(topicMapLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const result = await topicMapService().read(project);
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({ view: result.view });
  } catch (error) {
    logFailure("topic-maps read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseTopicMapRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(topicMapLimiter("write"), operator.id);
  if (limited) return limited;

  try {
    if ((await projectRepository.getProjectById(parsed.projectId)) === null) return errorResponse("project-not-found", 404);
    const started = Date.now();
    if (parsed.action === "build") {
      const result = await topicMapService().build(parsed.projectId, operator.id);
      logEvent("info", "topic-map.build", { projectId: parsed.projectId, outcome: result.status, runId: result.status === "built" ? result.view.map.id : null, count: result.status === "built" ? result.view.clusters.length : null, durationMs: Date.now() - started });
      switch (result.status) {
        case "built":
          return json({ status: "built", view: result.view }, 201);
        case "not-set-up":
          return errorResponse("not-set-up", 503);
        case "no-run":
          return errorResponse("no-run", 409);
        case "live-articles-unread":
          return errorResponse("live-articles-unread", 409);
        case "project-not-found":
          return errorResponse("project-not-found", 404);
        case "invalid-map":
          logEvent("warn", "topic-map.build.invalid", { projectId: parsed.projectId, reason: result.reason });
          return errorResponse("invalid-map", 422);
      }
    }
    const result = await topicMapService().approve(parsed.projectId, parsed.mapId, operator.id);
    logEvent("info", "topic-map.approve", { projectId: parsed.projectId, runId: parsed.mapId, outcome: result.status, durationMs: Date.now() - started });
    switch (result.status) {
      case "approved":
        return json({ status: "approved", map: result.map });
      case "not-set-up":
        return errorResponse("not-set-up", 503);
      case "map-not-found":
        return errorResponse("not-found", 404);
      case "not-proposed":
        return errorResponse("not-proposed", 409);
    }
  } catch (error) {
    logFailure("topic-maps write", error);
    return errorResponse("failed", 500);
  }
}
