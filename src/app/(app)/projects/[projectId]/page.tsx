import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { getProjectIds, getProjectRecord } from "@/lib/mock/projects";

type PageParams = { params: Promise<{ projectId: string }> };

/**
 * Every project in the roster is prerendered: the roster is a fixed fixture
 * set, so an id that is not in it is a broken link rather than a project that
 * has not been built yet.
 *
 * `dynamicParams` is deliberately left at its default rather than set to
 * `false`. Setting it turns an unknown id into a routing-level 404 answered by
 * the root boundary, which never reaches this segment — so `notFound()` below,
 * the "not found" branch in `generateMetadata`, and the sibling
 * `not-found.tsx` would all be unreachable. Rendering an unknown id on demand
 * keeps the 404 status and puts the recovery screen inside the application
 * shell. Every detail route in the product follows this convention.
 */
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
