import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LivePageDetail, PageDetailNotice } from "@/components/technical/live-page-detail";
import { logFailure } from "@/lib/agent-runs/http";
import { getOperator } from "@/lib/auth/session";
import { crawlLimiter, crawlService } from "@/lib/crawl";
import { presentPageDetail } from "@/lib/crawl/page-detail";

type PageParams = { params: Promise<{ pageId: string }> };

/** A crawl page's own id. The fixture `tech-*` ids never match, so they fall through to not-found. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Page detail · Technical",
  description: "What this product's own crawl recorded for one page: how it answered, what it declared, what it carried, how it linked, and the findings that name it.",
};

/**
 * One recorded page of one of a stored project's own crawls (Phase 3,
 * checkpoint 3.3), by the crawl page's own id.
 *
 * Rendered on the server for every request — nothing is prerendered, and the
 * modelled inventory is gone. The operator is checked and the crawl read
 * limit consumed before anything is read; the service checks the page →
 * crawl → project chain, so an unknown id, a fixture id, a competitor
 * crawl's page or a page whose project is gone is not found.
 */
export default async function TechnicalPageDetailPage({ params }: PageParams) {
  const { pageId } = await params;
  const id = decodeURIComponent(pageId);
  if (!UUID.test(id)) notFound();

  const operator = await getOperator();
  if (!operator) notFound();

  const allowance = await crawlLimiter("read").consume(operator.id);
  if (!allowance.allowed) {
    return <PageDetailNotice title="Too many reads in a short time" description="Wait a moment and reload. Nothing is shown in place of the page's records." />;
  }

  let detail: Awaited<ReturnType<ReturnType<typeof crawlService>["getCrawlPageDetail"]>>;
  try {
    detail = await crawlService().getCrawlPageDetail(id.toLowerCase());
  } catch (error) {
    // The error's name only; the notice names no cause (fix F7, audit A4-07).
    logFailure("technical page detail", error);
    return <PageDetailNotice title="The crawl records could not be read" description="The page's crawl records could not be read just now. Reload in a moment. Nothing is shown in their place." />;
  }
  if (detail.status === "unavailable") {
    return <PageDetailNotice title="Crawls are not stored on this deployment" description="There is no recorded page to show. Nothing is shown in its place." />;
  }
  if (detail.status === "not-found") notFound();

  return <LivePageDetail view={presentPageDetail(detail)} />;
}
