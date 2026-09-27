import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { keywordLimiter, keywordService } from "@/lib/keywords";
import { parseAddKeywordsRequest, parseListKeywordsRequest } from "@/lib/keywords/contract";

/**
 * Curated keywords: list a project's, or add some (Phase 3, checkpoint 3.5).
 *
 *   GET  /api/keywords?project=<id>[&status=<status>]
 *   POST /api/keywords   { project, queries: [...], groupLabel?, note?, targetPage? }
 *
 * Operators only, confirmed with the Auth server here; writes from this
 * site's own pages only. The list is one project's, bounded, each keyword
 * with its link to the stored Search Console rows by exact query text. The
 * write adds up to 100 exact queries, one database function call each,
 * which re-checks the project and the target's host. Nothing here runs an
 * agent or reads a figure into a keyword.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  const parsed = parseListKeywordsRequest({ project: params.get("project"), status: params.get("status") });
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(keywordLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const result = await keywordService().listKeywords(parsed.projectId, parsed.status);
    if (result.status === "unavailable") return errorResponse("unavailable", 503);
    return json({ keywords: result.keywords });
  } catch (error) {
    logFailure("keywords list", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseAddKeywordsRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(keywordLimiter("write"), operator.id);
  if (limited) return limited;

  try {
    const result = await keywordService().addKeywords(parsed.projectId, parsed.entries, operator.id);
    switch (result.status) {
      case "unavailable":
        return errorResponse("unavailable", 503);
      case "project-not-found":
        return errorResponse("project-not-found", 404);
      case "recorded":
        return json({ status: "recorded", results: result.results }, 201);
    }
  } catch (error) {
    logFailure("keywords add", error);
    return errorResponse("failed", 500);
  }
}
