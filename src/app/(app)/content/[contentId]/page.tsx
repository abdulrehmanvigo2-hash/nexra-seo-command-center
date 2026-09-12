import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentWorkspace } from "@/components/content/content-workspace";
import { FORMAT_META, getContentIds, getContentRecord } from "@/lib/mock/content";

type PageParams = { params: Promise<{ contentId: string }> };

/**
 * Every piece in the inventory is prerendered: the inventory is derived from a
 * fixed keyword registry, so an id that is not in it is a broken link rather
 * than a page that has not been written yet. An unknown id renders on demand
 * and falls through to `notFound()`, as in Projects.
 */
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

  // The workspace reads its initial tab from the query string, so links from
  // AI Visibility land on the right section. `useSearchParams` needs a Suspense
  // boundary during static rendering.
  return (
    <Suspense fallback={<ContentDetailFallback />}>
      <ContentWorkspace contentId={id} />
    </Suspense>
  );
}

function ContentDetailFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-6 w-full max-w-80" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Panel as="div" key={index} className="p-3.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-16" />
          </Panel>
        ))}
      </div>
      <Panel>
        <div className="space-y-3 p-4 sm:p-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </Panel>
    </div>
  );
}
