import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin, json, limitResponse, logFailure, readJsonBody } from "@/lib/agent-runs/http";
import { getOperator, getPublisher } from "@/lib/auth/session";
import { logEvent } from "@/lib/observability/log";
import { publicationLimiter, publishingService } from "@/lib/publishing";
import { isProjectId, isUuid, parsePublicationRequest } from "@/lib/publishing/contract";
import { isReadyToPublish } from "@/lib/publishing/service";
import { projectRepository } from "@/lib/projects/repository";

/**
 * Publications (P-L2, PR 6; `docs/roadmap/P-L2-publishing.md`).
 *
 *   GET  /api/publications?project=<id>[&view=ready]   the project's publications (or only those ready to publish)
 *   GET  /api/publications?approval=<uuid>             one publication by its approval, with a preview while requested
 *   POST /api/publications { project, articleId, publishedOn, crossLinkAnchor? }   request a publication
 *
 * Reads: an operator or a reviewer (P-L2 PR 3). A GET never writes: the preview reads the site at main's head and
 * renders in memory. The request is an operator's decision — it records the 6.8 approval — so operators only, from
 * this site's own pages. Every answer is a fixed code; 503 `not-set-up` until migration 20261023120000 is applied.
 */

export async function GET(request: NextRequest) {
  const viewer = await getPublisher();
  if (!viewer) return errorResponse("unauthorized", 401);

  const params = request.nextUrl.searchParams;
  const project = params.get("project");
  const approval = params.get("approval");
  if (!(isProjectId(project) && approval === null) && !(isUuid(approval) && project === null)) return errorResponse("bad-request", 400);

  const limited = await limitResponse(publicationLimiter("read"), viewer.id);
  if (limited) return limited;

  try {
    const publisher = publishingService();
    if (approval !== null) {
      const result = await publisher.view(approval);
      if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
      if (result.entry === null) return errorResponse("publication-not-found", 404);
      return json({ mode: publisher.mode, configured: publisher.configured, role: viewer.role, entry: result.entry, preview: result.preview });
    }
    const now = Date.now();
    const result = params.get("view") === "ready" ? await publisher.ready(project!, now) : await publisher.list(project!);
    if (result.status === "not-set-up") return errorResponse("not-set-up", 503);
    return json({
      mode: publisher.mode,
      configured: publisher.configured,
      publications: result.publications.map((entry) => ({ ...entry, ready: isReadyToPublish(entry, result.publications, now) })),
    });
  } catch (error) {
    logFailure("publications read", error);
    return errorResponse("failed", 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return errorResponse("forbidden", 403);

  const operator = await getOperator();
  if (!operator) return errorResponse("unauthorized", 401);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parsePublicationRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error, 400);

  const limited = await limitResponse(publicationLimiter("write"), operator.id);
  if (limited) return limited;

  try {
    if ((await projectRepository.getProjectById(parsed.projectId)) === null) return errorResponse("project-not-found", 404);
    const result = await publishingService().request(parsed, operator.id);
    logEvent("info", "publication.request", {
      projectId: parsed.projectId,
      outcome: result.status,
      runId: result.status === "requested" ? result.publication.id : null,
    });
    switch (result.status) {
      case "requested":
        return json({ status: "requested", publication: result.publication }, 201);
      case "not-set-up":
        return errorResponse("not-set-up", 503);
      case "article-not-found":
      case "project-not-found":
        return errorResponse(result.status, 404);
      case "not-eligible":
        return json({ error: "not-eligible", reason: result.reason ?? null }, 409);
      case "invalid":
        return json({ error: "invalid", reason: result.reason }, 422);
      default:
        return errorResponse(result.status, 409);
    }
  } catch (error) {
    logFailure("publications request", error);
    return errorResponse("failed", 500);
  }
}
