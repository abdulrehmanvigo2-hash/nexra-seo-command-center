import type { Metadata } from "next";
import { Suspense } from "react";
import { TechnicalSeo } from "@/components/technical/technical-seo";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { projectRepository } from "@/lib/projects/repository";
import { projectOptionsFrom } from "@/lib/projects/selection";

export const metadata: Metadata = {
  title: "Technical SEO",
  description:
    "What this product's own crawl of a stored project observed: how its pages answered, what they declared, and what fixed rules found.",
};

/**
 * The workspace reads its initial project and tab from the query string, so
 * links from the Command Center and from a project land on that project.
 * `useSearchParams` needs a Suspense boundary during static rendering, which is
 * what this shell provides.
 *
 * The stored roster comes from the Projects repository: every section reads a
 * stored project's own crawl records (checkpoint 3.2); nothing is fixture data.
 */
export default async function TechnicalSeoPage() {
  const storedProjects = projectOptionsFrom(await projectRepository.listProjects());

  return (
    <Suspense fallback={<TechnicalFallback />}>
      <TechnicalSeo storedProjects={storedProjects} />
    </Suspense>
  );
}

function TechnicalFallback() {
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
