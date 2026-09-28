import type { Metadata } from "next";
import { Suspense } from "react";
import { ObservedReport } from "@/components/reports/observed-report";
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
  title: "Reports",
  description:
    "One stored project's report, generated on read from its Search Console windows, crawl findings, tasks, SEO Director plan and articles — observed data only.",
};

/**
 * Reports on read (checkpoint 6.4, decision Q6): the report is generated in
 * the browser from the chosen project's stored records each time the screen
 * opens; nothing is stored. The fixture report library and its per-report
 * route (`/reports/[reportId]`) are gone. `useSearchParams` (the `?project=`
 * other screens' links carry) needs a Suspense boundary.
 */
export default async function ReportsPage() {
  const projects = projectOptionsFrom(await projectRepository.listProjects());

  return (
    <Suspense fallback={<ReportsFallback />}>
      <ObservedReport projects={projects} />
    </Suspense>
  );
}

function ReportsFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-6 w-full max-w-64" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      {Array.from({ length: 5 }, (_, index) => (
        <Panel as="div" key={index} className="space-y-3 p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
        </Panel>
      ))}
    </div>
  );
}
