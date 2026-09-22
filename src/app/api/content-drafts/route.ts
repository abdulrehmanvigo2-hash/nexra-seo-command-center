import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { draftService } from "@/lib/content/drafts";

/**
 * Content drafts, read side.
 *
 *   GET /api/content-drafts?project=<id>&writerRun=<uuid>
 *     → { draft: { draft, version } | null }
 *
 * The one read the Save-as-draft control needs: whether the Writer run on
 * screen has already been saved, so a page load restores the draft instead
 * of offering to create it again. A read, never a write: nothing here can
 * create, change or publish anything. Operators only, private, uncached.
 * Writes go through the Server Action in `app/(app)/projects/draft-actions`.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  const project = params.get("project");
  const writerRun = params.get("writerRun");
  if (project === null || writerRun === null) return errorResponse("invalid", 400);

  try {
    const result = await draftService().findForWriterRun(project, writerRun);
    if (!result.ok) return errorResponse(result.reason, result.reason === "invalid" ? 400 : 503);
    return json({ draft: result.saved });
  } catch (error) {
    logFailure("content-drafts read", error);
    return errorResponse("failed", 500);
  }
}
