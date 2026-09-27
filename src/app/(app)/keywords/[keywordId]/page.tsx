import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KeywordDetailNotice, LiveKeywordDetail } from "@/components/keywords/live-keyword-detail";
import { getOperator } from "@/lib/auth/session";
import { keywordLimiter, keywordService } from "@/lib/keywords";
import { isKeywordId } from "@/lib/keywords/contract";

type PageParams = { params: Promise<{ keywordId: string }> };

export const metadata: Metadata = {
  title: "Curated keyword · Keyword Intelligence",
  description: "One curated keyword: what an operator recorded about it, what the stored Search Console rows report for its exact query, its tasks and its history.",
};

/**
 * One curated keyword (Phase 3, checkpoint 3.5), by its `nexra_keywords`
 * id — replaced in place (decision Q2): the modelled keyword pages are gone,
 * so a fixture id is not found. Rendered on the server for every request,
 * nothing prerendered. The id's shape, then the operator, then the read
 * limit, then the service, which requires the keyword's project to be a
 * stored project; an unknown id is not found.
 */
export default async function KeywordPage({ params }: PageParams) {
  const { keywordId } = await params;
  const id = decodeURIComponent(keywordId);
  if (!isKeywordId(id)) notFound();

  const operator = await getOperator();
  if (!operator) notFound();

  const allowance = await keywordLimiter("read").consume(operator.id);
  if (!allowance.allowed) {
    return <KeywordDetailNotice title="Too many reads in a short time" description="Wait a moment and reload. Nothing is shown in place of the keyword's records." />;
  }

  const detail = await keywordService().readKeyword(id.toLowerCase());
  if (detail.status === "unavailable") {
    return <KeywordDetailNotice title="Curated keywords are not kept on this deployment" description="There is no curated keyword to show. Nothing is shown in its place." />;
  }
  if (detail.status === "not-found") notFound();

  return <LiveKeywordDetail keyword={detail.keyword} project={detail.project} events={detail.events} observed={detail.observed} history={detail.history} tasks={detail.tasks} />;
}
