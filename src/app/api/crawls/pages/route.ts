import type { NextRequest } from "next/server";
import {
  errorResponse,
  isSameOrigin,
  json,
  limitResponse,
  logFailure,
  readJsonBody,
} from "@/lib/agent-runs/http";
import { crawlLimiter, crawlService, FETCH_SLICE } from "@/lib/crawl/runtime";
import { getOperator } from "@/lib/auth/session";

/**
 * One slice of a crawl's page-fetch stage.
 *
 *   POST /api/crawls/pages  { crawlId } → { crawl, pass }
 *
 * Operators only, same-origin only, and the crawl is named by id — the site
 * comes from the stored crawl, never from the caller.
 *
 * Deliberately a slice. A crawl of hundreds of pages does not fit in one
 * request, so the caller comes back until `pass.remaining` is zero; the queue
 * is in Postgres, and a request that dies mid-slice loses only the leases it
 * held. Calling this twice at once is safe: the two callers claim disjoint
 * batches.
 */

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const crawlId =
    typeof body.value === "object" && body.value !== null
      ? (body.value as Record<string, unknown>).crawlId
      : undefined;
  if (typeof crawlId !== "string" || crawlId.length === 0 || crawlId.length > 64) {
    return errorResponse("bad-request", 400);
  }

  try {
    const limited = await limitResponse(crawlLimiter("fetch-slice"), operator.id);
    if (limited) return limited;

    const result = await crawlService().runFetchSlice(crawlId, FETCH_SLICE);
    if (!result.ok) {
      return json({ error: result.reason }, result.reason === "unknown-project" ? 404 : 503);
    }
    return json({ crawl: result.crawl, pass: result.pass });
  } catch (error) {
    logFailure("crawl pages slice", error);
    return errorResponse("failed", 500);
  }
}
