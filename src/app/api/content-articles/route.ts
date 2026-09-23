import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { articleService } from "@/lib/content/articles";

/**
 * Articles, read side.
 *
 *   GET /api/content-articles?project=<id>
 *     → { workspace: { articles, planCandidates, sourceCandidates } }
 *
 * What the article panel needs: the project's articles with every stored
 * version, each version's text parsed from its canonical form and checked
 * against its stored hash, and its source provenance; the completed content
 * plan runs that have no article yet; and the project's draft versions with
 * the hashes the server computes for them. Reads, never writes: nothing here
 * can create, change, fact-check, approve or publish anything. Operators
 * only, private, uncached. Writes go through the Server Actions in
 * `app/(app)/projects/article-actions`.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (project === null) return errorResponse("invalid", 400);

  try {
    const result = await articleService().getWorkspace(project);
    if (!result.ok) return errorResponse(result.reason, result.reason === "invalid" ? 400 : 503);
    return json({ workspace: result.workspace });
  } catch (error) {
    logFailure("content-articles read", error);
    return errorResponse("failed", 500);
  }
}
