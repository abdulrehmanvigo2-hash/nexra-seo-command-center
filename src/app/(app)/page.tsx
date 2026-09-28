import type { Metadata } from "next";
import { CommandCenter } from "@/components/dashboard/command-center";
import { projectRepository } from "@/lib/projects/repository";
import { projectOptionsFrom } from "@/lib/projects/selection";

/**
 * Rendered per request (checkpoint 5.5): the stored project list is read on
 * every visit, so a project added after a deploy appears without a rebuild.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Command Center",
  description:
    "Cross-project overview of SEO health, active priorities, and live agent activity.",
};

/**
 * The projects the dashboard can be scoped to come from the Projects
 * repository, so a project created on the Projects screen is selectable here
 * too — the same source Analytics, Keyword Intelligence and the agent roster
 * already read.
 */
export default async function CommandCenterPage() {
  const projects = projectOptionsFrom(await projectRepository.listProjects());

  return <CommandCenter projects={projects} />;
}
