import type { Metadata } from "next";
import { Suspense } from "react";
import { BacklinksWorkspace } from "@/components/backlinks/backlinks-workspace";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Backlinks & Authority",
  description:
    "The link profile: referring domains, backlinks, anchor distribution, the pages earning links, competitor link gaps, profile risk, and the outreach they produce.",
};

/**
 * The workspace reads its initial project from the query string, so links from
 * the Command Center and from a project land on a filtered view.
 * `useSearchParams` needs a Suspense boundary during static rendering, which is
 * what this shell provides.
 */
export default function BacklinksPage() {
  return (
    <Suspense fallback={<BacklinksFallback />}>
      <BacklinksWorkspace />
    </Suspense>
  );
}

function BacklinksFallback() {
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
