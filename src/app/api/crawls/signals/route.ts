import type { NextRequest } from "next/server";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { crawlLimiter, crawlService } from "@/lib/crawl/runtime";
import type { CrawlFailureReason } from "@/lib/crawl/service";
import { getOperator } from "@/lib/auth/session";

/**
 * What the latest crawl read out of a project's pages.
 *
 *   GET /api/crawls/signals?project=<id> → { crawl, signals }
 *
 * Read-only, operators only, and named by project — the same shape as the
 * crawl status route beside it, and for the same reason: the caller says which
 * project it is looking at, and nothing else about what the server reads.
 *
 * Separate from `GET /api/crawls` deliberately. That route is polled every few
 * seconds while a pass runs, and a few hundred rows of signals do not belong
 * in a poll; this one is read once a pass has something to show.
 */

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

    const result = await crawlService().signalsForProject(projectId);
    return result.ok
      ? json({ crawl: result.crawl, signals: result.signals })
      : json({ error: result.reason }, FAILURE_STATUS[result.reason]);
  } catch (error) {
    logFailure("crawl signals read", error);
    return errorResponse("failed", 500);
  }
}
