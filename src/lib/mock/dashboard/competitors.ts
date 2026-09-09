import {
  clamp,
  deltaFor,
  jitter,
  pickSubset,
  randInt,
  round,
  volumeFor,
} from "@/lib/mock/dashboard/core";
import type {
  CompetitorRow,
  CompetitorSnapshot,
  DashboardProject,
  DateRange,
  TrendSeries,
} from "@/types/dashboard";

/**
 * Where the selected project sits against its tracked competitive set.
 *
 * The brands below are invented for the demo and refer to no real company.
 * Their visibility is derived from the project's own health, so a stronger
 * project genuinely leads its set rather than the ranking being fixed.
 */

type RivalSeed = {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  /** Visibility share before the selected project's health is applied. */
  readonly baseVisibility: number;
  readonly baseOverlap: number;
};

const RIVALS: readonly RivalSeed[] = [
  { id: "northpeak", name: "Northpeak", domain: "northpeak.example", baseVisibility: 18.4, baseOverlap: 61 },
  { id: "cartograph", name: "Cartograph", domain: "cartograph.example", baseVisibility: 15.2, baseOverlap: 54 },
  { id: "bellhaven", name: "Bellhaven", domain: "bellhaven.example", baseVisibility: 12.7, baseOverlap: 47 },
  { id: "quantly", name: "Quantly", domain: "quantly.example", baseVisibility: 9.8, baseOverlap: 38 },
  { id: "fernbrook", name: "Fernbrook", domain: "fernbrook.example", baseVisibility: 7.4, baseOverlap: 33 },
  { id: "havenline", name: "Havenline", domain: "havenline.example", baseVisibility: 5.1, baseOverlap: 21 },
];

export function buildCompetitorSnapshot(
  project: DashboardProject,
  range: DateRange,
  trend: TrendSeries,
): CompetitorSnapshot {
  const selfVisibility = round(
    clamp(16.2 + project.healthOffset * 0.42 + jitter(project.seed, 61, 1.4), 2, 42),
    1,
  );

  const selected = project.portfolio
    ? RIVALS
    : pickSubset(RIVALS, project.seed + 37, randInt(project.seed, 38, 4, 5));

  const rivals: readonly CompetitorRow[] = selected.map((rival, index) => {
    const visibility = round(
      clamp(rival.baseVisibility + jitter(project.seed, index + 62, 2.2), 1, 45),
      1,
    );
    const change = deltaFor(project, range, index + 70, 0.8, 5.6);

    return {
      id: `${project.id}-${rival.id}`,
      name: rival.name,
      domain: rival.domain,
      visibility,
      keywordOverlap: Math.round(
        clamp(rival.baseOverlap + jitter(project.seed, index + 63, 6), 8, 92),
      ),
      estimatedTraffic: volumeFor(
        project,
        Math.round(visibility * 22_400),
        index + 64,
      ),
      contentGaps: randInt(project.seed, index + 65, 28, 460),
      trend: { value: change },
      gaining: change > 2.5,
    };
  });

  const gapOpportunities = rivals.reduce(
    (carry, rival) => carry + rival.contentGaps,
    0,
  );

  return {
    self: {
      name: project.portfolio ? "Tracked portfolio" : project.name,
      domain: project.domain,
      visibility: selfVisibility,
      estimatedTraffic: trend.totals.organicTraffic,
      trend: { value: trend.deltas.organicTraffic },
    },
    rivals: [...rivals].sort((a, b) => b.visibility - a.visibility),
    gapOpportunities,
    sharedKeywords: randInt(project.seed, 66, 640, 4_800),
  };
}
