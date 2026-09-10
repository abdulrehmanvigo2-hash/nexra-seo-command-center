import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClusterWorkspace } from "@/components/keywords/cluster-workspace";
import { getClusterIds, getClusterRecord } from "@/lib/mock/keywords";

type PageParams = { params: Promise<{ clusterId: string }> };

/** The cluster set is fixed, so an unknown id is a broken link. */
export const dynamicParams = false;

export function generateStaticParams() {
  return getClusterIds().map((clusterId) => ({ clusterId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { clusterId } = await params;
  const cluster = getClusterRecord(decodeURIComponent(clusterId));

  if (!cluster) {
    return { title: "Cluster not found" };
  }

  return {
    title: cluster.name,
    description: `${cluster.parentTopic} · ${cluster.projectName}. ${cluster.keywordCount} keywords, coverage, page plan, and gaps.`,
  };
}

export default async function ClusterPage({ params }: PageParams) {
  const { clusterId } = await params;
  const id = decodeURIComponent(clusterId);

  if (!getClusterRecord(id)) {
    notFound();
  }

  return <ClusterWorkspace clusterId={id} />;
}
