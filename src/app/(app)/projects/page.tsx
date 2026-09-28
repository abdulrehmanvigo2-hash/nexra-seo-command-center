import type { Metadata } from "next";
import { ProjectsWorkspace } from "@/components/projects/projects-workspace";
import { projectRepository } from "@/lib/projects/repository";

/**
 * Rendered per request (checkpoint 5.5): the stored project list is read on
 * every visit, so a project added after a deploy appears without a rebuild.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Per-client workspaces covering scope, delivery state, and project configuration.",
};

export default async function ProjectsPage() {
  const { projects, asOf } = await projectRepository.listProjects();

  return (
    <ProjectsWorkspace
      roster={projects}
      asOf={asOf}
      storesProjects={projectRepository.storesProjects}
    />
  );
}
