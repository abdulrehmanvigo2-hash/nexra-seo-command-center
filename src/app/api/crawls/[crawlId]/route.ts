import type { NextRequest } from "next/server";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { errorResponse, json, limitResponse, logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";

/**
 * One crawl and the pages it observed.
 *
 *   GET /api/crawls/<id>[?pages=n]
 *
 * Read-only, operators only. Nothing here writes, and nothing here reaches out
 * to a website: it reports what a crawl already recorded.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ crawlId: string }> },
) {
  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const { crawlId } = await context.params;
  if (!UUID.test(crawlId)) return errorResponse("invalid", 400);

  const rawPages = request.nextUrl.searchParams.get("pages");
  const pages = rawPages !== null && /^\d{1,4}$/.test(rawPages) ? Number(rawPages) : 500;

  const limited = await limitResponse(crawlLimiter("read"), operator.id);
  if (limited) return limited;

  try {
    const detail = await crawlService().getCrawl(crawlId, Math.min(pages, 1_000));
    return detail === null ? errorResponse("not-found", 404) : json(detail);
  } catch (error) {
    logFailure("crawl read", error);
    return errorResponse("failed", 500);
  }
}
