import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { keywordSnapshotService } from "@/lib/keyword-snapshots";
import { isSnapshotProjectId } from "@/lib/keyword-snapshots/contract";

/**
 * Today's live provider spend against the daily cap (F0, §5).
 *
 *   GET /api/keyword-snapshots/daily-usage?project=<id>
 *
 * Operators only. Read only: it sums today's live runs as the reserve
 * function counts them and never calls the provider, reserves or writes.
 * The cap is global per UTC day; the project is taken for symmetry with the
 * agent-run usage route and checked for shape only.
 */
export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const project = request.nextUrl.searchParams.get("project");
  if (!isSnapshotProjectId(project)) return errorResponse("bad-request", 400);

  try {
    const result = await keywordSnapshotService().usage(project);
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({ usage: result.usage });
  } catch (error) {
    logFailure("keyword-snapshots daily-usage", error);
    return errorResponse("failed", 500);
  }
}
