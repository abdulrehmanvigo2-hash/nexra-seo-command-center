"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { applyCompetitorDomainsUpdate, type CompetitorUpdateResult } from "@/lib/projects/competitor-update";
import { unmeasuredListItem } from "@/lib/projects/fixture-analytics";
import type { NewProjectErrors } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";
import { appRateLimiter } from "@/lib/security/app-rate-limit";
import type { NewProjectInput, ProjectListItem } from "@/types/project";

/**
 * Creates a project in the configured store.
 *
 * The only path from the browser to a project write. It runs on the server,
 * where the repository and its credentials live, and hands back no more than
 * the roster needs: the new row on success, or the reason there is none.
 *
 * A Server Action is reachable by a direct POST, not only through the dialog,
 * so nothing here trusts its caller or its argument. The caller must be an
 * operator, confirmed with the Auth server — the proxy's check in front of
 * this route is not relied on — before the repository, and its secret key,
 * are touched at all. The repository then validates the input as `unknown`.
 *
 * Writes are limited per operator: one at a time per process, and 10 per ten
 * minutes, counted in Postgres on the database deployment so every server
 * instance shares the allowance (`@/lib/security/app-rate-limit`). If the
 * count cannot be read, nothing is written.
 *
 * On success the roster and the new project's page are revalidated. Called
 * from a Server Action, `revalidatePath` also re-renders the page the user is
 * on, so the roster shows the new project in the same round trip, and every
 * later visit gets a freshly rendered page instead of the build-time one.
 */

export type CreateProjectActionResult =
  | { readonly ok: true; readonly project: ProjectListItem }
  | { readonly ok: false; readonly reason: "invalid"; readonly errors: NewProjectErrors }
  | { readonly ok: false; readonly reason: "duplicate-domain" }
  /** Not signed in as an operator; nothing was read or written. */
  | { readonly ok: false; readonly reason: "unauthorized" }
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number }
  /** The store does not persist projects, or failed to; nothing was written. */
  | { readonly ok: false; readonly reason: "unavailable" | "failed" };

const CREATES = { limit: 10, windowSeconds: 10 * 60 } as const;
const inFlight = new Set<string>();

export async function createProjectAction(
  input: NewProjectInput,
): Promise<CreateProjectActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };

  if (inFlight.has(operator.id)) {
    return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };
  }

  inFlight.add(operator.id);
  let result: Awaited<ReturnType<typeof projectRepository.createProject>>;
  try {
    const allowance = await appRateLimiter("projects.create", CREATES).consume(operator.id);
    if (!allowance.allowed) {
      return {
        ok: false,
        reason: "rate-limited",
        retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)),
      };
    }
    result = await projectRepository.createProject(input);
  } catch (error) {
    // The detail stays in the server log; the browser learns only that it failed.
    console.error(
      "createProjectAction:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    );
    return { ok: false, reason: "failed" };
  } finally {
    inFlight.delete(operator.id);
  }

  if (!result.ok) return result;

  revalidatePath("/projects");
  revalidatePath(`/projects/${result.project.id}`);
  // Analytics and Keywords list the roster in their project pickers.
  revalidatePath("/analytics");
  revalidatePath("/keywords");

  return { ok: true, project: unmeasuredListItem(result.project) };
}

/**
 * Replaces the competitor domains recorded for one existing project.
 *
 * The second and only other path from the browser to a project write, and
 * a narrow one: one field of one project, decided by
 * `@/lib/projects/competitor-update` against the project's own stored
 * record. The same rules as creation apply around it — operator confirmed
 * with the Auth server before anything is read, the argument treated as
 * `unknown`, one write at a time per process, and 10 per ten minutes per
 * operator counted in Postgres. The project's page is revalidated so the
 * crawl panel beneath the editor reads the saved list on the next render.
 *
 * Saving a list crawls nothing and queues nothing: a saved domain becomes a
 * crawl the operator may ask for, subject to the server's allow-list, and
 * no more.
 */

export type UpdateProjectCompetitorsActionResult =
  | CompetitorUpdateResult
  | { readonly ok: false; readonly reason: "rate-limited"; readonly retryAfterSeconds: number }
  /** The store failed; nothing is known to have been written. */
  | { readonly ok: false; readonly reason: "failed" };

const COMPETITOR_UPDATES = { limit: 10, windowSeconds: 10 * 60 } as const;
const competitorUpdatesInFlight = new Set<string>();

export async function updateProjectCompetitorsAction(
  request: unknown,
): Promise<UpdateProjectCompetitorsActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };

  if (competitorUpdatesInFlight.has(operator.id)) {
    return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };
  }

  competitorUpdatesInFlight.add(operator.id);
  let result: CompetitorUpdateResult;
  try {
    const allowance = await appRateLimiter("projects.update-competitors", COMPETITOR_UPDATES).consume(operator.id);
    if (!allowance.allowed) {
      return {
        ok: false,
        reason: "rate-limited",
        retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)),
      };
    }
    result = await applyCompetitorDomainsUpdate(request, { operator, projects: projectRepository });
  } catch (error) {
    console.error(
      "updateProjectCompetitorsAction:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    );
    return { ok: false, reason: "failed" };
  } finally {
    competitorUpdatesInFlight.delete(operator.id);
  }

  if (result.ok) revalidatePath(`/projects/${result.projectId}`);
  return result;
}
