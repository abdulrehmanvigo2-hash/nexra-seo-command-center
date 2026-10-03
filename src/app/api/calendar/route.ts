import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { calendarLimiter, calendarService } from "@/lib/calendar";
import { isCalendarProjectId, parseCalendarRequest } from "@/lib/calendar/contract";
import { logEvent } from "@/lib/observability/log";
import { projectRepository } from "@/lib/projects/repository";

/**
 * The content calendar (M3, PR 3): read a project's planned work with each item's stage, set a task's planned date, or
 * link a task to its article.
 *
 *   GET  /api/calendar?project=<id>
 *   POST /api/calendar   { project, action: "set-date", taskId, date } | { project, action: "link-article", taskId, articleId }
 *
 * Operators only, confirmed with the Auth server here; the writes from this site's own pages only. Each write is one
 * database function that locks the task and appends its event; nothing runs an agent, changes an article or
 * publishes. "Not set up" (the migration not applied, or no store) is a 503 the screen reads as a calm state.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (!isCalendarProjectId(project)) return errorResponse("bad-request", 400);

  const limited = await limitResponse(calendarLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const result = await calendarService().read(project);
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({ view: result.view });
  } catch (error) {
    logFailure("calendar read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseCalendarRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(calendarLimiter("write"), operator.id);
  if (limited) return limited;

  try {
    if ((await projectRepository.getProjectById(parsed.projectId)) === null) return errorResponse("project-not-found", 404);
    const started = Date.now();
    const result =
      parsed.action === "set-date"
        ? await calendarService().setDate(parsed.projectId, parsed.taskId, parsed.date, operator.id)
        : await calendarService().linkArticle(parsed.projectId, parsed.taskId, parsed.articleId, operator.id);
    logEvent("info", `calendar.${parsed.action}`, { projectId: parsed.projectId, outcome: result.status, durationMs: Date.now() - started });
    switch (result.status) {
      case "plan-date-changed":
      case "article-linked":
        return json({ status: result.status });
      case "same-date":
      case "same-article":
        return json({ status: result.status });
      case "not-set-up":
        return errorResponse("not-set-up", 503);
      case "task-not-found":
      case "article-not-found":
        return errorResponse(result.status, 404);
      case "terminal":
        return errorResponse("terminal", 409);
    }
  } catch (error) {
    logFailure(`calendar ${parsed.action}`, error);
    return errorResponse("failed", 500);
  }
}
