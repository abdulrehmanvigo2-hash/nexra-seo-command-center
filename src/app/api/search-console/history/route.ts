import { NextResponse, type NextRequest } from "next/server";
import { getOperator } from "@/lib/auth/session";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";
import { readSearchConsoleHistory } from "@/lib/search-console/history";
import { HISTORY_RANGE_ID, presentHistory } from "@/lib/search-console/history/view";

/**
 * Stored Search Console history for one project: the P4a comparison of
 * its two newest comparable snapshots, projected to what the panel shows.
 *
 *   GET /api/search-console/history?project=<id>&range=30d
 *
 * Operators only, checked against the Auth server. The project must exist
 * in the configured store, and the range must be the one window snapshots
 * are kept for. The property is the server's own mapping for the project,
 * resolved inside the reader; no request names one. Read-only: one bounded
 * store read, no Google call, no write. Never cached.
 */
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };

  const operator = await getOperator();
  if (!operator) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }

  const projectId = request.nextUrl.searchParams.get("project");
  const rangeId = request.nextUrl.searchParams.get("range") ?? HISTORY_RANGE_ID;
  if (!projectId || !isStorableProjectId(projectId) || rangeId !== HISTORY_RANGE_ID) {
    return NextResponse.json({ error: "bad-request" }, { status: 400, headers });
  }

  let exists: boolean;
  try {
    exists = (await projectRepository.getProjectById(projectId)) !== null;
  } catch (error) {
    console.error("search-console history route:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
  if (!exists) {
    return NextResponse.json({ error: "not-found" }, { status: 404, headers });
  }

  try {
    const comparison = await readSearchConsoleHistory(projectId);
    return NextResponse.json(presentHistory(comparison), { headers });
  } catch (error) {
    console.error("search-console history route:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
}
