import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { getProjectIds, getProjectRecord } from "@/lib/mock/projects";

type PageParams = { params: Promise<{ projectId: string }> };

/**
 * Every project in the roster is prerendered, and only those: the roster is a
 * fixed fixture set, so an id that is not in it is a broken link rather than a
 * project that has not been built yet.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return getProjectIds().map((projectId) => ({ projectId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { projectId } = await params;
  const project = getProjectRecord(projectId);

  if (!project) {
    return { title: "Project not found" };
  }

  return {
    title: project.name,
    description: `${project.client} · ${project.industry}. SEO health, performance, issues, and the agents assigned to this project.`,
  };
}

export default async function ProjectPage({ params }: PageParams) {
  const { projectId } = await params;

  if (!getProjectRecord(projectId)) {
    notFound();
  }

  return <ProjectWorkspace projectId={projectId} />;
}
