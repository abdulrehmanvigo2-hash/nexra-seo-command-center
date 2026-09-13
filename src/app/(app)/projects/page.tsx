import type { Metadata } from "next";
import { ProjectsWorkspace } from "@/components/projects/projects-workspace";
import { projectRepository } from "@/lib/projects/repository";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Per-client workspaces covering scope, delivery state, and project configuration.",
};

export default async function ProjectsPage() {
  const { projects, asOf } = await projectRepository.listProjects();

  return <ProjectsWorkspace roster={projects} asOf={asOf} />;
}
