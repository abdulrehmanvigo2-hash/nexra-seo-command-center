import type { NextRequest } from "next/server";
import { agentTaskLimiter, agentTaskService } from "@/lib/agent-tasks";
import { isTaskId, parseTaskActionRequest } from "@/lib/agent-tasks/contract";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";

/**
 * One agent task: read it with its history, or change it (Project Manager
 * task workflow).
 *
 *   GET  /api/agent-tasks/<id>?project=<id>            → { task, events, outcome }
 *   POST /api/agent-tasks/<id>  { project, action: "status", status }
 *                               { project, action: "owner", owningAgent }
 *                               { project, action: "handoff" }
 *
 * Operators only, confirmed with the Auth server; writes from this site's
 * own pages only; sixty actions per operator per ten minutes. Every call
 * names the project beside the task, and the database answers
 * `task-not-found` for a task of another project, never which. A status
 * moves only along the fixed transition map; an owner is one of the twelve
 * registry agents; a handoff names no agent, task type or input — the server
 * maps the owning agent to its one supported task or refuses — and creates
 * at most one queued run, which nothing here executes. The read's `outcome`
 * is what became of the newest handoff, computed now from the linked run and
 * shown only when that run is provably this task's; it writes nothing and
 * never changes the task's status.
 */

const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export async function GET(request: NextRequest, context: RouteContext<"/api/agent-tasks/[taskId]">) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const { taskId } = await context.params;
  const project = request.nextUrl.searchParams.get("project");
  if (!isTaskId(taskId) || project === null || project.length > 64 || !PROJECT_ID.test(project)) return errorResponse("invalid", 400);

  const limited = await limitResponse(agentTaskLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const service = agentTaskService();
    const result = await service.readTask(project, taskId.toLowerCase());
    switch (result.status) {
      case "unavailable":
        return errorResponse("unavailable", 503);
      case "task-not-found":
        return errorResponse("task-not-found", 404);
      case "found":
        return json({ task: result.task, events: result.events, outcome: await service.readOutcome(result.task, result.events) });
    }
  } catch (error) {
    logFailure("agent-tasks read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest, context: RouteContext<"/api/agent-tasks/[taskId]">) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const { taskId } = await context.params;
  if (!isTaskId(taskId)) return errorResponse("invalid", 400);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseTaskActionRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(agentTaskLimiter("action"), operator.id);
  if (limited) return limited;

  const base = { projectId: parsed.projectId, taskId: taskId.toLowerCase(), operatorId: operator.id };
  try {
    const service = agentTaskService();
    switch (parsed.action) {
      case "status": {
        const result = await service.changeStatus({ ...base, status: parsed.status });
        switch (result.status) {
          case "unavailable":
            return errorResponse("unavailable", 503);
          case "task-not-found":
            return errorResponse(result.status, 404);
          case "same-status":
          case "terminal":
          case "transition-not-allowed":
            return json({ error: result.status, task: result.task }, 409);
          case "transitioned":
            return json({ status: result.status, task: result.task, event: result.event });
        }
        break;
      }
      case "owner": {
        const result = await service.changeOwner({ ...base, owningAgent: parsed.owningAgent });
        switch (result.status) {
          case "unavailable":
            return errorResponse("unavailable", 503);
          case "task-not-found":
            return errorResponse(result.status, 404);
          case "same-owner":
          case "terminal":
            return json({ error: result.status, task: result.task }, 409);
          case "owner-changed":
            return json({ status: result.status, task: result.task, event: result.event });
        }
        break;
      }
      case "handoff": {
        const result = await service.handoff(base);
        switch (result.status) {
          case "unavailable":
            return errorResponse("unavailable", 503);
          case "task-not-found":
            return errorResponse(result.status, 404);
          case "terminal":
          case "handoff-unsupported":
            return json({ error: result.status, task: result.task }, 409);
          case "handoff-active":
            return json({ error: result.status, task: result.task, runId: result.runId }, 409);
          case "run-refused":
            return json({ error: result.status, task: result.task, reason: result.reason }, 409);
          case "handed-off":
            return json({ status: result.status, task: result.task, run: result.run, duplicate: result.duplicate }, 201);
        }
        break;
      }
    }
    return errorResponse("invalid", 400);
  } catch (error) {
    logFailure("agent-tasks action", error);
    return errorResponse("failed", 500);
  }
}
