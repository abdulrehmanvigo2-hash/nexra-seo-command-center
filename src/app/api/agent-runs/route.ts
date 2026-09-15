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
 * Agent runs: list them, or queue a new one.
 *
 *   GET  /api/agent-runs?project=<id>[&limit=n]
 *   GET  /api/agent-runs?agent=<id>[&limit=n]
 *   POST /api/agent-runs   { projectId, agentId, taskType, input }
 *
 * Operators only, confirmed with the Auth server here rather than left to the
 * proxy. Creating a run only queues it; nothing executes until it is started
 * (`POST /api/agent-runs/<id>` with `{ "action": "execute" }`).
 *
 * An identical request that is already queued or running is not queued twice:
 * the existing run comes back with `duplicate: true` and a 200 instead of 201.
 * Creates are limited per operator — one at a time, and 30 per ten minutes,
 * held in this process's memory.
 */

const createsPerOperator = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1_000 });
const inFlight = new Set<string>();

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  const project = params.get("project");
  const agent = params.get("agent");
  const limit = params.get("limit");
  const filter = {
    ...(project !== null ? { projectId: project } : {}),
    ...(agent !== null ? { agentId: agent } : {}),
    ...(limit !== null ? { limit: /^\d{1,3}$/.test(limit) ? Number(limit) : Number.NaN } : {}),
  };

  try {
    const result = await agentRunService().listRuns(filter);
    return result.ok ? json({ runs: result.runs }) : failureResponse(result);
  } catch (error) {
    logFailure("agent-runs list", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  if (inFlight.has(operator.id)) return errorResponse("rate-limited", 429);
  const allowance = createsPerOperator.consume(operator.id);
  if (!allowance.allowed) {
    const response = errorResponse("rate-limited", 429);
    response.headers.set("Retry-After", String(Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000))));
    return response;
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  inFlight.add(operator.id);
  try {
    const result = await agentRunService().createRun(operator.id, body.value);
    if (!result.ok) return failureResponse(result);
    return json({ run: result.run, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  } catch (error) {
    logFailure("agent-runs create", error);
    return errorResponse("failed", 500);
  } finally {
    inFlight.delete(operator.id);
  }
}
