import type { NextRequest } from "next/server";
import { errorResponse, json, logFailure } from "@/lib/agent-runs/http";
import { admitWorker } from "@/lib/agent-runs/worker-http";
import { crawlService, FETCH_SLICE } from "@/lib/crawl/runtime";
import { logEvent } from "@/lib/observability/log";

/**
 * Resumes one crawl's page-fetch stage without an operator present.
 *
 *   GET or POST /api/worker/crawl?crawl=<id>   Authorization: Bearer <CRON_SECRET>
 *
 * The safety net behind the operator's own slices: a browser closed mid-crawl
 * leaves a queue, and this empties it. It uses the same worker credential and
 * the same slice the panel drives, so there is one code path and one set of
 * limits, not two.
 *
 * It never starts a crawl. A crawl exists because an operator asked for one,
 * and this only continues work that is already queued — which is why nothing
 * here is a recurring site crawl.
 *
 * Not on a schedule yet. Adding it to `vercel.json` is the one line that would
 * make resumption automatic, and that is a deployment decision rather than a
 * code one.
 */

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return resume(request);
}

export async function POST(request: NextRequest) {
  return resume(request);
}

async function resume(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const refused = await admitWorker(request, "process");
    if (refused) return refused;

    const crawlId = request.nextUrl.searchParams.get("crawl");
    if (crawlId === null || crawlId.length === 0 || crawlId.length > 64) {
      return errorResponse("bad-request", 400);
    }

    const result = await crawlService().runFetchSlice(crawlId, FETCH_SLICE);
    if (!result.ok) {
      return json({ error: result.reason }, result.reason === "unknown-project" ? 404 : 503);
    }

    logEvent("info", "worker.invocation", {
      job: "crawl",
      claimed: result.pass.claimed,
      recovered: result.pass.recovered,
      // The log's field set is fixed; what is left goes in the count slot.
      count: result.pass.remaining,
      stoppedBy: result.pass.stoppedBy,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return json({ job: "crawl", crawl: result.crawl, pass: result.pass });
  } catch (error) {
    logFailure("worker crawl", error);
    return errorResponse("failed", 500);
  }
}
