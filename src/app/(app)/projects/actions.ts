"use server";

import { revalidatePath } from "next/cache";
import { getOperator } from "@/lib/auth/session";
import { unmeasuredListItem } from "@/lib/projects/fixture-analytics";
import type { NewProjectErrors } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";
import { createRateLimiter } from "@/lib/security/rate-limit";
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
 * Writes are limited per operator: one at a time, and a handful per ten
 * minutes, held in this process's memory (see `createRateLimiter`).
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

const createsPerOperator = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1_000 });
const inFlight = new Set<string>();

export async function createProjectAction(
  input: NewProjectInput,
): Promise<CreateProjectActionResult> {
  const operator = await getOperator();
  if (!operator) return { ok: false, reason: "unauthorized" };

  if (inFlight.has(operator.id)) {
    return { ok: false, reason: "rate-limited", retryAfterSeconds: 1 };
  }
  const allowance = createsPerOperator.consume(operator.id);
  if (!allowance.allowed) {
    return {
      ok: false,
      reason: "rate-limited",
      retryAfterSeconds: Math.max(1, Math.ceil(allowance.retryAfterMs / 1_000)),
    };
  }

  inFlight.add(operator.id);
  let result: Awaited<ReturnType<typeof projectRepository.createProject>>;
  try {
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

  return { ok: true, project: unmeasuredListItem(result.project) };
}
