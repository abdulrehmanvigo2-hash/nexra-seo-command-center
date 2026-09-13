import "server-only";

import type { ProjectRepository } from "@/lib/projects/contract";
import { mockProjectRepository } from "@/lib/projects/mock-repository";

export type { ProjectRepository, ProjectRoster } from "@/lib/projects/contract";

/**
 * Where project data comes from — the one line that changes when it comes
 * from somewhere else.
 *
 * Server-only. Routes read through this and hand the result to their screens
 * as props; a Client Component that imports it fails the build, which is what
 * keeps a future store's credentials and queries off the browser.
 */
export const projectRepository: ProjectRepository = mockProjectRepository;
