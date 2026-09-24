import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { findingsReadRequest } from "@/lib/crawl/findings/request";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";

/**
 * The deterministic findings recorded for one of a project's own crawls.
 *
 *   GET /api/crawls/<id>/findings?project=<id>
 *
 * Read-only, operators only. Nothing here writes, computes or reaches out to
 * a website: it reports what was recorded when the crawl finished (T3), and
 * only for the project named, so a crawl id alone reads nothing. A crawl
 * with nothing recorded answers `not-recorded` with the crawl's own status,
 * never an empty report that could be read as a clean site.
 */

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ crawlId: string }> },
) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const { crawlId } = await context.params;
  const parsed = findingsReadRequest(crawlId, request.nextUrl.searchParams.get("project"));
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(crawlLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const read = await crawlService().getCrawlFindings(parsed.projectId, parsed.crawlId);
    switch (read.status) {
      case "unavailable":
        return errorResponse("unavailable", 503);
      case "not-found":
        return errorResponse("not-found", 404);
      case "not-recorded":
        return json({ status: "not-recorded", crawl: read.crawl });
      case "recorded":
        return json({ status: "recorded", crawl: read.crawl, report: read.report });
    }
  } catch (error) {
    logFailure("crawl findings read", error);
    return errorResponse("failed", 500);
  }
}
