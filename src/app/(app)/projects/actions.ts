"use server";

import { revalidatePath } from "next/cache";
import { unmeasuredListItem } from "@/lib/projects/fixture-analytics";
import type { NewProjectErrors } from "@/lib/projects/intake-rules";
import { projectRepository } from "@/lib/projects/repository";
import type { NewProjectInput, ProjectListItem } from "@/types/project";

/**
 * Creates a project in the configured store.
 *
 * The only path from the browser to a project write. It runs on the server,
 * where the repository and its credentials live, and hands back no more than
 * the roster needs: the new row on success, or the reason there is none.
 *
 * A Server Action is reachable by a direct POST, not only through the dialog,
 * so nothing here trusts its argument — the repository validates the input as
 * `unknown` before anything is written. There is no authentication yet: until
 * there is, anyone who can reach the server can call this, which is why the
 * application must not be deployed publicly in this state.
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
  /** The store does not persist projects, or failed to; nothing was written. */
  | { readonly ok: false; readonly reason: "unavailable" | "failed" };

export async function createProjectAction(
  input: NewProjectInput,
): Promise<CreateProjectActionResult> {
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
  }

  if (!result.ok) return result;

  revalidatePath("/projects");
  revalidatePath(`/projects/${result.project.id}`);

  return { ok: true, project: unmeasuredListItem(result.project) };
}
