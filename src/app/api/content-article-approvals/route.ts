import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { articleApprovalService } from "@/lib/content/articles/approvals";

/**
 * Article approval, read side (Stage 5, milestone C5).
 *
 *   GET /api/content-article-approvals?project=<id>&article=<uuid>
 *     → { approval: { eligibility, history, unitCounts, … } }
 *
 * The current version's approval state — its eligibility under the rule in
 * `lib/content/articles/approvals/eligibility`, with every blocking reason,
 * and the article's immutable approval history. Reads, never writes:
 * nothing here can approve, propose or publish anything. Operators only,
 * private, uncached. Approving goes through the Server Action in
 * `app/(app)/projects/article-approval-actions`.
 */

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  const project = params.get("project");
  const article = params.get("article");
  if (project === null || article === null) return errorResponse("invalid", 400);

  try {
    const result = await articleApprovalService().getState(project, article);
    if (!result.ok) {
      const status = result.reason === "invalid" ? 400 : result.reason === "unavailable" ? 503 : result.reason === "failed" ? 500 : 404;
      return errorResponse(result.reason, status);
    }
    return json({ approval: result.state });
  } catch (error) {
    logFailure("content-article-approvals read", error);
    return errorResponse("failed", 500);
  }
}
