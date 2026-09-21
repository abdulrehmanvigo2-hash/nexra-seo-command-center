/**
 * Replacing one project's recorded competitor domains, as a rule with its
 * boundaries injected.
 *
 * The Server Action that the browser reaches is a thin shell around this:
 * it supplies the operator the Auth server confirmed and the configured
 * repository, and this decides everything else. Kept apart so the decisions
 * — who may write, which project, which field, what is refused — run under
 * `node --test` against an in-memory repository, with no cookies, no
 * database and no Next.js.
 *
 * Three rules. The caller's operator session decides access, before any
 * read. The project is loaded on the server by the id the request names, and
 * its own stored domain — never anything the browser sends — is what the new
 * list is checked against. And the repository is asked to change one field:
 * the competitor list. Nothing here can reach the project's name, domain,
 * goal, crawls or runs, and nothing here crawls, queues, or executes anything.
 */

import type { Operator } from "@/lib/auth/access";
import type { ProjectRepository } from "@/lib/projects/contract";
import {
  COMPETITOR_DOMAINS_MESSAGE,
  parseCompetitorDomains,
  type CompetitorDomainsProblem,
} from "@/lib/projects/competitor-domains";
import { isStorableProjectId } from "@/lib/projects/intake-rules";

export type CompetitorUpdateDependencies = {
  /** The operator behind the request, confirmed with the Auth server, or null. */
  readonly operator: Operator | null;
  readonly projects: Pick<ProjectRepository, "getProjectById" | "updateProjectCompetitors">;
};

export type CompetitorUpdateResult =
  /** The list as the store now holds it, canonical. */
  | { readonly ok: true; readonly projectId: string; readonly competitorDomains: readonly string[] }
  /** Not signed in as an operator; nothing was read or written. */
  | { readonly ok: false; readonly reason: "unauthorized" }
  /** The request or the list broke a rule; nothing was written. */
  | {
      readonly ok: false;
      readonly reason: "invalid";
      readonly problem: CompetitorDomainsProblem | "request";
      readonly index: number | null;
      readonly message: string;
    }
  | { readonly ok: false; readonly reason: "unknown-project" }
  /** This store does not persist projects. */
  | { readonly ok: false; readonly reason: "unavailable" };

const REQUEST_FIELDS = ["projectId", "competitorDomains"] as const;

const invalidRequest = (message: string): CompetitorUpdateResult => ({
  ok: false,
  reason: "invalid",
  problem: "request",
  index: null,
  message,
});

/**
 * Applies one update, or refuses.
 *
 * The request is `unknown` because a Server Action is reachable by a direct
 * POST: it must be an object with exactly a project id and a list, and any
 * other field is refused rather than ignored.
 */
export async function applyCompetitorDomainsUpdate(
  request: unknown,
  dependencies: CompetitorUpdateDependencies,
): Promise<CompetitorUpdateResult> {
  if (dependencies.operator === null) return { ok: false, reason: "unauthorized" };

  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return invalidRequest("The request must be an object.");
  }
  const unknown = Object.keys(request).filter((key) => !(REQUEST_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return invalidRequest(`The request has fields this action does not accept: ${unknown.slice(0, 5).join(", ")}.`);
  }

  const { projectId, competitorDomains } = request as { projectId?: unknown; competitorDomains?: unknown };
  if (typeof projectId !== "string" || !isStorableProjectId(projectId)) {
    return { ok: false, reason: "unknown-project" };
  }

  // The project's own record decides what the list is checked against.
  const project = await dependencies.projects.getProjectById(projectId);
  if (project === null) return { ok: false, reason: "unknown-project" };

  const parsed = parseCompetitorDomains(competitorDomains, project.domain);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "invalid",
      problem: parsed.problem,
      index: parsed.index,
      message: COMPETITOR_DOMAINS_MESSAGE[parsed.problem],
    };
  }

  const stored = await dependencies.projects.updateProjectCompetitors(project.id, parsed.value);
  if (!stored.ok) return stored;
  return { ok: true, projectId: project.id, competitorDomains: stored.competitorDomains };
}
