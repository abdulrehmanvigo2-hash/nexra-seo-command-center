import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { websiteDryRunService } from "@/lib/content/publications/website";

/**
 * The website artifact dry-run for one active publication proposal.
 *
 *   GET /api/content-publications/dry-run?project=<id>&draft=<uuid>&proposal=<uuid>
 *     → { dryRun: { status, template, route, fields, warnings, page, registry, … } }
 *
 * A read, rendered offline from the pinned website template and the
 * proposal's verified, bound version. Nothing here writes, and nothing
 * reaches GitHub, the website or any other network: no branch, commit, pull
 * request, deployment or publication is created. Operators only, private,
 * uncached.
 */

const STATUS: Record<string, number> = {
  invalid: 400,
  "not-found": 404,
  withdrawn: 409,
  stale: 409,
  unverified: 409,
  "no-template": 409,
  unavailable: 503,
};

export async function GET(request: NextRequest) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  const project = params.get("project");
  const draft = params.get("draft");
  const proposal = params.get("proposal");
  if (project === null || draft === null || proposal === null) return errorResponse("invalid", 400);

  try {
    const result = await websiteDryRunService().getDryRun(project, draft, proposal);
    if (!result.ok) return errorResponse(result.reason, STATUS[result.reason] ?? 500);
    return json({ dryRun: result.dryRun });
  } catch (error) {
    logFailure("content-publications dry-run", error);
    return errorResponse("failed", 500);
  }
}
