import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import {
  errorResponse,
  isSameOrigin,
  json,
  limitResponse,
  logFailure,
  readJsonBody,
} from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import type { CrawlFailureReason } from "@/types/crawl";

/**
 * Crawls: list a project's crawls, or run one.
 *
 *   GET  /api/crawls?project=<id>[&limit=n]
 *   POST /api/crawls   { projectId }
 *
 * Operators only, confirmed with the Auth server here rather than left to the
 * proxy. The body carries a project id and nothing else — the site to crawl
 * comes from that project's stored domain, so no request can point this
 * crawler at an arbitrary URL.
 *
 * `POST` runs the crawl inside this request and answers when it has finished
 * or hit a budget. Nothing runs detached, and there is no schedule: a crawl
 * happens because an operator asked for one, and never otherwise.
 *
 * Crawling is off unless the server sets `CRAWL_ENABLED` and lists the
 * project's host in `CRAWL_ALLOWED_HOSTS`; otherwise every call here answers
 * `disabled` or `host-not-allowed` without making a single outbound request.
 */

const FAILURE_STATUS: Readonly<Record<CrawlFailureReason, number>> = {
  disabled: 503,
  "host-not-allowed": 403,
  "unknown-project": 404,
  "no-domain": 422,
  "blocked-by-robots": 422,
  "start-unreachable": 502,
  "start-unsafe": 422,
  unavailable: 503,
};

/** One crawl at a time per operator, on top of the shared window limit. */
const inFlight = new Set<string>();

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (project === null || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(project)) {
    return errorResponse("invalid", 400);
  }

  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit !== null && /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : 25;

  const limited = await limitResponse(crawlLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    return json({ crawls: await crawlService().listCrawls(project, Math.min(limit, 100)) });
  } catch (error) {
    logFailure("crawls list", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const payload = body.value;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return errorResponse("invalid", 400);
  }
  const projectId = (payload as { projectId?: unknown }).projectId;
  if (typeof projectId !== "string" || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(projectId)) {
    return errorResponse("invalid", 400);
  }

  if (inFlight.has(operator.id)) return errorResponse("rate-limited", 429);
  const limited = await limitResponse(crawlLimiter("start"), operator.id);
  if (limited) return limited;

  inFlight.add(operator.id);
  try {
    const result = await crawlService().startCrawl(projectId, operator.id);
    return result.ok
      ? json({ crawl: result.crawl }, 201)
      : json({ error: result.failure.reason }, FAILURE_STATUS[result.failure.reason]);
  } catch (error) {
    logFailure("crawl start", error);
    return errorResponse("failed", 500);
  } finally {
    inFlight.delete(operator.id);
  }
}
