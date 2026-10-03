import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { isRunId } from "@/lib/agent-runs/service";
import { getOperator } from "@/lib/auth/session";
import { assembledDraftFor } from "@/lib/briefs/draft";
import { isSnapshotProjectId } from "@/lib/keyword-snapshots/contract";

/**
 * The assembled article draft of one brief (M6, PR 5).
 *
 *   GET /api/briefs/draft?project=<id>&brief=<brief run uuid>
 *
 * Operators only; read-only, and, like the run list it reads, not rate limited. Computed on read from the brief run, its opportunity's records and the Writer's newest
 * part runs: the parts' states, the import-ready content (null until every part is drafted), the evidence map with
 * unsupported lines first, the C1 validator's issues and the notes. Nothing is saved, queued or run.
 */
export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);
  const project = request.nextUrl.searchParams.get("project");
  const brief = request.nextUrl.searchParams.get("brief");
  if (!isSnapshotProjectId(project) || brief === null || !isRunId(brief)) return errorResponse("bad-request", 400);
  try {
    const result = await assembledDraftFor(project, brief.toLowerCase());
    if (result.status === "not-kept") return errorResponse("not-set-up", 503);
    if (result.status === "brief-not-usable") return errorResponse("brief-not-usable", 404);
    return json({ draft: result.draft });
  } catch (error) {
    logFailure("briefs draft", error);
    return errorResponse("failed", 500);
  }
}
