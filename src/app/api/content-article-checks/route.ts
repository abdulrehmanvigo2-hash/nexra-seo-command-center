import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { articleCheckService } from "@/lib/content/articles/checks";

/**
 * Article check units, read side (Stage 5, milestone C4).
 *
 *   GET /api/content-article-checks?project=<id>&article=<uuid>&version=<n>
 *     → { checks: { units, state, counts, … } }
 *
 * One exact article version's check units — regenerated on the server from
 * the version's stored canonical text, each with its identity, hash, size
 * and the row recorded for it, if any — and the version's check state,
 * derived from those rows. Reads, never writes: nothing here can queue,
 * record, approve or publish anything. Operators only, private, uncached.
 * Recording goes through the Server Action in
 * `app/(app)/projects/article-check-actions`.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  const project = params.get("project");
  const article = params.get("article");
  const version = Number(params.get("version"));
  if (project === null || article === null) return errorResponse("invalid", 400);

  try {
    const result = await articleCheckService().getVersionChecks(project, article, version);
    if (!result.ok) {
      const status = result.reason === "invalid" ? 400 : result.reason === "unavailable" ? 503 : result.reason === "version-unreadable" ? 500 : 404;
      return errorResponse(result.reason, status);
    }
    return json({ checks: result.checks });
  } catch (error) {
    logFailure("content-article-checks read", error);
    return errorResponse("failed", 500);
  }
}
