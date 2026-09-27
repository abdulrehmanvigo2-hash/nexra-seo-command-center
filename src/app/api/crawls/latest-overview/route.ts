import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { overviewReadRequest } from "@/lib/crawl/overview/contract";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { projectRepository } from "@/lib/projects/repository";

/**
 * The project's latest own-site crawl, as the live Technical SEO screen
 * reads it (Phase 3, checkpoint 3.2).
 *
 *   GET /api/crawls/latest-overview?project=<id>
 *
 * Read-only, operators only, the project checked before anything is read:
 * the crawl is found by the project's own host, so neither another project's
 * crawl nor a competitor's can answer. It returns the crawl, its pages
 * (bounded), a summary of its recorded link edges and its findings at the
 * current rule version. Nothing is fetched from a website to answer it, and
 * a project with no crawl answers `none`, never an empty crawl.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const parsed = overviewReadRequest(request.nextUrl.searchParams.get("project"));
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(crawlLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const project = await projectRepository.getProjectById(parsed.projectId);
    if (project === null) return errorResponse("not-found", 404);

    const overview = await crawlService().getLatestCrawlOverview(parsed.projectId);
    if (overview.status === "unavailable") return errorResponse("unavailable", 503);
    return json(overview);
  } catch (error) {
    logFailure("latest crawl overview read", error);
    return errorResponse("failed", 500);
  }
}
