import type { NextRequest } from "next/server";
import {
  errorResponse,
  isSameOrigin,
  json,
  limitResponse,
  logFailure,
  readJsonBody,
} from "@/lib/agent-runs/http";
import { crawlLimiter, crawlService } from "@/lib/crawl/runtime";
import type { CrawlFailureReason } from "@/lib/crawl/service";
import { getOperator } from "@/lib/auth/session";

/**
 * Discovery crawls: read the latest for a project, or start one.
 *
 *   GET  /api/crawls?project=<id>   → { crawl: Crawl | null }
 *   POST /api/crawls  { projectId } → { crawl, started }
 *
 * Operators only, confirmed with the Auth server here rather than left to the
 * proxy, because a Server Action or a route is reachable by a direct POST. The
 * request names a project and nothing else: the site comes from that project's
 * stored domain and through the URL policy, so this endpoint cannot be used to
 * make the server fetch an address of the caller's choosing.
 *
 * The HTTP helpers are the agent runtime's, deliberately: body limits,
 * same-origin, rate-limit responses and failure logging are the same problem
 * here, and a second set of them would be a second thing to keep right.
 *
 * A pass runs inside this request — there is no background queue for crawls
 * yet — so the route is given the same 300-second ceiling the worker routes
 * use, and the runtime's own budget is set to finish inside it.
 */

export const maxDuration = 300;

/** One start at a time per operator, before the shared limit is even read. */
const inFlight = new Set<string>();

const FAILURE_STATUS: Readonly<Record<CrawlFailureReason, number>> = {
  invalid: 400,
  "unknown-project": 404,
  "site-refused": 422,
  unavailable: 503,
};

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const projectId = request.nextUrl.searchParams.get("project");
  if (projectId === null) return errorResponse("bad-request", 400);

  try {
    const limited = await limitResponse(crawlLimiter("read"), operator.id);
    if (limited) return limited;

    const result = await crawlService().latestForProject(projectId);
    return result.ok
      ? json({ crawl: result.crawl })
      : json({ error: result.reason }, FAILURE_STATUS[result.reason]);
  } catch (error) {
    logFailure("crawls read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  if (inFlight.has(operator.id)) return errorResponse("rate-limited", 429);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const projectId =
    typeof body.value === "object" && body.value !== null
      ? (body.value as Record<string, unknown>).projectId
      : undefined;

  inFlight.add(operator.id);
  try {
    const limited = await limitResponse(crawlLimiter("start"), operator.id);
    if (limited) return limited;

    const result = await crawlService().startDiscovery(operator.id, projectId);
    if (!result.ok) return json({ error: result.reason }, FAILURE_STATUS[result.reason]);
    // 200 rather than 201 when the caller joined a pass that was already in
    // flight: nothing new was created.
    return json({ crawl: result.crawl, started: result.started }, result.started ? 201 : 200);
  } catch (error) {
    logFailure("crawls start", error);
    return errorResponse("failed", 500);
  } finally {
    inFlight.delete(operator.id);
  }
}
