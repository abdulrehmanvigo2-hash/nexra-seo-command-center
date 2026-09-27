import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { keywordLimiter, keywordService } from "@/lib/keywords";
import { isKeywordId, parseKeywordActionRequest } from "@/lib/keywords/contract";

/**
 * One curated keyword (Phase 3, checkpoint 3.5).
 *
 *   POST /api/keywords/<id>   { project, action: "status" | "group" | "target" | "note", value }
 *
 * Operators only, same origin, under the write limit. The keyword is reached
 * only through the project named beside it, so another project's keyword
 * answers keyword-not-found; the database function locks the row, changes
 * its one field and appends one event. The keyword's detail is read by the
 * `/keywords/<id>` page on the server, not through this route.
 */

type Context = { params: Promise<{ keywordId: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const { keywordId } = await context.params;
  if (!isKeywordId(keywordId)) return errorResponse("invalid", 400);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseKeywordActionRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(keywordLimiter("write"), operator.id);
  if (limited) return limited;

  try {
    const result = await keywordService().act({ projectId: parsed.projectId, keywordId: keywordId.toLowerCase(), action: parsed.action, value: parsed.value, operatorId: operator.id });
    switch (result.status) {
      case "unavailable":
        return errorResponse("unavailable", 503);
      case "keyword-not-found":
        return errorResponse("keyword-not-found", 404);
      case "target-off-host":
        return errorResponse("target-off-host", 409);
      case "unchanged":
        return json({ status: "unchanged", keyword: result.keyword });
      case "changed":
        return json({ status: "changed", keyword: result.keyword, event: result.event });
    }
  } catch (error) {
    logFailure("keywords action", error);
    return errorResponse("failed", 500);
  }
}
