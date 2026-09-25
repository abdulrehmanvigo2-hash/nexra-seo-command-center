/**
 * Reading a project's latest recorded findings and recording a decision, as
 * plain data (milestone M3). The route and the section around this own a
 * fetch and some markup; which ids are accepted, which endpoint is asked and
 * what each refusal means to an operator live here, where `node --test`
 * reaches them without a server.
 */

const PROJECT_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export type LatestFindingsReadRequest =
  | { readonly ok: true; readonly projectId: string }
  | { readonly ok: false; readonly error: "invalid" };

/** Whether this project id may be asked for. Shape only. */
export function latestFindingsReadRequest(project: string | null): LatestFindingsReadRequest {
  if (project === null || project.length > 64 || !PROJECT_ID.test(project)) return { ok: false, error: "invalid" };
  return { ok: true, projectId: project };
}

/** The read endpoint for a project's latest recorded findings, with the decisions recorded against them. */
export function latestFindingsUrl(projectId: string): string {
  const params = new URLSearchParams({ project: projectId });
  return `/api/crawls/latest-findings?${params.toString()}`;
}

/** The write endpoint for one decision about one of a crawl's recorded findings. */
export function triageUrl(crawlId: string): string {
  return `/api/crawls/${encodeURIComponent(crawlId)}/findings/triage`;
}

/**
 * What a refused or failed read means, in an operator's terms. Every line
 * says what did not happen; none says the project has no findings.
 */
export function latestFindingsReadFailure(httpStatus: number): string {
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 404) return "This project is not stored, so nothing was read.";
  if (httpStatus === 429) return "Too many requests. Wait a moment and refresh.";
  return "The recorded findings could not be read. The findings themselves are unaffected.";
}

/** What a refused or failed decision means. None of these lines says the decision was saved. */
export function triageSaveFailure(httpStatus: number, code: string | null): string {
  if (httpStatus === 401) return "Your session has ended. Reload the page to sign in again.";
  if (httpStatus === 403) return "This request did not come from this site, so nothing was saved.";
  if (httpStatus === 404) return code === "not-recorded"
    ? "This finding is no longer among the crawl's recorded findings, so no decision was saved."
    : "This crawl is not one of this project's, so no decision was saved.";
  if (httpStatus === 429) return "Too many decisions in a short time. Wait a moment and try again.";
  if (httpStatus === 400) return "The decision was not accepted: choose one of the four statuses and keep the note under 500 characters.";
  if (httpStatus === 503) return "Decisions are not stored on this deployment.";
  return "The decision could not be saved. The finding is unaffected.";
}
