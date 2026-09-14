import type { Metadata } from "next";
import { Suspense } from "react";
import { KeywordsWorkspace } from "@/components/keywords/keywords-workspace";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { projectRepository } from "@/lib/projects/repository";
import { projectOptionsFrom } from "@/lib/projects/selection";

export const metadata: Metadata = {
  title: "Keyword Intelligence",
  description:
    "The keyword universe: opportunity scoring, clusters, movement, cannibalisation, content gaps, SERP features, and answer-engine readiness.",
};

/**
 * The workspace reads its initial project and cluster from the query string,
 * so links from the dashboard and from a project workspace land on a filtered
 * view. `useSearchParams` needs a Suspense boundary during static rendering,
 * which is what this shell provides.
 *
 * The projects it can be filtered to come from the Projects repository, so a
 * project created on the Projects screen is selectable here too.
 */
export default async function KeywordsPage() {
  const projects = projectOptionsFrom(await projectRepository.listProjects());

  return (
    <Suspense fallback={<KeywordsFallback />}>
      <KeywordsWorkspace projects={projects} />
    </Suspense>
  );
}

function KeywordsFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      {/* Widths are capped to the container: a fixed `w-96` here is wider
          than a 375px viewport and pushes the page sideways for as long as the
          fallback is on screen. */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-full max-w-64" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Panel as="div" key={index} className="p-3.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-16" />
            <Skeleton className="mt-3 h-3 w-full" />
          </Panel>
        ))}
      </div>
      <Panel>
        <div className="space-y-3 p-4 sm:p-5">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </Panel>
    </div>
  );
}
