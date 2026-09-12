import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompetitorWorkspace } from "@/components/competitors/competitor-workspace";
import {
  COMPETITOR_TYPE_META,
  getCompetitorIds,
  getCompetitorRecord,
} from "@/lib/mock/competitors";

type PageParams = { params: Promise<{ competitorId: string }> };

/**
 * Every tracked competitor is prerendered: the set is derived from a fixed
 * project roster and keyword registry, so an id that is not in it is a broken
 * link rather than a rival we have not measured yet. An unknown id renders on
 * demand and falls through to `notFound()`, as in Projects.
 */
export function generateStaticParams() {
  return getCompetitorIds().map((competitorId) => ({ competitorId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { competitorId } = await params;
  const record = getCompetitorRecord(decodeURIComponent(competitorId));

  if (!record) {
    return { title: "Competitor not found" };
  }

  return {
    title: `${record.name} · ${record.projectName}`,
    description: `${COMPETITOR_TYPE_META[record.type].label} competitor on ${record.domain}. Keyword overlap, ranking battles, modelled pages, cluster dominance, gaps, and the work they produce for ${record.projectName}.`,
  };
}

export default async function CompetitorDetailPage({ params }: PageParams) {
  const { competitorId } = await params;
  const id = decodeURIComponent(competitorId);

  if (!getCompetitorRecord(id)) {
    notFound();
  }

  return <CompetitorWorkspace competitorId={id} />;
}
