import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { latestFindingsReadRequest } from "@/lib/crawl/findings/triage/request";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { projectRepository } from "@/lib/projects/repository";

/**
 * The most recently recorded findings of one project's own crawls, with the
 * decisions recorded against them (milestone M3).
 *
 *   GET /api/crawls/latest-findings?project=<id>
 *
 * Read-only, operators only. Nothing here writes, computes or reaches out to
 * a website: it reports what was recorded when the newest reviewed crawl
 * finished (T3) and what operators have since decided (M3), for the project
 * named and no other. A project with nothing recorded answers `none`, never
 * an empty report that could be read as a clean site.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const parsed = latestFindingsReadRequest(request.nextUrl.searchParams.get("project"));
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(crawlLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const project = await projectRepository.getProjectById(parsed.projectId);
    if (project === null) return errorResponse("not-found", 404);

    const read = await crawlService().getLatestCrawlFindings(parsed.projectId);
    switch (read.status) {
      case "unavailable":
        return errorResponse("unavailable", 503);
      case "none":
        return json({ status: "none" });
      case "recorded":
        return json({ status: "recorded", crawl: read.crawl, report: read.report, triage: read.triage });
    }
  } catch (error) {
    logFailure("latest crawl findings read", error);
    return errorResponse("failed", 500);
  }
}
