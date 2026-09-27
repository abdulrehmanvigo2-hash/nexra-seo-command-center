import type { Metadata } from "next";
import { Suspense } from "react";
import { CompetitorsScreen } from "@/components/competitors/observed-competitors";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { projectRepository } from "@/lib/projects/repository";
import { projectOptionsFrom } from "@/lib/projects/selection";

export const metadata: Metadata = {
  title: "Competitor Intelligence",
  description:
    "The competitor domains recorded for a stored project, and what each site's pages declared as this product crawled them, side by side, with the comparison review.",
};

/**
 * The screen reads its initial project from the query string. `useSearchParams`
 * needs a Suspense boundary during static rendering, which is what this shell
 * provides. The projects come from the Projects repository.
 */
export default async function CompetitorsPage() {
  const projects = projectOptionsFrom(await projectRepository.listProjects());
  return (
    <Suspense fallback={<CompetitorsFallback />}>
      <CompetitorsScreen projects={projects} />
    </Suspense>
  );
}

function CompetitorsFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-6 w-full max-w-64" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      <Panel>
        <div className="space-y-3 p-4 sm:p-5">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </Panel>
    </div>
  );
}
