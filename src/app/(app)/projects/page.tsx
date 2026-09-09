import type { Metadata } from "next";
import { ProjectsWorkspace } from "@/components/projects/projects-workspace";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Per-client workspaces covering scope, delivery state, and project configuration.",
};

export default function ProjectsPage() {
  return <ProjectsWorkspace />;
}
