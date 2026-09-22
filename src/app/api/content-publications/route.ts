import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { publicationService } from "@/lib/content/publications";

/**
 * Publication proposals, read side.
 *
 *   GET /api/content-publications?project=<id>&draft=<uuid>
 *     → { state: { active, history, candidate, refusal } }
 *
 * What the draft panel's proposal section needs: the draft's active
 * proposal with its preview rebuilt from the bound version row and checked
 * against the stored hashes, the withdrawn history, and — only when the
 * current version may be proposed now — the server's own reading of that
 * version and its content hash. Reads, never writes: nothing here can
 * create, change, publish or send anything. Operators only, private,
 * uncached. Writes go through the Server Actions in
 * `app/(app)/projects/publication-actions`.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  const project = params.get("project");
  const draft = params.get("draft");
  if (project === null || draft === null) return errorResponse("invalid", 400);

  try {
    const result = await publicationService().getState(project, draft);
    if (!result.ok) {
      const status = result.reason === "invalid" ? 400 : result.reason === "not-found" ? 404 : 503;
      return errorResponse(result.reason, status);
    }
    return json({ state: result.state });
  } catch (error) {
    logFailure("content-publications read", error);
    return errorResponse("failed", 500);
  }
}
