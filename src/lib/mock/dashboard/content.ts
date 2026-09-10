import {
  getContentGapOpportunities,
  getSnapshotCounts,
  getSnapshotPages,
} from "@/lib/mock/content";
import type { ContentSnapshot, DashboardProject, DateRange } from "@/types/dashboard";

/**
 * Page-level content performance for the Command Center, split into the four
 * buckets an editor works from: what is winning, what is slipping, what is
 * worth writing, and what has just shipped.
 *
 * Nothing here is authored any more. Every page, its position, its state, and
 * the reason it sits in its bucket come from the canonical content layer in
 * `@/lib/mock/content`, which derives them from the keyword registry. A page
 * called decaying on this panel is the page called decaying in the Content
 * Studio, because they are one record read twice.
 *
 * The counters are real counts rather than scaled shares, which is the one
 * place this differs from the keyword snapshot beside it. The keyword
 * dashboard extrapolates from an analysed sample to a much larger tracked
 * universe; there is no larger universe of pages behind the content records,
 * so extrapolating would invent pages that do not exist.
 *
 * `opportunities` is the count of content gaps the studio would commission for
 * this project — the same queue, counted the same way.
 */
export function buildContentSnapshot(
  project: DashboardProject,
  range: DateRange,
): ContentSnapshot {
  const pages = getSnapshotPages(project.id, range);
  const counts = getSnapshotCounts(project.id, range);

  const gaps = getContentGapOpportunities();
  const opportunities =
    project.id === "portfolio"
      ? gaps.length
      : gaps.filter((gap) => gap.projectId === project.id).length;

  return {
    pages,
    decayAlerts: counts.decayAlerts,
    needsRefresh: counts.needsRefresh,
    publishedInWindow: counts.publishedInWindow,
    opportunities,
  };
}
