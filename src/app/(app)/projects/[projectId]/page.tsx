import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectUnmeasured } from "@/components/projects/project-unmeasured";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { DATE_RANGES } from "@/lib/mock/dashboard";
import { projectRepository } from "@/lib/projects/repository";
import type { ProjectDetail } from "@/types/project";

type PageParams = { params: Promise<{ projectId: string }> };

/**
 * Every project that exists at build time is prerendered. One created later is
 * rendered on its first request, and the create action revalidates its path so
 * a cached "not found" from before it existed cannot outlive it.
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

  // Only a measured project has health, performance, and issues to describe.
  const measured =
    (await projectRepository.getProjectDetail(projectId, DATE_RANGES[0].id)) !==
    null;

  return {
    title: project.name,
    description: measured
      ? `${project.client} · ${project.industry}. SEO health, performance, issues, and the agents assigned to this project.`
      : `${project.client} · ${project.industry}. Saved and awaiting its first crawl — no reporting data yet.`,
  };
}

/**
 * The workspace switches between reporting windows instantly, so every window
 * is read here, on the server, and handed over together. Fetching a window on
 * demand would put a loading state into a switch that has never had one.
 */
export default async function ProjectPage({ params }: PageParams) {
  const { projectId } = await params;

  const project = await projectRepository.getProjectById(projectId);
  if (!project) {
    notFound();
  }

  const details = await Promise.all(
    DATE_RANGES.map((range) =>
      projectRepository.getProjectDetail(projectId, range.id),
    ),
  );
  const found = details.filter(
    (detail): detail is ProjectDetail => detail !== null,
  );

  // The project exists but nothing has measured it: show what is known, and
  // say so, rather than inventing the rest or denying the project exists.
  if (found.length === 0) {
    return <ProjectUnmeasured project={project} />;
  }

  // Reporting data for some windows but not others is a broken store, not a
  // state to render around.
  if (found.length !== DATE_RANGES.length) {
    throw new Error(
      `Project ${projectId} has reporting data for ${found.length} of ${DATE_RANGES.length} windows.`,
    );
  }

  return <ProjectWorkspace details={found} />;
}
