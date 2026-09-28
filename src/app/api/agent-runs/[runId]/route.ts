import type { NextRequest } from "next/server";
import { agentRunLimiter, agentRunService } from "@/lib/agent-runs";
import {
  errorResponse,
  failureResponse,
  isSameOrigin,
  json,
  limitResponse,
  logFailure,
  readJsonBody,
  heldByCapResponse,
} from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";

/**
 * One agent run: read it, or move it through its lifecycle.
 *
 *   GET  /api/agent-runs/<id>   → { run, attempts }
 *   POST /api/agent-runs/<id>   { "action": "execute" | "cancel" | "retry" }
 *
 * `attempts` is the run's execution history, oldest first; leases and worker
 * labels are not part of it. `execute` claims a queued run and runs one
 * attempt with the configured executor, under a lease, before answering; if this
 * request dies first, the lease expires and recovery fails the attempt (see
 * `/api/agent-runs/worker`). `cancel` stops a queued or running run; `retry`
 * puts a failed run back in the queue while it has attempts left. A request
 * that does not fit the run's current state gets 409 with that state.
 *
 * Operators only, confirmed with the Auth server. Actions are limited per
 * operator: 60 per ten minutes, shared by every instance through Postgres, and
 * one execution at a time per process.
 */

/** An AI attempt may take two minutes; the platform must not cut it off first. */
export const maxDuration = 300;

const ACTIONS = ["execute", "cancel", "retry"] as const;
type Action = (typeof ACTIONS)[number];

const executing = new Set<string>();

function parseAction(body: unknown): Action | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "action") return null;
  const action = (body as { action: unknown }).action;
  return ACTIONS.find((entry) => entry === action) ?? null;
}

export async function GET(_request: NextRequest, context: RouteContext<"/api/agent-runs/[runId]">) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const { runId } = await context.params;
  try {
    const service = agentRunService();
    const result = await service.getRun(runId);
    if (!result.ok) return failureResponse(result);
    const history = await service.listAttempts(runId);
    return history.ok ? json({ run: result.run, attempts: history.attempts }) : failureResponse(history);
  } catch (error) {
    logFailure("agent-runs read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest, context: RouteContext<"/api/agent-runs/[runId]">) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const action = parseAction(body.value);
  if (!action) return errorResponse("bad-request", 400);

  const { runId } = await context.params;
  const service = agentRunService();

  try {
    const limited = await limitResponse(agentRunLimiter("action"), operator.id);
    if (limited) return limited;

    switch (action) {
      case "execute": {
        if (executing.has(operator.id)) return errorResponse("rate-limited", 429);
        executing.add(operator.id);
        try {
          const result = await service.executeRun(runId);
          if (result.ok) return json({ run: result.run });
          return result.reason === "daily-cap" ? heldByCapResponse(result) : failureResponse(result);
        } finally {
          executing.delete(operator.id);
        }
      }
      case "cancel": {
        const result = await service.cancelRun(operator.id, runId);
        return result.ok ? json({ run: result.run }) : failureResponse(result);
      }
      case "retry": {
        const result = await service.retryRun(runId);
        return result.ok ? json({ run: result.run }) : failureResponse(result);
      }
    }
  } catch (error) {
    logFailure(`agent-runs ${action}`, error);
    return errorResponse("failed", 500);
  }
}
