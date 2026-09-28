import type { NextRequest } from "next/server";
import { agentTaskLimiter, agentTaskService } from "@/lib/agent-tasks";
import { parseCreateTaskRequest, parseListTasksRequest } from "@/lib/agent-tasks/contract";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";

/**
 * Agent tasks: list a project's, or record one (Project Manager real task core).
 *
 *   GET  /api/agent-tasks?project=<id>[&status=<status>][&limit=n]
 *   GET  /api/agent-tasks?project=<id>&view=cited-priority
 *        the project's priority changes that cite a Director run (checkpoint 6.7)
 *   POST /api/agent-tasks   { project, title, sourceKind, sourceRef, owningAgent, priority? }
 *
 * Operators only, confirmed with the Auth server here rather than left to
 * the proxy; writes from this site's own pages only. The read is scoped to
 * one project and bounded. The write goes through the one database
 * function, which re-checks the project, the owning agent, the source's
 * provenance, the title and the priority, and inserts one row in backlog.
 * Nothing here queues a run, executes an agent or changes a page.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  if (params.has("view")) return citedPriority(params, operator.id);
  const parsed = parseListTasksRequest({ project: params.get("project"), status: params.get("status"), limit: params.get("limit") });
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(agentTaskLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const result = await agentTaskService().listTasks(parsed.filter);
    if (result.status === "unavailable") return errorResponse("unavailable", 503);
    return json({ tasks: result.tasks });
  } catch (error) {
    logFailure("agent-tasks list", error);
    return errorResponse("failed", 500);
  }
}

/** `view=cited-priority` only; a project and nothing else. Reads only. */
async function citedPriority(params: URLSearchParams, operatorId: string) {
  const keys = [...params.keys()];
  if (params.get("view") !== "cited-priority" || keys.length !== 2 || !keys.includes("project")) return errorResponse("invalid", 400);
  const parsed = parseListTasksRequest({ project: params.get("project"), status: null, limit: null });
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(agentTaskLimiter("read"), operatorId);
  if (limited) return limited;

  try {
    const result = await agentTaskService().citedPriorityChanges(parsed.filter.projectId);
    if (result.status === "unavailable") return errorResponse("unavailable", 503);
    return json({ changes: result.changes });
  } catch (error) {
    logFailure("agent-tasks cited priority", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseCreateTaskRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(agentTaskLimiter("create"), operator.id);
  if (limited) return limited;

  try {
    const result = await agentTaskService().createTask({
      projectId: parsed.projectId,
      title: parsed.title,
      sourceKind: parsed.sourceKind,
      sourceRef: parsed.sourceRef,
      owningAgent: parsed.owningAgent,
      priority: parsed.priority,
      operatorId: operator.id,
    });
    switch (result.status) {
      case "unavailable":
        return errorResponse("unavailable", 503);
      case "project-not-found":
      case "run-not-found":
      case "keyword-not-found":
        return errorResponse(result.status, 404);
      case "run-not-completed":
      case "run-not-director":
        return errorResponse(result.status, 409);
      case "created":
        return json({ status: "created", task: result.task }, 201);
    }
  } catch (error) {
    logFailure("agent-tasks create", error);
    return errorResponse("failed", 500);
  }
}
