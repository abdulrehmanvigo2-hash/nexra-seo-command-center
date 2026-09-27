import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { OVERVIEW_LINK_LIMIT, overviewReadRequest } from "@/lib/crawl/overview/contract";
import { coverageBanner } from "@/lib/crawl/overview/present";
import { presentOutbound, type LatestOutbound } from "@/lib/authority/outbound-view";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { projectRepository } from "@/lib/projects/repository";

/**
 * The Outbound Links screen's one read (Phase 4, checkpoint 4.5).
 *
 *   GET /api/crawls/latest-outbound?project=<id>
 *
 * A new route because the latest-overview answer summarises the recorded
 * edges as counts and never carries an edge list, while this screen shows
 * each external host's rel values, source paths and anchor text. It reads
 * the same latest own-site crawl the overview does (the service's own
 * rule: confined to exactly the project's host, so a competitor crawl is
 * never it), then that crawl's recorded edges through the one bounded link
 * read, and answers the external ones grouped by host. Read-only, operators
 * only, the project checked before anything is read, the crawl read limit;
 * nothing is fetched from any website.
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
    if (overview.status === "none") return json({ status: "none" } satisfies LatestOutbound);

    const links = await crawlService().listCrawlLinks(overview.crawl.id, OVERVIEW_LINK_LIMIT);
    const answer: LatestOutbound = {
      status: "crawled",
      crawl: overview.crawl,
      banner: coverageBanner(overview.crawl, overview.pages, overview.links),
      cut: overview.links.cut,
      view: presentOutbound(links),
    };
    return json(answer);
  } catch (error) {
    logFailure("latest outbound read", error);
    return errorResponse("failed", 500);
  }
}
