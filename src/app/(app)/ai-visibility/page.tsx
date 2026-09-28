import type { Metadata } from "next";
import { Suspense } from "react";
import { AiVisibilityScreen } from "@/components/ai-visibility/observed-ai-visibility";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { projectRepository } from "@/lib/projects/repository";
import { projectOptionsFrom } from "@/lib/projects/selection";

/**
 * Rendered per request (checkpoint 5.5): the stored project list is read on
 * every visit, so a project added after a deploy appears without a rebuild.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Visibility",
  description:
    "What each page of a stored project's site declared to this product's crawler, in the fields an answer engine could read — not whether any AI engine cites it — with the answer-readiness review.",
};

/**
 * The screen reads its initial project from the query string. `useSearchParams`
 * needs a Suspense boundary during static rendering, which is what this shell
 * provides. The projects come from the Projects repository.
 */
export default async function AiVisibilityPage() {
  const projects = projectOptionsFrom(await projectRepository.listProjects());
  return (
    <Suspense fallback={<AiVisibilityFallback />}>
      <AiVisibilityScreen projects={projects} />
    </Suspense>
  );
}

function AiVisibilityFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      {/* Widths are capped to the container: a fixed width here would be wider
          than a 375px viewport and push the page sideways for as long as the
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
