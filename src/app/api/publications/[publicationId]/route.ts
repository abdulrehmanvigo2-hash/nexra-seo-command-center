import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getPublisher } from "@/lib/auth/session";
import { logEvent } from "@/lib/observability/log";
import { publicationLimiter, publishingService } from "@/lib/publishing";
import { isUuid, parsePublishAction } from "@/lib/publishing/contract";

/**
 * Publish one publication, or continue it from its last recorded step (P-L2, PR 6).
 *
 *   POST /api/publications/<id> { action: "publish" }
 *
 * An operator or a reviewer, from this site's own pages, rate limited. With `NEXRA_PUBLISH_MODE` off (the default)
 * it answers 409 `publishing-off` before anything is read or consumed; without the GitHub token, 503
 * `not-configured`. A press that has to wait — checks still running, a merge left to the owner in dry-run, a page not
 * yet live — answers 200 with what it waits for; the next press continues.
 */

export async function POST(request: NextRequest, context: { params: Promise<{ publicationId: string }> }) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const publisher = await getPublisher();
  if (!publisher) return errorResponse("unauthorized", 401);

  const { publicationId } = await context.params;
  if (!isUuid(publicationId)) return errorResponse("bad-request", 400);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  if (!parsePublishAction(body.value).ok) return errorResponse("bad-request", 400);

  const limited = await limitResponse(publicationLimiter("write"), publisher.id);
  if (limited) return limited;

  try {
    const started = Date.now();
    const result = await publishingService().publish(publicationId, publisher.id);
    logEvent("info", "publication.publish", {
      outcome: result.status,
      runId: publicationId,
      reason: result.status === "failed" ? result.code : result.status === "waiting" ? result.waitingFor : null,
      durationMs: Date.now() - started,
    });
    switch (result.status) {
      case "live":
      case "waiting":
      case "failed":
        return json(result);
      case "publishing-off":
        return errorResponse("publishing-off", 409);
      case "not-configured":
      case "not-set-up":
        return errorResponse(result.status, 503);
      case "publication-not-found":
        return errorResponse("publication-not-found", 404);
      case "render-refused":
        return json({ error: "render-refused", refusal: result.refusal }, 422);
      case "unavailable":
        return json({ error: "unavailable", code: result.code }, 502);
      default:
        return json({ error: result.status, reason: "reason" in result ? (result.reason ?? null) : null }, 409);
    }
  } catch (error) {
    logFailure("publications publish", error);
    return errorResponse("failed", 500);
  }
}
