import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { crawlLimiter } from "@/lib/crawl";
import { recordSuggestionTask } from "@/lib/internal-links";
import { parseTaskRequest } from "@/lib/internal-links/contract";

/**
 * Records one internal-link suggestion as a task (M8, PR 5).
 *
 *   POST /api/internal-links/task   { project, crawl, from, to, anchor }
 *
 * Operators only, from this site's own pages only, the crawl decision limit (as finding triage: 60 per ten minutes). One call to
 * `nexra_link_suggestion_task_create`, which checks the project's own crawl and both fetched pages and records one
 * backlog task for On-Page SEO. No page is edited.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = parseTaskRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const limited = await limitResponse(crawlLimiter("triage"), operator.id);
  if (limited) return limited;
  try {
    const result = await recordSuggestionTask(parsed.value, operator.id);
    switch (result.status) {
      case "created":
        return json({ taskId: result.taskId }, 201);
      case "not-set-up":
        return errorResponse("not-set-up", 503);
      case "project-not-found":
        return errorResponse("not-found", 404);
      case "crawl-not-found":
      case "page-not-found":
      case "same-page":
        return errorResponse(result.status, 409);
      default:
        return errorResponse("bad-request", 400);
    }
  } catch (error) {
    logFailure("internal links task", error);
    return errorResponse("failed", 500);
  }
}
