import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { parseTriageSetRequest } from "@/lib/crawl/findings/triage/contract";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";

/**
 * One operator's decision about one recorded finding of one of a project's
 * own crawls (milestone M3).
 *
 *   POST /api/crawls/<id>/findings/triage   { project, findingKey, status, note? }
 *
 * Operators only, from this site's own pages only. The body names the
 * project, the finding by its stable key, one of the four statuses and an
 * optional note; any other field is refused. The decision is written
 * through the one database function, which checks again that the crawl is
 * the project's and the finding recorded, and never changes the finding.
 * Nothing here fixes a page, dispatches an agent or resolves anything on
 * its own.
 */

export async function POST(request: NextRequest, context: { params: Promise<{ crawlId: string }> }) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const { crawlId } = await context.params;
  const parsed = parseTriageSetRequest(crawlId, body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(crawlLimiter("triage"), operator.id);
  if (limited) return limited;

  try {
    const result = await crawlService().setFindingTriage({
      projectId: parsed.projectId,
      crawlId: parsed.crawlId,
      findingKey: parsed.findingKey,
      status: parsed.status,
      note: parsed.note,
      operatorId: operator.id,
    });
    switch (result.status) {
      case "unavailable":
        return errorResponse("unavailable", 503);
      case "not-found":
        return errorResponse("not-found", 404);
      case "not-recorded":
        return errorResponse("not-recorded", 404);
      case "set":
        return json({ status: "set", previous: result.previous, triage: result.triage });
    }
  } catch (error) {
    logFailure("crawl finding triage", error);
    return errorResponse("failed", 500);
  }
}
