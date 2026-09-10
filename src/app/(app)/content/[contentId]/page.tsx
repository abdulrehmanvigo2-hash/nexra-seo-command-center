import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentWorkspace } from "@/components/content/content-workspace";
import { FORMAT_META, getContentIds, getContentRecord } from "@/lib/mock/content";

type PageParams = { params: Promise<{ contentId: string }> };

/**
 * Every piece in the inventory is prerendered, and only those: the inventory
 * is derived from a fixed keyword registry, so an id that is not in it is a
 * broken link rather than a page that has not been written yet.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return getContentIds().map((contentId) => ({ contentId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { contentId } = await params;
  const record = getContentRecord(decodeURIComponent(contentId));

  if (!record) {
    return { title: "Content not found" };
  }

  return {
    title: record.title,
    description: `${record.projectName} · ${record.clusterName}. ${FORMAT_META[record.format].label} with content score, on-page findings, internal links, and answer-engine readiness.`,
  };
}

export default async function ContentDetailPage({ params }: PageParams) {
  const { contentId } = await params;
  const id = decodeURIComponent(contentId);

  if (!getContentRecord(id)) {
    notFound();
  }

  return <ContentWorkspace contentId={id} />;
}
