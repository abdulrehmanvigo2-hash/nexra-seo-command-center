import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { readCompetitorList, readCompetitorOverview, type CompetitorOverviewReaders, type OverviewRefusal } from "@/lib/crawl/competitor-overview";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";

/**
 * The Competitor Intelligence screen's one read (Phase 4, checkpoint 4.4).
 *
 *   GET /api/crawls/competitor-overview?project=<id>
 *   GET /api/crawls/competitor-overview?project=<id>&competitor=<host>
 *
 * Read-only, operators only. The project is checked before anything is read,
 * and a competitor must be one of the domains the project's stored record
 * lists — resolved by the comparison reader's own rule, so another project's
 * competitor, the project's own site, a URL or an unrecorded domain is
 * refused. Without a competitor: the recorded competitors, each with its
 * newest crawl. With one: the project's newest own-site crawl beside that
 * competitor's newest crawl, each reduced to what its fetched pages
 * declared, or "not crawled". Nothing is fetched from a website to answer it.
 */

/** A competitor host as the request names it: a bounded string, checked properly by the reader. */
const COMPETITOR_INPUT = /^[a-z0-9.-]{1,253}$/i;

const REFUSAL_STATUS: Readonly<Record<OverviewRefusal, number>> = {
  "project-not-found": 404,
  "no-domain": 422,
  "competitor-invalid": 422,
  "competitor-not-recorded": 422,
  "competitor-is-project-site": 422,
};

function readers(): CompetitorOverviewReaders {
  return {
    getProjectById: (id) => projectRepository.getProjectById(id),
    getProjectIntake: (id) => projectRepository.getProjectIntake(id),
    listProjectCrawls: (projectId) => crawlService().listCrawls(projectId, 1),
    listCompetitorCrawls: async (projectId, host) => {
      const listed = await crawlService().listCompetitorCrawls(projectId, host, 1);
      return listed.ok ? listed.crawls : [];
    },
    crawls: crawlService(),
  };
}

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (project === null || !isStorableProjectId(project)) return errorResponse("invalid", 400);
  const competitor = request.nextUrl.searchParams.get("competitor");
  if (competitor !== null && !COMPETITOR_INPUT.test(competitor)) return errorResponse("invalid", 400);

  const limited = await limitResponse(crawlLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    if ((await projectRepository.getProjectById(project)) === null) return errorResponse("not-found", 404);
    const result =
      competitor === null
        ? await readCompetitorList(readers(), project)
        : await readCompetitorOverview(readers(), { projectId: project, competitorDomain: competitor });
    return result.ok ? json(result.view) : errorResponse(result.reason, REFUSAL_STATUS[result.reason]);
  } catch (error) {
    logFailure("competitor overview read", error);
    return errorResponse("failed", 500);
  }
}
