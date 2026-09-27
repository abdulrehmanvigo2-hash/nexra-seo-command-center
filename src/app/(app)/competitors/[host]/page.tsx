import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComparisonRuns, CompetitorDeclarations, ObservedBadge } from "@/components/competitors/observed-competitors";
import { SectionHeader } from "@/components/ui/section-header";
import { getOperator } from "@/lib/auth/session";
import { canonicalCompetitorHost, recordedCompetitorHost } from "@/lib/crawl/competitor-target";
import { RECORDED_NOTE } from "@/lib/crawl/competitor-overview";
import { projectRepository } from "@/lib/projects/repository";
import { isStorableProjectId } from "@/lib/projects/intake-rules";
import { projectOptionsFrom } from "@/lib/projects/selection";

type PageParams = {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ project?: string | string[] }>;
};

export const metadata: Metadata = {
  title: "Competitor · Competitor Intelligence",
  description: "What one recorded competitor's pages declared as this product crawled them, beside the project's own, and the comparison reviews of it.",
};

/**
 * One recorded competitor, keyed by its host (Phase 4, checkpoint 4.4,
 * decision Q3), replaced in place.
 *
 * Rendered on the server for every request — nothing is prerendered. The id
 * must be a plain hostname (a fixture id is not, and is not found), the
 * operator is checked, and the host must be one a stored project recorded:
 * the `?project=` one when it records it, else the first project that does.
 * An unknown host is not found. The declarations and runs are read by the
 * page's own client sections through the gated routes.
 */
export default async function CompetitorDetailPage({ params, searchParams }: PageParams) {
  const { host: raw } = await params;
  const host = canonicalCompetitorHost(decodeURIComponent(raw));
  if (host === null) notFound();

  const operator = await getOperator();
  if (!operator) notFound();

  const wanted = (await searchParams).project;
  const roster = projectOptionsFrom(await projectRepository.listProjects());
  const ordered =
    typeof wanted === "string" && isStorableProjectId(wanted) ? [...roster.filter((p) => p.id === wanted), ...roster.filter((p) => p.id !== wanted)] : [...roster];

  for (const project of ordered) {
    const intake = await projectRepository.getProjectIntake(project.id);
    const recorded = (intake?.competitorDomains ?? []).map((entry) => recordedCompetitorHost(entry)).filter((entry): entry is string => entry !== null);
    if (!recorded.includes(host)) continue;
    return (
      <div className="space-y-6">
        <SectionHeader
          size="page"
          title={host}
          description={`A competitor domain recorded for ${project.name}. ${RECORDED_NOTE}`}
          actions={<ObservedBadge />}
        />
        <CompetitorDeclarations projectId={project.id} projectDomain={project.domain} recorded={recorded} host={host} />
        <ComparisonRuns projectId={project.id} host={host} />
      </div>
    );
  }
  notFound();
}
