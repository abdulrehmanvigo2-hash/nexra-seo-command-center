import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { DATE_RANGES } from "@/lib/mock/dashboard";
import { projectRepository } from "@/lib/projects/repository";
import type { ProjectDetail } from "@/types/project";

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
export async function generateStaticParams() {
  const ids = await projectRepository.listProjectIds();
  return ids.map((projectId) => ({ projectId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { projectId } = await params;
  const project = await projectRepository.getProjectById(projectId);

  if (!project) {
    return { title: "Project not found" };
  }

  return {
    title: project.name,
    description: `${project.client} · ${project.industry}. SEO health, performance, issues, and the agents assigned to this project.`,
  };
}

/**
 * The workspace switches between reporting windows instantly, so every window
 * is read here, on the server, and handed over together. Fetching a window on
 * demand would put a loading state into a switch that has never had one.
 */
export default async function ProjectPage({ params }: PageParams) {
  const { projectId } = await params;

  const details = await Promise.all(
    DATE_RANGES.map((range) =>
      projectRepository.getProjectDetail(projectId, range.id),
    ),
  );
  const found = details.filter(
    (detail): detail is ProjectDetail => detail !== null,
  );

  if (found.length !== DATE_RANGES.length) {
    notFound();
  }

  return <ProjectWorkspace details={found} />;
}
