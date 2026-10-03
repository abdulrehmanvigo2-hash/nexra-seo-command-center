import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublishView } from "@/components/publishing/publish-view";
import { getPublisher } from "@/lib/auth/session";
import { isUuid } from "@/lib/publishing/contract";

export const metadata: Metadata = {
  title: "Publish",
  description: "One publication request: the exact files it would write to the website, and the one press that publishes it.",
};

export const dynamic = "force-dynamic";

/**
 * The publish page (P-L2, PR 7): one publication request, keyed by the id of the 6.8 approval it recorded — the link
 * *Ready to publish* opens. Outside the app shell, so a reviewer (P-L2 PR 3) sees this page and nothing else. Opening
 * it reads only: the request, the mode and, while it is requested, the files rendered at the website's current `main`.
 * The press is a POST from the page; GET never acts.
 */
export default async function PublishPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = await params;
  if (!isUuid(approvalId)) notFound();
  const publisher = await getPublisher();
  if (!publisher) notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <PublishView approvalId={approvalId} role={publisher.role} />
    </main>
  );
}
