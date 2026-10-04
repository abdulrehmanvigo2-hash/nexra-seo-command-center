import type { NextRequest } from "next/server";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { crawlLimiter } from "@/lib/crawl";
import { overviewReadRequest } from "@/lib/crawl/overview/contract";
import { readInternalLinks } from "@/lib/internal-links";
import { projectRepository } from "@/lib/projects/repository";

/**
 * Internal-link suggestions over the newest own-site crawl (M8, PR 5).
 *
 *   GET /api/internal-links?project=<id>
 *
 * Operators only; read-only; the crawl read limit; the project checked before anything is read. Computed on read by
 * fixed rules from stored records: no page is fetched, no model is called, nothing is written.
 */
export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const parsed = overviewReadRequest(request.nextUrl.searchParams.get("project"));
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const limited = await limitResponse(crawlLimiter("read"), operator.id);
  if (limited) return limited;
  try {
    if ((await projectRepository.getProjectById(parsed.projectId)) === null) return errorResponse("not-found", 404);
    const view = await readInternalLinks(parsed.projectId);
    if (view.status === "unavailable") return errorResponse("unavailable", 503);
    return json({ view });
  } catch (error) {
    logFailure("internal links read", error);
    return errorResponse("failed", 500);
  }
}
