import type { Metadata } from "next";
import { Suspense } from "react";
import { ObservedCommandCenter } from "@/components/dashboard/observed-command-center";
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
  title: "Command Center",
  description:
    "One stored project's Search Console window, crawl findings, open tasks, recent agent runs and content pipeline — observed data only.",
};

/**
 * The Command Center over stored data (checkpoint 6.3): the stored project
 * list comes from the Projects repository, and each tile reads that project's
 * own records through an existing route. `useSearchParams` (the `?project=`
 * the tiles' links carry) needs a Suspense boundary.
 */
export default async function CommandCenterPage() {
  const projects = projectOptionsFrom(await projectRepository.listProjects());

  return (
    <Suspense fallback={<CommandCenterFallback />}>
      <ObservedCommandCenter projects={projects} />
    </Suspense>
  );
}

function CommandCenterFallback() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-full max-w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Panel as="div" key={index} className="space-y-3 p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-3 w-full" />
          </Panel>
        ))}
      </div>
    </div>
  );
}
