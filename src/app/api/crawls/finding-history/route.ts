import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { latestFindingsReadRequest } from "@/lib/crawl/findings/triage/request";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { projectRepository } from "@/lib/projects/repository";

/**
 * Cross-crawl finding history for one project's own crawls (Phase 3,
 * checkpoint 3.3).
 *
 *   GET /api/crawls/finding-history?project=<id>
 *
 * Read-only, operators only, the project checked before the service. The
 * history is derived on read from the reports recorded when each crawl
 * finished — reports at the current rule version compared, a crawl with no
 * report shown as not recorded, nothing recomputed and nothing stored.
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

    const read = await crawlService().getFindingHistory(parsed.projectId);
    if (read.status === "unavailable") return errorResponse("unavailable", 503);
    return json(read);
  } catch (error) {
    logFailure("crawl finding history read", error);
    return errorResponse("failed", 500);
  }
}
