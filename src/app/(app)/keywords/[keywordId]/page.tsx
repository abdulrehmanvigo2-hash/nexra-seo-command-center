import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KeywordWorkspace } from "@/components/keywords/keyword-workspace";
import { getKeywordIds, getKeywordRecord } from "@/lib/mock/keywords";

type PageParams = { params: Promise<{ keywordId: string }> };

/**
 * Every analysed keyword is prerendered: the registry is a fixed set, so an id
 * that is not in it is a broken link rather than a keyword that has not been
 * researched yet. An unknown id renders on demand and falls through to
 * `notFound()`, as in Projects.
 */
export function generateStaticParams() {
  return getKeywordIds().map((keywordId) => ({ keywordId }));
}

export async function generateMetadata({
  params,
}: PageParams): Promise<Metadata> {
  const { keywordId } = await params;
  const record = getKeywordRecord(decodeURIComponent(keywordId));

  if (!record) {
    return { title: "Keyword not found" };
  }

  return {
    title: record.keyword,
    description: `${record.projectName} · ${record.clusterName}. Position, difficulty, traffic potential, SERP features, and answer-engine readiness.`,
  };
}

export default async function KeywordPage({ params }: PageParams) {
  const { keywordId } = await params;
  const id = decodeURIComponent(keywordId);

  if (!getKeywordRecord(id)) {
    notFound();
  }

  return <KeywordWorkspace keywordId={id} />;
}
