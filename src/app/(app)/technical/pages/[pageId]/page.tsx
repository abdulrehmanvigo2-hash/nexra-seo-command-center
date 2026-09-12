import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TechnicalPageWorkspace } from "@/components/technical/page-workspace";
import { getTechnicalPage, getTechnicalPageIds } from "@/lib/mock/technical";

type PageParams = { params: Promise<{ pageId: string }> };

/**
 * Every published URL is prerendered: the inventory is derived from the content
 * layer at build time, so an id outside it is a broken link rather than a page
 * we have not diagnosed yet. An unknown id renders on demand and falls through
 * to `notFound()`, as in Projects.
 */
export function generateStaticParams() {
  return getTechnicalPageIds().map((pageId) => ({ pageId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { pageId } = await params;
  const page = getTechnicalPage(decodeURIComponent(pageId));

  if (!page) {
    return { title: "Page not found" };
  }

  return {
    title: `${page.title} · Technical`,
    description: `Technical diagnostics for ${page.path} on ${page.projectName}: response, indexing, metadata, internal linking, Core Web Vitals, structured data, and every finding open against the URL.`,
  };
}

export default async function TechnicalPageDetailPage({ params }: PageParams) {
  const { pageId } = await params;
  const id = decodeURIComponent(pageId);

  if (!getTechnicalPage(id)) {
    notFound();
  }

  return <TechnicalPageWorkspace pageId={id} />;
}
