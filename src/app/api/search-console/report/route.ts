import { NextResponse, type NextRequest } from "next/server";
import { getOperator } from "@/lib/auth/session";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";
import { isRangeId } from "@/lib/search-console/date-windows";
import { getSearchConsoleReport, searchConsoleProvider } from "@/lib/search-console";

/**
 * Search Console performance for one project and range.
 *
 * The browser's only way to Search Console data. It runs on the server, where
 * the service account's key lives, and answers operators only — checked here
 * against the Auth server, not left to the proxy. The project must exist in
 * the configured store; the range must be one the product offers.
 *
 * The answer is always a `SearchConsoleReport`: a provider failure comes back
 * as a state with a 200, because the page renders it, while a bad request or a
 * missing operator gets an HTTP error. Never cached by the browser or a CDN;
 * the provider keeps its own server-side cache.
 */
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };

  const operator = await getOperator();
  if (!operator) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }

  const projectId = request.nextUrl.searchParams.get("project");
  const rangeId = request.nextUrl.searchParams.get("range") ?? "30d";
  if (!projectId || !isStorableProjectId(projectId) || !isRangeId(rangeId)) {
    return NextResponse.json({ error: "bad-request" }, { status: 400, headers });
  }

  let exists: boolean;
  try {
    exists = (await projectRepository.getProjectById(projectId)) !== null;
  } catch (error) {
    console.error(
      "search-console route:",
      error instanceof Error ? error.name : "unknown error",
    );
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers });
  }
  if (!exists) {
    return NextResponse.json({ error: "not-found" }, { status: 404, headers });
  }

  const report = await getSearchConsoleReport(searchConsoleProvider(), projectId, rangeId);
  return NextResponse.json(report, { headers });
}
