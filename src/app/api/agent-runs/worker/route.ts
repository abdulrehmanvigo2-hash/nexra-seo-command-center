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
 * The agent-run worker, triggered by hand.
 *
 *   POST /api/agent-runs/worker   { "action": "recover-stale" }  → { recovered: [{ runId, attemptNumber }] }
 *   POST /api/agent-runs/worker   { "action": "run-next" }       → { run | null }
 *
 * `recover-stale` fails up to 25 attempts whose lease has expired — their
 * worker crashed, timed out, or was stopped — with `lease-expired`. It never
 * completes a run or re-queues one; retrying stays an explicit action within
 * the run's attempt limit. Calling it again finds nothing new.
 *
 * `run-next` claims the oldest queued run that no other worker holds and runs
 * one attempt with the mock executor inside this request.
 *
 * Nothing calls this on a schedule. It exists so recovery and the worker path
 * can be exercised now, and it is what a scheduled job or queue consumer will
 * replace — calling the worker module directly, with its own credentials.
 *
 * Operators only, confirmed with the Auth server; same-origin; one worker
 * action per operator at a time, and 30 per ten minutes.
 */

const ACTIONS = ["recover-stale", "run-next"] as const;
type Action = (typeof ACTIONS)[number];

const actionsPerOperator = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1_000 });
const inFlight = new Set<string>();

function parseAction(body: unknown): Action | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "action") return null;
  const action = (body as { action: unknown }).action;
  return ACTIONS.find((entry) => entry === action) ?? null;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  if (inFlight.has(operator.id)) return errorResponse("rate-limited", 429);
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

  inFlight.add(operator.id);
  try {
    const service = agentRunService();
    switch (action) {
      case "recover-stale": {
        const result = await service.recoverStaleRuns();
        return result.ok ? json({ recovered: result.recovered }) : failureResponse(result);
      }
      case "run-next": {
        const result = await service.executeNextRun();
        return result.ok ? json({ run: result.run }) : failureResponse(result);
      }
    }
  } catch (error) {
    logFailure(`agent-runs worker ${action}`, error);
    return errorResponse("failed", 500);
  } finally {
    inFlight.delete(operator.id);
  }
}
