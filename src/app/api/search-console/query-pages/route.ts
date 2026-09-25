import { NextResponse, type NextRequest } from "next/server";
import { getOperator } from "@/lib/auth/session";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";
import { readSearchConsoleQueryPages } from "@/lib/search-console/query-pages";
import { QUERY_PAGE_VIEW_RANGE_ID, presentQueryPages } from "@/lib/search-console/query-pages/view";

/**
 * Stored query × page overlap for one project (M1 P4c): the intelligence
 * over its newest stored window, and the change against the newest eligible
 * earlier one, projected to what the panel shows.
 *
 *   GET /api/search-console/query-pages?project=<id>&range=30d
 *
 * Operators only, checked against the Auth server. The project must exist
 * in the configured store, and the range must be the one window pairs are
 * kept for. The property is the server's own mapping for the project,
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
  const rangeId = request.nextUrl.searchParams.get("range") ?? QUERY_PAGE_VIEW_RANGE_ID;
  if (!projectId || !isStorableProjectId(projectId) || rangeId !== QUERY_PAGE_VIEW_RANGE_ID) {
    return NextResponse.json({ error: "bad-request" }, { status: 400, headers });
  }

  let exists: boolean;
  try {
    exists = (await projectRepository.getProjectById(projectId)) !== null;
  } catch (error) {
    console.error("search-console query-pages route:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
  if (!exists) {
    return NextResponse.json({ error: "not-found" }, { status: 404, headers });
  }

  try {
    const intelligence = await readSearchConsoleQueryPages(projectId);
    return NextResponse.json(presentQueryPages(intelligence), { headers });
  } catch (error) {
    console.error("search-console query-pages route:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
}
