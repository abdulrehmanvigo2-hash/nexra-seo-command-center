import { NextResponse, type NextRequest } from "next/server";
import { getOperator } from "@/lib/auth/session";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";
import { readLatestSearchConsoleWindow } from "@/lib/search-console/latest";

/**
 * The latest stored Search Console window for one project (checkpoint 4.3):
 * the Analytics tiles' one read.
 *
 *   GET /api/search-console/latest-window?project=<id>
 *
 * Operators only, checked against the Auth server. The project must exist in
 * the configured store. The property is the server's own mapping for the
 * project, resolved inside the reader; no request names one. Read-only: one
 * bounded store read, no Google call, no write. Never cached.
 */
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };

  const operator = await getOperator();
  if (!operator) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }

  const projectId = request.nextUrl.searchParams.get("project");
  if (!projectId || !isStorableProjectId(projectId)) {
    return NextResponse.json({ error: "bad-request" }, { status: 400, headers });
  }

  let exists: boolean;
  try {
    exists = (await projectRepository.getProjectById(projectId)) !== null;
  } catch (error) {
    console.error("search-console latest-window route:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
  if (!exists) {
    return NextResponse.json({ error: "not-found" }, { status: 404, headers });
  }

  try {
    return NextResponse.json(await readLatestSearchConsoleWindow(projectId), { headers });
  } catch (error) {
    console.error("search-console latest-window route:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
}
