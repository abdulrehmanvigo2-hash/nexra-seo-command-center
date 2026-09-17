import type { Metadata } from "next";
import { AgentsWorkspace } from "@/components/agents/agents-workspace";
import { projectRepository } from "@/lib/projects/repository";
import { projectOptionsFrom } from "@/lib/projects/selection";

export const metadata: Metadata = {
  title: "AI Agents",
  description:
    "The twelve specialist agents: roster, status, workload, orchestration pipeline, hand-offs, and outputs.",
};

/**
 * The run history panel filters by project, so the page reads the real
 * roster from the Projects repository, as Analytics does.
 */
export default async function AgentsPage() {
  const projects = projectOptionsFrom(await projectRepository.listProjects());
  return <AgentsWorkspace projects={projects} />;
}
