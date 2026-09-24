/**
 * Reading one crawl's recorded findings, as plain data (checkpoint T4).
 *
 * The route and the panel around this own a fetch and some markup. What
 * could go wrong with the request — which ids are accepted at all, which
 * endpoint is asked, what each refusal means to an operator — lives here,
 * where `node --test` reaches it without a server.
 *
 * The read is scoped to a project on purpose: the endpoint answers for the
 * project's own crawl only, so a crawl id alone is never enough to ask.
 */

/** The same shape the crawl routes accept: a lower-case slug. */
const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FindingsReadRequest =
  | { readonly ok: true; readonly projectId: string; readonly crawlId: string }
  | { readonly ok: false; readonly error: "invalid" };

/**
 * Whether these two ids may be asked for. Shape only: whether the crawl is
 * the project's is the service's decision, made against stored rows.
 */
export function findingsReadRequest(crawlId: string, project: string | null): FindingsReadRequest {
  if (project === null || project.length > 64 || !PROJECT_ID.test(project)) return { ok: false, error: "invalid" };
  if (!UUID.test(crawlId)) return { ok: false, error: "invalid" };
  return { ok: true, projectId: project, crawlId: crawlId.toLowerCase() };
}

/** The read endpoint for one crawl's findings, scoped to the project. */
export function findingsUrl(projectId: string, crawlId: string): string {
  const params = new URLSearchParams({ project: projectId });
  return `/api/crawls/${encodeURIComponent(crawlId)}/findings?${params.toString()}`;
}

/**
 * What a refused or failed read means, in an operator's terms.
 *
 * Every line says what did not happen. None of them says the crawl has no
 * findings: a read that failed established nothing about the site.
 */
export function findingsReadFailure(httpStatus: number): string {
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 404) return "This crawl is not one of this project's, so its findings were not read.";
  if (httpStatus === 429) return "Too many requests. Wait a moment and refresh.";
  return "The recorded findings could not be read. The crawl itself is unaffected.";
}
