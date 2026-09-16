import type { NextRequest } from "next/server";
import { agentRunService } from "@/lib/agent-runs";
import {
  errorResponse,
  failureResponse,
  isSameOrigin,
  json,
  logFailure,
  readJsonBody,
} from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { createRateLimiter } from "@/lib/security/rate-limit";

/**
 * One agent run: read it, or move it through its lifecycle.
 *
 *   GET  /api/agent-runs/<id>   → { run, attempts }
 *   POST /api/agent-runs/<id>   { "action": "execute" | "cancel" | "retry" }
 *
 * `attempts` is the run's execution history, oldest first; leases and worker
 * labels are not part of it. `execute` claims a queued run and runs one
 * attempt with the mock executor, under a lease, before answering; if this
 * request dies first, the lease expires and recovery fails the attempt (see
 * `/api/agent-runs/worker`). `cancel` stops a queued or running run; `retry`
 * puts a failed run back in the queue while it has attempts left. A request
 * that does not fit the run's current state gets 409 with that state.
 *
 * Operators only, confirmed with the Auth server. Actions are limited per
 * operator — one execution at a time, and 60 actions per ten minutes.
 */

const ACTIONS = ["execute", "cancel", "retry"] as const;
type Action = (typeof ACTIONS)[number];

const actionsPerOperator = createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1_000 });
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

  const allowance = actionsPerOperator.consume(operator.id);
  if (!allowance.allowed) {
    const response = errorResponse("rate-limited", 429);
    response.headers.set("Retry-After", String(Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000))));
    return response;
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const action = parseAction(body.value);
  if (!action) return errorResponse("bad-request", 400);

  const { runId } = await context.params;
  const service = agentRunService();

  try {
    switch (action) {
      case "execute": {
        if (executing.has(operator.id)) return errorResponse("rate-limited", 429);
        executing.add(operator.id);
        try {
          const result = await service.executeRun(runId);
          return result.ok ? json({ run: result.run }) : failureResponse(result);
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
