import { getContentRecords } from "@/lib/mock/content";
import {
  DORMANT_TRAFFIC,
  PERFORMING_SHARE,
  headroomFor,
  pageStateFor,
  ratio,
} from "@/lib/mock/analytics/scoring";
import type { PagePerformance } from "@/types/analytics";

/**
 * Published pages, read for how they are performing.
 *
 * The inventory is Content Studio's and is referenced by `contentId` — this
 * module adds the performance reading and nothing else. Traffic, potential,
 * position and the content score are all figures that layer already computes.
 *
 * A page is judged against its own potential rather than against other pages.
 * A location page carrying 80 sessions out of a possible 95 is doing its job;
 * ranking it below a guide carrying 400 out of a possible 3,000 would be
 * measuring size rather than performance.
 */

let cache: readonly PagePerformance[] | null = null;

function build(): readonly PagePerformance[] {
  return getContentRecords()
    .filter((record) => record.url !== null)
    .map((record) => {
      const state = pageStateFor({
        traffic: record.traffic,
        potential: record.trafficPotential,
        positionChange: record.positionChange,
        health: record.health,
      });

      const share = ratio(record.traffic, Math.max(record.trafficPotential, 1));

      const reason =
        state === "dormant"
          ? `Under ${DORMANT_TRAFFIC} sessions a month — too little to read either way.`
          : state === "decaying"
            ? record.positionChange <= -3
              ? `Down ${Math.abs(record.positionChange)} places on average across its keywords.`
              : "Losing ground against the positions it held."
            : state === "compounding"
              ? `Carrying ${share}% of its potential and still gaining position.`
              : state === "steady"
                ? `Carrying ${share}% of its potential, holding position.`
                : `At ${share}% of what its own keywords could carry, against a ${PERFORMING_SHARE}% mark.`;

      return {
        contentId: record.id,
        title: record.title,
        path: (record.url as string).replace(/^https?:\/\/[^/]+/, ""),
        projectId: record.projectId,
        projectName: record.projectName,
        clusterId: record.clusterId,
        clusterName: record.clusterName,
        traffic: record.traffic,
        potential: record.trafficPotential,
        headroom: Math.max(record.trafficPotential - record.traffic, 0),
        opportunityValue: record.opportunityValue,
        keywords: record.keywordCount,
        keywordsInTopTen: record.keywordsInTopTen,
        averagePosition: record.averagePosition,
        positionChange: record.positionChange,
        contentScore: record.score.score,
        state,
        reason,
      } satisfies PagePerformance;
    });
}

export function getPagePerformance(): readonly PagePerformance[] {
  cache ??= build();
  return cache;
}

export function pagePerformanceFor(
  contentId: string,
): PagePerformance | null {
  return (
    getPagePerformance().find((page) => page.contentId === contentId) ?? null
  );
}

export function pagesForProject(
  projectId: string,
): readonly PagePerformance[] {
  return getPagePerformance().filter((page) => page.projectId === projectId);
}

export { headroomFor };
